// Core engine — deterministic, pure (no I/O). All rules server-side (doc 01).
//
// Design:
//  - GameState is a plain serializable object (single source of truth).
//  - `Game` additionally holds non-serializable continuations (pending prompt
//    resumes). The server owns Games in memory; clients only ever see views.
//  - Every mutation emits to the EventLog; the server drains it for broadcasts.
//  - Responses (Evade/Stim/Jam/…) resolve through the prompt stack: effects
//    register a prompt + continuation, `respond()` resumes them.

import {
  CARD_DEFS,
  DEFAULT_SETTINGS,
  ROLE_DISTRIBUTION,
  STANDARD_SURVIVOR_IDS,
  LEADER_IDS,
  SURVIVOR_DEFS,
  type CardInstance,
  type GameState,
  type GameSettings,
  type PlayerState,
  type Prompt,
  type PromptKind,
  type RespondAction,
  type Role,
  type Suit,
} from "@ashfall/shared";
import { EventLog, type GameEvent } from "./events.js";
import { Rng } from "./rng.js";
import { buildDeck } from "./deck.js";
import { hooks, canSaveWith } from "./hooks.js";

export class EngineError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

export interface CreateGameOptions {
  roomId: string;
  seed: number;
  players: { id: string; name: string; isBot?: boolean }[];
  settings?: Partial<GameSettings>;
}

/** Continuation waiting on a player's response. */
export interface PendingResponse {
  prompt: Prompt;
  /** returns error code string if the action is illegal for this prompt */
  validate?: (action: RespondAction) => string | null;
  /** resume with a validated action, or null on timeout/auto-decline */
  resume: (action: RespondAction | null) => void;
}

export interface Game {
  state: GameState;
  cards: Map<string, CardInstance>;
  log: EventLog;
  rng: Rng;
  draftOffers: Map<string, string[]>;
  pickedSurvivors: Set<string>;
  /** prompt id → continuation */
  pending: Map<string, PendingResponse>;
  nextPromptId: number;
  /** per-turn phase skip flags (Ration Cut / Lockdown) */
  turnCtx: { skipDraw: boolean; skipPlay: boolean };
  /** cards revealed by Supply Drop (transient) */
  revealed: string[];
  /**
   * Limbo zone: cards mid-resolution (delayed tactics awaiting a jam window,
   * etc.). Kept OUT of deck & discard so a reshuffle triggered by a hook can
   * never swallow a card that is still being placed. Counted for conservation.
   */
  limbo: string[];
}

/** Move a card from a player's hand into the limbo zone (no discard round-trip).
 *  Fires onHandEmpty AFTER the card is safely in limbo. */
export function handToLimbo(game: Game, playerId: string, cardId: string, defId: string, targets?: string[]): void {
  const p = game.state.players[playerId]!;
  const idx = p.hand.indexOf(cardId);
  if (idx >= 0) p.hand.splice(idx, 1);
  game.limbo.push(cardId);
  emit(game, { type: "card_played", playerId, cardId, defId, targets });
  if (p.hand.length === 0 && p.alive) hooks.onHandEmpty?.(game, playerId);
}

/** Take a card out of limbo (to place on the table or send to discard). */
export function takeFromLimbo(game: Game, cardId: string): void {
  const idx = game.limbo.indexOf(cardId);
  if (idx >= 0) game.limbo.splice(idx, 1);
}

const ALL_ROLES: Role[] = ["sovereign", "warden", "raider", "phantom"];

// ---------------------------------------------------------------------------
// Game creation & draft
// ---------------------------------------------------------------------------

