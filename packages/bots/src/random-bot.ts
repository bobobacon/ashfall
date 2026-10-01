// Random-legal bot game driver — powers M1 crash testing and E-01 simulations.
// Plays a full game: draft → turns with random legal card plays → end.
// Answers every prompt with a random legal response (or decline).
import {
  createGame,
  autoPick,
  endTurn,
  playCard,
  respond,
  defIdOf,
  handDefIds,
  distance,
  inAttackRange,
  strikeLimit,
  type Game,
  type CreateGameOptions,
  type RespondAction,
} from "@ashfall/engine";

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
        const evades = p.hand.filter((c) => defIdOf(game, c) === "evade");
        if (evades.length > 0 && flip < 0.7) {
          action = { kind: "discard", cardIds: [evades[0]!] };
        }
        break;
      }
      case "discard_strike": {
        const strikes = p.hand.filter((c) => defIdOf(game, c) === "strike");
        if (strikes.length > 0 && flip < 0.6) {
          action = { kind: "discard", cardIds: [strikes[0]!] };
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
        const zones = (prompt.context.zones as string[] | undefined) ??
          (prompt.context.options as string[] | undefined);
        if (zones && zones.length > 0) {
          action = { kind: "choose", choice: game.rng.pick(zones) };
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

/** Pick a random legal card to play from the current player's hand, if any. */
function tryRandomPlay(game: Game): boolean {
  const cur = game.state.currentPlayerId!;
  const p = game.state.players[cur]!;
  if (!p.alive || p.hand.length === 0) return false;

  const others = Object.values(game.state.players).filter((pl) => pl.alive && pl.id !== cur);
  if (others.length === 0) return false;

  // gather candidate plays
  type Candidate = { cardId: string; targets?: string[] };
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
      default:
        break; // evade / signal_jam: response-only
    }
  }

  if (candidates.length === 0) return false;
  const pick = game.rng.pick(candidates);
  playCard(game, { playerId: cur, cardId: pick.cardId, targets: pick.targets });
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

    while (phaseOf(game) === "playing" && result.turns < maxTurns) {
      const cur = game.state.currentPlayerId!;
      result.turns = game.state.turnNumber;

      // play up to 3 random legal cards this turn
      let plays = 0;
      while (plays < 3 && phaseOf(game) === "playing" && game.state.currentPlayerId === cur) {
        if (!tryRandomPlay(game)) break;
        plays++;
      }
      if (phaseOf(game) === "ended") break;
      if (game.state.currentPlayerId !== cur) continue; // turn advanced via effects

      endTurn(game, cur);
      drainPrompts(game);
    }

    if (phaseOf(game) === "ended") {
      result.winner = game.state.winner?.faction;
    } else {
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
