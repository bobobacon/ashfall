// Survivor skills (M4) — doc 01 §6. Passive hooks register into hooks.ts at
// module load; active skills run via useSkill() intents.
//
// Import DAG (acyclic): engine ← hooks ← skills ← cards ← index
// engine.ts never imports this file; it calls the hooks registered here.
import { SURVIVOR_DEFS, type EquipmentSlot } from "@ashfall/shared";
import {
  EngineError,
  ask,
  dealDamage,
  defIdOf,
  discardFromHand,
  drawCards,
  emit,
  flipFate,
  gameEnded,
  heal,
  jamWindow,
  respond,
  type DamageRequest,
  type Game,
} from "./engine.js";
import {
  hooks,
  canActAs as canActAsPure,
  evadesRequiredFor,
  deadeyeForbidsEvade,
} from "./hooks.js";
import { resolveMortarRain, resolveStandoff } from "./effects.js";

// ---------------------------------------------------------------------------
// Skill metadata
// ---------------------------------------------------------------------------

export type ActiveSkillId =
  | "highwayman"
  | "chem_rage"
  | "bunker_down"
  | "almsgiver"
  | "reforge"
  | "bond_weave"
  | "ration_share"
  | "barter"
  | "honey_trap"
  | "triage"
  | "satellite_call"
  | "sovereign_iron_decree"
  | "sovereign_blood_oath"
  | "sovereign_tides_mercy";

interface ActiveSkillMeta {
  survivorId: string;
  /** replaces the default draw when chosen at the draw-phase prompt */
  drawPhase?: boolean;
  oncePerTurn: boolean;
  sovereignOnly?: boolean;
  /** usable while the owner is dying (via prompt bypass) */
  dying?: boolean;
}

export const ACTIVE_SKILLS: Record<ActiveSkillId, ActiveSkillMeta> = {
  highwayman: { survivorId: "marauder_kesh", drawPhase: true, oncePerTurn: true },
  chem_rage: { survivorId: "brute_barehide", drawPhase: true, oncePerTurn: true },
  ration_share: { survivorId: "quartermaster_orlo", drawPhase: true, oncePerTurn: true },
  bunker_down: { survivorId: "bastion", oncePerTurn: true },
  almsgiver: { survivorId: "matriarch_vala", oncePerTurn: false },
  reforge: { survivorId: "tide_lord_soran", oncePerTurn: false },
  bond_weave: { survivorId: "vesper_blade_dancer", oncePerTurn: false },
  barter: { survivorId: "quartermaster_orlo", oncePerTurn: true },
  honey_trap: { survivorId: "femme_black_widow", oncePerTurn: true },
  triage: { survivorId: "doc_mort", oncePerTurn: false },
  satellite_call: { survivorId: "baron_howl", oncePerTurn: true },
  sovereign_iron_decree: { survivorId: "baron_kaine", oncePerTurn: false, sovereignOnly: true },
  sovereign_blood_oath: { survivorId: "matriarch_vala", oncePerTurn: false, sovereignOnly: true },
  sovereign_tides_mercy: { survivorId: "tide_lord_soran", oncePerTurn: true, sovereignOnly: true, dying: true },
};

const uses = new Map<string, number>();
function useKey(game: Game, playerId: string, skillId: string): string {
  return `${game.state.roomId}:${game.state.turnNumber}:${playerId}:${skillId}`;
}
function used(game: Game, playerId: string, skillId: string): number {
  return uses.get(useKey(game, playerId, skillId)) ?? 0;
}
function markUsed(game: Game, playerId: string, skillId: string): void {
  const k = useKey(game, playerId, skillId);
  uses.set(k, (uses.get(k) ?? 0) + 1);
  if (uses.size > 10_000) {
    for (const key of uses.keys()) {
      if (!key.includes(`:${game.state.turnNumber}:`)) uses.delete(key);
    }
  }
}

// ---------------------------------------------------------------------------
// useSkill intent
// ---------------------------------------------------------------------------

export interface UseSkillRequest {
  playerId: string;
  skillId: ActiveSkillId;
  targets?: string[];
  cardIds?: string[];
  payload?: unknown;
}

export function canUseSkillNow(game: Game, playerId: string, skillId: string): boolean {
  const meta = ACTIVE_SKILLS[skillId as ActiveSkillId];
  const p = game.state.players[playerId];
  if (!meta || !p?.alive || p.survivorId !== meta.survivorId) return false;
  if (meta.sovereignOnly && p.role !== "sovereign") return false;
  if (meta.oncePerTurn && used(game, playerId, skillId) >= 1) return false;
  if (meta.dying) {
    return game.state.pendingPrompts.some(
      (pr) => pr.playerId === playerId && pr.context.dyingId === playerId,
    );
  }
  if (meta.drawPhase) {
    // usable only by answering the draw-phase choice prompt (see modifyDraw hook)
    return game.state.pendingPrompts.some(
      (pr) =>
        pr.playerId === playerId &&
        pr.context.mode === "draw_skill_choice" &&
        (pr.context.options as string[]).includes(skillId),
    );
  }
  return game.state.currentPlayerId === playerId && game.state.turnPhase === "play";
}