export function createGame(opts: CreateGameOptions): Game {
  const n = opts.players.length;
  if (n < 3 || n > 10) throw new EngineError("E_PLAYER_COUNT", "need 3-10 players");
  const dist = ROLE_DISTRIBUTION[n]!;

  const rng = new Rng(opts.seed);
  const deckCards = buildDeck();
  const cards = new Map(deckCards.map((c) => [c.id, c]));

  const roleBag: Role[] = [];
  for (const role of ALL_ROLES) {
    for (let i = 0; i < dist[role]; i++) roleBag.push(role);
  }
  const roles = rng.shuffle(roleBag);

  const players: Record<string, PlayerState> = {};
  const turnOrder: string[] = [];
  opts.players.forEach((p, i) => {
    turnOrder.push(p.id);
    players[p.id] = {
      id: p.id,
      seat: i,
      name: p.name,
      role: roles[i]!,
      roleRevealed: false,
      hp: 0,
      maxHp: 0,
      hand: [],
      equipment: {},
      delayed: [],
      tethered: false,
      alive: true,
      flipped: false,
      strikeCountThisTurn: 0,
      buffs: { chemBrewNext: false, barehideMode: false },
      marks: {},
      connected: true,
      isBot: p.isBot ?? false,
    };
  });

  const sovereign = Object.values(players).find((p) => p.role === "sovereign")!;
  sovereign.roleRevealed = true;

  const state: GameState = {
    roomId: opts.roomId,
    seed: opts.seed,
    phase: "role_deal",
    turnOrder,
    turnNumber: 0,
    deck: rng.shuffle(deckCards.map((c) => c.id)),
    discard: [],
    players,
    pendingPrompts: [],
    settings: { ...DEFAULT_SETTINGS, ...opts.settings },
    seq: 0,
  };

  const log = new EventLog();
  log.push({ type: "game_created", roomId: state.roomId, seed: state.seed, playerCount: n });
  log.push({ type: "roles_dealt", sovereignSeat: sovereign.seat });
  // roles are dealt synchronously at creation → the game is immediately in draft
  state.phase = "draft";

  const game: Game = {
    state,
    cards,
    log,
    rng,
    draftOffers: new Map(),
    pickedSurvivors: new Set(),
    pending: new Map(),
    nextPromptId: 0,
    turnCtx: { skipDraw: false, skipPlay: false },
    revealed: [],
    limbo: [],
  };

  // Draft offers: Sovereign 3 random + 3 leaders (leaders reserved for sovereign);
  // others 3 random. Unique offers while the pool lasts; refill/redeal otherwise.
  const reservedLeaders = new Set(LEADER_IDS);
  const available = rng.shuffle(STANDARD_SURVIVOR_IDS.filter((id) => !reservedLeaders.has(id)));
  const offered = new Set<string>();

  const deal3 = (): string[] => {
    const out: string[] = [];
    while (out.length < 3) {
      if (available.length === 0) {
        const refill = STANDARD_SURVIVOR_IDS.filter(
          (id) => !reservedLeaders.has(id) && !game.pickedSurvivors.has(id) && !offered.has(id),
        );
        if (refill.length === 0) {
          const reuse = STANDARD_SURVIVOR_IDS.filter(
            (id) => !reservedLeaders.has(id) && !game.pickedSurvivors.has(id),
          );
          available.push(...rng.shuffle(reuse));
        } else {
          available.push(...rng.shuffle(refill));
        }
      }
      const id = available.pop()!;
      if (game.pickedSurvivors.has(id) || out.includes(id)) continue;
      out.push(id);
      offered.add(id);
    }
    return out;
  };

  for (const p of Object.values(players)) {
    if (p.role === "sovereign") {
      const offer = [...deal3(), ...LEADER_IDS];
      game.draftOffers.set(p.id, offer);
      log.push({ type: "draft_offered", playerId: p.id, survivorIds: offer });
    } else {
      const offer = deal3();
      game.draftOffers.set(p.id, offer);
      log.push({ type: "draft_offered", playerId: p.id, survivorIds: offer });
    }
  }

  return game;
}

export function pickSurvivor(game: Game, playerId: string, survivorId: string): void {
  const { state } = game;
  if (state.phase !== "role_deal" && state.phase !== "draft") {
    throw new EngineError("E_PHASE", "draft not active");
  }
  const offer = game.draftOffers.get(playerId);
  if (!offer || offer.length === 0) throw new EngineError("E_DRAFT_DONE", "already picked");
  if (!offer.includes(survivorId)) {
    throw new EngineError("E_NOT_OFFERED", "survivor not in your offer");
  }
  if (game.pickedSurvivors.has(survivorId)) {
    throw new EngineError("E_ALREADY_TAKEN", "survivor already chosen by another player");
  }
  game.draftOffers.set(playerId, []);
  game.pickedSurvivors.add(survivorId);

  const p = state.players[playerId]!;
  p.survivorId = survivorId;
  const def = SURVIVOR_DEFS[survivorId]!;
  p.maxHp = def.maxHp + (p.role === "sovereign" ? 1 : 0);
  p.hp = p.maxHp;
  emit(game, { type: "draft_picked", playerId, survivorId });

  const allPicked = Object.values(state.players).every((pl) => pl.survivorId !== undefined);
  if (allPicked) startGame(game);
}

export function autoPick(game: Game, playerId: string): void {
  if (game.state.players[playerId]?.survivorId) return;
  const offer = game.draftOffers.get(playerId);
  if (!offer || offer.length === 0) return;

  let candidates = offer.filter((id) => !game.pickedSurvivors.has(id));
  if (candidates.length === 0) {
    const pool = game.rng.shuffle(
      STANDARD_SURVIVOR_IDS.filter((id) => !game.pickedSurvivors.has(id)),
    );
    const isSovereign = game.state.players[playerId]!.role === "sovereign";
    if (isSovereign) {
      const freeLeaders = LEADER_IDS.filter((id) => !game.pickedSurvivors.has(id));
      const others = pool.filter((id) => !freeLeaders.includes(id)).slice(0, 3);
      candidates = [...others, ...freeLeaders];
    } else {
      candidates = pool.slice(0, 3);
    }
    game.draftOffers.set(playerId, candidates);
    emit(game, { type: "draft_offered", playerId, survivorIds: candidates });
  }
  pickSurvivor(game, playerId, game.rng.pick(candidates));
}

