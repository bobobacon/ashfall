// Random-legal bot game driver — powers M1 crash testing and E-01 simulations.
// Plays a full game: draft → turns with random damage/skips → end.
import type { Game } from "@ashfall/engine";
import {
  createGame,
  autoPick,
  endTurn,
  dealDamage,
  type CreateGameOptions,
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

export function playRandomGame(opts: CreateGameOptions, maxTurns = 500): SimResult {
  const game: Game = createGame(opts);
  const result: SimResult = {
    seed: opts.seed,
    playerCount: opts.players.length,
    turns: 0,
    conservationOk: false,
  };

  try {
    // draft: everyone auto-picks
    for (const p of Object.values(game.state.players)) {
      autoPick(game, p.id);
    }

    while (game.state.phase === "playing" && result.turns < maxTurns) {
      const cur = game.state.currentPlayerId!;
      result.turns = game.state.turnNumber;

      // random "attack": 50% chance to damage a random other alive player for 1
      const targets = Object.values(game.state.players).filter(
        (p) => p.alive && p.id !== cur,
      );
      if (targets.length > 0 && game.rng.next() < 0.5) {
        const t = game.rng.pick(targets);
        dealDamage(game, {
          targetId: t.id,
          amount: 1,
          sourcePlayerId: cur,
        });
      }

      // damage may have ended the game (e.g. sovereign killed) — stop cleanly.
      // Read via helper: TS narrows `state.phase` to "playing" from the loop
      // condition and can't know dealDamage() mutated it.
      if (phaseOf(game) === "ended") break;

      endTurn(game, cur);
    }

    if (game.state.phase === "ended") {
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
