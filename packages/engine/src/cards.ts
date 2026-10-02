// Card play system (M2/M3/M4): playCard intents for all cards, strike↔evade
// flow, delayed placement, equipment installation, launcher/railgun specials.
// Conversion skills are honored everywhere via hooks.canActAs.
import { CARD_DEFS, isRed, type CardInstance, type EquipmentSlot } from "@ashfall/shared";
import {
  EngineError,
  ask,
  dealDamage,
  defIdOf,
  discardFromHand,
  emit,
  flipFate,
  gameEnded,
  handToLimbo,
  takeFromLimbo,
  jamWindow,
  placeDelayed,
  type Game,
} from "./engine.js";
import { distance, inAttackRange } from "./distance.js";
import {
  resolveFieldClinic,
  resolveMortarRain,
  resolveMutantHorde,
  resolveStandoff,
  resolveSupplyDrop,
} from "./effects.js";
import {
  hooks,
  canActAs as canActAsPure,
  deadeyeForbidsEvade,
  evadesRequiredFor,
  canSaveWith,
} from "./hooks.js";
import { kaanFateGate, removeEquipment } from "./skills.js";

export interface PlayCardRequest {
  playerId: string;
  cardId: string;
  targets?: string[];
  /** play AS another defId via a conversion skill (red→strike etc.) */
  asDefId?: string;
}

export function canActAs(game: Game, playerId: string, cardId: string, asDefId: string): boolean {
  const inst = game.cards.get(cardId);
  if (!inst) return false;
  return canActAsPure(game.state.players[playerId]?.survivorId, inst, asDefId);
}

