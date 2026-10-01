// Engine public API — grows through M1..M4.
export { Rng } from "./rng.js";
export { buildDeck } from "./deck.js";
export { seatDistance, distance, attackRange, inAttackRange } from "./distance.js";
export { EventLog, type GameEvent } from "./events.js";
export {
  EngineError,
  createGame,
  pickSurvivor,
  autoPick,
  drawCards,
  endTurn,
  dealDamage,
  resolveDying,
  saveDying,
  killPlayer,
  checkGameEnd,
  cardOf,
  defOf,
  type Game,
  type CreateGameOptions,
  type DamageRequest,
} from "./engine.js";
export { viewFor, type PlayerView } from "./view.js";
