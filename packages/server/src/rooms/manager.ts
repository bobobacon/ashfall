// RoomManager — in-memory rooms, lobby lifecycle, bot seats, prompt timers,
// reconnect tokens, fan-out views. The server layer (ws.ts) drives intents here.
import { randomBytes, randomUUID } from "node:crypto";
import {
  autoPick,
  createGame,
  endTurn,
  playCard,
  pickSurvivor,
  respond,
  useSkill,
  launcherStrike,
  viewFor,
  viewForSpectator,
  type Game,
  type PlayerView,
  type GameEvent,
  type ActiveSkillId,
} from "@ashfall/engine";
import { botChooseDiscards, botChoosePlayAction, botRespond } from "@ashfall/bots";
import { ROOM_CODE_ALPHABET, type ClientIntentT } from "@ashfall/shared";

export interface RoomPlayer {
  id: string;
  name: string;
  seat: number;
  isBot: boolean;
  connected: boolean;
  connId?: string; // ws connection id (humans only)
  reconnectToken?: string;
  /** human dropped; a bot now plays the seat until reconnect */
  botTakenOver?: boolean;
  cheatStrikes: number;
}

export type RoomPhase = "lobby" | "draft" | "playing" | "ended";

export interface RoomSettings {
  turnTimerMs: number;
  allowSpectators: boolean;
  allowBots: boolean;
  expansions: { tether: boolean; ascendants: boolean };
}

export interface Room {
  id: string;
  phase: RoomPhase;
  hostId?: string;
  players: RoomPlayer[];
  spectators: Map<string, { connId: string; name: string }>;
  connToPlayer: Map<string, string>;
  game?: Game;
  settings: RoomSettings;
  createdAt: number;
  timers: Map<string, NodeJS.Timeout>;
  /** fan-out callback registered by the server transport */
  emit?: (target: string, msg: unknown) => void;
}

/** Coded error with a stable code for the wire protocol. */
export class RoomError extends Error {
  constructor(public code: string, message: string) {
    super(message);
  }
}

const BOT_NAMES = ["Rustjaw", "Cinder", "Mox", "Vulture", "Pike", "Hex", "Dreg", "Sable", "Torch"];

/** Un-narrowed phase read (engine mutations are invisible to TS control flow). */
function phaseOf(game: Game): string {
  return game.state.phase;
}

/** Bot "thinking" delay so humans can follow the action. */
const BOT_THINK_MS = 700;
/** Grace period before a disconnected human's seat is bot-taken-over. */
const TAKEOVER_GRACE_MS = 90_000;
/** Draft pick timeout. */
const DRAFT_TIMEOUT_MS = 30_000;

export class RoomManager {
  private rooms = new Map<string, Room>();

  // ---------------------------------------------------------------- lifecycle

  createRoom(hostConnId: string, hostName: string): { room: Room; player: RoomPlayer } {
    const id = this.genRoomCode();
    const player: RoomPlayer = {
      id: randomUUID(),
      name: hostName,
      seat: 0,
      isBot: false,
      connected: true,
      connId: hostConnId,
      reconnectToken: randomBytes(16).toString("hex"),
      cheatStrikes: 0,
    };
    const room: Room = {
      id,
      phase: "lobby",
      hostId: player.id,
      players: [player],
      spectators: new Map(),
      connToPlayer: new Map([[hostConnId, player.id]]),
      settings: {
        turnTimerMs: 30_000,
        allowSpectators: true,
        allowBots: true,
        expansions: { tether: false, ascendants: false },
      },
      createdAt: Date.now(),
      timers: new Map(),
    };
    this.rooms.set(id, room);
    return { room, player };
  }

  private genRoomCode(): string {
    for (let attempt = 0; attempt < 100; attempt++) {
      const bytes = randomBytes(6);
      let code = "";
      for (let i = 0; i < 6; i++) code += ROOM_CODE_ALPHABET[bytes[i]! % ROOM_CODE_ALPHABET.length];
      if (!this.rooms.has(code)) return code;
    }
    throw new RoomError("E_ROOM_CODES", "room code space exhausted");
  }

  getRoom(roomId: string): Room | undefined {
    return this.rooms.get(roomId);
  }

  roomCount(): number {
    return this.rooms.size;
  }

  listOpenRooms(): { id: string; players: number; phase: RoomPhase }[] {
    return [...this.rooms.values()]
      .filter((r) => r.phase === "lobby")
      .map((r) => ({ id: r.id, players: r.players.length, phase: r.phase }));
  }

