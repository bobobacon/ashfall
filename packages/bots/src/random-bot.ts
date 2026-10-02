// Random-legal bot game driver — powers M1 crash testing and E-01 simulations.
// Plays a full game: draft → turns with random legal card plays → end.
// Answers every prompt with a random legal response (or decline).
import {
  createGame,
  autoPick,
  endTurn,
  playCard,
  respond,
  useSkill,
  canUseSkillNow,
  canActAs,
  defIdOf,
  distance,
  inAttackRange,
  strikeLimit,
  type ActiveSkillId,
  type Game,
  type CreateGameOptions,
  type RespondAction,
  type UseSkillRequest,
} from "@ashfall/engine";
import { SURVIVOR_DEFS } from "@ashfall/shared";

export interface SimResult {
  seed: number;
  playerCount: number;
  turns: number;
  winner?: string;
  crashed?: string;
  conservationOk: boolean;
}

/** Un-narrowed phase read (engine mutations are invisible to TS control flow). */
function phaseOf(game: Game): string {
  return game.state.phase;
}

/** Un-narrowed turnPhase read — same reason as phaseOf. */
function turnPhaseOf(game: Game): string | undefined {
  return game.state.turnPhase;
}

/** Answer all pending prompts with random legal responses. */
function drainPrompts(game: Game, max = 1000): void {
  let guard = 0;
  while (game.state.pendingPrompts.length > 0 && guard++ < max) {
    const prompt = game.state.pendingPrompts[0]!;
    const pid = prompt.playerId;
    const p = game.state.players[pid]!;
    const flip = game.rng.next();

    let action: RespondAction = { kind: "decline" };

    switch (prompt.kind) {
      case "discard_evade": {
        const required = (prompt.context.required as number | undefined) ?? 1;
        const evades = p.hand.filter((c) => defIdOf(game, c) === "evade");
        // Wraith Phase Step: strikes can act as evades
        if (p.survivorId === "wraith_white_ghost") {
          evades.push(...p.hand.filter((c) => defIdOf(game, c) === "strike"));
        }
        const unique = [...new Set(evades)];
        if (unique.length >= required && flip < 0.7) {
          action = { kind: "discard", cardIds: unique.slice(0, required) };
        }
        break;
      }
      case "discard_strike": {
        const strikes = p.hand.filter((c) => defIdOf(game, c) === "strike");
        // Ronan War Saint: red cards act as strikes
        if (p.survivorId === "ronan_crimson_blade") {
          strikes.push(...p.hand.filter((c) => {
            const inst = game.cards.get(c)!;
            return inst.suit === "heart" || inst.suit === "diamond";
          }));
        }
        const unique = [...new Set(strikes)];
        if (unique.length > 0 && flip < 0.6) {
          action = { kind: "discard", cardIds: [unique[0]!] };
        }
        break;
      }
      case "use_stim": {
        const isSelf = prompt.context.self === true;
        const saves = p.hand.filter((c) => {
          const d = defIdOf(game, c);
          return d === "stim" || (isSelf && d === "chem_brew");
        });
        if (saves.length > 0 && flip < 0.9) {
          action = { kind: "discard", cardIds: [saves[0]!] };
        }
        break;
      }
      case "jam": {
        const jams = p.hand.filter((c) => defIdOf(game, c) === "signal_jam");
        if (jams.length > 0 && flip < 0.3) {
          action = { kind: "discard", cardIds: [jams[0]!] };
        }
        break;
      }
      case "choose":
      case "supply_pick": {
        const mode = prompt.context.mode as string | undefined;
        if (mode === "highwayman_targets") {
          const opts = prompt.context.options as string[];
          const n = Math.min(opts.length, flip < 0.5 ? 1 : 2);
          const picks = game.rng.shuffle(opts).slice(0, n);
          action = { kind: "choose", choice: JSON.stringify(picks) };
        } else if (mode === "draw_skill_choice") {
          const opts = prompt.context.options as string[];
          // 50/50: use the skill or normal draw
          action = flip < 0.5 ? { kind: "choose", choice: game.rng.pick(opts) } : { kind: "decline" };
        } else {
          const zones = (prompt.context.zones as string[] | undefined) ??
            (prompt.context.options as string[] | undefined);
          if (zones && zones.length > 0) {
            action = { kind: "choose", choice: game.rng.pick(zones) };
          }
        }
        break;
      }
      case "proxy_war": {
        const strikes = p.hand.filter((c) => defIdOf(game, c) === "strike");
        if (strikes.length > 0 && flip < 0.5) {
          action = { kind: "discard", cardIds: [strikes[0]!] };
        }
        break;
      }
      default:
        break; // decline
    }

    respond(game, pid, prompt.id, action);
    if (phaseOf(game) === "ended") return;
  }
  if (game.state.pendingPrompts.length > 0) {
    throw new Error(`prompt drain stuck: ${game.state.pendingPrompts.length} prompts remain`);
  }
}