export function useSkill(game: Game, req: UseSkillRequest): void {
  const meta = ACTIVE_SKILLS[req.skillId];
  if (!meta) throw new EngineError("E_UNKNOWN_SKILL", req.skillId);
  const p = game.state.players[req.playerId];
  if (!p?.alive) throw new EngineError("E_DEAD", "player not alive");
  if (p.survivorId !== meta.survivorId) throw new EngineError("E_NO_SKILL", "survivor lacks skill");
  if (meta.sovereignOnly && p.role !== "sovereign") {
    throw new EngineError("E_NOT_SOVEREIGN", "sovereign skill requires the sovereign role");
  }
  if (meta.oncePerTurn && used(game, req.playerId, req.skillId) >= 1) {
    throw new EngineError("E_SKILL_USED", "already used this turn");
  }

  // Draw-phase skills are invoked by ANSWERING the draw_skill_choice prompt.
  if (meta.drawPhase) {
    const pr = game.state.pendingPrompts.find(
      (x) =>
        x.playerId === req.playerId &&
        x.context.mode === "draw_skill_choice" &&
        (x.context.options as string[]).includes(req.skillId),
    );
    if (!pr) throw new EngineError("E_PHASE", "no draw-phase choice pending");
    respond(game, req.playerId, pr.id, { kind: "choose", choice: req.skillId });
    return;
  }

  if (meta.dying) {
    const dyingPrompt = game.state.pendingPrompts.some(
      (pr) => pr.playerId === req.playerId && pr.context.dyingId === req.playerId,
    );
    if (!dyingPrompt) throw new EngineError("E_PHASE", "not dying");
  } else if (game.state.currentPlayerId !== req.playerId || game.state.turnPhase !== "play") {
    throw new EngineError("E_PHASE", "skill not usable now");
  }

  markUsed(game, req.playerId, req.skillId);
  emit(game, { type: "skill_activated", playerId: req.playerId, skillId: req.skillId });
  const impl = IMPL[req.skillId];
  if (!impl) throw new EngineError("E_INTERNAL", `no impl for ${req.skillId}`);
  impl(game, req);
}

type SkillImpl = (game: Game, req: UseSkillRequest) => void;

// ---------------------------------------------------------------------------
// Draw-phase skills (invoked through the modifyDraw hook's choice prompt)
// ---------------------------------------------------------------------------

function runDrawSkill(game: Game, playerId: string, skillId: ActiveSkillId, cont: () => void): void {
  markUsed(game, playerId, skillId);
  emit(game, { type: "skill_activated", playerId, skillId });

  if (skillId === "chem_rage") {
    drawCards(game, playerId, 1);
    game.state.players[playerId]!.buffs.barehideMode = true;
    cont();
    return;
  }

  if (skillId === "highwayman") {
    const targets = Object.values(game.state.players).filter(
      (o) => o.alive && o.id !== playerId && o.hand.length > 0,
    );
    if (targets.length === 0) {
      drawCards(game, playerId, 2);
      cont();
      return;
    }
    ask(game, {
      playerId,
      kind: "choose",
      context: { mode: "highwayman_targets", options: targets.map((t) => t.id) },
      validate: (a) => {
        if (a.kind === "decline") return null;
        if (a.kind !== "choose") return "E_BAD_ACTION";
        try {
          const ids = JSON.parse(a.choice) as string[];
          if (ids.length < 1 || ids.length > 2 || new Set(ids).size !== ids.length) return "E_BAD_CHOICE";
          return ids.every((id) => targets.some((t) => t.id === id)) ? null : "E_BAD_TARGETS";
        } catch {
          return "E_BAD_ACTION";
        }
      },
      resume: (a) => {
        if (gameEnded(game)) return;
        if (a?.kind === "choose") {
          const ids = JSON.parse(a.choice) as string[];
          for (const id of ids) {
            const t = game.state.players[id]!;
            if (!t.alive || t.hand.length === 0) continue;
            const stolen = game.rng.pick(t.hand);
            t.hand.splice(t.hand.indexOf(stolen), 1);
            game.state.players[playerId]!.hand.push(stolen);
            emit(game, { type: "card_discarded", playerId: id, cardId: stolen, reason: "highwayman" });
            emit(game, { type: "cards_drawn", playerId, count: 1 });
          }
        } else {
          drawCards(game, playerId, 2); // declined → normal draw
        }
        cont();
      },
    });
    return;
  }

  if (skillId === "ration_share") {
    drawCards(game, playerId, 2);
    const others = Object.values(game.state.players).filter((o) => o.alive && o.id !== playerId);
    const p = game.state.players[playerId]!;
    if (others.length === 0 || p.hand.length < 2) {
      cont();
      return;
    }
    let min = others[0]!;
    for (const o of others) if (o.hand.length < min.hand.length) min = o;
    const toId = min.id;
    ask(game, {
      playerId,
      kind: "give_cards",
      context: { mode: "ration_share", count: 2, to: toId },
      validate: (a) => {
        if (a.kind === "decline") return null; // timeout → random 2 given
        if (a.kind !== "discard" || a.cardIds.length !== 2) return "E_BAD_ACTION";
        if (new Set(a.cardIds).size !== 2) return "E_BAD_ACTION";
        return a.cardIds.every((c) => game.state.players[playerId]!.hand.includes(c))
          ? null
          : "E_NOT_IN_HAND";
      },
      resume: (a) => {
        if (gameEnded(game)) return;
        const pp = game.state.players[playerId]!;
        const give =
          a?.kind === "discard" ? a.cardIds : game.rng.shuffle(pp.hand).slice(0, 2); // timeout → random
        for (const c of give) {
          const idx = pp.hand.indexOf(c);
          if (idx >= 0) {
            pp.hand.splice(idx, 1);
            game.state.players[toId]?.hand.push(c);
          }
        }
        emit(game, { type: "cards_drawn", playerId: toId, count: give.length });
        cont();
      },
    });
    return;
  }
}

