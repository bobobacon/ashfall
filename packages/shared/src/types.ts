// ASHFALL: The Last Bastion — core type definitions (shared client/server)
// Mechanics reference: WTK manual; theme is original post-apocalypse fantasy.

export type Suit = "spade" | "heart" | "club" | "diamond";
export type Role = "sovereign" | "warden" | "raider" | "phantom";
export type Faction = "syndicate" | "verdant" | "tide" | "walker" | "ascendant";
export type Gender = "male" | "female";
export type Element = "none" | "burn" | "ion";

export type CardCategory = "basic" | "tactic" | "delay" | "equipment";
export type EquipmentSlot = "weapon" | "armor" | "rig_plus" | "rig_minus";

export type TargetRule =
  | { kind: "none" }
  | { kind: "any_player" }
  | { kind: "within_distance"; range: number }
  | { kind: "within_attack_range" }
  | { kind: "all_others" }
  | { kind: "player_with_weapon" };

export interface CardDef {
  defId: string;
  name: { en: string; th: string };
  category: CardCategory;
  /** replaces-WTK mapping kept in code comments only, never shipped to UI */
  subtype?: EquipmentSlot;
  range?: number;
  element: Element;
  targets: TargetRule;
  /** short bilingual rules text shown in UI */
  text: { en: string; th: string };
}

/** A concrete card instance in a deck */
export interface CardInstance {
  id: string; // unique, e.g. "strike_07"
  defId: string; // e.g. "strike"
  suit: Suit;
  number: number; // 1..13
}

export type SkillKind = "passive" | "active" | "sovereign" | "awaken";

export interface SkillDef {
  id: string;
  name: { en: string; th: string };
  description: { en: string; th: string };
  kind: SkillKind;
  oncePerTurn?: boolean;
}

export interface SurvivorDef {
  id: string;
  name: { en: string; th: string };
  faction: Faction;
  gender: Gender;
  maxHp: number;
  skills: SkillDef[];
  /** faction leader — extra draft pick offered to the Sovereign */
  isLeader?: boolean;
}

export type GamePhase = "lobby" | "role_deal" | "draft" | "playing" | "ended";
export type TurnPhase = "start" | "draw" | "play" | "end";

export interface DelayedCard {
  cardId: string; // instance id of the delayed card on the table
  defId: "ion_storm" | "ration_cut" | "lockdown";
  placedBy: string; // player id
  receivedAt: number; // logical timestamp; LIFO by most-recent-first
}

export interface EquipmentState {
  weapon?: string; // card instance id
  armor?: string;
  rig_plus?: string;
  rig_minus?: string;
}

export interface PlayerState {
  id: string;
  seat: number;
  name: string;
  role: Role;
  roleRevealed: boolean;
  survivorId?: string;
  hp: number;
  maxHp: number;
  hand: string[];
  equipment: EquipmentState;
  delayed: DelayedCard[];
  tethered: boolean;
  alive: boolean;
  flipped: boolean; // skip-next-turn (Bunker Down / Void Tithe)
  strikeCountThisTurn: number;
  buffs: {
    chemBrewNext: boolean;
    barehideMode: boolean;
  };
  marks: Record<string, number>; // Soul Ledger revenge marks
  connected: boolean;
  isBot: boolean;
}

export type PromptKind =
  | "discard_strike"
  | "discard_evade"
  | "use_stim"
  | "jam"
  | "fate_hack"
  | "choose_hand_card"
  | "choose_discard"
  | "reorder_deck"
  | "give_cards"
  | "standoff"
  | "proxy_war"
  | "blood_debt";

export interface Prompt {
  id: string;
  playerId: string;
  kind: PromptKind;
  context: Record<string, unknown>;
  deadlineMs: number; // server epoch ms
}

export interface GameSettings {
  turnTimerMs: number;
  expansions: {
    tether: boolean;
    ascendants: boolean;
    awaken: boolean;
  };
  allowSpectators: boolean;
  allowBots: boolean;
}

export interface WinnerInfo {
  faction: Role; // winning role ("citadel" wins reported as "sovereign")
  reason: string;
}

export interface GameState {
  roomId: string;
  seed: number;
  phase: GamePhase;
  turnOrder: string[];
  currentPlayerId?: string;
  turnPhase?: TurnPhase;
  turnNumber: number;
  deck: string[]; // card instance ids, top = last
  discard: string[];
  players: Record<string, PlayerState>;
  pendingPrompts: Prompt[];
  winner?: WinnerInfo;
  settings: GameSettings;
  seq: number; // monotonic event counter
}

export const DEFAULT_SETTINGS: GameSettings = {
  turnTimerMs: 30_000,
  expansions: { tether: false, ascendants: false, awaken: false },
  allowSpectators: true,
  allowBots: true,
};

/** Role distribution by player count (WTK manual §2.1 mapping) */
export const ROLE_DISTRIBUTION: Record<number, Record<Role, number>> = {
  3: { sovereign: 1, warden: 0, raider: 1, phantom: 1 },
  4: { sovereign: 1, warden: 1, raider: 1, phantom: 1 },
  5: { sovereign: 1, warden: 1, raider: 2, phantom: 1 },
  6: { sovereign: 1, warden: 1, raider: 3, phantom: 1 },
  7: { sovereign: 1, warden: 2, raider: 3, phantom: 1 },
  8: { sovereign: 1, warden: 2, raider: 4, phantom: 1 },
  9: { sovereign: 1, warden: 3, raider: 4, phantom: 1 },
  10: { sovereign: 1, warden: 3, raider: 4, phantom: 2 },
};