function startGame(game: Game): void {
  const { state } = game;
  state.phase = "draft";
  emit(game, { type: "draft_revealed" });

  for (const p of Object.values(state.players)) {
    drawCards(game, p.id, 4);
  }

  state.phase = "playing";
  const sovereignIdx = state.turnOrder.findIndex(
    (id) => state.players[id]!.role === "sovereign",
  );
  state.turnOrder = [
    ...state.turnOrder.slice(sovereignIdx),
    ...state.turnOrder.slice(0, sovereignIdx),
  ];
  emit(game, { type: "game_started", turnOrder: [...state.turnOrder] });

  beginTurn(game, state.turnOrder[0]!);
}

// ---------------------------------------------------------------------------
// Event helper (seq assignment) + card/deck helpers
// ---------------------------------------------------------------------------

export function emit(game: Game, ev: GameEvent): void {
  game.state.seq++;
  game.log.push(ev);
}

export function drawCards(game: Game, playerId: string, count: number): void {
  const { state } = game;
  const p = state.players[playerId]!;
  let drawn = 0;
  for (let i = 0; i < count; i++) {
    if (state.deck.length === 0) {
      if (state.discard.length === 0) break;
      state.deck = game.rng.shuffle(state.discard.splice(0, state.discard.length));
      emit(game, { type: "reshuffle" });
    }
    p.hand.push(state.deck.pop()!);
    drawn++;
  }
  if (drawn > 0) emit(game, { type: "cards_drawn", playerId, count: drawn });
}

/** Move cards from a player's hand to the discard pile. */
export function discardFromHand(game: Game, playerId: string, cardIds: string[], reason: string): void {
  const p = game.state.players[playerId]!;
  const removed: string[] = [];
  for (const cardId of cardIds) {
    const idx = p.hand.indexOf(cardId);
    if (idx >= 0) {
      p.hand.splice(idx, 1);
      game.state.discard.push(cardId);
      removed.push(cardId);
    }
  }
  if (removed.length === 1) {
    emit(game, { type: "card_discarded", playerId, cardId: removed[0]!, reason });
  } else if (removed.length > 1) {
    emit(game, { type: "cards_discarded", playerId, cardIds: removed, reason });
  }
  if (removed.length > 0 && p.hand.length === 0 && p.alive) {
    hooks.onHandEmpty?.(game, playerId);
  }
}

export function heal(game: Game, targetId: string, amount: number, src?: { playerId?: string; cardId?: string }): void {
  const p = game.state.players[targetId]!;
  const before = p.hp;
  p.hp = Math.min(p.maxHp, p.hp + amount);
  if (p.hp > before) {
    emit(game, { type: "heal", targetId, amount: p.hp - before, sourcePlayerId: src?.playerId, sourceCardId: src?.cardId });
  }
}

export function cardOf(game: Game, cardId: string): CardInstance | undefined {
  return game.cards.get(cardId);
}

export function defOf(game: Game, cardId: string) {
  const inst = game.cards.get(cardId);
  return inst ? CARD_DEFS[inst.defId] : undefined;
}

export function defIdOf(game: Game, cardId: string): string | undefined {
  return game.cards.get(cardId)?.defId;
}

export function handDefIds(game: Game, playerId: string): string[] {
  return game.state.players[playerId]!.hand.map((c) => defIdOf(game, c)!).filter(Boolean);
}

// ---------------------------------------------------------------------------
// Prompt stack
// ---------------------------------------------------------------------------

export interface AskOptions {
  playerId: string;
  kind: PromptKind;
  context: Record<string, unknown>;
  validate?: (action: RespondAction) => string | null;
  resume: (action: RespondAction | null) => void;
}

/** Issue a prompt to a player and suspend the current effect until answered. */
export function ask(game: Game, opts: AskOptions): void {
  const id = `pr${++game.nextPromptId}`;
  const prompt: Prompt = {
    id,
    playerId: opts.playerId,
    kind: opts.kind,
    context: opts.context,
    deadlineMs: 0, // server stamps real deadline when broadcasting
  };
  game.pending.set(id, { prompt, validate: opts.validate, resume: opts.resume });
  game.state.pendingPrompts.push(prompt);
  emit(game, { type: "prompt_issued", prompt });
}

/** Player answers a prompt. action=null means timeout/auto-decline. */
export function respond(game: Game, playerId: string, promptId: string, action: RespondAction | null): void {
  const pending = game.pending.get(promptId);
  if (!pending) throw new EngineError("E_NO_PROMPT", "unknown or resolved prompt");
  if (pending.prompt.playerId !== playerId) {
    throw new EngineError("E_NOT_YOUR_PROMPT", "prompt addressed to another player");
  }

  if (action !== null) {
    // validate BEFORE consuming — an illegal answer must leave the prompt pending
    // so the player can retry (server also counts the cheat attempt).
    const err = pending.validate?.(action);
    if (err) throw new EngineError(err, `illegal response: ${err}`);
  }

  game.pending.delete(promptId);
  game.state.pendingPrompts = game.state.pendingPrompts.filter((p) => p.id !== promptId);

  if (action === null) {
    emit(game, { type: "prompt_timeout", promptId, playerId });
    pending.resume(null);
    return;
  }

  emit(game, { type: "prompt_resolved", promptId, playerId, action: JSON.stringify(action).slice(0, 200) });
  pending.resume(action);
  // safety net: if the resolution left a dead turn-holder with nothing pending,
  // advance the turn (covers deaths inside prompt chains)
  recoverStalledTurn(game);
}

