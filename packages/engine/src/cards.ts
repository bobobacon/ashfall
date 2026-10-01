// Card play system (M2): playCard intents for all basic/tactic/delayed cards.
// Strike↔Evade flow with prompt stack; Signal Jam windows on tactics;
// Standoff & Proxy War sub-games; delayed card placement.
import {
  CARD_DEFS,
  isRed,
  type CardInstance,
} from "@ashfall/shared";
import {
  EngineError,
  ask,
  dealDamage,
  defIdOf,
  discardFromHand,
  drawCards,
  emit,
  enterDying,
  flipFate,
  gameEnded,
  handDefIds,
  heal,
  jamWindow,
  nextAlive,
  placeDelayed,
  turnOrderFrom,
  type DamageKind,
  type Game,
} from "./engine.js";
import { distance, inAttackRange } from "./distance.js";

export interface PlayCardRequest {
  playerId: string;
  cardId: string;
  targets?: string[];
}

/** Validate + execute a play-phase card intent (or a response-phase card via respond()). */
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
  const def = CARD_DEFS[inst.defId]!;
  const targets = req.targets ?? [];

  switch (inst.defId) {
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
      playWithJam(game, req.playerId, req.cardId, inst.defId, targets, () =>
        resolveScavenge(game, req.playerId, targets[0]!),
      );
      return;
    case "sabotage":
      requireTarget(game, targets, 1);
      requireNotGhost(game, targets[0]!);
      playWithJam(game, req.playerId, req.cardId, inst.defId, targets, () =>
        resolveSabotage(game, req.playerId, req.cardId, targets[0]!),
      );
      return;
    case "proxy_war":
      requireTarget(game, targets, 2);
      playWithJam(game, req.playerId, req.cardId, inst.defId, targets, () =>
        resolveProxyWar(game, req.playerId, targets[0]!, targets[1]!),
      );
      return;
    case "standoff":
      requireTarget(game, targets, 1);
      requireNotGhost(game, targets[0]!);
      playWithJam(game, req.playerId, req.cardId, inst.defId, targets, () =>
        resolveStandoff(game, req.playerId, req.playerId, targets[0]!),
      );
      return;
    case "supply_drop":
      playWithJam(game, req.playerId, req.cardId, inst.defId, targets, () =>
        resolveSupplyDrop(game, req.playerId),
      );
      return;
    case "mortar_rain":
      playWithJam(game, req.playerId, req.cardId, inst.defId, targets, () =>
        resolveMortarRain(game, req.playerId, "mortar"),
      );
      return;
    case "mutant_horde":
      playWithJam(game, req.playerId, req.cardId, inst.defId, targets, () =>
        resolveMutantHorde(game, req.playerId),
      );
      return;
    case "field_clinic":
      playWithJam(game, req.playerId, req.cardId, inst.defId, targets, () =>
        resolveFieldClinic(game, req.playerId),
      );
      return;
    case "signal_jam":
      throw new EngineError("E_RESPONSE_ONLY", "signal jam is only played in response");

    // --- delayed tactics (placed on a player, jam-able) ---
    case "ion_storm":
      // no duplicate rule: only one Ion Storm in play at a time (standard)
      if (Object.values(game.state.players).some((pl) => pl.alive && pl.delayed.some((d) => d.defId === "ion_storm"))) {
        throw new EngineError("E_DUP_DELAYED", "an ion storm is already in play");
      }
      playDelayed(game, req.playerId, req.cardId, "ion_storm", req.playerId, targets);
      return;
    case "ration_cut":
      requireTarget(game, targets, 1);
      requireWithinDistance(game, req.playerId, targets[0]!, 1);
      playDelayed(game, req.playerId, req.cardId, "ration_cut", targets[0]!, targets);
      return;
    case "lockdown":
      requireTarget(game, targets, 1);
      playDelayed(game, req.playerId, req.cardId, "lockdown", targets[0]!, targets);
      return;

    // --- equipment (M3) ---
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
      throw new EngineError("E_UNKNOWN_CARD", `unhandled card: ${inst.defId}`);
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
function isGhostProtected(game: Game, targetId: string): boolean {
  const t = game.state.players[targetId]!;
  return t.survivorId === "sage_aldric" && t.hand.length === 0;
}

function requireNotGhost(game: Game, targetId: string): void {
  if (isGhostProtected(game, targetId)) {
    throw new EngineError("E_GHOST_SIGNAL", "target is untargetable (empty hand)");
  }
}

/** Consume a card from hand to discard as "played". */
function consumePlayed(game: Game, playerId: string, cardId: string, defId: string, targets?: string[]): void {
  discardFromHand(game, playerId, [cardId], "played");
  emit(game, { type: "card_played", playerId, cardId, defId, targets });
}

/** Play an instant tactic: consume card, open jam window, apply effect if it survives. */
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
    onCancel: () => {
      /* card already in discard; effect fizzles */
    },
  });
}