/** Validate + execute a play-phase card intent. */
export function playCard(game: Game, req: PlayCardRequest): void {
  const { state } = game;
  if (gameEnded(game)) throw new EngineError("E_GAME_OVER", "game ended");
  const p = state.players[req.playerId];
  if (!p || !p.alive) throw new EngineError("E_DEAD", "player not alive");
  if (state.currentPlayerId !== req.playerId) {
    throw new EngineError("E_NOT_YOUR_TURN", "not your turn");
  }
  if (state.turnPhase !== "play") throw new EngineError("E_PHASE", "not in play phase");
  if (game.pending.size > 0) throw new EngineError("E_PENDING", "responses pending");
  if (!p.hand.includes(req.cardId)) throw new EngineError("E_NOT_IN_HAND", "card not in hand");

  const inst = game.cards.get(req.cardId)!;
  const targets = req.targets ?? [];

  const effectiveDefId = req.asDefId ?? inst.defId;
  if (effectiveDefId !== inst.defId && !canActAs(game, req.playerId, req.cardId, effectiveDefId)) {
    throw new EngineError("E_NO_CONVERSION", "this survivor cannot convert that card");
  }

  switch (effectiveDefId) {
    // --- basic ---
    case "strike":
      playStrike(game, req.playerId, req.cardId, targets[0]);
      return;
    case "evade":
      throw new EngineError("E_RESPONSE_ONLY", "evade is only played in response");
    case "stim":
      playStimOwnTurn(game, req.playerId, req.cardId, targets[0]);
      return;
    case "chem_brew":
      playChemBrewOwnTurn(game, req.playerId, req.cardId);
      return;

    // --- instant tactics (jam-able) ---
    case "scavenge":
      requireTarget(game, targets, 1);
      requireWithinDistance(game, req.playerId, targets[0]!, 1);
      requireNotGhost(game, targets[0]!);
      playWithJam(game, req.playerId, req.cardId, effectiveDefId, targets, () =>
        resolveScavenge(game, req.playerId, targets[0]!),
      );
      return;
    case "sabotage":
      requireTarget(game, targets, 1);
      requireNotGhost(game, targets[0]!);
      playWithJam(game, req.playerId, req.cardId, effectiveDefId, targets, () =>
        resolveSabotage(game, req.playerId, targets[0]!),
      );
      return;
    case "proxy_war":
      requireTarget(game, targets, 2);
      playWithJam(game, req.playerId, req.cardId, effectiveDefId, targets, () =>
        resolveProxyWar(game, req.playerId, targets[0]!, targets[1]!),
      );
      return;
    case "standoff":
      requireTarget(game, targets, 1);
      requireNotGhost(game, targets[0]!);
      playWithJam(game, req.playerId, req.cardId, effectiveDefId, targets, () =>
        resolveStandoff(game, req.playerId, targets[0]!),
      );
      return;
    case "supply_drop":
      playWithJam(game, req.playerId, req.cardId, effectiveDefId, targets, () =>
        resolveSupplyDrop(game, req.playerId),
      );
      return;
    case "mortar_rain":
      playWithJam(game, req.playerId, req.cardId, effectiveDefId, targets, () =>
        resolveMortarRain(game, req.playerId, "mortar"),
      );
      return;
    case "mutant_horde":
      playWithJam(game, req.playerId, req.cardId, effectiveDefId, targets, () =>
        resolveMutantHorde(game, req.playerId),
      );
      return;
    case "field_clinic":
      playWithJam(game, req.playerId, req.cardId, effectiveDefId, targets, () =>
        resolveFieldClinic(game, req.playerId),
      );
      return;
    case "signal_jam":
      throw new EngineError("E_RESPONSE_ONLY", "signal jam is only played in response");

    // --- delayed tactics (jam-able) ---
    case "ion_storm":
      if (
        Object.values(game.state.players).some(
          (pl) => pl.alive && pl.delayed.some((d) => d.defId === "ion_storm"),
        )
      ) {
        throw new EngineError("E_DUP_DELAYED", "an ion storm is already in play");
      }
      playDelayed(game, req.playerId, req.cardId, "ion_storm", req.playerId, targets);
      return;
    case "ration_cut":
      requireTarget(game, targets, 1);
      requireWithinDistance(game, req.playerId, targets[0]!, 1);
      requireNoAshwalk(game, targets[0]!, "ration_cut");
      playDelayed(game, req.playerId, req.cardId, "ration_cut", targets[0]!, targets);
      return;
    case "lockdown":
      requireTarget(game, targets, 1);
      requireNoAshwalk(game, targets[0]!, "lockdown");
      playDelayed(game, req.playerId, req.cardId, "lockdown", targets[0]!, targets);
      return;

    // --- equipment ---
    case "auto_rifle":
    case "plasma_cutter":
    case "scrap_launcher":
    case "railgun":
    case "holo_barrier":
    case "kevlar_mesh":
    case "bulwark_rig":
    case "scout_bike":
      installEquipment(game, req.playerId, req.cardId, inst);
      return;

    default:
      throw new EngineError("E_UNKNOWN_CARD", `unhandled card: ${effectiveDefId}`);
  }
}

// --- validation helpers -----------------------------------------------------

function requireTarget(game: Game, targets: string[], n: number): void {
  if (targets.length !== n) throw new EngineError("E_BAD_TARGETS", `expected ${n} target(s)`);
  for (const t of targets) {
    const p = game.state.players[t];
    if (!p || !p.alive) throw new EngineError("E_BAD_TARGETS", `invalid target ${t}`);
  }
}

function requireWithinDistance(game: Game, from: string, to: string, range: number): void {
  if (distance(game.state, from, to) > range) {
    throw new EngineError("E_OUT_OF_RANGE", "target out of range");
  }
}

/** Ghost Signal (Sage Aldric): with 0 hand cards, untargetable by strike/targeted tactics. */
export function isGhostProtected(game: Game, targetId: string): boolean {
  const t = game.state.players[targetId]!;
  return t.survivorId === "sage_aldric" && t.hand.length === 0;
}

function requireNotGhost(game: Game, targetId: string): void {
  if (isGhostProtected(game, targetId)) {
    throw new EngineError("E_GHOST_SIGNAL", "target is untargetable (empty hand)");
  }
}