/** Cancel all pending prompts of a player (e.g. on death) without resuming.
 *  Callers MUST follow up with recoverStalledTurn() — a cancelled turn-flow
 *  prompt (draw_skill_choice etc.) orphans its continuation. */
export function cancelPromptsFor(game: Game, playerId: string): void {
  for (const [id, pending] of [...game.pending]) {
    if (pending.prompt.playerId === playerId) {
      game.pending.delete(id);
      game.state.pendingPrompts = game.state.pendingPrompts.filter((p) => p.id !== id);
    }
  }
}

/** Self-heal the turn flow: if the current turn holder is dead and nothing is
 *  pending, advance to the next player. Covers deaths mid-turn (Blood Debt,
 *  Misdirect redirects, Ion Storm) where the flow continuation was cancelled
 *  along with the dead player's prompts. */
export function recoverStalledTurn(game: Game): void {
  const { state } = game;
  if (state.phase !== "playing") return;
  if (game.pending.size > 0) return;
  const cur = state.currentPlayerId ? state.players[state.currentPlayerId] : undefined;
  if (cur && cur.alive) return;
  beginTurn(game);
}

// ---------------------------------------------------------------------------
// Turn flow
// ---------------------------------------------------------------------------

function beginTurn(game: Game, firstId?: string): void {
  const { state } = game;
  if (state.phase !== "playing") return;

  let current: string;
  if (firstId) {
    current = firstId;
  } else {
    current = state.turnOrder[
      (state.turnOrder.indexOf(state.currentPlayerId!) + 1) % state.turnOrder.length
    ]!;
  }

  // skip dead or flipped (Bunker Down / Void Tithe) players
  let guard = 0;
  while (guard++ <= state.turnOrder.length) {
    const p = state.players[current]!;
    if (p.alive && !p.flipped) break;
    if (p.alive && p.flipped) {
      p.flipped = false;
      emit(game, { type: "phase_changed", playerId: current, phase: undefined });
    }
    current = state.turnOrder[(state.turnOrder.indexOf(current) + 1) % state.turnOrder.length]!;
  }

  const p = state.players[current]!;
  if (!p.alive || state.phase !== "playing") return;

  state.currentPlayerId = current;
  state.turnNumber++;
  p.strikeCountThisTurn = 0;
  p.buffs = { chemBrewNext: false, barehideMode: false };
  game.turnCtx = { skipDraw: false, skipPlay: false };
  emit(game, { type: "turn_started", playerId: current, turnNumber: state.turnNumber });

  // --- start phase: turnStart skill hook (Drone Scout), then delayed judgments LIFO ---
  state.turnPhase = "start";
  emit(game, { type: "phase_changed", playerId: current, phase: "start" });
  const afterTurnStart = (): void => {
    resolveDelayed(game, current, () => {
      if (state.phase !== "playing" || state.currentPlayerId !== current) return;
      // current player may have died to their own Ion Storm → advance turn
      if (!state.players[current]!.alive) {
        beginTurn(game);
        return;
      }
      // --- draw phase ---
      state.turnPhase = "draw";
      emit(game, { type: "phase_changed", playerId: current, phase: "draw" });
      const doPlayPhase = (): void => {
        if (state.phase !== "playing" || state.currentPlayerId !== current) return;
        if (!state.players[current]!.alive) {
          beginTurn(game);
          return;
        }
        state.turnPhase = "play";
        emit(game, { type: "phase_changed", playerId: current, phase: "play" });
        if (game.turnCtx.skipPlay) {
          forceEndTurn(game, current);
        }
      };
      if (game.turnCtx.skipDraw) {
        doPlayPhase();
        return;
      }
      // draw phase: modifyDraw hook lets draw-phase skills (Highwayman, Chem
      // Rage, Ration Share) replace the default 2-card draw when their owner
      // opts in via useSkill; default path draws 2 immediately.
      if (hooks.modifyDraw) {
        hooks.modifyDraw(game, current, doPlayPhase);
      } else {
        drawCards(game, current, 2);
        doPlayPhase();
      }
    });
  };
  if (hooks.turnStart) {
    hooks.turnStart(game, current, afterTurnStart);
  } else {
    afterTurnStart();
  }
}