// --- Strike flow ------------------------------------------------------------

export function playStrike(game: Game, playerId: string, cardId: string, targetId?: string): void {
  const p = game.state.players[playerId]!;
  if (!targetId) throw new EngineError("E_BAD_TARGETS", "strike needs a target");
  const target = game.state.players[targetId];
  if (!target || !target.alive || targetId === playerId) {
    throw new EngineError("E_BAD_TARGETS", "invalid strike target");
  }
  if (isGhostProtected(game, targetId)) {
    throw new EngineError("E_GHOST_SIGNAL", "target is untargetable (empty hand)");
  }
  // strike limit: 1/turn (M4 skills & M3 Auto-Rifle lift it)
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

  // Holo-Barrier: free fate check first — red counts as an evaded strike
  const armorId = target.equipment.armor;
  const armorDef = armorId ? CARD_DEFS[game.cards.get(armorId)!.defId] : undefined;
  const plasmaAttacker =
    p.equipment.weapon != null &&
    game.cards.get(p.equipment.weapon)!.defId === "plasma_cutter";
  if (armorDef?.defId === "holo_barrier" && !plasmaAttacker) {
    const fate = flipFate(game, { forPlayerId: targetId, outcome: "holo_barrier" });
    if (isRed(fate.suit)) {
      return; // barrier dodged the strike
    }
  }

  // Evade window: target may respond (Lu Bu-style 2-evade skills hook in M4)
  const evadeRequired = 1;
  ask(game, {
    playerId: targetId,
    kind: "discard_evade",
    context: { sourceId: playerId, cardId, required: evadeRequired },
    validate: (action) => {
      if (action.kind === "decline") return null;
      if (action.kind !== "discard") return "E_BAD_ACTION";
      const ok =
        action.cardIds.length === evadeRequired &&
        action.cardIds.every(
          (c) => game.state.players[targetId]!.hand.includes(c) && defIdOf(game, c) === "evade",
        );
      return ok ? null : "E_BAD_EVADE";
    },
    resume: (action) => {
      if (gameEnded(game)) return;
      if (action?.kind === "discard") {
        discardFromHand(game, targetId, action.cardIds, "evade");
        emit(game, { type: "card_played", playerId: targetId, cardId: action.cardIds[0]!, defId: "evade" });
        // Railgun (Heaven Halberd): strike evaded → may discard 2 to strike another
        railgunFollowUp(game, playerId, targetId);
        return;
      }
      dealDamage(game, {
        targetId,
        amount,
        element: "none",
        sourcePlayerId: playerId,
        sourceCardId: cardId,
        damageKind: "strike",
      });
    },
  });
}

/** Railgun chain attack: after an evaded strike, its wielder may discard 2 cards
 *  to strike a DIFFERENT target (once per evade, still within their turn). */
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
      // choice = JSON: { cardIds: [c1, c2], targetId }
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
      strikeEvadeWindow(game, playerId, parsed.targetId, undefined, amount);
    },
  });
}

/** Strike limit for a player: base 1; Auto-Rifle (M3) & War Bellow (M4) lift it. */
export function strikeLimit(game: Game, playerId: string): number {
  const p = game.state.players[playerId]!;
  if (p.survivorId === "grog_thunderlung") return Infinity; // War Bellow
  if (p.equipment.weapon) {
    const w = game.cards.get(p.equipment.weapon)!;
    if (w.defId === "auto_rifle") return Infinity;
  }
  return 1;
}