/** Ashwalk (Ember Sage Ryn): immune to Lockdown / Ration Cut. */
function requireNoAshwalk(game: Game, targetId: string, defId: string): void {
  if (game.state.players[targetId]!.survivorId === "ember_sage_ryn") {
    throw new EngineError("E_IMMUNE", `target is immune to ${defId}`);
  }
}

/** Consume a card from hand to discard as "played". */
function consumePlayed(game: Game, playerId: string, cardId: string, defId: string, targets?: string[]): void {
  discardFromHand(game, playerId, [cardId], "played");
  emit(game, { type: "card_played", playerId, cardId, defId, targets });
}

/** Play an instant tactic: consume card, open jam window, apply if it survives. */
function playWithJam(
  game: Game,
  playerId: string,
  cardId: string,
  defId: string,
  targets: string[],
  apply: () => void,
): void {
  consumePlayed(game, playerId, cardId, defId, targets);
  jamWindow(game, {
    description: { defId, sourceId: playerId, targetIds: targets },
    onApply: apply,
    onCancel: () => {},
  });
}

// --- Strike flow ------------------------------------------------------------

/** Strike limit: base 1; Auto-Rifle & War Bellow lift it. */
export function strikeLimit(game: Game, playerId: string): number {
  const p = game.state.players[playerId]!;
  if (p.survivorId === "grog_thunderlung") return Infinity; // War Bellow
  if (p.equipment.weapon) {
    const w = game.cards.get(p.equipment.weapon)!;
    if (w.defId === "auto_rifle") return Infinity;
  }
  return 1;
}

export function playStrike(game: Game, playerId: string, cardId: string, targetId?: string): void {
  const p = game.state.players[playerId]!;
  if (!targetId) throw new EngineError("E_BAD_TARGETS", "strike needs a target");
  const target = game.state.players[targetId];
  if (!target || !target.alive || targetId === playerId) {
    throw new EngineError("E_BAD_TARGETS", "invalid strike target");
  }
  requireNotGhost(game, targetId);
  if (p.strikeCountThisTurn >= strikeLimit(game, playerId)) {
    throw new EngineError("E_STRIKE_LIMIT", "strike limit reached this turn");
  }
  if (!inAttackRange(game.state, playerId, targetId, game.cards)) {
    throw new EngineError("E_OUT_OF_RANGE", "target out of attack range");
  }

  p.strikeCountThisTurn++;
  const amount = 1 + (p.buffs.chemBrewNext ? 1 : 0) + (p.buffs.barehideMode ? 1 : 0);
  p.buffs.chemBrewNext = false;
  consumePlayed(game, playerId, cardId, "strike", [targetId]);

  // Kaan Iron Charge: fate gate first (non-heart → target cannot evade)
  kaanFateGate(game, playerId, targetId, (kaanForbids) => {
    if (gameEnded(game)) return;

    // Holo-Barrier: free fate check — red counts as an evaded strike
    const armorId = target.equipment.armor;
    const armorDef = armorId ? CARD_DEFS[game.cards.get(armorId)!.defId] : undefined;
    const plasmaAttacker =
      p.equipment.weapon != null &&
      game.cards.get(p.equipment.weapon)!.defId === "plasma_cutter";

    const proceedToEvade = (): void => {
      openEvadeWindow(game, playerId, targetId, cardId, amount, {
        railgun: true,
        forbidden: kaanForbids,
      });
    };

    if (armorDef?.defId === "holo_barrier" && !plasmaAttacker) {
      flipFate(game, { forPlayerId: targetId, outcome: "holo_barrier" }, (fate) => {
        if (gameEnded(game)) return;
        if (isRed(fate.suit)) return; // barrier dodged
        proceedToEvade();
      });
    } else {
      proceedToEvade();
    }
  });
}

/** Shared evade window for strike-class damage. Skill-aware:
 *  Kaan forbidden flag, Hale Deadeye, Karn double-evade, Wraith conversions. */