/** End turn by player intent (with optional chosen discards). */
export function endTurn(game: Game, playerId: string, chosenDiscards?: string[]): void {
  const { state } = game;
  if (state.phase !== "playing") throw new EngineError("E_PHASE", "game not playing");
  if (state.currentPlayerId !== playerId) throw new EngineError("E_NOT_YOUR_TURN", "not your turn");
  if (game.pending.size > 0) throw new EngineError("E_PENDING", "responses still pending");
  if (state.turnPhase !== "play") throw new EngineError("E_PHASE", "not in play phase");
  state.turnPhase = "end";
  emit(game, { type: "phase_changed", playerId, phase: "end" });
  const finish = (): void => {
    if (state.phase !== "playing") return;
    discardDownToHp(game, playerId, chosenDiscards);
    emit(game, { type: "turn_ended", playerId });
    beginTurn(game);
  };
  if (hooks.turnEnd) {
    hooks.turnEnd(game, playerId, finish);
  } else {
    finish();
  }
}

/** Lockdown skip → server-forced end of turn (no intent needed). */
export function forceEndTurn(game: Game, playerId: string): void {
  const { state } = game;
  if (state.phase !== "playing" || state.currentPlayerId !== playerId) return;
  state.turnPhase = "end";
  emit(game, { type: "phase_changed", playerId, phase: "end" });
  const finish = (): void => {
    if (state.phase !== "playing") return;
    discardDownToHp(game, playerId);
    emit(game, { type: "turn_ended", playerId });
    beginTurn(game);
  };
  if (hooks.turnEnd) {
    hooks.turnEnd(game, playerId, finish);
  } else {
    finish();
  }
}

function discardDownToHp(game: Game, playerId: string, chosen?: string[]): void {
  const p = game.state.players[playerId]!;
  const excess = p.hand.length - Math.max(0, p.hp);
  if (excess <= 0) return;
  let toDiscard: string[];
  if (chosen && chosen.length === excess && chosen.every((c) => p.hand.includes(c))) {
    toDiscard = chosen;
  } else {
    toDiscard = game.rng.shuffle(p.hand).slice(0, excess); // timeout → random
  }
  discardFromHand(game, playerId, toDiscard, "end_turn_down_to_hp");
}

// ---------------------------------------------------------------------------
// Fate Checks (manual §3 "ตัดสิน") + Signal Jam window
// ---------------------------------------------------------------------------

export interface FateResult {
  cardId: string;
  suit: Suit;
  number: number;
}

/** Flip the top deck card as the Fate Card; card goes to discard after.
 *  Continuation-based: the modifyFate hook (Vex Fate Hack) may prompt a player
 *  to substitute a hand card BEFORE `apply` runs with the effective result.
 *  apply is called exactly once. */
export function flipFate(
  game: Game,
  ctx: { forCardId?: string; forPlayerId?: string; outcome: string },
  apply: (result: FateResult) => void,
): void {
  const { state } = game;
  if (state.deck.length === 0) {
    if (state.discard.length === 0) throw new EngineError("E_NO_CARDS", "no cards left for fate");
    state.deck = game.rng.shuffle(state.discard.splice(0, state.discard.length));
    emit(game, { type: "reshuffle" });
  }
  const cardId = state.deck.pop()!;
  const inst = game.cards.get(cardId)!;
  state.discard.push(cardId);

  const finish = (suit: Suit, number: number): void => {
    emit(game, {
      type: "fate_check",
      forCardId: ctx.forCardId,
      forPlayerId: ctx.forPlayerId,
      cardId,
      suit,
      number,
      outcome: ctx.outcome,
    });
    apply({ cardId, suit, number });
  };

  if (hooks.modifyFate) {
    hooks.modifyFate(
      game,
      { cardId, suit: inst.suit, number: inst.number, forPlayerId: ctx.forPlayerId, outcome: ctx.outcome },
      (final) => finish(final.suit, final.number),
    );
  } else {
    finish(inst.suit, inst.number);
  }
}

export interface JamWindowOptions {
  /** what is being jammed, for UI context */
  description: { defId?: string; sourceId?: string; targetIds?: string[] };
  /** effect applies (nobody jammed, or jams cancelled out) */
  onApply: () => void;
  /** effect nullified (odd number of jams) */
  onCancel: () => void;
}

/**
 * Signal Jam window (manual: Nullification chain). Every alive player, in turn
 * order starting at the current player, gets one chance to jam; each jam flips
 * the active flag and the pass continues (so jams can be jammed back).
 */
export function jamWindow(game: Game, opts: JamWindowOptions): void {
  const { state } = game;
  const order = [...state.turnOrder];
  const startIdx = Math.max(0, order.indexOf(state.currentPlayerId ?? order[0]!));
  const candidates = [...order.slice(startIdx), ...order.slice(0, startIdx)].filter(
    (id) => state.players[id]!.alive,
  );

  const step = (idx: number, active: boolean): void => {
    if (gameEnded(game)) return;
    if (idx >= candidates.length) {
      if (active) opts.onApply();
      else opts.onCancel();
      return;
    }
    const pid = candidates[idx]!;
    const canJam = handDefIds(game, pid).includes("signal_jam");
    if (!canJam) {
      step(idx + 1, active); // no jam card → no prompt (avoid needless spam)
      return;
    }
    ask(game, {
      playerId: pid,
      kind: "jam",
      context: { active, ...opts.description },
      validate: (action) => {
        if (action.kind === "decline") return null;
        if (action.kind !== "discard") return "E_BAD_ACTION";
        const ok =
          action.cardIds.length === 1 &&
          game.state.players[pid]!.hand.includes(action.cardIds[0]!) &&
          defIdOf(game, action.cardIds[0]!) === "signal_jam";
        return ok ? null : "E_BAD_JAM";
      },
      resume: (action) => {
        if (action?.kind === "discard") {
          discardFromHand(game, pid, action.cardIds, "signal_jam");
          emit(game, { type: "card_played", playerId: pid, cardId: action.cardIds[0]!, defId: "signal_jam" });
          step(idx + 1, !active);
        } else {
          step(idx + 1, active);
        }
      },
    });
  };

  step(0, true);
}