// ---------------------------------------------------------------------------
// Play-phase / dying skill implementations
// ---------------------------------------------------------------------------

const IMPL: Partial<Record<ActiveSkillId, SkillImpl>> = {
  bunker_down: (game, req) => {
    drawCards(game, req.playerId, 3);
    game.state.players[req.playerId]!.flipped = true;
  },

  almsgiver: (game, req) => {
    const targetId = req.targets?.[0];
    const t = targetId ? game.state.players[targetId] : undefined;
    if (!t?.alive || targetId === req.playerId) {
      throw new EngineError("E_BAD_TARGETS", "choose another living player");
    }
    const cards = req.cardIds ?? [];
    const p = game.state.players[req.playerId]!;
    if (cards.length === 0) throw new EngineError("E_BAD_ACTION", "choose cards to give");
    if (new Set(cards).size !== cards.length) throw new EngineError("E_BAD_ACTION", "duplicate cards");
    for (const c of cards) {
      if (!p.hand.includes(c)) throw new EngineError("E_NOT_IN_HAND", "card not in hand");
    }
    for (const c of cards) {
      p.hand.splice(p.hand.indexOf(c), 1);
      t.hand.push(c);
    }
    emit(game, { type: "cards_drawn", playerId: targetId!, count: cards.length });
    const givenKey = `given:${useKey(game, req.playerId, "almsgiver")}`;
    const given = (uses.get(givenKey) ?? 0) + cards.length;
    uses.set(givenKey, given);
    if (given >= 2 && p.hp < p.maxHp) heal(game, req.playerId, 1);
  },

  reforge: (game, req) => {
    const p = game.state.players[req.playerId]!;
    const cards = req.cardIds ?? [];
    if (cards.length === 0) throw new EngineError("E_BAD_ACTION", "choose cards to reforge");
    if (new Set(cards).size !== cards.length) throw new EngineError("E_BAD_ACTION", "duplicate cards");
    for (const c of cards) {
      if (!p.hand.includes(c)) throw new EngineError("E_NOT_IN_HAND", "card not in hand");
    }
    discardFromHand(game, req.playerId, cards, "reforge");
    drawCards(game, req.playerId, cards.length);
  },

  bond_weave: (game, req) => {
    const p = game.state.players[req.playerId]!;
    const equipCard = req.cardIds?.[0];
    const slots = (["weapon", "armor", "rig_plus", "rig_minus"] as const).filter(
      (s) => p.equipment[s],
    );
    if (slots.length === 0) throw new EngineError("E_NO_EQUIPMENT", "no equipment installed");
    const slot = slots.find((s) => p.equipment[s] === equipCard);
    if (!slot || !equipCard) throw new EngineError("E_BAD_ACTION", "choose an installed equipment card");
    const maleTarget = req.targets?.[0];
    if (maleTarget !== undefined) {
      const t = game.state.players[maleTarget];
      const def = t?.survivorId ? SURVIVOR_DEFS[t.survivorId] : undefined;
      if (!t?.alive || def?.gender !== "male") {
        throw new EngineError("E_BAD_TARGETS", "optional target must be a living male");
      }
    }
    removeEquipment(game, req.playerId, slot, "bond_weave");
    heal(game, req.playerId, 1);
    if (maleTarget && game.state.players[maleTarget]?.alive) {
      heal(game, maleTarget, 1, { playerId: req.playerId });
    }
  },

  barter: (game, req) => {
    const [t1, t2] = req.targets ?? [];
    const p1 = t1 ? game.state.players[t1] : undefined;
    const p2 = t2 ? game.state.players[t2] : undefined;
    if (!p1?.alive || !p2?.alive || t1 === t2) {
      throw new EngineError("E_BAD_TARGETS", "need 2 distinct living players");
    }
    const hand1 = p1.hand.splice(0);
    p1.hand.push(...p2.hand.splice(0));
    p2.hand.push(...hand1);
  },

  honey_trap: (game, req) => {
    const p = game.state.players[req.playerId]!;
    if (p.hand.length < 1) throw new EngineError("E_NOT_ENOUGH_CARDS", "need 1 card");
    const [m1, m2] = req.targets ?? [];
    if (!m1 || !m2 || m1 === m2) throw new EngineError("E_BAD_TARGETS", "need 2 distinct males");
    for (const m of [m1, m2]) {
      const t = game.state.players[m];
      const def = t?.survivorId ? SURVIVOR_DEFS[t.survivorId] : undefined;
      if (!t?.alive || def?.gender !== "male") {
        throw new EngineError("E_BAD_TARGETS", "targets must be living males");
      }
    }
    const cost = req.cardIds?.[0];
    if (!cost || !p.hand.includes(cost)) throw new EngineError("E_NOT_IN_HAND", "choose a card to discard");
    discardFromHand(game, req.playerId, [cost], "honey_trap");
    resolveStandoff(game, m1, m2);
  },

  triage: (game, req) => {
    const p = game.state.players[req.playerId]!;
    if (p.hand.length < 1) throw new EngineError("E_NOT_ENOUGH_CARDS", "need 1 card");
    const targetId = req.targets?.[0];
    const t = targetId ? game.state.players[targetId] : undefined;
    if (!t?.alive || t.hp >= t.maxHp) throw new EngineError("E_BAD_TARGETS", "target must be injured");
    const cost = req.cardIds?.[0];
    if (!cost || !p.hand.includes(cost)) throw new EngineError("E_NOT_IN_HAND", "choose a card to discard");
    discardFromHand(game, req.playerId, [cost], "triage");
    heal(game, targetId!, 1, { playerId: req.playerId });
  },

  satellite_call: (game, req) => {
    const p = game.state.players[req.playerId]!;
    const [c1, c2] = req.cardIds ?? [];
    if (!c1 || !c2 || c1 === c2 || !p.hand.includes(c1) || !p.hand.includes(c2)) {
      throw new EngineError("E_BAD_ACTION", "choose 2 distinct hand cards");
    }
    if (game.cards.get(c1)!.suit !== game.cards.get(c2)!.suit) {
      throw new EngineError("E_NOT_SAME_SUIT", "both cards must share a suit");
    }
    discardFromHand(game, req.playerId, [c1, c2], "satellite_call");
    jamWindow(game, {
      description: { defId: "mortar_rain", sourceId: req.playerId },
      onApply: () => resolveMortarRain(game, req.playerId, "mortar"),
      onCancel: () => {},
    });
  },

  sovereign_iron_decree: (game, req) => {
    // Simplified v1: command a Syndicate ally to discard an Evade (representing
    // calling a bodyguard). Full "discard evade ON BEHALF" integration is a
    // documented SIT verification item (A10-24).
    const targetId = req.targets?.[0];
    const t = targetId ? game.state.players[targetId] : undefined;
    const def = t?.survivorId ? SURVIVOR_DEFS[t.survivorId] : undefined;
    if (!targetId || !t?.alive || def?.faction !== "syndicate" || targetId === req.playerId) {
      throw new EngineError("E_BAD_TARGETS", "target must be another living Syndicate player");
    }
    ask(game, {
      playerId: targetId,
      kind: "discard_evade",
      context: { via: "iron_decree", for: req.playerId },
      validate: (a) => {
        if (a.kind === "decline") return null;
        if (a.kind !== "discard" || a.cardIds.length !== 1) return "E_BAD_ACTION";
        const c = a.cardIds[0]!;
        return t.hand.includes(c) && defIdOf(game, c) === "evade" ? null : "E_BAD_EVADE";
      },
      resume: (a) => {
        if (gameEnded(game)) return;
        if (a?.kind === "discard") discardFromHand(game, targetId, a.cardIds, "iron_decree");
      },
    });
  },

  sovereign_blood_oath: (game, req) => {
    const [helperId0, targetId0] = req.targets ?? [];
    const helper = helperId0 ? game.state.players[helperId0] : undefined;
    const target = targetId0 ? game.state.players[targetId0] : undefined;
    const hDef = helper?.survivorId ? SURVIVOR_DEFS[helper.survivorId] : undefined;
    if (!helperId0 || !helper?.alive || hDef?.faction !== "verdant" || helperId0 === req.playerId) {
      throw new EngineError("E_BAD_TARGETS", "helper must be another living Verdant player");
    }
    if (!targetId0 || !target?.alive || targetId0 === helperId0 || targetId0 === req.playerId) {
      throw new EngineError("E_BAD_TARGETS", "invalid strike target");
    }
    const helperId: string = helperId0;
    const targetId: string = targetId0;
    ask(game, {
      playerId: helperId,
      kind: "discard_strike",
      context: { via: "blood_oath", for: req.playerId, targetId },
      validate: (a) => {
        if (a.kind === "decline") return null;
        if (a.kind !== "discard" || a.cardIds.length !== 1) return "E_BAD_ACTION";
        const c = a.cardIds[0]!;
        return helper.hand.includes(c) && canActAs(game, helperId, c, "strike")
          ? null
          : "E_NOT_STRIKE";
      },
      resume: (a) => {
        if (gameEnded(game)) return;
        if (a?.kind !== "discard") return; // refused — nothing happens
        discardFromHand(game, helperId, a.cardIds, "blood_oath");
        strikeFromSkill(game, req.playerId, targetId, 1);
      },
    });
  },

  sovereign_tides_mercy: (game, req) => {
    const dyingId = (req.payload as string | undefined) ?? req.playerId;
    const dying = game.state.players[dyingId];
    if (!dying || dying.hp > 0) throw new EngineError("E_NOT_DYING", "nobody is dying");
    const helperId = req.targets?.[0];
    const helper = helperId ? game.state.players[helperId] : undefined;
    const hDef = helper?.survivorId ? SURVIVOR_DEFS[helper.survivorId] : undefined;
    if (!helper?.alive || hDef?.faction !== "tide") {
      throw new EngineError("E_BAD_TARGETS", "helper must be a living Tide player");
    }
    const stim = helper.hand.find((c) => canActAs(game, helperId!, c, "stim"));
    if (!stim) throw new EngineError("E_NO_STIM", "that player has no stim");
    helper.hand.splice(helper.hand.indexOf(stim), 1);
    game.state.discard.push(stim);
    emit(game, { type: "card_discarded", playerId: helperId!, cardId: stim, reason: "tides_mercy" });
    dying.hp = 1;
    emit(game, { type: "heal", targetId: dyingId, amount: 1, sourcePlayerId: helperId });
    emit(game, { type: "saved", playerId: dyingId });
  },
};

