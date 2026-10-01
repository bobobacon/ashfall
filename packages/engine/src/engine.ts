// Core engine — deterministic, pure (no I/O). All rules server-side (doc 01).
//
// Design:
//  - GameState is a plain serializable object (the single source of truth).
//  - A side table `CardIndex` maps card instance id → CardInstance (deck layout is
//    fixed, so this is created once per game and never mutated).
//  - Every mutation appends to EventLog; the server drains it for broadcasts.
//  - Intents are applied via applyIntent() which validates + mutates or throws EngineError.

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
  type Role,
} from "@ashfall/shared";
import { EventLog, type GameEvent } from "./events.js";
import { Rng } from "./rng.js";
import { buildDeck } from "./deck.js";
import { attackRange, distance, inAttackRange } from "./distance.js";

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

export interface Game {
  state: GameState;
  cards: Map<string, CardInstance>;
  log: EventLog;
  rng: Rng;
  /** draft offers per player (secret until revealed) */
  draftOffers: Map<string, string[]>;
  /** survivor ids already claimed during the draft */
  pickedSurvivors: Set<string>;
}

const ALL_ROLES: Role[] = ["sovereign", "warden", "raider", "phantom"];

export function createGame(opts: CreateGameOptions): Game {
  const n = opts.players.length;
  if (n < 3 || n > 10) throw new EngineError("E_PLAYER_COUNT", "need 3-10 players");
  const dist = ROLE_DISTRIBUTION[n]!;

  const rng = new Rng(opts.seed);
  const deckCards = buildDeck();
  const cards = new Map(deckCards.map((c) => [c.id, c]));

  // role bag
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

  // Sovereign is public from setup (manual §1)
  const sovereign = Object.values(players).find((p) => p.role === "sovereign")!;
  sovereign.roleRevealed = true;

  const state: GameState = {
    roomId: opts.roomId,
    seed: opts.seed,
    phase: "role_deal",
    turnOrder,
    turnNumber: 0,
    // deck: shuffled instance ids, top = last element
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

  const game: Game = { state, cards, log, rng, draftOffers: new Map(), pickedSurvivors: new Set() };

  // Draft offers (doc 01 §2.3): Sovereign gets 3 random + the 3 faction leaders
  // (leaders are reserved — never offered to anyone else). Others get 3 random.
  // Offers are unique across players while the pool lasts; when it runs dry
  // (10 players × 3 > pool), it refills with not-yet-offered-or-picked survivors
  // and, if still short, re-offers previously offered (unpicked) survivors.
  // Pick conflicts on reveal are resolved by auto-redeal (see autoPick).
  const reservedLeaders = new Set(LEADER_IDS);
  const available = rng.shuffle(STANDARD_SURVIVOR_IDS.filter((id) => !reservedLeaders.has(id)));
  const offered = new Set<string>(); // ever offered to a non-sovereign player

  const deal3 = (): string[] => {
    const out: string[] = [];
    while (out.length < 3) {
      // refill: unpicked, not-currently-offered survivors
      if (available.length === 0) {
        const refill = STANDARD_SURVIVOR_IDS.filter(
          (id) => !reservedLeaders.has(id) && !game.pickedSurvivors.has(id) && !offered.has(id),
        );
        if (refill.length === 0) {
          // everyone has been offered at least once: reuse unpicked, unoffered-in-this-round
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
      const random3 = deal3();
      const offer = [...random3, ...LEADER_IDS];
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

/** Apply a draft pick. Validated: must be offered AND not already taken. */
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
  game.log.push({ type: "draft_picked", playerId, survivorId });

  // When all picked → simultaneous reveal + opening hands + start
  const allPicked = Object.values(state.players).every((pl) => pl.survivorId !== undefined);
  if (allPicked) startGame(game);
}

/** Timeout/conflict fallback: pick a random still-available survivor from the offer;
 *  if the whole offer was taken by earlier picks, redeal a fresh offer and pick. */
export function autoPick(game: Game, playerId: string): void {
  if (game.state.players[playerId]?.survivorId) return; // already picked
  let offer = game.draftOffers.get(playerId);
  if (!offer || offer.length === 0) return; // E_DRAFT_DONE state (shouldn't happen pre-start)

  let candidates = offer.filter((id) => !game.pickedSurvivors.has(id));
  if (candidates.length === 0) {
    // full conflict: redeal 3 unpicked survivors (sovereign keeps leaders if free)
    const pool = game.rng.shuffle(
      STANDARD_SURVIVOR_IDS.filter((id) => !game.pickedSurvivors.has(id)),
    );
    const sovereign = game.state.players[playerId]!.role === "sovereign";
    if (sovereign) {
      const freeLeaders = LEADER_IDS.filter((id) => !game.pickedSurvivors.has(id));
      const others = pool.filter((id) => !freeLeaders.includes(id)).slice(0, 3);
      candidates = [...others, ...freeLeaders];
    } else {
      candidates = pool.slice(0, 3);
    }
    game.draftOffers.set(playerId, candidates);
    game.log.push({ type: "draft_offered", playerId, survivorIds: candidates });
  }
  pickSurvivor(game, playerId, game.rng.pick(candidates));
}

function startGame(game: Game): void {
  const { state } = game;
  state.phase = "draft";
  game.log.push({ type: "draft_revealed" });

  // Opening hands: 4 each (manual §2.4)
  for (const p of Object.values(state.players)) {
    drawCards(game, p.id, 4);
  }

  state.phase = "playing";
  // Turn order starts at the Sovereign, clockwise (manual §2)
  const sovereignIdx = state.turnOrder.findIndex(
    (id) => state.players[id]!.role === "sovereign",
  );
  state.turnOrder = [...state.turnOrder.slice(sovereignIdx), ...state.turnOrder.slice(0, sovereignIdx)];
  game.log.push({ type: "game_started", turnOrder: [...state.turnOrder] });

  beginTurn(game);
}

/** Draw `count` cards for a player; reshuffles discard when the deck runs out. */
export function drawCards(game: Game, playerId: string, count: number): void {
  const { state } = game;
  const p = state.players[playerId]!;
  let drawn = 0;
  for (let i = 0; i < count; i++) {
    if (state.deck.length === 0) {
      if (state.discard.length === 0) break; // no cards left at all
      state.deck = game.rng.shuffle(state.discard.splice(0, state.discard.length));
      game.log.push({ type: "reshuffle" });
    }
    const cardId = state.deck.pop()!;
    p.hand.push(cardId);
    drawn++;
  }
  if (drawn > 0) game.log.push({ type: "cards_drawn", playerId, count: drawn });
}

function beginTurn(game: Game): void {
  const { state } = game;
  // advance past flipped (skipped) players — Bunker Down / Void Tithe
  let guard = 0;
  let current = state.currentPlayerId
    ? state.turnOrder[(state.turnOrder.indexOf(state.currentPlayerId) + 1) % state.turnOrder.length]!
    : state.turnOrder[0]!;
  // first turn: start at turnOrder[0] (Sovereign)
  if (state.turnNumber === 0) current = state.turnOrder[0]!;

  while (guard++ <= state.turnOrder.length) {
    const p = state.players[current]!;
    if (p.alive && !p.flipped) break;
    if (p.alive && p.flipped) {
      p.flipped = false; // consume the skip
      game.log.push({ type: "phase_changed", playerId: current, phase: undefined });
    }
    current = state.turnOrder[(state.turnOrder.indexOf(current) + 1) % state.turnOrder.length]!;
  }

  const p = state.players[current]!;
  state.currentPlayerId = current;
  state.turnNumber++;
  p.strikeCountThisTurn = 0;
  p.buffs = { chemBrewNext: false, barehideMode: false };
  game.log.push({ type: "turn_started", playerId: current, turnNumber: state.turnNumber });

  // Start phase: delayed judgments resolve here (M2). Then draw phase.
  state.turnPhase = "start";
  game.log.push({ type: "phase_changed", playerId: current, phase: "start" });
  state.turnPhase = "draw";
  game.log.push({ type: "phase_changed", playerId: current, phase: "draw" });
  drawCards(game, current, 2);
  state.turnPhase = "play";
  game.log.push({ type: "phase_changed", playerId: current, phase: "play" });
}

/** End the current turn: discard down to HP, then pass to next alive player. */
export function endTurn(game: Game, playerId: string, chosenDiscards?: string[]): void {
  const { state } = game;
  if (state.phase !== "playing") throw new EngineError("E_PHASE", "game not playing");
  if (state.currentPlayerId !== playerId) {
    throw new EngineError("E_NOT_YOUR_TURN", "not your turn");
  }
  const p = state.players[playerId]!;

  // Discard down to current HP (manual §3.4)
  const excess = p.hand.length - Math.max(0, p.hp);
  if (excess > 0) {
    let toDiscard: string[];
    if (chosenDiscards && chosenDiscards.length === excess && chosenDiscards.every((c) => p.hand.includes(c))) {
      toDiscard = chosenDiscards;
    } else {
      // timeout / invalid → random legal choice
      toDiscard = game.rng.shuffle(p.hand).slice(0, excess);
    }
    for (const cardId of toDiscard) {
      p.hand.splice(p.hand.indexOf(cardId), 1);
      state.discard.push(cardId);
    }
    game.log.push({ type: "cards_discarded", playerId, cardIds: toDiscard, reason: "end_turn_down_to_hp" });
  }

  game.log.push({ type: "turn_ended", playerId });
  state.turnPhase = "end";
  beginTurn(game);
}

// ---------------------------------------------------------------------------
// Damage / dying / death / win detection (doc 01 §5)
// ---------------------------------------------------------------------------

export interface DamageRequest {
  targetId: string;
  amount: number;
  element?: "none" | "burn" | "ion";
  sourcePlayerId?: string;
  sourceCardId?: string;
}

/** Apply damage → dying → death → game-end pipeline (simplified M1 core; M2/M3 hook armor/evade). */
export function dealDamage(game: Game, req: DamageRequest): void {
  const { state } = game;
  const target = state.players[req.targetId];
  if (!target || !target.alive) return;

  target.hp -= req.amount;
  game.log.push({
    type: "damage",
    targetId: req.targetId,
    amount: req.amount,
    element: req.element ?? "none",
    sourcePlayerId: req.sourcePlayerId,
    sourceCardId: req.sourceCardId,
  });

  if (target.hp <= 0) resolveDying(game, req.targetId, req.sourcePlayerId);
}

/** Dying state: player may self-save with Stim/Chem Brew (prompt-driven in M2);
 *  M1 core: if no save happens, death resolves. */
export function resolveDying(game: Game, playerId: string, killerId?: string): void {
  const { state } = game;
  const p = state.players[playerId]!;
  game.log.push({ type: "dying", playerId });
  // M1: no save pipeline yet → immediate death. M2 adds Stim/Chem Brew prompts.
  killPlayer(game, playerId, killerId);
}

/** Save a dying player by raising HP to ≥ 1 (called after a Stim/Chem Brew in M2). */
export function saveDying(game: Game, playerId: string): void {
  const p = game.state.players[playerId]!;
  p.hp = Math.max(p.hp, 1);
  game.log.push({ type: "saved", playerId });
}

export function killPlayer(game: Game, playerId: string, killerId?: string): void {
  const { state } = game;
  const p = state.players[playerId]!;
  if (!p.alive) return;

  p.alive = false;
  p.hp = 0;
  p.roleRevealed = true;

  // all cards to discard (hand, equipment, delayed)
  for (const cardId of p.hand.splice(0)) state.discard.push(cardId);
  for (const slot of ["weapon", "armor", "rig_plus", "rig_minus"] as const) {
    const cardId = p.equipment[slot];
    if (cardId) {
      state.discard.push(cardId);
      delete p.equipment[slot];
    }
  }
  p.delayed = [];
  game.log.push({ type: "death", playerId, role: p.role, killerId });

  // Kill rewards & penalties (manual §5)
  if (killerId && state.players[killerId]?.alive) {
    const victim = p;
    const killer = state.players[killerId]!;
    if (victim.role === "raider") {
      drawCards(game, killerId, 3);
      game.log.push({ type: "kill_reward", killerId, cardsDrawn: 3 });
    }
    if (killer.role === "sovereign" && victim.role === "warden") {
      // Sovereign discards EVERYTHING (hand + equipment)
      for (const cardId of killer.hand.splice(0)) state.discard.push(cardId);
      for (const slot of ["weapon", "armor", "rig_plus", "rig_minus"] as const) {
        const cardId = killer.equipment[slot];
        if (cardId) {
          state.discard.push(cardId);
          delete killer.equipment[slot];
        }
      }
      game.log.push({ type: "sovereign_penalty", playerId: killerId });
    }
  }

  checkGameEnd(game);
}

/** Win detection (doc 01 §1.3). Returns winner info if the game ended. */
export function checkGameEnd(game: Game): { faction: Role; reason: string } | null {
  const { state } = game;
  if (state.phase === "ended") return state.winner ?? null;

  const alive = Object.values(state.players).filter((p) => p.alive);
  const sovereign = Object.values(state.players).find((p) => p.role === "sovereign")!;

  let winner: { faction: Role; reason: string } | null = null;

  if (!sovereign.alive) {
    if (alive.length === 1 && alive[0]!.role === "phantom") {
      winner = { faction: "phantom", reason: "phantom_last_standing_sovereign_dead" };
    } else {
      winner = { faction: "raider", reason: "sovereign_dead" };
    }
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
    game.log.push({ type: "game_ended", winner: winner.faction, reason: winner.reason });
  }
  return winner;
}

/** Card lookup helper used by intents. */
export function cardOf(game: Game, cardId: string): CardInstance | undefined {
  return game.cards.get(cardId);
}

export function defOf(game: Game, cardId: string) {
  const inst = game.cards.get(cardId);
  return inst ? CARD_DEFS[inst.defId] : undefined;
}

export { type GameEvent };