/** Scrap Launcher special: discard 2 hand cards to issue a Strike (once/turn, active). */
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
  if (isGhostProtected(game, targetId)) throw new EngineError("E_GHOST_SIGNAL", "target untargetable");
  if (!inAttackRange(game.state, playerId, targetId, game.cards)) {
    throw new EngineError("E_OUT_OF_RANGE", "out of range");
  }

  // player chooses which 2 cards via prompt
  ask(game, {
    playerId,
    kind: "choose_hand_card",
    context: { mode: "launcher_cost", count: 2 },
    validate: (action) => {
      if (action.kind !== "discard" || action.cardIds.length !== 2) return "E_BAD_ACTION";
      const uniq = new Set(action.cardIds);
      if (uniq.size !== 2) return "E_BAD_ACTION";
      return action.cardIds.every((c) => p.hand.includes(c)) ? null : "E_NOT_IN_HAND";
    },
    resume: (action) => {
      if (gameEnded(game)) return;
      if (action?.kind !== "discard") return; // declined → nothing happens
      p.strikeCountThisTurn++;
      discardFromHand(game, playerId, action.cardIds, "launcher_cost");
      emit(game, { type: "card_played", playerId, cardId: action.cardIds[0]!, defId: "strike", targets: [targetId] });
      strikeEvadeWindow(game, playerId, targetId, undefined, 1);
    },
  });
}

/** Shared evade window for strike-class damage (normal strike, launcher, proxy). */
function strikeEvadeWindow(game: Game, attackerId: string, targetId: string, cardId?: string, amount = 1): void {
  ask(game, {
    playerId: targetId,
    kind: "discard_evade",
    context: { sourceId: attackerId, cardId, required: 1 },
    validate: (action) => {
      if (action.kind === "decline") return null;
      if (action.kind !== "discard" || action.cardIds.length !== 1) return "E_BAD_ACTION";
      const c = action.cardIds[0]!;
      return game.state.players[targetId]!.hand.includes(c) && defIdOf(game, c) === "evade"
        ? null
        : "E_BAD_EVADE";
    },
    resume: (action) => {
      if (gameEnded(game)) return;
      if (action?.kind === "discard") {
        discardFromHand(game, targetId, action.cardIds, "evade");
        emit(game, { type: "card_played", playerId: targetId, cardId: action.cardIds[0]!, defId: "evade" });
        return;
      }
      dealDamage(game, {
        targetId,
        amount,
        element: "none",
        sourcePlayerId: attackerId,
        sourceCardId: cardId,
        damageKind: "strike",
      });
    },
  });
}

// --- Stim / Chem Brew on own turn -------------------------------------------

function playStimOwnTurn(game: Game, playerId: string, cardId: string, targetId?: string): void {
  const target = targetId ?? playerId;
  const tp = game.state.players[target];
  if (!tp || !tp.alive) throw new EngineError("E_BAD_TARGETS", "invalid stim target");
  if (tp.hp >= tp.maxHp) throw new EngineError("E_FULL_HP", "target at full HP");
  consumePlayed(game, playerId, cardId, "stim", [target]);
  heal(game, target, 1, { playerId, cardId });
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
  // ask which zone: hand (random) or an equipment piece
  const zones: string[] = [];
  if (t.hand.length > 0) zones.push("hand");
  for (const slot of ["weapon", "armor", "rig_plus", "rig_minus"] as const) {
    if (t.equipment[slot]) zones.push(slot);
  }
  if (zones.length === 0) return; // nothing to take — effect fizzles

  ask(game, {
    playerId,
    kind: "choose",
    context: { zones, targetId },
    validate: (action) =>
      action.kind === "choose" && zones.includes(action.choice) ? null : "E_BAD_CHOICE",
    resume: (action) => {
      if (gameEnded(game)) return;
      const zone = action?.kind === "choose" ? action.choice : game.rng.pick(zones);
      if (zone === "hand") {
        if (t.hand.length === 0) return;
        const stolen = game.rng.pick(t.hand);
        t.hand.splice(t.hand.indexOf(stolen), 1);
        game.state.players[playerId]!.hand.push(stolen);
        emit(game, { type: "card_discarded", playerId: targetId, cardId: stolen, reason: "scavenged" });
      } else {
        const cardId = t.equipment[zone as keyof typeof t.equipment]!;
        delete t.equipment[zone as keyof typeof t.equipment];
        game.state.players[playerId]!.hand.push(cardId);
        emit(game, {
          type: "equipment_removed",
          playerId: targetId,
          cardId,
          slot: zone,
          reason: "scavenged",
        });
      }
    },
  });
}