/** Strike issued via Blood Oath: evade window, damage attributed to the sovereign. */
function strikeFromSkill(game: Game, attackerId: string, targetId: string, amount: number): void {
  const attacker = game.state.players[attackerId]!;
  const target = game.state.players[targetId]!;
  kaanFateGate(game, attackerId, targetId, (forbidden) => {
    if (gameEnded(game)) return;
    if (forbidden || deadeyeForbidsEvade(attacker, target)) {
      dealDamage(game, { targetId, amount, sourcePlayerId: attackerId, damageKind: "strike" });
      return;
    }
    const required = evadesRequiredFor(attacker.survivorId);
    ask(game, {
      playerId: targetId,
      kind: "discard_evade",
      context: { sourceId: attackerId, required, via: "skill_strike" },
      validate: (a) => {
        if (a.kind === "decline") return null;
        if (a.kind !== "discard") return "E_BAD_ACTION";
        const ok =
          a.cardIds.length === required &&
          new Set(a.cardIds).size === required &&
          a.cardIds.every((c) => canActAs(game, targetId, c, "evade"));
        return ok ? null : "E_BAD_EVADE";
      },
      resume: (a) => {
        if (gameEnded(game)) return;
        if (a?.kind === "discard") {
          discardFromHand(game, targetId, a.cardIds, "evade");
          return;
        }
        dealDamage(game, { targetId, amount, sourcePlayerId: attackerId, damageKind: "strike" });
      },
    });
  });
}

