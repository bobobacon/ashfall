// Bot policy — decision primitives reused by both the simulation runner
// (playRandomGame) and the server's bot seats (M5).
//
// All functions are PURE with respect to randomness: they consume game.rng so
// decisions stay deterministic per room seed.
import {
  canActAs,
  canUseSkillNow,
  defIdOf,
  distance,
  inAttackRange,
  strikeLimit,
  useSkill,
  type ActiveSkillId,
  type Game,
  type Prompt,
  type RespondAction,
  type UseSkillRequest,
} from "@ashfall/engine";
import { SURVIVOR_DEFS } from "@ashfall/shared";

/** Compute a legal (random) response to a prompt. Never throws. */
export function botRespond(game: Game, prompt: Prompt): RespondAction {
  const p = game.state.players[prompt.playerId];
  if (!p) return { kind: "decline" };
  const flip = game.rng.next();

  switch (prompt.kind) {
    case "discard_evade": {
      const required = (prompt.context.required as number | undefined) ?? 1;
      const evades = p.hand.filter((c) => defIdOf(game, c) === "evade");
      if (p.survivorId === "wraith_white_ghost") {
        evades.push(...p.hand.filter((c) => defIdOf(game, c) === "strike"));
      }
      const unique = [...new Set(evades)];
      if (unique.length >= required && flip < 0.7) {
        return { kind: "discard", cardIds: unique.slice(0, required) };
      }
      return { kind: "decline" };
    }
    case "discard_strike": {
      const strikes = p.hand.filter((c) => defIdOf(game, c) === "strike");
      if (p.survivorId === "ronan_crimson_blade") {
        strikes.push(
          ...p.hand.filter((c) => {
            const inst = game.cards.get(c)!;
            return inst.suit === "heart" || inst.suit === "diamond";
          }),
        );
      }
      const unique = [...new Set(strikes)];
      if (unique.length > 0 && flip < 0.6) {
        return { kind: "discard", cardIds: [unique[0]!] };
      }
      return { kind: "decline" };
    }
    case "use_stim": {
      const isSelf = prompt.context.self === true;
      const saves = p.hand.filter((c) => {
        const d = defIdOf(game, c);
        return d === "stim" || (isSelf && d === "chem_brew");
      });
      // Doc Mort: any red card saves
      if (p.survivorId === "doc_mort") {
        saves.push(
          ...p.hand.filter((c) => {
            const inst = game.cards.get(c)!;
            return inst.suit === "heart" || inst.suit === "diamond";
          }),
        );
      }
      const unique = [...new Set(saves)];
      if (unique.length > 0 && flip < 0.9) {
        return { kind: "discard", cardIds: [unique[0]!] };
      }
      return { kind: "decline" };
    }
    case "jam": {
      const jams = p.hand.filter((c) => defIdOf(game, c) === "signal_jam");
      if (jams.length > 0 && flip < 0.3) {
        return { kind: "discard", cardIds: [jams[0]!] };
      }
      return { kind: "decline" };
    }
    case "fate_hack": {
      // Vex: swap only when the flipped card is "bad" — random bot just declines
      return { kind: "decline" };
    }
    case "reorder_deck": {
      return { kind: "decline" }; // keep natural order
    }
    case "choose":
    case "supply_pick": {
      const mode = prompt.context.mode as string | undefined;
      if (mode === "highwayman_targets") {
        const opts = prompt.context.options as string[];
        const n = Math.min(opts.length, flip < 0.5 ? 1 : 2);
        return { kind: "choose", choice: JSON.stringify(game.rng.shuffle(opts).slice(0, n)) };
      }
      if (mode === "draw_skill_choice") {
        const opts = prompt.context.options as string[];
        return flip < 0.5 ? { kind: "choose", choice: game.rng.pick(opts) } : { kind: "decline" };
      }
      if (mode === "scrap_reclaim") {
        // Kaine: reclaim ~70% of the time
        const cardId = prompt.context.cardId as string;
        return flip < 0.7 ? { kind: "choose", choice: cardId } : { kind: "decline" };
      }
      if (mode === "misdirect") {
        // Nyx: redirect ~60% of the time to a random candidate
        const spades = prompt.context.spades as string[];
        const cands = prompt.context.candidates as string[];
        if (flip < 0.6 && spades.length > 0 && cands.length > 0) {
          return {
            kind: "choose",
            choice: JSON.stringify({ spade: game.rng.pick(spades), toId: game.rng.pick(cands) }),
          };
        }
        return { kind: "decline" };
      }
      const zones =
        (prompt.context.zones as string[] | undefined) ??
        (prompt.context.options as string[] | undefined);
      if (zones && zones.length > 0) {
        return { kind: "choose", choice: game.rng.pick(zones) };
      }
      return { kind: "decline" };
    }
    case "give_cards": {
      // Foresight / Ration Share: give the required count when specified
      const count = (prompt.context.count as number | undefined) ?? 0;
      if (count > 0 && p.hand.length >= count) {
        return { kind: "discard", cardIds: game.rng.shuffle(p.hand).slice(0, count) };
      }
      return { kind: "decline" };
    }
    case "proxy_war": {
      const strikes = p.hand.filter((c) => canActAs(game, p.id, c, "strike"));
      if (strikes.length > 0 && flip < 0.5) {
        return { kind: "discard", cardIds: [strikes[0]!] };
      }
      return { kind: "decline" };
    }
    case "blood_debt": {
      // Grim's target: discard a card rather than lose HP (~80%)
      if (p.hand.length > 0 && flip < 0.8) {
        return { kind: "discard", cardIds: [game.rng.pick(p.hand)] };
      }
      return { kind: "decline" };
    }
    case "choose_hand_card": {
      const mode = prompt.context.mode as string | undefined;
      const count = (prompt.context.count as number | undefined) ?? 1;
      if (mode === "railgun_followup") {
        // attack another target ~50% of the time if we can pay
        const evaded = prompt.context.evadedTargetId as string;
        const targets = Object.values(game.state.players).filter(
          (o) =>
            o.alive &&
            o.id !== p.id &&
            o.id !== evaded &&
            !isGhost(o) &&
            inAttackRange(game.state, p.id, o.id, game.cards),
        );
        if (flip < 0.5 && p.hand.length >= 2 && targets.length > 0) {
          return {
            kind: "choose",
            choice: JSON.stringify({
              cardIds: game.rng.shuffle(p.hand).slice(0, 2),
              targetId: game.rng.pick(targets).id,
            }),
          };
        }
        return { kind: "decline" };
      }
      // launcher_cost / honey_trap_cost / triage_cost
      if (p.hand.length >= count) {
        return { kind: "discard", cardIds: game.rng.shuffle(p.hand).slice(0, count) };
      }
      return { kind: "decline" };
    }
    default:
      return { kind: "decline" };
  }
}

