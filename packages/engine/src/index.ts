// Engine public API — grows through M1..M4.
export type {
  CardInstance,
  GameState,
  PlayerState,
  Prompt,
  PromptKind,
  RespondAction,
  Role,
  GameSettings,
} from "@ashfall/shared";
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
  discardFromHand,
  heal,
  endTurn,
  forceEndTurn,
  dealDamage,
  enterDying,
  resolveDying,
  saveDying,
  killPlayer,
  checkGameEnd,
  gameEnded,
  cardOf,
  defOf,
  defIdOf,
  handDefIds,
  ask,
  respond,
  cancelPromptsFor,
  flipFate,
  jamWindow,
  placeDelayed,
  turnOrderFrom,
  nextAlive,
  emit,
  type Game,
  type CreateGameOptions,
  type DamageRequest,
  type DamageKind,
  type PendingResponse,
  type AskOptions,
  type FateResult,
  type JamWindowOptions,
} from "./engine.js";
export { viewFor, type PlayerView } from "./view.js";
export {
  playCard,
  installEquipment,
  playStrike,
  strikeLimit,
  launcherStrike,
  resolveStandoff,
  type PlayCardRequest,
} from "./cards.js";
