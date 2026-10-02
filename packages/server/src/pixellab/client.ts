// PixelLab API v2 client — synchronous generation endpoints with credit
// guardrails (doc 03): balance floor, monthly cap, ledger.
//
// Used by tools/artgen CLI and (staging only) the in-app admin regen tool.
// NEVER bundled into the client; NEVER present in prod runtime (no key).
import { createHash } from "node:crypto";

const BASE = "https://api.pixellab.ai/v2";

export interface PixelLabConfig {
  apiKey: string;
  /** refuse generation when balance is below this (generations) */
  floor?: number;
  /** monthly cap on generations (default 2000; staging sub-cap e.g. 300) */
  monthlyCap?: number;
  /** ledger sink — append-only record of every spend */
  ledger?: (entry: LedgerEntry) => void;
  /** fetch impl (injectable for tests) */
  fetchImpl?: typeof fetch;
  /** fixed "now" for deterministic tests */
  now?: () => Date;
}

export interface LedgerEntry {
  at: string; // ISO
  endpoint: string;
  assetId?: string;
  generations: number;
  usd?: number;
  balanceAfter?: number;
}

export interface BalanceInfo {
  credits: { type: string; usd?: number };
  subscription?: {
    type: string;
    status: string;
    plan?: string;
    generations?: number;
    total?: number;
  };
}

export interface GenerateImageOptions {
  description: string;
  width: number;
  height: number;
  /** pixen only: style/consistency seed */
  seed?: number;
  noBackground?: boolean;
  enhancePrompt?: boolean;
  model?: "pixen" | "pixflux";
}

export interface GenerateResult {
  png: Buffer;
  usage: { generations: number; usd?: number };
  enhancedPrompt?: string;
  hash: string; // sha256 of png — dedupe/content addressing
}

export class PixelLabError extends Error {
  constructor(public code: string, message: string, public status?: number) {
    super(message);
  }
}

export class PixelLabClient {
  private cfg: Required<Pick<PixelLabConfig, "floor" | "monthlyCap">> & PixelLabConfig;
  private fetchImpl: typeof fetch;
  private cachedBalance?: { at: number; info: BalanceInfo };
  private monthSpend = 0; // generations this calendar month (from ledger or in-memory)

  constructor(cfg: PixelLabConfig) {
    if (!cfg.apiKey) throw new PixelLabError("E_NO_KEY", "PIXELLAB_API_KEY is not set");
    this.cfg = { floor: 50, monthlyCap: 2000, ...cfg };
    this.fetchImpl = cfg.fetchImpl ?? fetch;
  }

  setMonthSpend(generations: number): void {
    this.monthSpend = generations;
  }

  async balance(force = false): Promise<BalanceInfo> {
    const now = Date.now();
    if (!force && this.cachedBalance && now - this.cachedBalance.at < 60_000) {
      return this.cachedBalance.info;
    }
    const res = await this.fetchImpl(`${BASE}/balance`, {
      headers: { Authorization: `Bearer ${this.cfg.apiKey}` },
    });
    if (!res.ok) {
      throw new PixelLabError("E_BALANCE", `balance check failed: ${res.status}`, res.status);
    }
    const info = (await res.json()) as BalanceInfo;
    this.cachedBalance = { at: now, info };
    return info;
  }

  /** Remaining generations on the subscription (or Infinity if USD credits). */
  async remainingGenerations(): Promise<number> {
    const b = await this.balance();
    if (b.subscription?.type === "generations" && typeof b.subscription.generations === "number") {
      return b.subscription.generations;
    }
    return Infinity; // usd-based account — cap still applies via ledger
  }

  /** Guardrails: balance floor + monthly cap. Throws before spending. */
  async assertCanSpend(generations = 1): Promise<void> {
    if (this.monthSpend + generations > this.cfg.monthlyCap) {
      throw new PixelLabError(
        "E_MONTHLY_CAP",
        `monthly cap reached: ${this.monthSpend}+${generations} > ${this.cfg.monthlyCap}`,
      );
    }
    const remaining = await this.remainingGenerations();
    if (remaining !== Infinity && remaining - generations < this.cfg.floor) {
      throw new PixelLabError(
        "E_BALANCE_FLOOR",
        `balance ${remaining} below floor ${this.cfg.floor} (would spend ${generations})`,
      );
    }
  }

  async generateImage(opts: GenerateImageOptions, assetId?: string): Promise<GenerateResult> {
    await this.assertCanSpend(1);
    const model = opts.model ?? "pixen";
    const endpoint = model === "pixen" ? "/create-image-pixen" : "/create-image-pixflux";
    const body: Record<string, unknown> = {
      description: opts.description,
      image_size: { width: opts.width, height: opts.height },
      no_background: opts.noBackground ?? false,
    };
    if (model === "pixen") {
      if (opts.seed !== undefined) body.seed = opts.seed;
      if (opts.enhancePrompt) body.enhance_prompt = true;
    }

    const res = await this.fetchImpl(`${BASE}${endpoint}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.cfg.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new PixelLabError(
        "E_GENERATE",
        `${endpoint} failed: ${res.status} ${text.slice(0, 300)}`,
        res.status,
      );
    }
    const data = (await res.json()) as {
      image: { base64: string; format?: string };
      usage?: { generations?: number | null; usd?: number | null };
      enhanced_prompt?: string | null;
    };
    const png = Buffer.from(data.image.base64, "base64");
    const generations = data.usage?.generations ?? 1;
    this.monthSpend += generations;

    this.cfg.ledger?.({
      at: (this.cfg.now?.() ?? new Date()).toISOString(),
      endpoint,
      assetId,
      generations,
      ...(data.usage?.usd != null ? { usd: data.usage.usd } : {}),
    });

    return {
      png,
      usage: { generations, ...(data.usage?.usd != null ? { usd: data.usage.usd } : {}) },
      ...(data.enhanced_prompt ? { enhancedPrompt: data.enhanced_prompt } : {}),
      hash: createHash("sha256").update(png).digest("hex").slice(0, 16),
    };
  }

  /** Post-process: reduce to a shared palette (style consistency). */
  async reduceColors(images: string[], numColors: number): Promise<Buffer[]> {
    const res = await this.fetchImpl(`${BASE}/reduce-colors`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.cfg.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ images, num_colors: numColors }),
    });
    if (!res.ok) {
      throw new PixelLabError("E_REDUCE", `reduce-colors failed: ${res.status}`, res.status);
    }
    const data = (await res.json()) as { images: { base64: string }[] };
    return data.images.map((i) => Buffer.from(i.base64, "base64"));
  }

  /** Post-process: transparent background. */
  async removeBackground(imageB64: string, width: number, height: number): Promise<Buffer> {
    const res = await this.fetchImpl(`${BASE}/remove-background`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.cfg.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        image: imageB64,
        image_size: { width, height },
      }),
    });
    if (!res.ok) {
      throw new PixelLabError("E_REMOVE_BG", `remove-background failed: ${res.status}`, res.status);
    }
    const data = (await res.json()) as { image: { base64: string } };
    return Buffer.from(data.image.base64, "base64");
  }
}
