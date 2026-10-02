// Engine public API. Importing this module also loads skills.ts, which
// registers the passive hooks at module load (side effect by design).
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
  handToLimbo,
  takeFromLimbo,
  recoverStalledTurn,
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
  openEvadeWindow,
  strikeLimit,
  launcherStrike,
  isGhostProtected,
  canActAs,
  type PlayCardRequest,
} from "./cards.js";
export {
  resolveStandoff,
  resolveMortarRain,
  resolveMutantHorde,
  resolveFieldClinic,
  resolveSupplyDrop,
} from "./effects.js";
export { hooks } from "./hooks.js";
export {
  useSkill,
  canUseSkillNow,
  ACTIVE_SKILLS,
  removeEquipment,
  kaanFateGate,
  evadesRequired,
  evadeForbidden,
  type ActiveSkillId,
  type UseSkillRequest,
} from "./skills.js";
