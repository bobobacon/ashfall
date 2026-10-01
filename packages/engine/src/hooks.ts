// Hook registry — skills.ts registers handlers here at module load; engine.ts
// calls them. This indirection keeps engine.ts free of skills imports (no cycle).
import type { DamageKind, DamageRequest } from "./engine.js";
import type { EquipmentSlot, Suit } from "@ashfall/shared";

export interface PostDamageCtx {
  game: unknown; // Game (avoid import cycle; skills.ts casts)
  playerId: string; // damage receiver (skill owner)
  sourcePlayerId?: string;
  sourceCardId?: string;
  amount: number;
  element: "none" | "burn" | "ion";
  damageKind: DamageKind;
}

export interface FlippedFate {
  cardId: string;
  suit: Suit;
  number: number;
  forPlayerId?: string;
  outcome: string;
}

export interface Hooks {
  /** before damage applies. MUST call proceed(req) exactly once — possibly with
   *  a modified request (e.g. Nyx redirect). req.noRedirect guards recursion. */
  preDamage?: (
    game: unknown,
    req: DamageRequest & { noRedirect?: boolean },
    proceed: (req: DamageRequest & { noRedirect?: boolean }) => void,
  ) => void;
  /** after HP loss, before dying resolution */
  postDamageTaken?: (ctx: PostDamageCtx) => void;
  /** after a player dies (role revealed, cards discarded) */
  onDeath?: (game: unknown, deadId: string, killerId?: string) => void;
  /** whenever a player's hand becomes empty from play/discard/give */
  onHandEmpty?: (game: unknown, playerId: string) => void;
  /** equipment left a player's slot (scavenge/sabotage/bond_weave/penalty…) */
  onEquipmentLost?: (
    game: unknown,
    playerId: string,
    cardId: string,
    slot: EquipmentSlot,
    reason: string,
  ) => void;
  /** a fate card was flipped; before the outcome is used. MUST call
   *  apply(final) exactly once, possibly with substituted suit/number (Vex). */
  modifyFate?: (
    game: unknown,
    flipped: FlippedFate,
    apply: (final: { suit: Suit; number: number }) => void,
  ) => void;
  /** start of turn, before delayed resolution. MUST call cont exactly once. */
  turnStart?: (game: unknown, playerId: string, cont: () => void) => void;
  /** draw phase. MUST call cont exactly once (after drawing or replacing). */
  modifyDraw?: (game: unknown, playerId: string, cont: () => void) => void;
  /** end of turn, before discard-down. MUST call cont exactly once. */
  turnEnd?: (game: unknown, playerId: string, cont: () => void) => void;
}

export const hooks: Hooks = {};

// ---------------------------------------------------------------------------
// Pure skill-query helpers (no engine runtime import → safe for any layer)
// ---------------------------------------------------------------------------

import { isRed, isBlack } from "@ashfall/shared";
import type { CardInstance, EquipmentState } from "@ashfall/shared";

/** Card conversion skills: can `card` (held by playerId's survivor) act as `asDefId`? */
export function canActAs(
  survivorId: string | undefined,
  card: CardInstance,
  asDefId: string,
): boolean {
  if (card.defId === asDefId) return true;
  switch (survivorId) {
    case "ronan_crimson_blade": // War Saint: every red card = strike
      return asDefId === "strike" && isRed(card.suit);
    case "corsair_bell": // Boarding Raid: every black card = sabotage
      return asDefId === "sabotage" && isBlack(card.suit);
    case "siren_lyra": // Lullaby: every diamond = lockdown
      return asDefId === "lockdown" && card.suit === "diamond";
    case "doc_mort": // Field Surgery: every red card = stim
      return asDefId === "stim" && isRed(card.suit);
    case "wraith_white_ghost": // Phase Step: strike <-> evade
      return (
        (asDefId === "strike" && card.defId === "evade") ||
        (asDefId === "evade" && card.defId === "strike")
      );
    default:
      return false;
  }
}

/** Warlord Karn: opponents need 2 Evades (vs his strikes) / 2 Strikes (duel). */
export function evadesRequiredFor(survivorId: string | undefined): number {
  return survivorId === "warlord_karn" ? 2 : 1;
}

/** Hale Deadeye: target cannot evade when hand ≥ attacker HP or has no equipment. */
export function deadeyeForbidsEvade(
  attacker: { survivorId?: string; hp: number },
  target: { hand: string[]; equipment: EquipmentState },
): boolean {
  if (attacker.survivorId !== "old_eye_hale") return false;
  if (target.hand.length >= attacker.hp) return true;
  return !Object.values(target.equipment).some(Boolean);
}

/** Can this card be used to save a dying player? (Stim always; Chem Brew self
 *  only; Doc Mort Field Surgery: any red card = Stim) */
export function canSaveWith(
  survivorId: string | undefined,
  card: CardInstance,
  isSelf: boolean,
): boolean {
  if (card.defId === "stim") return true;
  if (isSelf && card.defId === "chem_brew") return true;
  if (survivorId === "doc_mort" && isRed(card.suit)) return true;
  return false;
}