// ---------------------------------------------------------------------------
// Delayed-judgment cards (Ion Storm / Ration Cut / Lockdown)
// ---------------------------------------------------------------------------

/** Resolve a player's delayed cards LIFO at start of their turn.
 *  Only cards held at turn start are judged — an Ion Storm that re-lands on the
 *  same player waits until their NEXT turn. */
function resolveDelayed(game: Game, playerId: string, done: () => void): void {
  // snapshot LIFO: most recently received first
  const queue = [...game.state.players[playerId]!.delayed].reverse();
  let qi = 0;

  const next = (): void => {
    if (gameEnded(game)) return;
    const p = game.state.players[playerId]!;
    if (!p.alive || qi >= queue.length) {
      done();
      return;
    }
    const d = queue[qi++]!;
    // card may have been sabotaged/removed mid-resolution
    if (!p.delayed.some((dd) => dd.cardId === d.cardId)) {
      next();
      return;
    }
    jamWindow(game, {
      description: { defId: d.defId, sourceId: d.placedBy, targetIds: [playerId] },
      onApply: () => resolveOne(d.cardId),
      onCancel: () => {
        // jammed: delayed card goes to discard, no effect
        removeDelayed(game, playerId, d.cardId);
        game.state.discard.push(d.cardId);
        next();
      },
    });

    function resolveOne(cardId: string): void {
      if (gameEnded(game)) return;
      const holder = game.state.players[playerId]!;
      if (!holder.alive) {
        next();
        return;
      }
      removeDelayed(game, playerId, cardId);
      flipFate(game, { forCardId: cardId, forPlayerId: playerId, outcome: d.defId }, (fate) => {
        if (gameEnded(game)) return;
        if (d.defId === "ion_storm") {
          const triggered = fate.suit === "spade" && fate.number >= 2 && fate.number <= 9;
          if (triggered) {
            game.state.discard.push(cardId);
            dealDamage(game, {
              targetId: playerId,
              amount: 3,
              element: "ion",
              sourceCardId: cardId,
              damageKind: "ion_storm",
            });
          } else {
            // passes to next alive player WITHOUT an ion storm already
            // (standard rule: lightning skips players who already have one)
            const order = game.state.turnOrder;
            const idx = order.indexOf(playerId);
            let placed = false;
            for (let i = 1; i <= order.length; i++) {
              const cand = order[(idx + i) % order.length]!;
              const cp = game.state.players[cand]!;
              if (cp.alive && !cp.delayed.some((dd) => dd.defId === "ion_storm")) {
                placeDelayed(game, cand, cardId, "ion_storm", d.placedBy);
                placed = true;
                break;
              }
            }
            if (!placed && game.state.players[playerId]!.alive) {
              // all alive players already carry one → it stays on the current player
              placeDelayed(game, playerId, cardId, "ion_storm", d.placedBy);
            }
          }
          next();
        } else if (d.defId === "ration_cut") {
          game.state.discard.push(cardId);
          if (fate.suit !== "club") game.turnCtx.skipDraw = true;
          next();
        } else if (d.defId === "lockdown") {
          game.state.discard.push(cardId);
          if (fate.suit !== "heart") game.turnCtx.skipPlay = true;
          next();
        } else {
          game.state.discard.push(cardId);
          next();
        }
      });
    }
  };
  next();
}

/** Place a delayed card on a player. Rule: no duplicate defId per player. */
export function placeDelayed(game: Game, targetId: string, cardId: string, defId: "ion_storm" | "ration_cut" | "lockdown", placedBy: string): void {
  const p = game.state.players[targetId]!;
  if (p.delayed.some((d) => d.defId === defId)) {
    throw new EngineError("E_DUP_DELAYED", "player already has that delayed card");
  }
  p.delayed.push({ cardId, defId, placedBy, receivedAt: game.state.seq });
  emit(game, { type: "delayed_placed", targetId, cardId, defId, placedBy });
}

function removeDelayed(game: Game, playerId: string, cardId: string): void {
  const p = game.state.players[playerId]!;
  const idx = p.delayed.findIndex((d) => d.cardId === cardId);
  if (idx >= 0) p.delayed.splice(idx, 1);
}