/** Ghost Signal: empty-hand Sage Aldric is untargetable. */
function isGhost(t: { survivorId?: string; hand: string[] }): boolean {
  return t.survivorId === "sage_aldric" && t.hand.length === 0;
}

/** Try a random active skill for the current player (play phase). */
function tryRandomSkill(game: Game): boolean {
  const cur = game.state.currentPlayerId!;
  const p = game.state.players[cur]!;
  if (!p.alive || !p.survivorId) return false;

  const others = Object.values(game.state.players).filter((o) => o.alive && o.id !== cur);
  if (others.length === 0) return false;
  const flip = game.rng.next();
  if (flip > 0.25) return false; // only sometimes, to keep games varied

  const tryUse = (skillId: ActiveSkillId, req: Omit<UseSkillRequest, "playerId" | "skillId">): boolean => {
    if (!canUseSkillNow(game, cur, skillId)) return false;
    try {
      useSkill(game, { playerId: cur, skillId, ...req });
      drainPrompts(game);
      return true;
    } catch {
      return false; // illegal in this exact state — fall through
    }
  };

  switch (p.survivorId) {
    case "bastion":
      return tryUse("bunker_down", {});
    case "tide_lord_soran":
      if (p.hand.length > 0) {
        return tryUse("reforge", { cardIds: [game.rng.pick(p.hand)] });
      }
      return false;
    case "matriarch_vala":
      if (p.hand.length > 0) {
        return tryUse("almsgiver", {
          targets: [game.rng.pick(others).id],
          cardIds: [game.rng.pick(p.hand)],
        });
      }
      return false;
    case "vesper_blade_dancer": {
      const slots = (["weapon", "armor", "rig_plus", "rig_minus"] as const).filter(
        (s) => p.equipment[s],
      );
      if (slots.length === 0 || p.hp >= p.maxHp) return false;
      return tryUse("bond_weave", {
        cardIds: [p.equipment[slots[0]!]!],
        targets: [],
      });
    }
    case "quartermaster_orlo":
      if (others.length >= 2) {
        const [t1, t2] = game.rng.shuffle(others).slice(0, 2);
        if (tryUse("barter", { targets: [t1!.id, t2!.id] })) return true;
      }
      return false;
    case "femme_black_widow": {
      const males = others.filter(
        (o) => o.survivorId && SURVIVOR_DEFS[o.survivorId]?.gender === "male",
      );
      if (males.length < 2 || p.hand.length === 0) return false;
      const [m1, m2] = game.rng.shuffle(males).slice(0, 2);
      return tryUse("honey_trap", {
        targets: [m1!.id, m2!.id],
        cardIds: [game.rng.pick(p.hand)],
      });
    }
    case "doc_mort": {
      const injured = [p, ...others].filter((o) => o.hp < o.maxHp);
      if (injured.length === 0 || p.hand.length === 0) return false;
      return tryUse("triage", {
        targets: [game.rng.pick(injured).id],
        cardIds: [game.rng.pick(p.hand)],
      });
    }
    case "baron_howl": {
      if (p.hand.length < 2) return false;
      const bySuit = new Map<string, string[]>();
      for (const c of p.hand) {
        const s = game.cards.get(c)!.suit;
        bySuit.set(s, [...(bySuit.get(s) ?? []), c]);
      }
      const pair = [...bySuit.values()].find((v) => v.length >= 2);
      if (!pair) return false;
      return tryUse("satellite_call", { cardIds: pair.slice(0, 2) });
    }
    default:
      return false;
  }
}

/** Pick a random legal card to play from the current player's hand, if any. */
function tryRandomPlay(game: Game): boolean {
  const cur = game.state.currentPlayerId!;
  const p = game.state.players[cur]!;
  if (!p.alive || p.hand.length === 0) return false;

  const others = Object.values(game.state.players).filter((pl) => pl.alive && pl.id !== cur);
  if (others.length === 0) return false;

  // gather candidate plays
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
          const has = t.hand.length > 0 || Object.values(t.equipment).some(Boolean) || t.delayed.length > 0;
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
            if (b.id === a.id) continue;
            if (isGhost(b)) continue;
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
          if (t.survivorId === "ember_sage_ryn") continue; // Ashwalk immune
          if (distance(game.state, cur, t.id) <= 1 && !t.delayed.some((d) => d.defId === "ration_cut")) {
            candidates.push({ cardId, targets: [t.id] });
          }
        }
        break;
      }
      case "lockdown": {
        const all = [p, ...others];
        for (const t of all) {
          if (isGhost(t)) continue;
          if (t.delayed.some((d) => d.defId === "lockdown")) continue;
          if (t.survivorId === "ember_sage_ryn") continue; // Ashwalk immune
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
        // conversion skills: Ronan red→strike (bot plays converted strikes too)
        if (
          p.survivorId === "ronan_crimson_blade" &&
          p.strikeCountThisTurn < strikeLimit(game, cur) &&
          defIdOf(game, cardId) !== "strike" &&
          canActAs(game, cur, cardId, "strike")
        ) {
          for (const t of others) {
            if (isGhost(t)) continue;
            if (inAttackRange(game.state, cur, t.id, game.cards)) {
              candidates.push({ cardId, targets: [t.id], asDefId: "strike" });
            }
          }
        }
        break; // evade / signal_jam: response-only
      }
    }
  }

  if (candidates.length === 0) return false;
  // prefer strikes 60% of the time so games actually progress toward kills
  const strikes = candidates.filter(
    (c) => defIdOf(game, c.cardId) === "strike" || c.asDefId === "strike",
  );
  const pick =
    strikes.length > 0 && game.rng.next() < 0.6
      ? game.rng.pick(strikes)
      : game.rng.pick(candidates);
  playCard(game, { playerId: cur, cardId: pick.cardId, targets: pick.targets, asDefId: pick.asDefId });
  drainPrompts(game);
  return true;
}