  joinRoom(room: Room, connId: string, name: string): RoomPlayer {
    if (room.phase !== "lobby") throw new RoomError("E_STARTED", "game already started");
    if (room.players.length >= 10) throw new RoomError("E_FULL", "room full");
    const player: RoomPlayer = {
      id: randomUUID(),
      name,
      seat: this.nextSeat(room),
      isBot: false,
      connected: true,
      connId,
      reconnectToken: randomBytes(16).toString("hex"),
      cheatStrikes: 0,
    };
    room.players.push(player);
    room.connToPlayer.set(connId, player.id);
    return player;
  }

  addSpectator(room: Room, connId: string, name: string): void {
    if (!room.settings.allowSpectators) throw new RoomError("E_NO_SPECTATORS", "spectators disabled");
    room.spectators.set(connId, { connId, name });
  }

  reconnect(room: Room, connId: string, token: string): RoomPlayer | undefined {
    const player = room.players.find((p) => !p.isBot && p.reconnectToken === token);
    if (!player) return undefined;
    if (player.connId) room.connToPlayer.delete(player.connId);
    player.connId = connId;
    player.connected = true;
    player.botTakenOver = false;
    room.connToPlayer.set(connId, player.id);
    // sync the ENGINE player's connected flag so views render it correctly
    if (room.game?.state.players[player.id]) {
      room.game.state.players[player.id]!.connected = true;
    }
    const key = `takeover:${player.id}`;
    const t = room.timers.get(key);
    if (t) {
      clearTimeout(t);
      room.timers.delete(key);
    }
    return player;
  }

  addBot(room: Room): RoomPlayer {
    if (room.phase !== "lobby") throw new RoomError("E_STARTED", "game started");
    if (!room.settings.allowBots) throw new RoomError("E_NO_BOTS", "bots disabled");
    if (room.players.length >= 10) throw new RoomError("E_FULL", "room full");
    const used = new Set(room.players.map((p) => p.name));
    const name = BOT_NAMES.find((n) => !used.has(n)) ?? `Bot-${room.players.length}`;
    const bot: RoomPlayer = {
      id: randomUUID(),
      name,
      seat: this.nextSeat(room),
      isBot: true,
      connected: true,
      cheatStrikes: 0,
    };
    room.players.push(bot);
    return bot;
  }

  removeBot(room: Room, seat: number): boolean {
    if (room.phase !== "lobby") return false;
    const idx = room.players.findIndex((p) => p.isBot && p.seat === seat);
    if (idx < 0) return false;
    room.players.splice(idx, 1);
    return true;
  }

  leaveRoom(room: Room, playerId: string): void {
    const idx = room.players.findIndex((p) => p.id === playerId);
    if (idx < 0) return;
    const player = room.players[idx]!;
    if (room.phase === "lobby") {
      if (player.connId) room.connToPlayer.delete(player.connId);
      room.players.splice(idx, 1);
      if (room.hostId === playerId) room.hostId = room.players.find((p) => !p.isBot)?.id;
      if (room.players.length === 0) this.deleteRoom(room.id);
      return;
    }
    // mid-game: mark disconnected, bot takes over after grace.
    // Sync the ENGINE flag too — views render from state.players[].connected.
    if (room.game?.state.players[playerId]) {
      room.game.state.players[playerId]!.connected = false;
    }
    player.connected = false;
    this.scheduleBotTakeover(room, player);
  }

  removeSpectator(room: Room, connId: string): void {
    room.spectators.delete(connId);
  }

  deleteRoom(roomId: string): void {
    const room = this.rooms.get(roomId);
    if (!room) return;
    this.clearAllTimers(room);
    this.rooms.delete(roomId);
  }

  private nextSeat(room: Room): number {
    const taken = new Set(room.players.map((p) => p.seat));
    for (let s = 0; s < 10; s++) if (!taken.has(s)) return s;
    return room.players.length;
  }

  // -------------------------------------------------------------------- start

  startGame(room: Room, byPlayerId: string, seed?: number): void {
    if (room.phase !== "lobby") throw new RoomError("E_STARTED", "already started");
    if (room.players.length < 3) throw new RoomError("E_NEED_PLAYERS", "need 3+ players");
    if (room.hostId !== byPlayerId) throw new RoomError("E_NOT_HOST", "only the host can start");

    const gameSeed = seed ?? ((Date.now() ^ (Math.random() * 0xffffffff)) >>> 0);
    room.game = createGame({
      roomId: room.id,
      seed: gameSeed,
      players: [...room.players]
        .sort((a, b) => a.seat - b.seat)
        .map((p) => ({ id: p.id, name: p.name, isBot: p.isBot })),
      settings: {
        turnTimerMs: room.settings.turnTimerMs,
        expansions: {
          tether: room.settings.expansions.tether,
          ascendants: room.settings.expansions.ascendants,
          awaken: false,
        },
      },
    });
    room.phase = "draft";
    this.armDraftTimers(room);
    this.afterEngineStep(room);
    this.broadcastRoom(room);
  }

