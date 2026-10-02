// Wire protocol schemas (doc 02 §4) — shared by client & server via zod.
import { z } from "zod";

// ---------------------------------------------------------------------------
// Client → Server intents
// ---------------------------------------------------------------------------

export const RoomSettingsIntent = z.object({
  turnTimerMs: z.number().int().min(10_000).max(120_000).optional(),
  expansions: z
    .object({
      tether: z.boolean().optional(),
      ascendants: z.boolean().optional(),
      awaken: z.boolean().optional(),
    })
    .optional(),
  allowSpectators: z.boolean().optional(),
  allowBots: z.boolean().optional(),
});

export const ClientIntent = z.discriminatedUnion("type", [
  z.object({ type: z.literal("room:create"), name: z.string().min(1).max(24), settings: RoomSettingsIntent.optional() }),
  z.object({ type: z.literal("room:join"), roomId: z.string().length(6), playerName: z.string().min(1).max(24), reconnectToken: z.string().optional() }),
  z.object({ type: z.literal("room:spectate"), roomId: z.string().length(6) }),
  z.object({ type: z.literal("room:leave") }),
  z.object({ type: z.literal("room:addBot") }),
  z.object({ type: z.literal("room:removeBot"), seat: z.number().int() }),
  z.object({ type: z.literal("room:start") }),
  z.object({ type: z.literal("draft:pick"), survivorId: z.string() }),
  z.object({ type: z.literal("game:play"), cardId: z.string(), targets: z.array(z.string()).optional(), asDefId: z.string().optional() }),
  z.object({ type: z.literal("game:skill"), skillId: z.string(), targets: z.array(z.string()).optional(), cardIds: z.array(z.string()).optional(), payload: z.unknown().optional() }),
  z.object({ type: z.literal("game:launcher"), targetId: z.string() }),
  z.object({ type: z.literal("game:respond"), promptId: z.string(), action: z.union([
    z.object({ kind: z.literal("discard"), cardIds: z.array(z.string()).min(1) }),
    z.object({ kind: z.literal("decline") }),
    z.object({ kind: z.literal("choose"), choice: z.string() }),
  ])}),
  z.object({ type: z.literal("game:endTurn"), discards: z.array(z.string()).optional() }),
  z.object({ type: z.literal("chat"), text: z.string().min(1).max(200) }),
  z.object({ type: z.literal("resync") }),
]);

export type ClientIntentT = z.infer<typeof ClientIntent>;

// ---------------------------------------------------------------------------
// Server → Client messages
// ---------------------------------------------------------------------------

export const ServerMsgHello = z.object({
  type: z.literal("hello"),
  version: z.string(),
  sessionId: z.string(),
});

export const ServerMsgRoomUpdate = z.object({
  type: z.literal("room:update"),
  roomId: z.string(),
  phase: z.string(),
  hostId: z.string(),
  players: z.array(z.object({
    id: z.string(),
    name: z.string(),
    seat: z.number(),
    connected: z.boolean(),
    isBot: z.boolean(),
  })),
  spectators: z.number(),
  settings: z.unknown(),
});

export const ServerMsgJoined = z.object({
  type: z.literal("room:joined"),
  roomId: z.string(),
  playerId: z.string(),
  reconnectToken: z.string().optional(),
  youAreHost: z.boolean(),
});

export const ServerMsgGameView = z.object({
  type: z.literal("game:view"),
  seq: z.number(),
  view: z.unknown(), // PlayerView (validated structurally at runtime, opaque here)
});

export const ServerMsgGameEvent = z.object({
  type: z.literal("game:event"),
  seq: z.number(),
  events: z.array(z.unknown()),
});

export const ServerMsgPrompt = z.object({
  type: z.literal("game:prompt"),
  prompt: z.unknown(),
  deadlineMs: z.number(),
});

export const ServerMsgChat = z.object({
  type: z.literal("chat"),
  from: z.string(),
  text: z.string(),
});

export const ServerMsgError = z.object({
  type: z.literal("error"),
  code: z.string(),
  message: z.string(),
  intentSeq: z.number().optional(),
});

export const ServerMsgGameEnded = z.object({
  type: z.literal("game:ended"),
  winner: z.string(),
  reason: z.string(),
  roles: z.record(z.string(), z.string()), // playerId → role reveal
});

export const ServerMsg = z.discriminatedUnion("type", [
  ServerMsgHello,
  ServerMsgJoined,
  ServerMsgRoomUpdate,
  ServerMsgGameView,
  ServerMsgGameEvent,
  ServerMsgPrompt,
  ServerMsgChat,
  ServerMsgError,
  ServerMsgGameEnded,
]);

export type ServerMsgT = z.infer<typeof ServerMsg>;

/** Room codes: 6 chars, unambiguous alphabet (no 0/O/1/I). */
export const ROOM_CODE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