function resolveSabotage(game: Game, playerId: string, sourceCardId: string, targetId: string): void {
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
    context: { zones, targetId },
    validate: (action) =>
      action.kind === "choose" && zones.includes(action.choice) ? null : "E_BAD_CHOICE",
    resume: (action) => {
      if (gameEnded(game)) return;
      const zone = action?.kind === "choose" ? action.choice : game.rng.pick(zones);
      if (zone === "hand") {
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
        const cardId = t.equipment[zone as keyof typeof t.equipment]!;
        delete t.equipment[zone as keyof typeof t.equipment];
        game.state.discard.push(cardId);
        emit(game, {
          type: "equipment_removed",
          playerId: targetId,
          cardId,
          slot: zone,
          reason: "sabotaged",
        });
      }
    },
  });
}

/** Standoff (Duel): challenger vs target alternate discarding Strikes.
 *  Challenger discards first (manual: ผู้เล่น 2 คนดวลการ์ดโจมตีกัน ใครไม่มีการ์ดทิ้งก่อน เสีย 1 HP). */
export function resolveStandoff(
  game: Game,
  initiatorId: string,
  challengerId: string,
  defenderId: string,
  bonusDamage = 0,
): void {
  let current = challengerId;
  const other = (id: string) => (id === challengerId ? defenderId : challengerId);

  const step = (): void => {
    if (gameEnded(game)) return;
    const aliveCur = game.state.players[current]!;
    const aliveOther = game.state.players[other(current)]!;
    if (!aliveCur.alive || !aliveOther.alive) return; // duel over via death

    const strikeCards = aliveCur.hand.filter((c) => defIdOf(game, c) === "strike");
    ask(game, {
      playerId: current,
      kind: "discard_strike",
      context: { standoffWith: other(current) },
      validate: (action) => {
        if (action.kind === "decline") return null;
        if (action.kind !== "discard" || action.cardIds.length !== 1) return "E_BAD_ACTION";
        const c = action.cardIds[0]!;
        return aliveCur.hand.includes(c) && defIdOf(game, c) === "strike" ? null : "E_NOT_STRIKE";
      },
      resume: (action) => {
        if (gameEnded(game)) return;
        if (action?.kind === "discard") {
          discardFromHand(game, current, action.cardIds, "standoff");
          current = other(current);
          step();
        } else {
          // current player can't/won't → takes 1 (+bonus) damage from the other
          const amount = 1 + bonusDamage;
          dealDamage(game, {
            targetId: current,
            amount,
            element: "none",
            sourcePlayerId: other(current),
            damageKind: "standoff",
          });
        }
      },
    });
  };

  step();
  // initiator only used for logging context
  void initiatorId;
}