  private armDraftTimers(room: Room): void {
    const game = room.game!;
    for (const rp of room.players) {
      if (rp.isBot) continue; // bots pick inside driveDraft
      const key = `draft:${rp.id}`;
      if (room.timers.has(key)) continue;
      const t = setTimeout(() => {
        room.timers.delete(key);
        if (room.phase !== "draft" || !room.game) return;
        if (room.game.state.players[rp.id]?.survivorId) return;
        autoPick(room.game, rp.id); // timeout → random legal pick
        this.afterEngineStep(room);
        this.broadcastRoom(room);
      }, DRAFT_TIMEOUT_MS);
      room.timers.set(key, t);
    }
  }

  draftPick(room: Room, playerId: string, survivorId: string): void {
    if (room.phase !== "draft" || !room.game) throw new RoomError("E_PHASE", "not drafting");
    pickSurvivor(room.game, playerId, survivorId);
    const key = `draft:${playerId}`;
    const t = room.timers.get(key);
    if (t) {
      clearTimeout(t);
      room.timers.delete(key);
    }
    this.afterEngineStep(room);
    this.broadcastRoom(room);
  }

  // ------------------------------------------------------------------ intents

  /** Apply a client intent. Throws RoomError / EngineError on rejection. */
  applyIntent(room: Room, playerId: string, intent: ClientIntentT): void {
    const game = room.game;
    if (!game) throw new RoomError("E_NO_GAME", "no game in room");
    const rp = room.players.find((p) => p.id === playerId);
    if (!rp) throw new RoomError("E_NOT_IN_ROOM", "not in room");
    if (rp.isBot || rp.botTakenOver) throw new RoomError("E_BOT_SEAT", "seat is bot-controlled");

    switch (intent.type) {
      case "draft:pick":
        this.draftPick(room, playerId, intent.survivorId);
        return; // draftPick broadcasts
      case "game:play":
        playCard(game, {
          playerId,
          cardId: intent.cardId,
          targets: intent.targets,
          asDefId: intent.asDefId,
        });
        break;
      case "game:skill":
        useSkill(game, {
          playerId,
          skillId: intent.skillId as ActiveSkillId,
          targets: intent.targets,
          cardIds: intent.cardIds,
          payload: intent.payload,
        });
        break;
      case "game:launcher":
        launcherStrike(game, playerId, intent.targetId);
        break;
      case "game:respond":
        respond(game, playerId, intent.promptId, intent.action);
        break;
      case "game:endTurn":
        endTurn(game, playerId, intent.discards);
        break;
      default:
        throw new RoomError("E_BAD_INTENT", "intent not allowed in game");
    }
    this.afterEngineStep(room);
    this.broadcastRoom(room);
  }

  /** Record an illegal intent (cheat tracking). Returns true if the player was kicked. */
  recordCheat(room: Room, playerId: string): boolean {
    const rp = room.players.find((p) => p.id === playerId);
    if (!rp) return false;
    rp.cheatStrikes++;
    return rp.cheatStrikes >= 3;
  }

  // ------------------------------------------------- engine step orchestration

  /** After ANY engine mutation: flush events, sync timers, drive bots. */
  afterEngineStep(room: Room): void {
    const game = room.game;
    if (!game) return;

    const events = game.log.drain();
    if (events.length > 0) this.broadcastEvents(room, events);

    if (game.state.phase === "ended") {
      room.phase = "ended";
      this.clearAllTimers(room);
      this.broadcastEnded(room);
      return;
    }
    if (game.state.phase === "playing" && room.phase !== "playing") {
      room.phase = "playing";
      for (const [key, t] of [...room.timers]) {
        if (key.startsWith("draft:")) {
          clearTimeout(t);
          room.timers.delete(key);
        }
      }
    }

    this.syncPromptTimers(room);
    this.driveBots(room);
  }