// ---------------------------------------------------------------------------
// Damage → dying → death → game end (doc 01 §5)
// ---------------------------------------------------------------------------

export type DamageKind = "strike" | "mortar" | "horde" | "standoff" | "ion_storm" | "skill" | "direct";

export interface DamageRequest {
  targetId: string;
  amount: number;
  element?: "none" | "burn" | "ion";
  sourcePlayerId?: string;
  sourceCardId?: string;
  /** what kind of damage — armor (M3) reacts to this */
  damageKind?: DamageKind;
}

export function dealDamage(game: Game, req: DamageRequest & { noRedirect?: boolean }): void {
  const { state } = game;
  const target = state.players[req.targetId];
  if (!target || !target.alive) return;

  // pre-damage hook (Nyx Misdirect redirect etc.) — skills call proceed()
  if (hooks.preDamage && !req.noRedirect) {
    hooks.preDamage(game, req, (final) => applyDamage(game, final));
    return;
  }
  applyDamage(game, req);
}

function applyDamage(game: Game, req: DamageRequest & { noRedirect?: boolean }): void {
  const { state } = game;
  const target = state.players[req.targetId];
  if (!target || !target.alive) return;

  const kind: DamageKind = req.damageKind ?? "direct";
  const armorId = target.equipment.armor;
  const armorDef = armorId ? CARD_DEFS[game.cards.get(armorId)!.defId] : undefined;
  // Plasma Cutter: attacker's weapon ignores target armor
  const ignoresArmor =
    !!req.sourcePlayerId &&
    state.players[req.sourcePlayerId]!.equipment.weapon != null &&
    game.cards.get(state.players[req.sourcePlayerId]!.equipment.weapon!)!.defId ===
      "plasma_cutter";

  let amount = req.amount;

  if (armorDef && !ignoresArmor) {
    if (armorDef.defId === "kevlar_mesh") {
      // blocks normal Strike / Mortar Rain / Mutant Horde entirely;
      // Burn-element sources deal +1 (fire weakness)
      if (kind === "strike" || kind === "mortar" || kind === "horde") {
        if (req.element === "burn") {
          amount += 1; // passes through with +1
        } else {
          emit(game, {
            type: "damage_blocked",
            targetId: req.targetId,
            amount: req.amount,
            by: "kevlar_mesh",
          });
          return; // fully blocked
        }
      } else if (req.element === "burn") {
        amount += 1;
      }
    }
  }

  target.hp -= amount;
  emit(game, {
    type: "damage",
    targetId: req.targetId,
    amount,
    element: req.element ?? "none",
    sourcePlayerId: req.sourcePlayerId,
    sourceCardId: req.sourceCardId,
  });

  const firePost = (): void => {
    // post-damage skill hooks only for a still-alive receiver (dying/dead skip —
    // documented simplification vs physical game; verified in SIT A10)
    if (state.players[req.targetId]!.alive) {
      hooks.postDamageTaken?.({
        game,
        playerId: req.targetId,
        sourcePlayerId: req.sourcePlayerId,
        sourceCardId: req.sourceCardId,
        amount,
        element: req.element ?? "none",
        damageKind: kind,
      });
    }
  };

  if (target.hp <= 0) {
    // dying/save window settles FIRST, then post-damage triggers
    enterDying(game, req.targetId, req.sourcePlayerId, firePost);
  } else {
    firePost();
  }
}

/** Dying state: self-save first (Stim or Chem Brew), then others offer Stims
 *  in turn order. Prompt-driven; killPlayer runs when nobody saves.
 *  `after` runs once the dying window settles (saved or dead). */
export function enterDying(game: Game, playerId: string, killerId?: string, after?: () => void): void {
  const { state } = game;
  const dying = state.players[playerId]!;
  if (!dying.alive) {
    after?.();
    return;
  }
  emit(game, { type: "dying", playerId });

  const order = [playerId, ...turnOrderFrom(game, playerId).filter((id) => id !== playerId)];
  let idx = 0;

  const step = (): void => {
    if (gameEnded(game)) {
      after?.();
      return;
    }
    if (dying.hp > 0) {
      emit(game, { type: "saved", playerId });
      after?.();
      return;
    }
    while (idx < order.length && !state.players[order[idx]!]!.alive) idx++;
    if (idx >= order.length) {
      killPlayer(game, playerId, killerId);
      after?.();
      return;
    }
    const responderId = order[idx]!;
    idx++;
    const isSelf = responderId === playerId;
    const responder = state.players[responderId]!;
    const saveCards = responder.hand.filter((c) => {
      const inst = game.cards.get(c);
      return inst ? canSaveWith(responder.survivorId, inst, isSelf) : false;
    });
    if (saveCards.length === 0) {
      step(); // nothing to save with → no prompt
      return;
    }
    ask(game, {
      playerId: responderId,
      kind: "use_stim",
      context: { dyingId: playerId, self: isSelf },
      validate: (action) => {
        if (action.kind === "decline") return null;
        if (action.kind !== "discard" || action.cardIds.length !== 1) return "E_BAD_ACTION";
        const cid = action.cardIds[0]!;
        if (!responder.hand.includes(cid)) return "E_NOT_IN_HAND";
        const inst = game.cards.get(cid);
        return inst && canSaveWith(responder.survivorId, inst, isSelf) ? null : "E_NOT_SAVE_CARD";
      },
      resume: (action) => {
        if (action?.kind === "discard") {
          const cid = action.cardIds[0]!;
          discardFromHand(game, responderId, [cid], "save_dying");
          dying.hp = 1;
          emit(game, { type: "heal", targetId: playerId, amount: 1, sourcePlayerId: responderId, sourceCardId: cid });
          step(); // hp > 0 → saved branch exits
        } else {
          step();
        }
      },
    });
  };

  step();
}