// ---------------------------------------------------------------------------
// Game-level skill queries used by cards.ts / effects.ts
// ---------------------------------------------------------------------------

/** Can `cardId` in this player's hand act as `asDefId`? (conversion skills) */
export function canActAs(game: Game, playerId: string, cardId: string, asDefId: string): boolean {
  const inst = game.cards.get(cardId);
  if (!inst) return false;
  return canActAsPure(game.state.players[playerId]?.survivorId, inst, asDefId);
}

/** Evades required against this attacker (Warlord Karn = 2). */
export function evadesRequired(game: Game, attackerId: string): number {
  return evadesRequiredFor(game.state.players[attackerId]?.survivorId);
}

/** Hale Deadeye (sync): target cannot evade. */
export function evadeForbidden(game: Game, attackerId: string, targetId: string): boolean {
  const a = game.state.players[attackerId]!;
  const t = game.state.players[targetId]!;
  return deadeyeForbidsEvade(a, t);
}

/** Kaan Iron Charge fate gate: non-heart → target cannot evade (async). */
export function kaanFateGate(
  game: Game,
  attackerId: string,
  targetId: string,
  proceed: (forbidden: boolean) => void,
): void {
  if (game.state.players[attackerId]?.survivorId !== "rider_kaan") {
    proceed(false);
    return;
  }
  flipFate(game, { forPlayerId: targetId, outcome: "iron_charge" }, (fate) => {
    proceed(fate.suit !== "heart");
  });
}