  private syncPromptTimers(room: Room): void {
    const game = room.game!;

    // prompt timers
    const wanted = new Set(game.state.pendingPrompts.map((pr) => `prompt:${pr.id}`));
    for (const [key, t] of [...room.timers]) {
      if (key.startsWith("prompt:") && !wanted.has(key)) {
        clearTimeout(t);
        room.timers.delete(key);
      }
    }
    for (const pr of game.state.pendingPrompts) {
      const key = `prompt:${pr.id}`;
      if (room.timers.has(key)) continue;
      pr.deadlineMs = Date.now() + room.settings.turnTimerMs;
      const promptId = pr.id;
      const playerId = pr.playerId;
      const t = setTimeout(() => {
        room.timers.delete(key);
        const g = room.game;
        if (!g || !g.pending.has(promptId)) return;
        try {
          respond(g, playerId, promptId, null); // timeout → auto-decline/random
          this.afterEngineStep(room);
          this.broadcastRoom(room);
        } catch {
          /* resolved concurrently */
        }
      }, room.settings.turnTimerMs);
      room.timers.set(key, t);
    }

    // play-phase turn timer (humans only; play phase gets 2× budget)
    const cur = game.state.currentPlayerId;
    const turnKey = `turn:${game.state.turnNumber}`;
    const needsTurnTimer =
      !!cur &&
      game.state.pendingPrompts.length === 0 &&
      game.state.turnPhase === "play" &&
      !this.isBotSeat(room, cur);
    if (needsTurnTimer && !room.timers.has(turnKey)) {
      const t = setTimeout(() => {
        room.timers.delete(turnKey);
        const g = room.game;
        if (!g || g.state.phase !== "playing") return;
        if (g.state.currentPlayerId !== cur || g.state.turnPhase !== "play") return;
        try {
          endTurn(g, cur); // engine discards randomly
          this.afterEngineStep(room);
          this.broadcastRoom(room);
        } catch {
          /* turn moved on */
        }
      }, room.settings.turnTimerMs * 2);
      room.timers.set(turnKey, t);
    } else if (!needsTurnTimer) {
      const t = room.timers.get(turnKey);
      if (t) {
        clearTimeout(t);
        room.timers.delete(turnKey);
      }
    }
  }

  isBotSeat(room: Room, playerId: string): boolean {
    const rp = room.players.find((p) => p.id === playerId);
    return !!rp && (rp.isBot || !!rp.botTakenOver || !rp.connected);
  }

  /** Drive bot-controlled seats until the game waits on a human (or ends). */
  private driveBots(room: Room): void {
    const game = room.game;
    if (!game || game.state.phase === "ended") return;

    if (game.state.phase === "role_deal" || game.state.phase === "draft") {
      // draft: bots pick after a "think" beat
      const due = Object.values(game.state.players).find(
        (p) => !p.survivorId && this.isBotSeat(room, p.id),
      );
      if (due) {
        this.scheduleBotThink(room, () => {
          const g = room.game;
          if (!g || g.state.phase === "ended") return;
          if (!g.state.players[due.id]?.survivorId) autoPick(g, due.id);
          this.afterEngineStep(room);
          this.broadcastRoom(room);
        });
      }
      return;
    }
    if (game.state.phase !== "playing") return;

    // 1. bot prompts first (synchronous — responses cascade)
    for (;;) {
      const botPrompt = game.state.pendingPrompts.find((pr) => this.isBotSeat(room, pr.playerId));
      if (!botPrompt) break;
      const action = botRespond(game, botPrompt);
      respond(game, botPrompt.playerId, botPrompt.id, action);
      const events = game.log.drain();
      if (events.length) this.broadcastEvents(room, events);
      if (phaseOf(game) === "ended") {
        room.phase = "ended";
        this.clearAllTimers(room);
        this.broadcastEnded(room);
        return;
      }
    }
    if (game.state.pendingPrompts.length > 0) return; // waiting on human(s)

    // 2. bot turn? act after a think beat (one action per beat)
    const cur = game.state.currentPlayerId;
    if (!cur || !this.isBotSeat(room, cur)) return;
    if (game.state.turnPhase !== "play") return; // start/draw resolve in-engine

    this.scheduleBotThink(room, () => {
      const g = room.game;
      if (!g || g.state.phase !== "playing") return;
      if (g.state.currentPlayerId !== cur || g.state.turnPhase !== "play") return;
      if (g.state.pendingPrompts.length > 0) return;
      try {
        const action = botChoosePlayAction(g);
        if (action.kind === "play") {
          playCard(g, {
            playerId: cur,
            cardId: action.cardId,
            targets: action.targets,
            asDefId: action.asDefId,
          });
        } else if (action.kind === "skill") {
          useSkill(g, { playerId: cur, ...action.req });
        } else {
          endTurn(g, cur, botChooseDiscards(g, cur));
        }
      } catch {
        // illegal choice under a race — just end the turn
        try {
          if (g.state.currentPlayerId === cur && g.state.turnPhase === "play") {
            endTurn(g, cur);
          }
        } catch {
          /* ignore */
        }
      }
      this.afterEngineStep(room);
      this.broadcastRoom(room);
    });
  }

