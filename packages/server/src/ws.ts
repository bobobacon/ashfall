// WebSocket gateway — connection lifecycle, intent routing, rate limiting,
// fog-of-war fan-out. Protocol: JSON frames validated by zod (shared/protocol).
import type { Server } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import { randomUUID } from "node:crypto";
import { ClientIntent, type ClientIntentT } from "@ashfall/shared";
import { RoomManager, RoomError, type Room, type RoomPlayer } from "./rooms/manager.js";
import type { FastifyInstance } from "fastify";

const APP_VERSION = process.env.APP_VERSION ?? "0.1.0";
const MAX_MSG_PER_SEC = 30;
const HEARTBEAT_MS = 20_000;
const MAX_FRAME_BYTES = 16 * 1024;

interface Conn {
  id: string;
  ws: WebSocket;
  alive: boolean;
  /** rate window */
  tokens: number;
  lastRefill: number;
  room?: Room;
  player?: RoomPlayer;
  spectatorOf?: Room;
}

export interface WsGateway {
  wss: WebSocketServer;
  manager: RoomManager;
  connCount(): number;
  closeAll(): void;
}

export function websocketServer(httpServer: Server, app?: FastifyInstance): WsGateway {
  const manager = new RoomManager();
  const wss = new WebSocketServer({ server: httpServer, path: "/ws", maxPayload: MAX_FRAME_BYTES });
  const conns = new Map<string, Conn>();

  const send = (conn: Conn, msg: unknown): void => {
    if (conn.ws.readyState === WebSocket.OPEN) {
      conn.ws.send(JSON.stringify(msg));
    }
  };

  const sendError = (conn: Conn, code: string, message: string): void => {
    send(conn, { type: "error", code, message });
  };

  /** Fan-out helper registered on each room. target: "*" | playerId | spectator:<connId> */
  const roomEmitter = (conn: Conn) => (room: Room) => {
    room.emit = (target, msg) => {
      if (target === "*") {
        for (const rp of room.players) {
          const c = findByPlayerId(rp.id);
          if (c) send(c, msg);
        }
        for (const specConnId of room.spectators.keys()) {
          const c = conns.get(specConnId);
          if (c) send(c, msg);
        }
        return;
      }
      if (target.startsWith("spectator:")) {
        const c = conns.get(target.slice("spectator:".length));
        if (c) send(c, msg);
        return;
      }
      const c = findByPlayerId(target);
      if (c) send(c, msg);
    };
    void conn;
  };

  function findByPlayerId(playerId: string): Conn | undefined {
    for (const c of conns.values()) {
      if (c.player?.id === playerId) return c;
    }
    return undefined;
  }

  wss.on("connection", (ws) => {
    const conn: Conn = {
      id: randomUUID(),
      ws,
      alive: true,
      tokens: MAX_MSG_PER_SEC,
      lastRefill: Date.now(),
    };
    conns.set(conn.id, conn);
    send(conn, { type: "hello", version: APP_VERSION, sessionId: conn.id });

    ws.on("pong", () => {
      conn.alive = true;
    });

    ws.on("message", (raw) => {
      // rate limit (token bucket, refilled per second)
      const now = Date.now();
      const elapsed = (now - conn.lastRefill) / 1000;
      conn.tokens = Math.min(MAX_MSG_PER_SEC, conn.tokens + elapsed * MAX_MSG_PER_SEC);
      conn.lastRefill = now;
      if (conn.tokens < 1) {
        sendError(conn, "E_RATE_LIMIT", "slow down");
        return;
      }
      conn.tokens -= 1;

      let parsed: unknown;
      try {
        parsed = JSON.parse(String(raw));
      } catch {
        sendError(conn, "E_BAD_JSON", "invalid JSON frame");
        return;
      }

      const result = ClientIntent.safeParse(parsed);
      if (!result.success) {
        sendError(conn, "E_BAD_INTENT", "invalid intent");
        recordCheat(conn, "E_BAD_INTENT");
        return;
      }
      handleIntent(conn, result.data);
    });

    ws.on("close", () => {
      handleDisconnect(conn);
      conns.delete(conn.id);
    });

    ws.on("error", () => {
      handleDisconnect(conn);
      conns.delete(conn.id);
    });
  });

  function recordCheat(conn: Conn, _code: string): void {
    if (!conn.room || !conn.player) return;
    const kicked = manager.recordCheat(conn.room, conn.player.id);
    if (kicked) {
      sendError(conn, "E_KICKED", "too many illegal actions");
      handleDisconnect(conn);
      conn.ws.close();
    }
  }

  function handleIntent(conn: Conn, intent: ClientIntentT): void {
    switch (intent.type) {
      case "room:create": {
        const { room, player } = manager.createRoom(conn.id, intent.name);
        conn.room = room;
        conn.player = player;
        roomEmitter(conn)(room);
        send(conn, {
          type: "room:joined",
          roomId: room.id,
          playerId: player.id,
          reconnectToken: player.reconnectToken,
          youAreHost: true,
        });
        manager.broadcastRoom(room);
        return;
      }
      case "room:join": {
        const room = manager.getRoom(intent.roomId.toUpperCase());
        if (!room) {
          sendError(conn, "E_NO_ROOM", "room not found");
          return;
        }
        if (intent.reconnectToken) {
          const player = manager.reconnect(room, conn.id, intent.reconnectToken);
          if (player) {
            conn.room = room;
            conn.player = player;
            roomEmitter(conn)(room);
            send(conn, {
              type: "room:joined",
              roomId: room.id,
              playerId: player.id,
              reconnectToken: player.reconnectToken,
              youAreHost: room.hostId === player.id,
            });
            manager.broadcastRoom(room);
            return;
          }
          sendError(conn, "E_BAD_TOKEN", "invalid reconnect token");
          return;
        }
        try {
          const player = manager.joinRoom(room, conn.id, intent.playerName);
          conn.room = room;
          conn.player = player;
          roomEmitter(conn)(room);
          send(conn, {
            type: "room:joined",
            roomId: room.id,
            playerId: player.id,
            reconnectToken: player.reconnectToken,
            youAreHost: false,
          });
          manager.broadcastRoom(room);
        } catch (err) {
          sendError(conn, errCode(err), errMessage(err));
        }
        return;
      }
      case "room:spectate": {
        const room = manager.getRoom(intent.roomId.toUpperCase());
        if (!room) {
          sendError(conn, "E_NO_ROOM", "room not found");
          return;
        }
        try {
          manager.addSpectator(room, conn.id, "spectator");
          conn.spectatorOf = room;
          roomEmitter(conn)(room);
          manager.broadcastRoom(room);
        } catch (err) {
          sendError(conn, errCode(err), errMessage(err));
        }
        return;
      }
      case "room:leave": {
        handleDisconnect(conn, { silent: false });
        return;
      }
      case "room:addBot": {
        requireRoom(conn, (room) => {
          try {
            manager.addBot(room);
            manager.broadcastRoom(room);
          } catch (err) {
            sendError(conn, errCode(err), errMessage(err));
          }
        });
        return;
      }
      case "room:removeBot": {
        requireRoom(conn, (room) => {
          manager.removeBot(room, intent.seat);
          manager.broadcastRoom(room);
        });
        return;
      }
      case "room:start": {
        requireRoom(conn, (room) => {
          if (!conn.player) return;
          try {
            manager.startGame(room, conn.player.id);
          } catch (err) {
            sendError(conn, errCode(err), errMessage(err));
          }
        });
        return;
      }
      default: {
        // all game:* + chat intents require a seated player
        requireRoom(conn, (room) => {
          if (!conn.player) return;
          try {
            manager.applyIntent(room, conn.player.id, intent);
          } catch (err) {
            const code = errCode(err);
            sendError(conn, code, errMessage(err));
            if (code.startsWith("E_") && !isBenign(code)) recordCheat(conn, code);
          }
        });
        return;
      }
    }
  }

  function requireRoom(conn: Conn, fn: (room: Room) => void): void {
    if (!conn.room) {
      sendError(conn, "E_NO_ROOM", "not in a room");
      return;
    }
    fn(conn.room);
  }

  function handleDisconnect(conn: Conn, _opts?: { silent: boolean }): void {
    if (conn.room && conn.player) {
      const room = conn.room;
      manager.leaveRoom(room, conn.player.id);
      if (manager.getRoom(room.id)) manager.broadcastRoom(room);
    }
    if (conn.spectatorOf) {
      manager.removeSpectator(conn.spectatorOf, conn.id);
      const room = conn.spectatorOf;
      if (manager.getRoom(room.id)) manager.broadcastRoom(room);
    }
    conn.room = undefined;
    conn.player = undefined;
    conn.spectatorOf = undefined;
  }

  // heartbeat: ping every 20s, terminate after 2 missed pongs
  const heartbeat = setInterval(() => {
    for (const conn of conns.values()) {
      if (!conn.alive) {
        conn.ws.terminate();
        conns.delete(conn.id);
        continue;
      }
      conn.alive = false;
      conn.ws.ping();
    }
  }, HEARTBEAT_MS);

  wss.on("close", () => clearInterval(heartbeat));
  void app; // reserved for future REST integration (rooms API reads manager via return value)

  return {
    wss,
    manager,
    connCount: () => conns.size,
    closeAll: () => {
      clearInterval(heartbeat);
      for (const conn of conns.values()) conn.ws.terminate();
      conns.clear();
    },
  };
}

function errCode(err: unknown): string {
  if (err instanceof RoomError) return err.code;
  const e = err as { code?: string };
  return e?.code && typeof e.code === "string" ? e.code : "E_INTERNAL";
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : "internal error";
}

/** Benign rejection codes that don't count as cheat attempts. */
function isBenign(code: string): boolean {
  return (
    code === "E_PHASE" ||
    code === "E_NOT_YOUR_TURN" ||
    code === "E_PENDING" ||
    code === "E_BAD_TARGETS" ||
    code === "E_OUT_OF_RANGE" ||
    code === "E_STRIKE_LIMIT" ||
    code === "E_FULL_HP" ||
    code === "E_GAME_OVER"
  );
}