export function openEvadeWindow(
  game: Game,
  attackerId: string,
  targetId: string,
  cardId: string | undefined,
  amount: number,
  opts: { railgun?: boolean; forbidden?: boolean } = {},
): void {
  const attacker = game.state.players[attackerId]!;
  const target = game.state.players[targetId]!;
  if (!target.alive) return;

  const forbidden =
    opts.forbidden === true || deadeyeForbidsEvade(attacker, target);
  if (forbidden) {
    deliverStrikeDamage(game, attackerId, targetId, cardId, amount);
    return;
  }

  const required = evadesRequiredFor(attacker.survivorId);
  const canEvade = target.hand.some((c) => canActAs(game, targetId, c, "evade"));
  if (!canEvade) {
    deliverStrikeDamage(game, attackerId, targetId, cardId, amount);
    return;
  }

  ask(game, {
    playerId: targetId,
    kind: "discard_evade",
    context: { sourceId: attackerId, cardId, required },
    validate: (action) => {
      if (action.kind === "decline") return null;
      if (action.kind !== "discard") return "E_BAD_ACTION";
      const ok =
        action.cardIds.length === required &&
        new Set(action.cardIds).size === required &&
        action.cardIds.every(
          (c) =>
            game.state.players[targetId]!.hand.includes(c) && canActAs(game, targetId, c, "evade"),
        );
      return ok ? null : "E_BAD_EVADE";
    },
    resume: (action) => {
      if (gameEnded(game)) return;
      if (action?.kind === "discard") {
        discardFromHand(game, targetId, action.cardIds, "evade");
        emit(game, {
          type: "card_played",
          playerId: targetId,
          cardId: action.cardIds[0]!,
          defId: "evade",
        });
        if (opts.railgun) railgunFollowUp(game, attackerId, targetId);
        return;
      }
      deliverStrikeDamage(game, attackerId, targetId, cardId, amount);
    },
  });
}

function deliverStrikeDamage(
  game: Game,
  attackerId: string,
  targetId: string,
  cardId: string | undefined,
  amount: number,
): void {
  dealDamage(game, {
    targetId,
    amount,
    element: "none",
    sourcePlayerId: attackerId,
    sourceCardId: cardId,
    damageKind: "strike",
  });
}

/** Railgun: after an evaded strike, may discard 2 to strike a DIFFERENT target. */
function railgunFollowUp(game: Game, playerId: string, evadedTargetId: string): void {
  const p = game.state.players[playerId]!;
  if (!p.alive) return;
  if (game.state.currentPlayerId !== playerId) return;
  const weapon = p.equipment.weapon ? game.cards.get(p.equipment.weapon) : undefined;
  if (weapon?.defId !== "railgun") return;
  if (p.hand.length < 2) return;

  ask(game, {
    playerId,
    kind: "choose_hand_card",
    context: { mode: "railgun_followup", count: 2, evadedTargetId },
    validate: (action) => {
      if (action.kind === "decline") return null;
      if (action.kind !== "choose") return "E_BAD_ACTION";
      try {
        const parsed = JSON.parse(action.choice) as { cardIds: string[]; targetId: string };
        if (!Array.isArray(parsed.cardIds) || parsed.cardIds.length !== 2) return "E_BAD_ACTION";
        if (new Set(parsed.cardIds).size !== 2) return "E_BAD_ACTION";
        if (!parsed.cardIds.every((c) => p.hand.includes(c))) return "E_NOT_IN_HAND";
        const t = game.state.players[parsed.targetId];
        if (!t?.alive || parsed.targetId === playerId || parsed.targetId === evadedTargetId) {
          return "E_BAD_TARGETS";
        }
        if (isGhostProtected(game, parsed.targetId)) return "E_GHOST_SIGNAL";
        if (!inAttackRange(game.state, playerId, parsed.targetId, game.cards)) return "E_OUT_OF_RANGE";
        return null;
      } catch {
        return "E_BAD_ACTION";
      }
    },
    resume: (action) => {
      if (gameEnded(game)) return;
      if (action?.kind !== "choose") return; // declined
      const parsed = JSON.parse(action.choice) as { cardIds: string[]; targetId: string };
      discardFromHand(game, playerId, parsed.cardIds, "railgun_followup");
      const amount = 1 + (game.state.players[playerId]!.buffs.barehideMode ? 1 : 0);
      openEvadeWindow(game, playerId, parsed.targetId, undefined, amount, { railgun: false });
    },
  });
}

