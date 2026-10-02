// Game view store — Svelte 5 runes-based reactive state (.svelte.ts).
// Applies server views/events into state any component can read reactively.
import type { ServerMsgT } from "@ashfall/shared";

export interface RoomPlayerInfo {
  id: string;
  name: string;
  seat: number;
  connected: boolean;
  isBot: boolean;
}

export interface RoomInfo {
  roomId: string;
  phase: string;
  hostId?: string;
  players: RoomPlayerInfo[];
  spectators: number;
}

export interface PromptInfo {
  id: string;
  playerId: string;
  kind: string;
  context: Record<string, unknown>;
  deadlineMs: number;
}

export interface GameEndedInfo {
  winner: string;
  reason: string;
  roles: Record<string, string>;
}

// The engine's PlayerView type isn't importable client-side without pulling
// engine code into the bundle; mirror its shape structurally.
export interface ViewPlayerOther {
  id: string;
  name: string;
  seat: number;
  alive: boolean;
  connected: boolean;
  handCount: number;
  role?: string;
  survivorId?: string;
  hp: number;
  maxHp: number;
  equipment: Record<string, string | undefined>;
  equipDefs: Partial<Record<"weapon" | "armor" | "rig_plus" | "rig_minus", string>>;
  delayed: { defId: string; placedBy: string }[];
  tethered: boolean;
  flipped: boolean;
}

export interface ViewYou {
  id: string;
  name: string;
  seat: number;
  role: string;
  survivorId?: string;
  draftOffer?: string[];
  hp: number;
  maxHp: number;
  hand: string[];
  equipment: Record<string, string | undefined>;
  delayed: { defId: string; placedBy: string }[];
  tethered: boolean;
  flipped: boolean;
  buffs: Record<string, boolean>;
}

export interface CardInstanceInfo {
  id: string;
  defId: string;
  suit: "spade" | "heart" | "club" | "diamond";
  number: number;
}

export interface GameView {
  you: ViewYou;
  others: ViewPlayerOther[];
  cardDetails?: Record<string, CardInstanceInfo>;
  phase: string;
  turnPhase?: string;
  currentPlayerId?: string;
  turnNumber: number;
  turnOrder: { id: string; seat: number; alive: boolean }[];
  deckCount: number;
  discardCount: number;
  topDiscardId?: string;
  pendingPrompts: unknown[];
  winner?: { faction: string; reason: string };
  settings: unknown;
  seq: number;
}

export interface CardMeta {
  defId: string;
  name: { en: string; th: string };
  category: string;
  text: { en: string; th: string };
  subtype?: string;
  range?: number;
}
export interface SurvivorMeta {
  id: string;
  name: { en: string; th: string };
  faction: string;
  gender: string;
  maxHp: number;
  skills: { id: string; name: { en: string; th: string }; description: { en: string; th: string } }[];
}

class GameStore {
  room = $state<RoomInfo | null>(null);
  view = $state<GameView | null>(null);
  prompt = $state<PromptInfo | null>(null);
  ended = $state<GameEndedInfo | null>(null);
  events = $state<{ type: string; [k: string]: unknown }[]>([]);
  myPlayerId = $state<string | null>(null);
  lang = $state<"en" | "th">("en");

  // meta (loaded once from /api/meta)
  cards = $state<Record<string, CardMeta>>({});
  survivors = $state<Record<string, SurvivorMeta>>({});
  metaLoaded = $state(false);

  // local player display name (persisted)
  private _name = $state("");
  playerName(): string {
    return this._name;
  }
  setPlayerName(n: string): void {
    this._name = n;
    try {
      localStorage.setItem("ashfall:name", n);
    } catch {
      /* private mode */
    }
  }
  loadName(): void {
    try {
      this._name = localStorage.getItem("ashfall:name") ?? "";
    } catch {
      this._name = "";
    }
  }

  async loadMeta(): Promise<void> {
    if (this.metaLoaded) return;
    try {
      const res = await fetch("/api/meta");
      const data = (await res.json()) as { cards: Record<string, CardMeta>; survivors: Record<string, SurvivorMeta> };
      this.cards = data.cards;
      this.survivors = data.survivors;
      this.metaLoaded = true;
    } catch {
      /* offline / not ready */
    }
  }

  cardName(defId: string): string {
    const c = this.cards[defId];
    return c ? c.name[this.lang] : defId;
  }
  survivorName(id?: string): string {
    if (!id) return "—";
    const s = this.survivors[id];
    return s ? s.name[this.lang] : id;
  }

  get screen(): "home" | "lobby" | "draft" | "game" | "winner" {
    if (this.ended) return "winner";
    if (!this.room) return "home";
    if (this.view?.phase === "draft") return "draft";
    if (this.view && (this.view.phase === "playing" || this.view.phase === "ended")) return "game";
    return "lobby";
  }

  handle(msg: ServerMsgT): void {
    switch (msg.type) {
      case "room:joined":
        this.myPlayerId = msg.playerId;
        this.ended = null;
        break;
      case "room:update":
        this.room = {
          roomId: msg.roomId,
          phase: msg.phase,
          hostId: msg.hostId,
          players: msg.players as RoomPlayerInfo[],
          spectators: msg.spectators,
        };
        break;
      case "game:view":
        this.view = msg.view as GameView;
        // prompt cleared when the view says nothing pending for me
        if (this.prompt && !(this.view.pendingPrompts as { playerId?: string }[]).some(
          (p) => p.playerId === this.myPlayerId,
        )) {
          this.prompt = null;
        }
        break;
      case "game:event": {
        const evs = msg.events as { type: string }[];
        this.events = [...this.events, ...evs].slice(-80);
        break;
      }
      case "game:prompt":
        this.prompt = msg.prompt as unknown as PromptInfo;
        break;
      case "game:ended":
        this.ended = { winner: msg.winner, reason: msg.reason, roles: msg.roles };
        this.prompt = null;
        break;
      case "error":
        // surface as a transient event line (screens can render toasts)
        this.events = [...this.events, { type: "error", code: msg.code, message: msg.message }].slice(-80);
        break;
      default:
        break;
    }
  }

  reset(): void {
    this.room = null;
    this.view = null;
    this.prompt = null;
    this.ended = null;
    this.events = [];
  }
}

export const gameStore = new GameStore();