  private scheduleBotThink(room: Room, fn: () => void): void {
    const key = `botthink:${room.game!.state.seq}:${room.timers.size}`;
    if ([...room.timers.keys()].some((k) => k.startsWith("botthink:"))) return; // one at a time
    const t = setTimeout(() => {
      room.timers.delete(key);
      if (room.phase === "ended") return;
      fn();
    }, BOT_THINK_MS);
    room.timers.set(key, t);
  }

  // ------------------------------------------------------- disconnect handling

  private scheduleBotTakeover(room: Room, player: RoomPlayer): void {
    const key = `takeover:${player.id}`;
    if (room.timers.has(key)) return;
    const t = setTimeout(() => {
      room.timers.delete(key);
      if (!player.connected && (room.phase === "playing" || room.phase === "draft")) {
        player.botTakenOver = true;
        this.afterEngineStep(room);
        this.broadcastRoom(room);
      }
    }, TAKEOVER_GRACE_MS);
    room.timers.set(key, t);
  }

  // ------------------------------------------------------------- broadcasting

  viewForPlayer(room: Room, playerId: string): PlayerView | null {
    if (!room.game) return null;
    const offer =
      room.phase === "draft" && !room.game.state.players[playerId]?.survivorId
        ? room.game.draftOffers.get(playerId)
        : undefined;
    return viewFor(room.game.state, playerId, offer, room.game.cards);
  }

  spectatorView(room: Room): PlayerView | null {
    if (!room.game) return null;
    return viewForSpectator(room.game.state);
  }

  broadcastRoom(room: Room): void {
    if (!room.emit) return;
    room.emit("*", {
      type: "room:update",
      roomId: room.id,
      phase: room.phase,
      hostId: room.hostId,
      players: room.players.map((p) => ({
        id: p.id,
        name: p.name,
        seat: p.seat,
        connected: p.connected,
        isBot: p.isBot,
      })),
      spectators: room.spectators.size,
      settings: room.settings,
    });

    // Per-player views are always safe to send (fog-of-war filtered, and draft
    // offers are included only in the owner's view). Note the ENGINE phase stays
    // "role_deal" during the draft — gate on room.phase instead so draft views
    // (with offers) reach clients.
    if (!room.game || room.phase === "lobby") return;

    for (const rp of room.players) {
      if (rp.isBot) continue;
      const view = this.viewForPlayer(room, rp.id);
      if (!view) continue;
      room.emit(rp.id, { type: "game:view", seq: room.game.state.seq, view });
      for (const pr of room.game.state.pendingPrompts) {
        if (pr.playerId === rp.id) {
          room.emit(rp.id, { type: "game:prompt", prompt: pr, deadlineMs: pr.deadlineMs });
        }
      }
    }
    const sv = this.spectatorView(room);
    if (sv) {
      for (const connId of room.spectators.keys()) {
        room.emit(`spectator:${connId}`, { type: "game:view", seq: room.game.state.seq, view: sv });
      }
    }
  }

  private broadcastEvents(room: Room, events: GameEvent[]): void {
    if (!room.emit) return;
    const publicEvents = events.filter(isPublicEvent);
    if (publicEvents.length === 0) return;
    room.emit("*", { type: "game:event", seq: room.game!.state.seq, events: publicEvents });
  }

  private broadcastEnded(room: Room): void {
    if (!room.emit || !room.game) return;
    const w = room.game.state.winner;
    if (!w) return;
    const roles: Record<string, string> = {};
    for (const p of Object.values(room.game.state.players)) roles[p.id] = p.role;
    room.emit("*", { type: "game:ended", winner: w.faction, reason: w.reason, roles });
  }

  private clearAllTimers(room: Room): void {
    for (const t of room.timers.values()) clearTimeout(t);
    room.timers.clear();
  }
}

/** Events safe to broadcast to everyone (no hidden information). */
export function isPublicEvent(e: GameEvent): boolean {
  switch (e.type) {
    case "draft_offered": // secret per-player offers
    case "prompt_issued": // addressee-only (sent via game:prompt)
    case "prompt_resolved": // may embed chosen cards
    case "prompt_timeout":
      return false;
    default:
      return true;
  }
}