/** Scrap Launcher: discard 2 hand cards to issue a Strike (active, once/turn via strike limit). */
export function launcherStrike(game: Game, playerId: string, targetId: string): void {
  const { state } = game;
  if (state.currentPlayerId !== playerId) throw new EngineError("E_NOT_YOUR_TURN", "not your turn");
  if (state.turnPhase !== "play") throw new EngineError("E_PHASE", "not in play phase");
  const p = state.players[playerId]!;
  const weapon = p.equipment.weapon ? game.cards.get(p.equipment.weapon) : undefined;
  if (weapon?.defId !== "scrap_launcher") {
    throw new EngineError("E_NO_LAUNCHER", "scrap launcher not equipped");
  }
  if (p.strikeCountThisTurn >= strikeLimit(game, playerId)) {
    throw new EngineError("E_STRIKE_LIMIT", "strike limit reached");
  }
  if (p.hand.length < 2) throw new EngineError("E_NOT_ENOUGH_CARDS", "need 2 hand cards");
  const target = state.players[targetId];
  if (!target?.alive || targetId === playerId) throw new EngineError("E_BAD_TARGETS", "invalid target");
  requireNotGhost(game, targetId);
  if (!inAttackRange(game.state, playerId, targetId, game.cards)) {
    throw new EngineError("E_OUT_OF_RANGE", "out of range");
  }

  ask(game, {
    playerId,
    kind: "choose_hand_card",
    context: { mode: "launcher_cost", count: 2 },
    validate: (action) => {
      if (action.kind === "decline") return null; // aborted → nothing happens
      if (action.kind !== "discard" || action.cardIds.length !== 2) return "E_BAD_ACTION";
      if (new Set(action.cardIds).size !== 2) return "E_BAD_ACTION";
      return action.cardIds.every((c) => p.hand.includes(c)) ? null : "E_NOT_IN_HAND";
    },
    resume: (action) => {
      if (gameEnded(game)) return;
      if (action?.kind !== "discard") return;
      p.strikeCountThisTurn++;
      discardFromHand(game, playerId, action.cardIds, "launcher_cost");
      emit(game, {
        type: "card_played",
        playerId,
        cardId: action.cardIds[0]!,
        defId: "strike",
        targets: [targetId],
      });
      const amount = 1 + (p.buffs.barehideMode ? 1 : 0);
      openEvadeWindow(game, playerId, targetId, undefined, amount);
    },
  });
}

// --- Stim / Chem Brew on own turn -------------------------------------------

function playStimOwnTurn(game: Game, playerId: string, cardId: string, targetId?: string): void {
  const target = targetId ?? playerId;
  const tp = game.state.players[target];
  if (!tp?.alive) throw new EngineError("E_BAD_TARGETS", "invalid stim target");
  if (tp.hp >= tp.maxHp) throw new EngineError("E_FULL_HP", "target at full HP");
  consumePlayed(game, playerId, cardId, "stim", [target]);
  const before = tp.hp;
  tp.hp = Math.min(tp.maxHp, tp.hp + 1);
  emit(game, { type: "heal", targetId: target, amount: tp.hp - before, sourcePlayerId: playerId, sourceCardId: cardId });
}

function playChemBrewOwnTurn(game: Game, playerId: string, cardId: string): void {
  const p = game.state.players[playerId]!;
  if (p.buffs.chemBrewNext) throw new EngineError("E_ALREADY_BUFFED", "chem brew already active");
  consumePlayed(game, playerId, cardId, "chem_brew");
  p.buffs.chemBrewNext = true;
}