/** Central equipment removal — fires the onEquipmentLost hook (Vesper Salvage).
 *  `toHandOf`: move the card directly to another player's hand instead of the
 *  discard (Scavenge / Proxy War take). Direct transfer avoids the fragile
 *  "splice last discard" pattern which breaks when hooks reshuffle the deck. */
export function removeEquipment(
  game: Game,
  playerId: string,
  slot: EquipmentSlot,
  reason: string,
  toHandOf?: string,
): void {
  const p = game.state.players[playerId]!;
  const cardId = p.equipment[slot];
  if (!cardId) return;
  delete p.equipment[slot];
  if (toHandOf) {
    game.state.players[toHandOf]!.hand.push(cardId);
  } else {
    game.state.discard.push(cardId);
  }
  emit(game, { type: "equipment_removed", playerId, cardId, slot, reason });
  hooks.onEquipmentLost?.(game, playerId, cardId, slot, reason);
}

// ---------------------------------------------------------------------------
// Passive hook registrations (run once at module load)
// ---------------------------------------------------------------------------

// Nyx Misdirect: pre-damage redirect (discard 1 spade → another player takes it)
hooks.preDamage = (gameRef, req, proceed) => {
  const game = gameRef as Game;
  const target = game.state.players[req.targetId];
  if (!target || target.survivorId !== "nyx_the_veil" || !target.alive || req.noRedirect) {
    proceed(req);
    return;
  }
  const spades = target.hand.filter((c) => game.cards.get(c)!.suit === "spade");
  const candidates = Object.values(game.state.players).filter(
    (o) => o.alive && o.id !== req.targetId,
  );
  if (spades.length === 0 || candidates.length === 0) {
    proceed(req);
    return;
  }
  ask(game, {
    playerId: req.targetId,
    kind: "choose",
    context: {
      mode: "misdirect",
      spades,
      candidates: candidates.map((c) => c.id),
      damage: req.amount,
    },
    validate: (a) => {
      if (a.kind === "decline") return null;
      if (a.kind !== "choose") return "E_BAD_ACTION";
      try {
        const parsed = JSON.parse(a.choice) as { spade: string; toId: string };
        if (!spades.includes(parsed.spade)) return "E_NOT_IN_HAND";
        if (!candidates.some((c) => c.id === parsed.toId)) return "E_BAD_TARGETS";
        return null;
      } catch {
        return "E_BAD_ACTION";
      }
    },
    resume: (a) => {
      if (gameEnded(game)) return;
      if (a?.kind !== "choose") {
        proceed(req);
        return;
      }
      const parsed = JSON.parse(a.choice) as { spade: string; toId: string };
      discardFromHand(game, req.targetId, [parsed.spade], "misdirect");
      emit(game, { type: "skill_activated", playerId: req.targetId, skillId: "misdirect" });
      const redirectReq: DamageRequest & { noRedirect?: boolean } = {
        ...req,
        targetId: parsed.toId,
        noRedirect: true,
      };
      // receiver draws cards equal to damage AFTER it lands
      const before = game.state.players[parsed.toId]!.hp;
      proceed(redirectReq);
      const after = game.state.players[parsed.toId]!;
      const taken = before - after.hp;
      if (after.alive && taken > 0) drawCards(game, parsed.toId, taken);
    },
  });
};