/** Keep M1 API: forced death without save window (tests/sim). */
export function resolveDying(game: Game, playerId: string, killerId?: string): void {
  emit(game, { type: "dying", playerId });
  killPlayer(game, playerId, killerId);
}

export function saveDying(game: Game, playerId: string): void {
  const p = game.state.players[playerId]!;
  p.hp = Math.max(p.hp, 1);
  emit(game, { type: "saved", playerId });
}

export function killPlayer(game: Game, playerId: string, killerId?: string): void {
  const { state } = game;
  const p = state.players[playerId]!;
  if (!p.alive) return;

  cancelPromptsFor(game, playerId);
  p.alive = false;
  p.hp = 0;
  p.roleRevealed = true;

  for (const cardId of p.hand.splice(0)) state.discard.push(cardId);
  for (const slot of ["weapon", "armor", "rig_plus", "rig_minus"] as const) {
    const cardId = p.equipment[slot];
    if (cardId) {
      state.discard.push(cardId);
      delete p.equipment[slot];
    }
  }
  for (const d of p.delayed.splice(0)) state.discard.push(d.cardId);
  p.tethered = false;
  emit(game, { type: "death", playerId, role: p.role, killerId });

  if (killerId && state.players[killerId]?.alive) {
    const killer = state.players[killerId]!;
    if (p.role === "raider") {
      drawCards(game, killerId, 3);
      emit(game, { type: "kill_reward", killerId, cardsDrawn: 3 });
    }
    if (killer.role === "sovereign" && p.role === "warden") {
      for (const cardId of killer.hand.splice(0)) state.discard.push(cardId);
      for (const slot of ["weapon", "armor", "rig_plus", "rig_minus"] as const) {
        const cardId = killer.equipment[slot];
        if (cardId) {
          state.discard.push(cardId);
          delete killer.equipment[slot];
        }
      }
      emit(game, { type: "sovereign_penalty", playerId: killerId });
    }
  }

  checkGameEnd(game);

  // If the CURRENT turn holder just died mid-turn, their cancelled prompts may
  // have orphaned the turn-flow continuation (e.g. draw_skill_choice). Heal it.
  recoverStalledTurn(game);
}

export function checkGameEnd(game: Game): { faction: Role; reason: string } | null {
  const { state } = game;
  if (state.phase === "ended") return state.winner ?? null;

  const alive = Object.values(state.players).filter((p) => p.alive);
  const sovereign = Object.values(state.players).find((p) => p.role === "sovereign")!;

  let winner: { faction: Role; reason: string } | null = null;
  if (!sovereign.alive) {
    winner =
      alive.length === 1 && alive[0]!.role === "phantom"
        ? { faction: "phantom", reason: "phantom_last_standing_sovereign_dead" }
        : { faction: "raider", reason: "sovereign_dead" };
  } else {
    const raidersAlive = alive.some((p) => p.role === "raider");
    const phantomsAlive = alive.some((p) => p.role === "phantom");
    if (!raidersAlive && !phantomsAlive) {
      winner = { faction: "sovereign", reason: "all_raiders_and_phantoms_dead" };
    } else if (alive.length === 1 && alive[0]!.role === "phantom") {
      winner = { faction: "phantom", reason: "phantom_last_standing" };
    }
  }

  if (winner) {
    state.phase = "ended";
    state.winner = winner;
    emit(game, { type: "game_ended", winner: winner.faction, reason: winner.reason });
  }
  return winner;
}

export function gameEnded(game: Game): boolean {
  return game.state.phase === "ended";
}

/** Alive player ids in turn order starting at (and including) fromId. */
export function turnOrderFrom(game: Game, fromId: string): string[] {
  const order = game.state.turnOrder;
  const idx = Math.max(0, order.indexOf(fromId));
  return [...order.slice(idx), ...order.slice(0, idx)].filter(
    (id) => game.state.players[id]!.alive,
  );
}

/** Next alive player after fromId (Ion Storm transfer etc.). */
export function nextAlive(game: Game, fromId: string): string | undefined {
  const order = game.state.turnOrder;
  const idx = order.indexOf(fromId);
  for (let i = 1; i <= order.length; i++) {
    const cand = order[(idx + i) % order.length]!;
    if (game.state.players[cand]!.alive) return cand;
  }
  return undefined;
}
