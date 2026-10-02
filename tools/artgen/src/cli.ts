// artgen CLI — batch asset generation with credit guardrails (doc 03).
//
//   pnpm artgen plan     show worklist + projected generations
//   pnpm artgen probe    generate style master + 2 probes → report ACTUAL cost
//   pnpm artgen run      generate all missing slots (--group filter, --max-generations)
//   pnpm artgen approve  mark generated assets approved (writes to client assets)
//   pnpm artgen status   balance, ledger month-to-date, coverage
//
// Env: PIXELLAB_API_KEY (required), ARTGEN_LEDGER (default tools/artgen/ledger.jsonl),
//      ARTGEN_OUT (default tools/artgen/work), PIXELLAB_MONTHLY_CAP, PIXELLAB_FLOOR
import { existsSync, mkdirSync, readFileSync, appendFileSync, writeFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { createHash } from "node:crypto";
import { PixelLabClient, type LedgerEntry } from "@ashfall/server/dist/pixellab/client.js";
import { ALL_SLOTS, STYLE_MASTER, type AssetSlot } from "./manifest.js";

const ROOT = new URL("../../../", import.meta.url).pathname.replace(/\/$/, "");
const OUT_DIR = process.env.ARTGEN_OUT ?? join(ROOT, "tools/artgen/work");
const LEDGER_PATH = process.env.ARTGEN_LEDGER ?? join(ROOT, "tools/artgen/ledger.jsonl");
const CLIENT_ASSETS = join(ROOT, "packages/client/src/assets/generated");

function readLedger(): LedgerEntry[] {
  if (!existsSync(LEDGER_PATH)) return [];
  return readFileSync(LEDGER_PATH, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as LedgerEntry);
}

function monthSpend(): number {
  const now = new Date();
  const prefix = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  return readLedger()
    .filter((e) => e.at.startsWith(prefix))
    .reduce((sum, e) => sum + e.generations, 0);
}

function approvedState(): Record<string, string> {
  const p = join(ROOT, "tools/artgen/approved.json");
  if (!existsSync(p)) return {};
  return JSON.parse(readFileSync(p, "utf8")) as Record<string, string>;
}

function makeClient(): PixelLabClient {
  const apiKey = process.env.PIXELLAB_API_KEY;
  if (!apiKey) {
    console.error("PIXELLAB_API_KEY not set. Copy it into your environment (never commit it).");
    process.exit(1);
  }
  return new PixelLabClient({
    apiKey,
    floor: Number(process.env.PIXELLAB_FLOOR ?? 50),
    monthlyCap: Number(process.env.PIXELLAB_MONTHLY_CAP ?? 2000),
    ledger: (entry) => {
      mkdirSync(dirname(LEDGER_PATH), { recursive: true });
      appendFileSync(LEDGER_PATH, JSON.stringify(entry) + "\n");
      console.log(`  [ledger] ${entry.endpoint} ${entry.generations} gen${entry.usd != null ? ` ($${entry.usd})` : ""}${entry.assetId ? ` for ${entry.assetId}` : ""}`);
    },
  });
}

// Style seed: derived from the approved style master (all styleSeeded slots use it)
const STYLE_SEED = 20261001;

function outPath(slot: AssetSlot): string {
  return join(OUT_DIR, slot.file);
}

async function generateSlot(client: PixelLabClient, slot: AssetSlot): Promise<void> {
  mkdirSync(dirname(outPath(slot)), { recursive: true });
  console.log(`→ ${slot.id} (${slot.width}×${slot.height})`);
  const result = await client.generateImage(
    {
      description: slot.prompt,
      width: slot.width,
      height: slot.height,
      ...(slot.noBackground ? { noBackground: true } : {}),
      ...(slot.styleSeeded ? { seed: STYLE_SEED } : {}),
      model: "pixen",
    },
    slot.id,
  );
  writeFileSync(outPath(slot), result.png);
  console.log(`  saved ${outPath(slot)} (hash ${result.hash}, ${result.usage.generations} gen)`);
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

async function cmdPlan(): Promise<void> {
  const done = new Set(
    existsSync(OUT_DIR)
      ? walkFiles(OUT_DIR).map((f) => f.replace(OUT_DIR + "/", ""))
      : [],
  );
  const missing = ALL_SLOTS.filter((s) => !done.has(s.file));
  console.log(`manifest: ${ALL_SLOTS.length} slots total`);
  console.log(`generated: ${ALL_SLOTS.length - missing.length}, missing: ${missing.length}`);
  const byGroup = new Map<string, number>();
  for (const s of missing) byGroup.set(s.group, (byGroup.get(s.group) ?? 0) + 1);
  for (const [g, n] of byGroup) console.log(`  ${g}: ${n}`);
  console.log(`projected generations for missing: ${missing.length}`);
  console.log(`month-to-date spend: ${monthSpend()}`);
}

function walkFiles(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...walkFiles(p));
    else out.push(p);
  }
  return out;
}