// Post-damage passives: Kaine reclaim, Vex backstab, Oracle foresight, Grim debt
hooks.postDamageTaken = (ctx) => {
  const game = ctx.game as Game;
  const p = game.state.players[ctx.playerId];
  if (!p?.alive || gameEnded(game)) return;

  if (p.survivorId === "baron_kaine") {
    const cardId = ctx.sourceCardId;
    if (!cardId || !game.state.discard.includes(cardId)) return;
    ask(game, {
      playerId: p.id,
      kind: "choose",
      context: { mode: "scrap_reclaim", cardId },
      validate: (a) =>
        a.kind === "decline" || (a.kind === "choose" && a.choice === cardId) ? null : "E_BAD_CHOICE",
      resume: (a) => {
        if (gameEnded(game) || a?.kind !== "choose") return;
        // re-check: the card may have been reshuffled/drawn since the prompt
        // was issued — only reclaim if it is STILL in the discard (anti-dupe)
        const idx = game.state.discard.indexOf(cardId);
        if (idx < 0) return;
        game.state.discard.splice(idx, 1);
        game.state.players[p.id]!.hand.push(cardId);
        emit(game, { type: "skill_activated", playerId: p.id, skillId: "scrap_reclaim" });
      },
    });
    return;
  }

  if (p.survivorId === "vex") {
    const src = ctx.sourcePlayerId ? game.state.players[ctx.sourcePlayerId] : undefined;
    if (!src?.alive || src.hand.length === 0) return;
    const stolen = game.rng.pick(src.hand);
    src.hand.splice(src.hand.indexOf(stolen), 1);
    p.hand.push(stolen);
    emit(game, { type: "card_discarded", playerId: src.id, cardId: stolen, reason: "backstab" });
    emit(game, { type: "cards_drawn", playerId: p.id, count: 1 });
    emit(game, { type: "skill_activated", playerId: p.id, skillId: "backstab" });
    return;
  }

  if (p.survivorId === "oracle") {
    const lost = Math.max(1, ctx.amount);
    drawCards(game, p.id, 2 * lost);
    emit(game, { type: "skill_activated", playerId: p.id, skillId: "foresight" });
    const drawn = game.state.players[p.id]!.hand.slice(-2 * lost);
    if (drawn.length === 0) return;
    ask(game, {
      playerId: p.id,
      kind: "give_cards",
      context: { mode: "foresight", cards: drawn },
      validate: (a) => {
        if (a.kind === "decline") return null;
        if (a.kind !== "choose") return "E_BAD_ACTION";
        try {
          const parsed = JSON.parse(a.choice) as { cardId: string; targetId: string }[];
          for (const g of parsed) {
            if (!drawn.includes(g.cardId)) return "E_NOT_IN_HAND";
            if (!game.state.players[g.targetId]?.alive) return "E_BAD_TARGETS";
          }
          return null;
        } catch {
          return "E_BAD_ACTION";
        }
      },
      resume: (a) => {
        if (gameEnded(game) || a?.kind !== "choose") return;
        const parsed = JSON.parse(a.choice) as { cardId: string; targetId: string }[];
        const me = game.state.players[p.id]!;
        for (const g of parsed) {
          const idx = me.hand.indexOf(g.cardId);
          if (idx >= 0) {
            me.hand.splice(idx, 1);
            game.state.players[g.targetId]!.hand.push(g.cardId);
          }
        }
      },
    });
    return;
  }

  if (p.survivorId === "grim_one_eye") {
    const src = ctx.sourcePlayerId;
    if (!src || !game.state.players[src]?.alive) return;
    flipFate(game, { forPlayerId: p.id, outcome: "blood_debt" }, (fate) => {
      if (gameEnded(game) || fate.suit === "heart") return;
      emit(game, { type: "skill_activated", playerId: p.id, skillId: "blood_debt" });
      ask(game, {
        playerId: src,
        kind: "blood_debt",
        context: { owedTo: p.id },
        validate: (a) => {
          if (a.kind === "decline") return null;
          if (a.kind !== "discard" || a.cardIds.length !== 1) return "E_BAD_ACTION";
          return game.state.players[src]!.hand.includes(a.cardIds[0]!) ? null : "E_NOT_IN_HAND";
        },
        resume: (a) => {
          if (gameEnded(game)) return;
          if (a?.kind === "discard") {
            discardFromHand(game, src, a.cardIds, "blood_debt");
          } else {
            dealDamage(game, { targetId: src, amount: 1, damageKind: "skill", sourcePlayerId: p.id });
          }
        },
      });
    });
    return;
  }
};

