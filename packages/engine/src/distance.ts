// Distance calculation (doc 01 §4.5) — seat circle, alive players only.
import type { CardInstance, GameState, PlayerState } from "@ashfall/shared";
import { CARD_DEFS } from "@ashfall/shared";

/** Seat distance: min(clockwise, counter-clockwise) steps among ALIVE players only. */
export function seatDistance(state: GameState, aId: string, bId: string): number {
  const alive = state.turnOrder
    .map((id) => state.players[id]!)
    .filter((p) => p.alive);
  if (alive.length < 2) return 0;
  const ia = alive.findIndex((p) => p.id === aId);
  const ib = alive.findIndex((p) => p.id === bId);
  if (ia === -1 || ib === -1) throw new Error("distance query for dead/unknown player");
  const n = alive.length;
  const cw = (ib - ia + n) % n;
  const ccw = (ia - ib + n) % n;
  return Math.min(cw, ccw);
}

/** Effective distance A→B: seat dist + B's bulwark (+1 rig) − A's scout (−1 rig) − A's rider_kaan passive. */
export function distance(state: GameState, aId: string, bId: string): number {
  const a: PlayerState = state.players[aId]!;
  const b: PlayerState = state.players[bId]!;
  let d = seatDistance(state, aId, bId);
  if (b.equipment.rig_plus) d += 1;
  if (a.equipment.rig_minus) d -= 1;
  if (a.survivorId === "rider_kaan") d -= 1; // Iron Charge: permanent −1
  return Math.max(0, d);
}

/** Attack range of a player: equipped weapon range, else 1. */
export function attackRange(state: GameState, pId: string, cards: ReadonlyMap<string, CardInstance>): number {
  const p = state.players[pId]!;
  if (!p.equipment.weapon) return 1;
  const inst = cards.get(p.equipment.weapon);
  if (!inst) return 1;
  return CARD_DEFS[inst.defId]?.range ?? 1;
}

/** Can A strike B right now (distance vs weapon range)? */
export function inAttackRange(
  state: GameState,
  aId: string,
  bId: string,
  cards: ReadonlyMap<string, CardInstance>,
): boolean {
  return distance(state, aId, bId) <= attackRange(state, aId, cards);
}