/** Ghost Signal: empty-hand Aldric is untargetable. */
function isGhost(t: { survivorId?: string; hand: string[] }): boolean {
  return t.survivorId === "sage_aldric" && t.hand.length === 0;
}

export type BotTurnAction =
  | { kind: "play"; cardId: string; targets?: string[]; asDefId?: string }
  | { kind: "skill"; req: Omit<UseSkillRequest, "playerId"> }
  | { kind: "endTurn" }
  | { kind: "nothing" };

/** Decide the next play-phase action for the current player (one step). */
export function botChoosePlayAction(game: Game): BotTurnAction {
  const cur = game.state.currentPlayerId!;
  const p = game.state.players[cur]!;
  if (!p.alive) return { kind: "endTurn" };

  const others = Object.values(game.state.players).filter((pl) => pl.alive && pl.id !== cur);
  if (others.length === 0) return { kind: "endTurn" };

  // 25% chance to consider an active skill first
  if (game.rng.next() < 0.25) {
    const skill = botChooseSkill(game, cur, others);
    if (skill) return { kind: "skill", req: skill };
  }

  // card plays
  type Candidate = { cardId: string; targets?: string[]; asDefId?: string };
  const candidates: Candidate[] = [];

  for (const cardId of p.hand) {
    const def = defIdOf(game, cardId)!;
    switch (def) {
      case "strike": {
        if (p.strikeCountThisTurn >= strikeLimit(game, cur)) break;
        for (const t of others) {
          if (isGhost(t)) continue;
          if (inAttackRange(game.state, cur, t.id, game.cards)) {
            candidates.push({ cardId, targets: [t.id] });
          }
        }
        break;
      }
      case "stim": {
        const injured = [p, ...others].filter((pl) => pl.hp < pl.maxHp);
        for (const t of injured) candidates.push({ cardId, targets: [t.id] });
        break;
      }
      case "chem_brew": {
        if (!p.buffs.chemBrewNext) candidates.push({ cardId });
        break;
      }
      case "scavenge": {
        for (const t of others) {
          if (isGhost(t)) continue;
          if (distance(game.state, cur, t.id) <= 1) candidates.push({ cardId, targets: [t.id] });
        }
        break;
      }
      case "sabotage": {
        for (const t of others) {
          if (isGhost(t)) continue;
          const has =
            t.hand.length > 0 || Object.values(t.equipment).some(Boolean) || t.delayed.length > 0;
          if (has) candidates.push({ cardId, targets: [t.id] });
        }
        break;
      }
      case "standoff": {
        for (const t of others) {
          if (isGhost(t)) continue;
          candidates.push({ cardId, targets: [t.id] });
        }
        break;
      }
      case "mortar_rain":
      case "mutant_horde":
      case "field_clinic":
      case "supply_drop": {
        candidates.push({ cardId });
        break;
      }
      case "proxy_war": {
        for (const a of others) {
          if (!a.equipment.weapon) continue;
          for (const b of others) {
            if (b.id === a.id || isGhost(b)) continue;
            if (inAttackRange(game.state, a.id, b.id, game.cards)) {
              candidates.push({ cardId, targets: [a.id, b.id] });
            }
          }
        }
        break;
      }
      case "ion_storm": {
        const anyStorm = Object.values(game.state.players).some(
          (pl) => pl.alive && pl.delayed.some((d) => d.defId === "ion_storm"),
        );
        if (!anyStorm) candidates.push({ cardId });
        break;
      }
      case "ration_cut": {
        for (const t of others) {
          if (isGhost(t)) continue;
          if (t.survivorId === "ember_sage_ryn") continue;
          if (distance(game.state, cur, t.id) <= 1 && !t.delayed.some((d) => d.defId === "ration_cut")) {
            candidates.push({ cardId, targets: [t.id] });
          }
        }
        break;
      }
      case "lockdown": {
        for (const t of [p, ...others]) {
          if (isGhost(t)) continue;
          if (t.delayed.some((d) => d.defId === "lockdown")) continue;
          if (t.survivorId === "ember_sage_ryn") continue;
          candidates.push({ cardId, targets: [t.id] });
        }
        break;
      }
      case "auto_rifle":
      case "plasma_cutter":
      case "scrap_launcher":
      case "railgun":
      case "holo_barrier":
      case "kevlar_mesh":
      case "bulwark_rig":
      case "scout_bike": {
        candidates.push({ cardId });
        break;
      }
      default: {
        // Ronan: red non-strike cards as strikes
        if (
          p.survivorId === "ronan_crimson_blade" &&
          p.strikeCountThisTurn < strikeLimit(game, cur) &&
          def !== "strike" &&
          canActAs(game, cur, cardId, "strike")
        ) {
          for (const t of others) {
            if (isGhost(t)) continue;
            if (inAttackRange(game.state, cur, t.id, game.cards)) {
              candidates.push({ cardId, targets: [t.id], asDefId: "strike" });
            }
          }
        }
        break;
      }
    }
  }

  if (candidates.length > 0) {
    const strikes = candidates.filter(
      (c) => defIdOf(game, c.cardId) === "strike" || c.asDefId === "strike",
    );
    const pick =
      strikes.length > 0 && game.rng.next() < 0.6 ? game.rng.pick(strikes) : game.rng.pick(candidates);
    return { kind: "play", cardId: pick.cardId, targets: pick.targets, asDefId: pick.asDefId };
  }

  return { kind: "endTurn" };
}