// --- Instant tactics ---------------------------------------------------------

function resolveScavenge(game: Game, playerId: string, targetId: string): void {
  if (gameEnded(game)) return;
  const t = game.state.players[targetId]!;
  const zones: string[] = [];
  if (t.hand.length > 0) zones.push("hand");
  for (const slot of ["weapon", "armor", "rig_plus", "rig_minus"] as const) {
    if (t.equipment[slot]) zones.push(slot);
  }
  if (zones.length === 0) return;

  ask(game, {
    playerId,
    kind: "choose",
    context: { mode: "scavenge", zones, targetId },
    validate: (action) => {
      if (action.kind === "decline") return null; // timeout → random zone
      return action.kind === "choose" && zones.includes(action.choice) ? null : "E_BAD_CHOICE";
    },
    resume: (action) => {
      if (gameEnded(game)) return;
      const zone = (action?.kind === "choose" ? action.choice : game.rng.pick(zones)) as
        | "hand"
        | EquipmentSlot;
      if (zone === "hand") {
        if (t.hand.length === 0) return;
        const stolen = game.rng.pick(t.hand);
        t.hand.splice(t.hand.indexOf(stolen), 1);
        game.state.players[playerId]!.hand.push(stolen);
        emit(game, { type: "card_discarded", playerId: targetId, cardId: stolen, reason: "scavenged" });
      } else {
        // equipment goes directly to the taker's hand (no discard round-trip)
        removeEquipment(game, targetId, zone, "scavenged", playerId);
      }
    },
  });
}

function resolveSabotage(game: Game, playerId: string, targetId: string): void {
  if (gameEnded(game)) return;
  const t = game.state.players[targetId]!;
  const zones: string[] = [];
  if (t.hand.length > 0) zones.push("hand");
  for (const slot of ["weapon", "armor", "rig_plus", "rig_minus"] as const) {
    if (t.equipment[slot]) zones.push(slot);
  }
  for (const d of t.delayed) zones.push(`delayed:${d.cardId}`);
  if (zones.length === 0) return;

  ask(game, {
    playerId,
    kind: "choose",
    context: { mode: "sabotage", zones, targetId },
    validate: (action) => {
      if (action.kind === "decline") return null; // timeout → random zone
      return action.kind === "choose" && zones.includes(action.choice) ? null : "E_BAD_CHOICE";
    },
    resume: (action) => {
      if (gameEnded(game)) return;
      const zone = action?.kind === "choose" ? action.choice : game.rng.pick(zones);
      if (zone === "hand") {
        if (t.hand.length === 0) return;
        const destroyed = game.rng.pick(t.hand);
        discardFromHand(game, targetId, [destroyed], "sabotaged");
      } else if (zone.startsWith("delayed:")) {
        const cardId = zone.slice("delayed:".length);
        const idx = t.delayed.findIndex((d) => d.cardId === cardId);
        if (idx >= 0) {
          t.delayed.splice(idx, 1);
          game.state.discard.push(cardId);
          emit(game, { type: "card_discarded", playerId: targetId, cardId, reason: "sabotaged_delayed" });
        }
      } else {
        removeEquipment(game, targetId, zone as EquipmentSlot, "sabotaged");
      }
    },
  });
}