async function cmdProbe(): Promise<void> {
  const client = makeClient();
  client.setMonthSpend(monthSpend());
  const before = await client.balance(true);
  console.log("balance before:", JSON.stringify(before));

  // probe 1: the style master (real asset, not wasted)
  await generateSlot(client, STYLE_MASTER);
  // probe 2: one survivor
  const surv = ALL_SLOTS.find((s) => s.group === "survivor")!;
  await generateSlot(client, surv);

  const after = await client.balance(true);
  console.log("balance after:", JSON.stringify(after));
  const usedGen =
    (before.subscription?.generations ?? 0) - (after.subscription?.generations ?? 0);
  console.log(`\nACTUAL cost of 2 probes: ${usedGen} generations`);
  console.log(`projected full pack (${ALL_SLOTS.length} slots): ~${Math.ceil((usedGen / 2) * ALL_SLOTS.length)} generations`);
  console.log(`your monthly budget: ${client ? process.env.PIXELLAB_MONTHLY_CAP ?? 2000 : "?"}`);
  console.log("\nInspect tools/artgen/work/style_master.png and the survivor probe.");
  console.log("If the style is right → run: pnpm artgen run");
}

async function cmdRun(filterGroup?: string, maxGens?: number): Promise<void> {
  const client = makeClient();
  client.setMonthSpend(monthSpend());

  const done = new Set(
    existsSync(OUT_DIR) ? walkFiles(OUT_DIR).map((f) => f.replace(OUT_DIR + "/", "")) : [],
  );
  let slots = ALL_SLOTS.filter((s) => !done.has(s.file));
  if (filterGroup) slots = slots.filter((s) => s.group === filterGroup);
  if (maxGens !== undefined) slots = slots.slice(0, maxGens);

  console.log(`generating ${slots.length} slot(s)...`);
  let failures = 0;
  for (const slot of slots) {
    try {
      await generateSlot(client, slot);
    } catch (err) {
      failures++;
      console.error(`  FAILED ${slot.id}: ${(err as Error).message}`);
      if ((err as { code?: string }).code === "E_MONTHLY_CAP" || (err as { code?: string }).code === "E_BALANCE_FLOOR") {
        console.error("guardrail hit — stopping.");
        break;
      }
      // single retry on transient failure
      try {
        await generateSlot(client, slot);
        failures--;
      } catch (err2) {
        console.error(`  retry FAILED ${slot.id}: ${(err2 as Error).message}`);
      }
    }
  }
  console.log(`done. failures: ${failures}. month-to-date: ${monthSpend()} generations`);
}

async function cmdApprove(): Promise<void> {
  // Approve = copy from work/ into client assets + record hash in approved.json
  mkdirSync(CLIENT_ASSETS, { recursive: true });
  const approved = approvedState();
  let copied = 0;
  for (const slot of ALL_SLOTS) {
    const src = outPath(slot);
    if (!existsSync(src)) continue;
    const png = readFileSync(src);
    const hash = createHash("sha256").update(png).digest("hex").slice(0, 16);
    if (approved[slot.id] === hash) continue; // unchanged
    const dest = join(CLIENT_ASSETS, slot.file);
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, png);
    approved[slot.id] = hash;
    copied++;
    console.log(`approved ${slot.id} → ${dest.replace(ROOT + "/", "")}`);
  }
  writeFileSync(join(ROOT, "tools/artgen/approved.json"), JSON.stringify(approved, null, 2));
  console.log(`\n${copied} asset(s) approved into client bundle.`);
  const missing = ALL_SLOTS.filter((s) => !existsSync(outPath(s)));
  if (missing.length > 0) {
    console.log(`still missing (${missing.length}): ${missing.map((m) => m.id).join(", ")}`);
  }
}

async function cmdStatus(): Promise<void> {
  const client = makeClient();
  const balance = await client.balance(true);
  console.log("balance:", JSON.stringify(balance.subscription ?? balance.credits));
  console.log(`month-to-date: ${monthSpend()} generations (cap ${process.env.PIXELLAB_MONTHLY_CAP ?? 2000})`);
  const done = new Set(existsSync(OUT_DIR) ? walkFiles(OUT_DIR).map((f) => f.replace(OUT_DIR + "/", "")) : []);
  const approved = approvedState();
  console.log(`coverage: generated ${done.size}/${ALL_SLOTS.length}, approved ${Object.keys(approved).length}/${ALL_SLOTS.length}`);
}

// ---------------------------------------------------------------------------

const [cmd, ...args] = process.argv.slice(2);
const groupArg = args.find((a) => a.startsWith("--group="))?.split("=")[1];
const maxArg = args.find((a) => a.startsWith("--max-generations="))?.split("=")[1];

(async () => {
  switch (cmd) {
    case "plan": await cmdPlan(); break;
    case "probe": await cmdProbe(); break;
    case "run": await cmdRun(groupArg, maxArg ? Number(maxArg) : undefined); break;
    case "approve": await cmdApprove(); break;
    case "status": await cmdStatus(); break;
    default:
      console.log(`usage: artgen <plan|probe|run|approve|status> [--group=X] [--max-generations=N]`);
  }
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
