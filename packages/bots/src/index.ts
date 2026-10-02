// Bot package: policy (shared decision logic) + sim runner.
export {
  botRespond,
  botChoosePlayAction,
  botChooseDraft,
  botChooseDiscards,
  type BotTurnAction,
} from "./policy.js";
export { playRandomGame, drainPrompts, type SimResult } from "./random-bot.js";
