// Shared effect resolvers used by cards.ts (card plays) and skills.ts
// (skill-triggered effects). Imports only engine.ts + hooks.ts — no cycles.
// All discard-validation is conversion-aware (canActAs: Wraith strike↔evade,
// Ronan red=strike, Mort red=stim, …).
import {
  ask,
  dealDamage,
  defIdOf,
  discardFromHand,
  emit,
  gameEnded,
  turnOrderFrom,
  type DamageKind,
  type Game,
} from "./engine.js";
import { canActAs as canActAsPure } from "./hooks.js";

function canActAs(game: Game, playerId: string, cardId: string, asDefId: string): boolean {
  const inst = game.cards.get(cardId);
  if (!inst) return false;
  return canActAsPure(game.state.players[playerId]?.survivorId, inst, asDefId);
}

/** Standoff (Duel): challenger & defender alternate discarding Strikes;
 *  first who can't/won't takes 1 (+bonus) damage. Challenger goes first.
 *  Barehide Chem Rage adds +1 to the challenger's duel damage (buffs flag). */
export function resolveStandoff(
  game: Game,
  challengerId: string,
  defenderId: string,
): void {
  let current = challengerId;
  const other = (id: string) => (id === challengerId ? defenderId : challengerId);

  const step = (): void => {
    if (gameEnded(game)) return;
    const cur = game.state.players[current]!;
    const opp = game.state.players[other(current)]!;
    if (!cur.alive || !opp.alive) return;

    ask(game, {
      playerId: current,
      kind: "discard_strike",
      context: { standoffWith: other(current) },
      validate: (action) => {
        if (action.kind === "decline") return null;
        if (action.kind !== "discard" || action.cardIds.length !== 1) return "E_BAD_ACTION";
        const c = action.cardIds[0]!;
        return cur.hand.includes(c) && canActAs(game, current, c, "strike") ? null : "E_NOT_STRIKE";
      },
      resume: (action) => {
        if (gameEnded(game)) return;
        if (action?.kind === "discard") {
          discardFromHand(game, current, action.cardIds, "standoff");
          current = other(current);
          step();
        } else {
          // can't/won't → takes damage; Barehide buff of the OTHER player adds +1
          const bonus = game.state.players[other(current)]!.buffs.barehideMode ? 1 : 0;
          dealDamage(game, {
            targetId: current,
            amount: 1 + bonus,
            element: "none",
            sourcePlayerId: other(current),
            damageKind: "standoff",
          });
        }
      },
    });
  };

  step();
}

/** Mortar Rain: every other alive player discards an Evade or takes 1 damage. */
export function resolveMortarRain(game: Game, playerId: string, kind: DamageKind = "mortar"): void {
  const others = turnOrderFrom(game, playerId).filter((id) => id !== playerId);
  let idx = 0;
  const step = (): void => {
    if (gameEnded(game)) return;
    while (idx < others.length && !game.state.players[others[idx]!]!.alive) idx++;
    if (idx >= others.length) return;
    const tid = others[idx++]!;
    const canEvade = game.state.players[tid]!.hand.some((c) => canActAs(game, tid, c, "evade"));
    if (!canEvade) {
      dealDamage(game, { targetId: tid, amount: 1, element: "none", sourcePlayerId: playerId, damageKind: kind });
      step();
      return;
    }
    ask(game, {
      playerId: tid,
      kind: "discard_evade",
      context: { via: "mortar_rain", sourceId: playerId },
      validate: (action) => {
        if (action.kind === "decline") return null;
        if (action.kind !== "discard" || action.cardIds.length !== 1) return "E_BAD_ACTION";
        const c = action.cardIds[0]!;
        return game.state.players[tid]!.hand.includes(c) && canActAs(game, tid, c, "evade")
          ? null
          : "E_BAD_EVADE";
      },
      resume: (action) => {
        if (gameEnded(game)) return;
        if (action?.kind === "discard") {
          discardFromHand(game, tid, action.cardIds, "mortar_evade");
        } else {
          dealDamage(game, { targetId: tid, amount: 1, element: "none", sourcePlayerId: playerId, damageKind: kind });
        }
        step();
      },
    });
  };
  step();
}