export function playRandomGame(opts: CreateGameOptions, maxTurns = 500): SimResult {
  const game: Game = createGame(opts);
  const result: SimResult = {
    seed: opts.seed,
    playerCount: opts.players.length,
    turns: 0,
    conservationOk: false,
  };

  try {
    for (const p of Object.values(game.state.players)) {
      autoPick(game, p.id);
    }
    drainPrompts(game);

    let iters = 0;
    while (phaseOf(game) === "playing" && result.turns < maxTurns) {
      iters++;
      if (iters > maxTurns * 3) {
        result.crashed = `iteration cap: stuck at turn ${game.state.turnNumber}, phase=${String(game.state.turnPhase)}, current=${game.state.currentPlayerId}, pending=${game.state.pendingPrompts.map((pr) => `${pr.playerId}:${pr.kind}:${String(pr.context.mode ?? "")}`).join("|")}`;
        break;
      }
      const cur = game.state.currentPlayerId!;
      const turnBefore = game.state.turnNumber;
      result.turns = turnBefore;

      // play up to 3 random legal actions this turn (play phase only, no pending prompts)
      let plays = 0;
      while (
        plays < 3 &&
        phaseOf(game) === "playing" &&
        game.state.currentPlayerId === cur &&
        game.state.turnPhase === "play" &&
        game.state.pendingPrompts.length === 0
      ) {
        if (tryRandomSkill(game)) {
          plays++;
          continue;
        }
        if (!tryRandomPlay(game)) break;
        drainPrompts(game);
        plays++;
      }
      if (phaseOf(game) === "ended") break;
      if (game.state.currentPlayerId !== cur) continue; // turn advanced via effects
      if (game.state.pendingPrompts.length > 0) {
        drainPrompts(game);
        if (phaseOf(game) === "ended") break;
        if (game.state.currentPlayerId !== cur) continue;
      }
      if (game.state.turnPhase === "play") {
        endTurn(game, cur);
        drainPrompts(game);
      } else {
        // still in draw/start phase with prompts — drain again or break to avoid spinning
        drainPrompts(game);
        if (game.state.currentPlayerId === cur && turnPhaseOf(game) !== "play") {
          result.crashed = `stuck in phase ${String(game.state.turnPhase)} cur=${cur} surv=${String(game.state.players[cur]!.survivorId)} alive=${game.state.players[cur]!.alive} pendingMap=${game.pending.size} aliveAll=${Object.values(game.state.players).filter((x) => x.alive).map((x) => x.id + ":" + String(x.survivorId)).join(",")}`;
          break;
        }
      }
      // safety: if a full iteration neither advanced the turn nor ended the game,
      // something is looping — break with diagnostics
      if (
        phaseOf(game) === "playing" &&
        game.state.turnNumber === turnBefore &&
        game.state.currentPlayerId === cur &&
        game.state.pendingPrompts.length === 0
      ) {
        result.crashed = `no-progress at turn ${turnBefore}, phase=${String(game.state.turnPhase)}`;
        break;
      }
    }

    if (phaseOf(game) === "ended") {
      result.winner = game.state.winner?.faction;
    } else if (!result.crashed) {
      result.crashed = `turn cap hit (${maxTurns}) without game end`;
    }

    // card conservation invariant (A11-04)
    let total = game.state.deck.length + game.state.discard.length;
    for (const p of Object.values(game.state.players)) {
      total += p.hand.length;
      for (const slot of ["weapon", "armor", "rig_plus", "rig_minus"] as const) {
        if (p.equipment[slot]) total++;
      }
      total += p.delayed.length;
    }
    result.conservationOk = total === 108;
    if (!result.conservationOk) {
      result.crashed = `card conservation broken: ${total} != 108`;
    }
  } catch (err) {
    result.crashed = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  }

  return result;
}