function resolveProxyWar(game: Game, playerId: string, aId: string, bId: string): void {
  if (gameEnded(game)) return;
  const a = game.state.players[aId]!;
  const b = game.state.players[bId]!;
  if (!a.alive || !b.alive || aId === bId) return;
  if (!a.equipment.weapon) return; // fizzles without a weapon (card already spent)
  if (!inAttackRange(game.state, aId, bId, game.cards)) return;
  if (isGhostProtected(game, bId)) return;

  ask(game, {
    playerId: aId,
    kind: "proxy_war",
    context: { forcedBy: playerId, targetId: bId },
    validate: (action) => {
      if (action.kind === "decline") return null;
      if (action.kind !== "discard" || action.cardIds.length !== 1) return "E_BAD_ACTION";
      const c = action.cardIds[0]!;
      return a.hand.includes(c) && canActAs(game, aId, c, "strike") ? null : "E_NOT_STRIKE";
    },
    resume: (action) => {
      if (gameEnded(game)) return;
      if (action?.kind === "discard") {
        discardFromHand(game, aId, action.cardIds, "proxy_war");
        emit(game, {
          type: "card_played",
          playerId: aId,
          cardId: action.cardIds[0]!,
          defId: "strike",
          targets: [bId],
        });
        openEvadeWindow(game, aId, bId, action.cardIds[0], 1, { railgun: false });
      } else {
        // refuses → initiator takes A's weapon directly into hand
        removeEquipment(game, aId, "weapon", "proxy_war_refused", playerId);
      }
    },
  });
}

// --- Delayed card placement ---------------------------------------------------

function playDelayed(
  game: Game,
  playerId: string,
  cardId: string,
  defId: "ion_storm" | "ration_cut" | "lockdown",
  targetId: string,
  targets: string[],
): void {
  const t = game.state.players[targetId]!;
  if (t.survivorId === "ember_sage_ryn" && defId !== "ion_storm") {
    throw new EngineError("E_IMMUNE", "target is immune to this delayed card");
  }
  if (t.delayed.some((d) => d.defId === defId)) {
    throw new EngineError("E_DUP_DELAYED", "target already has that delayed card");
  }
  if (isGhostProtected(game, targetId)) {
    throw new EngineError("E_GHOST_SIGNAL", "target untargetable (empty hand)");
  }

  // Card leaves hand into LIMBO (not discard!) while the jam window resolves.
  // A discard round-trip could be swallowed by a hook-triggered reshuffle
  // (e.g. Ryn Chain Burn draws on empty hand → reshuffle → the staged card ends
  // up back in the deck AND on the table = duplication). Limbo is reshuffle-proof.
  handToLimbo(game, playerId, cardId, defId, targets);

  jamWindow(game, {
    description: { defId, sourceId: playerId, targetIds: [targetId] },
    onApply: () => {
      takeFromLimbo(game, cardId);
      if (gameEnded(game) || !game.state.players[targetId]!.alive) {
        game.state.discard.push(cardId);
        return;
      }
      placeDelayed(game, targetId, cardId, defId, playerId);
    },
    onCancel: () => {
      takeFromLimbo(game, cardId);
      game.state.discard.push(cardId); // jammed → discard
    },
  });
}

// --- Equipment installation ----------------------------------------------------

export function installEquipment(game: Game, playerId: string, cardId: string, inst: CardInstance): void {
  const def = CARD_DEFS[inst.defId]!;
  const slot = def.subtype!;
  const p = game.state.players[playerId]!;

  // hand → slot directly (never through discard — conservation)
  const idx = p.hand.indexOf(cardId);
  if (idx < 0) throw new EngineError("E_NOT_IN_HAND", "card not in hand");
  p.hand.splice(idx, 1);
  emit(game, { type: "card_played", playerId, cardId, defId: inst.defId });

  const old = p.equipment[slot];
  if (old) {
    // replace: old goes to discard (Salvage triggers for Vesper)
    delete p.equipment[slot];
    game.state.discard.push(old);
    emit(game, { type: "equipment_replaced", playerId, oldCardId: old, newCardId: cardId, slot });
    hooks.onEquipmentLost?.(game, playerId, old, slot, "replaced");
  } else {
    emit(game, { type: "equipment_installed", playerId, cardId, slot });
  }
  p.equipment[slot] = cardId;
  if (p.hand.length === 0) {
    hooks.onHandEmpty?.(game, playerId);
  }
}

export { defIdOf, canSaveWith };