/** Mutant Horde: every other alive player discards a Strike or takes 1 damage. */
export function resolveMutantHorde(game: Game, playerId: string): void {
  const others = turnOrderFrom(game, playerId).filter((id) => id !== playerId);
  let idx = 0;
  const step = (): void => {
    if (gameEnded(game)) return;
    while (idx < others.length && !game.state.players[others[idx]!]!.alive) idx++;
    if (idx >= others.length) return;
    const tid = others[idx++]!;
    const canDiscard = game.state.players[tid]!.hand.some((c) => canActAs(game, tid, c, "strike"));
    if (!canDiscard) {
      dealDamage(game, { targetId: tid, amount: 1, element: "none", sourcePlayerId: playerId, damageKind: "horde" });
      step();
      return;
    }
    ask(game, {
      playerId: tid,
      kind: "discard_strike",
      context: { via: "mutant_horde", sourceId: playerId },
      validate: (action) => {
        if (action.kind === "decline") return null;
        if (action.kind !== "discard" || action.cardIds.length !== 1) return "E_BAD_ACTION";
        const c = action.cardIds[0]!;
        return game.state.players[tid]!.hand.includes(c) && canActAs(game, tid, c, "strike")
          ? null
          : "E_NOT_STRIKE";
      },
      resume: (action) => {
        if (gameEnded(game)) return;
        if (action?.kind === "discard") {
          discardFromHand(game, tid, action.cardIds, "horde_discard");
        } else {
          dealDamage(game, { targetId: tid, amount: 1, element: "none", sourcePlayerId: playerId, damageKind: "horde" });
        }
        step();
      },
    });
  };
  step();
}

/** Field Clinic: all injured alive players heal 1 (capped at max). */
export function resolveFieldClinic(game: Game, playerId: string): void {
  for (const p of Object.values(game.state.players)) {
    if (p.alive && p.hp < p.maxHp) {
      const before = p.hp;
      p.hp = Math.min(p.maxHp, p.hp + 1);
      emit(game, { type: "heal", targetId: p.id, amount: p.hp - before, sourcePlayerId: playerId });
    }
  }
}

/** Supply Drop: reveal N (alive count) cards; each alive player picks 1 in turn order. */
export function resolveSupplyDrop(game: Game, playerId: string): void {
  if (gameEnded(game)) return;
  const alive = Object.values(game.state.players).filter((p) => p.alive);
  const n = alive.length;
  const revealed: string[] = [];
  for (let i = 0; i < n; i++) {
    if (game.state.deck.length === 0) {
      if (game.state.discard.length === 0) break;
      game.state.deck = game.rng.shuffle(game.state.discard.splice(0, game.state.discard.length));
      emit(game, { type: "reshuffle" });
    }
    revealed.push(game.state.deck.pop()!);
  }
  game.revealed = revealed;

  const order = turnOrderFrom(game, playerId);
  let pickIdx = 0;

  const step = (): void => {
    if (gameEnded(game) || game.revealed.length === 0) {
      game.state.discard.push(...game.revealed.splice(0));
      return;
    }
    while (pickIdx < order.length && !game.state.players[order[pickIdx]!]!.alive) pickIdx++;
    if (pickIdx >= order.length) {
      game.state.discard.push(...game.revealed.splice(0));
      return;
    }
    const pid = order[pickIdx++]!;
    const options = [...game.revealed];
    ask(game, {
      playerId: pid,
      kind: "supply_pick",
      context: { options },
      validate: (action) => {
        if (action.kind === "decline") return null; // timeout → random pick
        return action.kind === "choose" && game.revealed.includes(action.choice)
          ? null
          : "E_BAD_CHOICE";
      },
      resume: (action) => {
        if (gameEnded(game)) return;
        const chosen = action?.kind === "choose" ? action.choice : game.rng.pick(game.revealed);
        const idx = game.revealed.indexOf(chosen);
        if (idx >= 0) {
          game.revealed.splice(idx, 1);
          game.state.players[pid]!.hand.push(chosen);
          emit(game, { type: "cards_drawn", playerId: pid, count: 1 });
        }
        step();
      },
    });
  };

  step();
}

export { defIdOf };