// Turn start: Aldric Drone Scout — peek top up-to-5 and reorder
hooks.turnStart = (gameRef, playerId, cont) => {
  const game = gameRef as Game;
  const p = game.state.players[playerId]!;
  if (p.survivorId !== "sage_aldric" || game.state.deck.length < 2 || gameEnded(game)) {
    cont();
    return;
  }
  const n = Math.min(5, game.state.deck.length);
  const top = game.state.deck.slice(-n).reverse(); // top-of-deck first
  ask(game, {
    playerId,
    kind: "reorder_deck",
    context: { mode: "drone_scout", count: n, topCards: top },
    validate: (a) => {
      if (a.kind === "decline") return null;
      if (a.kind !== "choose") return "E_BAD_ACTION";
      try {
        const order = JSON.parse(a.choice) as string[];
        if (order.length !== n || new Set(order).size !== n) return "E_BAD_ACTION";
        return order.every((c) => top.includes(c)) ? null : "E_BAD_ACTION";
      } catch {
        return "E_BAD_ACTION";
      }
    },
    resume: (a) => {
      if (!gameEnded(game) && a?.kind === "choose") {
        const order = JSON.parse(a.choice) as string[];
        game.state.deck.splice(-n, n);
        game.state.deck.push(...[...order].reverse()); // order[0] = new top
        emit(game, { type: "skill_activated", playerId, skillId: "drone_scout" });
      }
      cont();
    },
  });
};

// Draw phase: offer draw-replacement skills before the default 2-card draw
hooks.modifyDraw = (gameRef, playerId, cont) => {
  const game = gameRef as Game;
  const p = game.state.players[playerId]!;
  const options = (["highwayman", "chem_rage", "ration_share"] as ActiveSkillId[]).filter(
    (s) => ACTIVE_SKILLS[s].survivorId === p.survivorId && used(game, playerId, s) < 1,
  );
  if (options.length === 0 || gameEnded(game)) {
    drawCards(game, playerId, 2);
    cont();
    return;
  }
  ask(game, {
    playerId,
    kind: "choose",
    context: { mode: "draw_skill_choice", options },
    validate: (a) => {
      if (a.kind === "decline") return null;
      return a.kind === "choose" && options.includes(a.choice as ActiveSkillId)
        ? null
        : "E_BAD_CHOICE";
    },
    resume: (a) => {
      if (gameEnded(game)) return;
      if (a?.kind === "choose") {
        runDrawSkill(game, playerId, a.choice as ActiveSkillId, cont);
      } else {
        drawCards(game, playerId, 2);
        cont();
      }
    },
  });
};

// Turn end: Femme Night Veil (+1 draw before discard-down)
hooks.turnEnd = (gameRef, playerId, cont) => {
  const game = gameRef as Game;
  const p = game.state.players[playerId]!;
  if (p.alive && p.survivorId === "femme_black_widow" && !gameEnded(game)) {
    drawCards(game, playerId, 1);
    emit(game, { type: "skill_activated", playerId, skillId: "night_veil" });
  }
  cont();
};

// Hand became empty: Ryn Chain Burn → draw 1
hooks.onHandEmpty = (gameRef, playerId) => {
  const game = gameRef as Game;
  const p = game.state.players[playerId];
  if (!p?.alive || gameEnded(game)) return;
  if (p.survivorId === "ember_sage_ryn") {
    drawCards(game, playerId, 1);
    emit(game, { type: "skill_activated", playerId, skillId: "chain_burn" });
  }
};

// Equipment lost: Vesper Salvage → draw 2 (only while alive)
hooks.onEquipmentLost = (gameRef, playerId, _cardId, _slot, _reason) => {
  const game = gameRef as Game;
  const p = game.state.players[playerId];
  if (!p?.alive || gameEnded(game)) return;
  if (p.survivorId === "vesper_blade_dancer") {
    drawCards(game, playerId, 2);
    emit(game, { type: "skill_activated", playerId, skillId: "salvage" });
  }
};

// Fate substitution: Vex Fate Hack — swap the fate card with a hand card
hooks.modifyFate = (gameRef, flipped, apply) => {
  const game = gameRef as Game;
  const vex = Object.values(game.state.players).find(
    (pl) => pl.alive && pl.survivorId === "vex" && pl.hand.length > 0,
  );
  if (!vex || gameEnded(game)) {
    apply({ suit: flipped.suit, number: flipped.number });
    return;
  }
  ask(game, {
    playerId: vex.id,
    kind: "fate_hack",
    context: { mode: "fate_hack", flipped },
    validate: (a) => {
      if (a.kind === "decline") return null;
      if (a.kind !== "discard" || a.cardIds.length !== 1) return "E_BAD_ACTION";
      return game.state.players[vex.id]!.hand.includes(a.cardIds[0]!) ? null : "E_NOT_IN_HAND";
    },
    resume: (a) => {
      if (gameEnded(game)) {
        apply({ suit: flipped.suit, number: flipped.number });
        return;
      }
      if (a?.kind === "discard") {
        const sub = a.cardIds[0]!;
        const inst = game.cards.get(sub)!;
        discardFromHand(game, vex.id, [sub], "fate_hack");
        emit(game, { type: "skill_activated", playerId: vex.id, skillId: "fate_hack" });
        apply({ suit: inst.suit, number: inst.number });
      } else {
        apply({ suit: flipped.suit, number: flipped.number });
      }
    },
  });
};