function resolveProxyWar(game: Game, playerId: string, aId: string, bId: string): void {
  if (gameEnded(game)) return;
  const a = game.state.players[aId]!;
  const b = game.state.players[bId]!;
  if (!a.alive || !b.alive || aId === bId) return;
  if (!a.equipment.weapon) throw new EngineError("E_BAD_TARGETS", "proxy A has no weapon");
  if (!inAttackRange(game.state, aId, bId, game.cards)) {
    throw new EngineError("E_OUT_OF_RANGE", "B not in A's attack range");
  }
  if (isGhostProtected(game, bId)) return; // effect fizzles

  const aStrikes = a.hand.filter((c) => defIdOf(game, c) === "strike");
  ask(game, {
    playerId: aId,
    kind: "proxy_war",
    context: { forcedBy: playerId, targetId: bId },
    validate: (action) => {
      if (action.kind === "decline") return null;
      if (action.kind !== "discard" || action.cardIds.length !== 1) return "E_BAD_ACTION";
      const c = action.cardIds[0]!;
      return a.hand.includes(c) && defIdOf(game, c) === "strike" ? null : "E_NOT_STRIKE";
    },
    resume: (action) => {
      if (gameEnded(game)) return;
      if (action?.kind === "discard") {
        // A strikes B (through the normal evade flow)
        discardFromHand(game, aId, action.cardIds, "proxy_war");
        emit(game, { type: "card_played", playerId: aId, cardId: action.cardIds[0]!, defId: "strike", targets: [bId] });
        proxyStrikeEvadeWindow(game, aId, bId, action.cardIds[0]!);
      } else {
        // A refuses → initiator takes A's weapon
        const weaponId = a.equipment.weapon!;
        delete a.equipment.weapon;
        game.state.players[playerId]!.hand.push(weaponId);
        emit(game, {
          type: "equipment_removed",
          playerId: aId,
          cardId: weaponId,
          slot: "weapon",
          reason: "proxy_war_refused",
        });
      }
    },
  });
  void aStrikes;
}

/** Strike issued by Proxy War: same evade window, damage attributed to A. */
function proxyStrikeEvadeWindow(game: Game, aId: string, bId: string, cardId: string): void {
  ask(game, {
    playerId: bId,
    kind: "discard_evade",
    context: { sourceId: aId, cardId, required: 1, viaProxy: true },
    validate: (action) => {
      if (action.kind === "decline") return null;
      if (action.kind !== "discard" || action.cardIds.length !== 1) return "E_BAD_ACTION";
      const c = action.cardIds[0]!;
      return game.state.players[bId]!.hand.includes(c) && defIdOf(game, c) === "evade"
        ? null
        : "E_BAD_EVADE";
    },
    resume: (action) => {
      if (gameEnded(game)) return;
      if (action?.kind === "discard") {
        discardFromHand(game, bId, action.cardIds, "evade");
        return;
      }
      dealDamage(game, {
        targetId: bId,
        amount: 1,
        element: "none",
        sourcePlayerId: aId,
        sourceCardId: cardId,
        damageKind: "strike",
      });
    },
  });
}

function resolveSupplyDrop(game: Game, playerId: string): void {
  if (gameEnded(game)) return;
  const alive = Object.values(game.state.players).filter((p) => p.alive);
  const n = alive.length;
  // reveal n cards from the deck
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

  const order = turnOrderFrom(game, playerId).filter((id) => revealed.length > 0);
  let pickIdx = 0;

  const step = (): void => {
    if (gameEnded(game) || game.revealed.length === 0) {
      // leftover revealed cards → discard
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
      validate: (action) =>
        action.kind === "choose" && game.revealed.includes(action.choice) ? null : "E_BAD_CHOICE",
      resume: (action) => {
        if (gameEnded(game)) return;
        const chosen =
          action?.kind === "choose" ? action.choice : game.rng.pick(game.revealed);
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

function resolveMortarRain(game: Game, playerId: string, kind: DamageKind): void {
  const others = turnOrderFrom(game, playerId).filter((id) => id !== playerId);
  let idx = 0;
  const step = (): void => {
    if (gameEnded(game)) return;
    while (idx < others.length && !game.state.players[others[idx]!]!.alive) idx++;
    if (idx >= others.length) return;
    const tid = others[idx++]!;
    const hasEvade = handDefIds(game, tid).includes("evade");
    if (!hasEvade) {
      dealDamage(game, {
        targetId: tid,
        amount: 1,
        element: "none",
        sourcePlayerId: playerId,
        damageKind: kind,
      });
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
        return game.state.players[tid]!.hand.includes(c) && defIdOf(game, c) === "evade"
          ? null
          : "E_BAD_EVADE";
      },
      resume: (action) => {
        if (gameEnded(game)) return;
        if (action?.kind === "discard") {
          discardFromHand(game, tid, action.cardIds, "mortar_evade");
        } else {
          dealDamage(game, {
            targetId: tid,
            amount: 1,
            element: "none",
            sourcePlayerId: playerId,
            damageKind: kind,
          });
        }
        step();
      },
    });
  };
  step();
}

function resolveMutantHorde(game: Game, playerId: string): void {
  const others = turnOrderFrom(game, playerId).filter((id) => id !== playerId);
  let idx = 0;
  const step = (): void => {
    if (gameEnded(game)) return;
    while (idx < others.length && !game.state.players[others[idx]!]!.alive) idx++;
    if (idx >= others.length) return;
    const tid = others[idx++]!;
    const hasStrike = handDefIds(game, tid).includes("strike");
    if (!hasStrike) {
      dealDamage(game, {
        targetId: tid,
        amount: 1,
        element: "none",
        sourcePlayerId: playerId,
        damageKind: "horde",
      });
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
        return game.state.players[tid]!.hand.includes(c) && defIdOf(game, c) === "strike"
          ? null
          : "E_NOT_STRIKE";
      },
      resume: (action) => {
        if (gameEnded(game)) return;
        if (action?.kind === "discard") {
          discardFromHand(game, tid, action.cardIds, "horde_discard");
        } else {
          dealDamage(game, {
            targetId: tid,
            amount: 1,
            element: "none",
            sourcePlayerId: playerId,
            damageKind: "horde",
          });
        }
        step();
      },
    });
  };
  step();
}

