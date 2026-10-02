// Random-legal bot game driver — powers crash testing and E-01 simulations.
// Uses the shared bot policy (same code path as server bot seats in M5).
import {
  createGame,
  autoPick,
  endTurn,
  playCard,
  respond,
  useSkill,
  type Game,
  type CreateGameOptions,
} from "@ashfall/engine";
import { botChoosePlayAction, botRespond, botChooseDiscards } from "./policy.js";

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

function turnPhaseOf(game: Game): string | undefined {
  return game.state.turnPhase;
}

/** Answer all pending prompts with policy responses. */
export function drainPrompts(game: Game, max = 1000): void {
  let guard = 0;
  while (game.state.pendingPrompts.length > 0 && guard++ < max) {
    const prompt = game.state.pendingPrompts[0]!;
    const action = botRespond(game, prompt);
    respond(game, prompt.playerId, prompt.id, action);
    if (phaseOf(game) === "ended") return;
  }
  if (game.state.pendingPrompts.length > 0) {
    throw new Error(`prompt drain stuck: ${game.state.pendingPrompts.length} prompts remain`);
  }
}

export function playRandomGame(opts: CreateGameOptions, maxTurns = 1500): SimResult {
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
        result.crashed = `iteration cap: stuck at turn ${game.state.turnNumber}, phase=${String(game.state.turnPhase)}, current=${game.state.currentPlayerId}`;
        break;
      }
      const cur = game.state.currentPlayerId!;
      const turnBefore = game.state.turnNumber;
      result.turns = turnBefore;

      // up to 3 actions this turn (play phase only, no pending prompts)
      let plays = 0;
      while (
        plays < 3 &&
        phaseOf(game) === "playing" &&
        game.state.currentPlayerId === cur &&
        turnPhaseOf(game) === "play" &&
        game.state.pendingPrompts.length === 0
      ) {
        const action = botChoosePlayAction(game);
        if (action.kind === "play") {
          playCard(game, {
            playerId: cur,
            cardId: action.cardId,
            targets: action.targets,
            asDefId: action.asDefId,
          });
          drainPrompts(game);
          plays++;
        } else if (action.kind === "skill") {
          useSkill(game, { playerId: cur, ...action.req });
          drainPrompts(game);
          plays++;
        } else {
          break;
        }
      }
      if (phaseOf(game) === "ended") break;
      if (game.state.currentPlayerId !== cur) continue;
      if (game.state.pendingPrompts.length > 0) {
        drainPrompts(game);
        if (phaseOf(game) === "ended") break;
        if (game.state.currentPlayerId !== cur) continue;
      }
      if (turnPhaseOf(game) === "play") {
        endTurn(game, cur, botChooseDiscards(game, cur));
        drainPrompts(game);
      } else {
        drainPrompts(game);
        if (game.state.currentPlayerId === cur && turnPhaseOf(game) !== "play") {
          result.crashed = `stuck in phase ${String(game.state.turnPhase)} cur=${cur} alive=${game.state.players[cur]!.alive}`;
          break;
        }
      }
      // no-progress guard
      if (
        phaseOf(game) === "playing" &&
        game.state.turnNumber === turnBefore &&
        game.state.currentPlayerId === cur &&
        game.state.pendingPrompts.length === 0 &&
        turnPhaseOf(game) === "play"
      ) {
        // same player still in play phase after endTurn attempt — loop would spin
        result.crashed = `no-progress at turn ${turnBefore}`;
        break;
      }
    }

    if (phaseOf(game) === "ended") {
      result.winner = game.state.winner?.faction;
    } else if (!result.crashed) {
      result.crashed = `turn cap hit (${maxTurns}) without game end`;
    }

    // card conservation invariant (A11-04)
    let total = game.state.deck.length + game.state.discard.length + game.limbo.length;
    for (const p of Object.values(game.state.players)) {
      total += p.hand.length;
      for (const slot of ["weapon", "armor", "rig_plus", "rig_minus"] as const) {
        if (p.equipment[slot]) total++;
      }
      total += p.delayed.length;
    }
    // in-flight zones: table-held delayed cards & revealed supply-drop cards
    total += game.revealed.length;
    result.conservationOk = total === 108;
    if (!result.conservationOk) {
      result.crashed = `card conservation broken: ${total} != 108`;
    }
  } catch (err) {
    result.crashed = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  }

  return result;
}