/** Pick a usable active skill + legal targets, or null. */
function botChooseSkill(
  game: Game,
  cur: string,
  others: { id: string; survivorId?: string; hand: string[]; hp: number; maxHp: number }[],
): Omit<UseSkillRequest, "playerId"> | null {
  const p = game.state.players[cur]!;
  if (!p.survivorId) return null;

  const usable = (id: ActiveSkillId): boolean => canUseSkillNow(game, cur, id);

  switch (p.survivorId) {
    case "bastion":
      return usable("bunker_down") ? { skillId: "bunker_down" } : null;
    case "tide_lord_soran":
      if (usable("reforge") && p.hand.length > 0) {
        return { skillId: "reforge", cardIds: [game.rng.pick(p.hand)] };
      }
      return null;
    case "matriarch_vala":
      if (usable("almsgiver") && p.hand.length > 0) {
        return {
          skillId: "almsgiver",
          targets: [game.rng.pick(others).id],
          cardIds: [game.rng.pick(p.hand)],
        };
      }
      return null;
    case "vesper_blade_dancer": {
      if (!usable("bond_weave") || p.hp >= p.maxHp) return null;
      const slots = (["weapon", "armor", "rig_plus", "rig_minus"] as const).filter(
        (s) => p.equipment[s],
      );
      if (slots.length === 0) return null;
      return { skillId: "bond_weave", cardIds: [p.equipment[slots[0]!]!] };
    }
    case "quartermaster_orlo": {
      if (usable("barter") && others.length >= 2) {
        const [t1, t2] = game.rng.shuffle(others).slice(0, 2);
        return { skillId: "barter", targets: [t1!.id, t2!.id] };
      }
      return null;
    }
    case "femme_black_widow": {
      if (!usable("honey_trap") || p.hand.length === 0) return null;
      const males = others.filter(
        (o) => o.survivorId && SURVIVOR_DEFS[o.survivorId]?.gender === "male",
      );
      if (males.length < 2) return null;
      const [m1, m2] = game.rng.shuffle(males).slice(0, 2);
      return {
        skillId: "honey_trap",
        targets: [m1!.id, m2!.id],
        cardIds: [game.rng.pick(p.hand)],
      };
    }
    case "doc_mort": {
      if (!usable("triage") || p.hand.length === 0) return null;
      const injured = others.filter((o) => o.hp < o.maxHp);
      if (injured.length === 0 && p.hp >= p.maxHp) return null;
      const target = injured.length > 0 ? game.rng.pick(injured).id : cur;
      if (target === cur && p.hp >= p.maxHp) return null;
      return { skillId: "triage", targets: [target], cardIds: [game.rng.pick(p.hand)] };
    }
    case "baron_howl": {
      if (!usable("satellite_call") || p.hand.length < 2) return null;
      const bySuit = new Map<string, string[]>();
      for (const c of p.hand) {
        const s = game.cards.get(c)!.suit;
        bySuit.set(s, [...(bySuit.get(s) ?? []), c]);
      }
      const pair = [...bySuit.values()].find((v) => v.length >= 2);
      if (!pair) return null;
      return { skillId: "satellite_call", cardIds: pair.slice(0, 2) };
    }
    default:
      return null;
  }
}

/** Draft pick: random from the offer (server passes the offer). */
export function botChooseDraft(offer: string[], rngPick: <T>(items: T[]) => T): string {
  return rngPick(offer);
}

/** End-of-turn discards: keep the "best" cards randomly (random bot). */
export function botChooseDiscards(game: Game, playerId: string): string[] {
  const p = game.state.players[playerId]!;
  const excess = p.hand.length - Math.max(0, p.hp);
  if (excess <= 0) return [];
  // keep strikes/evades/stims preferentially
  const value = (c: string): number => {
    const d = defIdOf(game, c);
    if (d === "evade" || d === "stim") return 2;
    if (d === "strike") return 1;
    return 0;
  };
  const sorted = [...p.hand].sort((a, b) => value(a) - value(b)); // low value first
  return sorted.slice(0, excess);
}

export { useSkill };