function resolveFieldClinic(game: Game, playerId: string): void {
  for (const p of Object.values(game.state.players)) {
    if (p.alive && p.hp < p.maxHp) {
      heal(game, p.id, 1, { playerId });
    }
  }
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
  // Ashwalk (Lu Xun) immunity: cannot be targeted by lockdown/ration_cut
  if (t.survivorId === "ember_sage_ryn" && defId !== "ion_storm") {
    throw new EngineError("E_IMMUNE", "target is immune to this delayed card");
  }
  // no duplicate defId on the same player (standard Sanguosha rule)
  if (t.delayed.some((d) => d.defId === defId)) {
    throw new EngineError("E_DUP_DELAYED", "target already has that delayed card");
  }
  if (isGhostProtected(game, targetId) && defId !== "ion_storm") {
    throw new EngineError("E_GHOST_SIGNAL", "target untargetable (empty hand)");
  }

  // card leaves hand now; placement happens if the jam window survives
  discardFromHand(game, playerId, [cardId], "played_delayed");
  emit(game, { type: "card_played", playerId, cardId, defId, targets });
  // remove from discard — it goes onto the table when placed
  const dIdx = game.state.discard.indexOf(cardId);
  if (dIdx >= 0) game.state.discard.splice(dIdx, 1);

  jamWindow(game, {
    description: { defId, sourceId: playerId, targetIds: [targetId] },
    onApply: () => {
      if (gameEnded(game) || !game.state.players[targetId]!.alive) {
        game.state.discard.push(cardId);
        return;
      }
      placeDelayed(game, targetId, cardId, defId, playerId);
    },
    onCancel: () => {
      game.state.discard.push(cardId); // jammed → discard
    },
  });
}

// --- Equipment installation (M3) ---------------------------------------------

export function installEquipment(game: Game, playerId: string, cardId: string, inst: CardInstance): void {
  const def = CARD_DEFS[inst.defId]!;
  const slot = def.subtype!;
  const p = game.state.players[playerId]!;

  // hand → equipment slot directly (never through discard — conservation!)
  const idx = p.hand.indexOf(cardId);
  if (idx < 0) throw new EngineError("E_NOT_IN_HAND", "card not in hand");
  p.hand.splice(idx, 1);
  emit(game, { type: "card_played", playerId, cardId, defId: inst.defId });

  const old = p.equipment[slot as keyof typeof p.equipment];
  if (old) {
    game.state.discard.push(old);
    emit(game, {
      type: "equipment_replaced",
      playerId,
      oldCardId: old,
      newCardId: cardId,
      slot,
    });
  } else {
    emit(game, { type: "equipment_installed", playerId, cardId, slot });
  }
  p.equipment[slot as keyof typeof p.equipment] = cardId;
}

export { isGhostProtected, isRed, nextAlive, enterDying, flipFate };
