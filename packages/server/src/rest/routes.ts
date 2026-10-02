// REST routes: health, room listing, meta (card/survivor defs for the UI).
import type { FastifyInstance } from "fastify";
import { CARD_DEFS, SURVIVOR_DEFS, ROLE_DISTRIBUTION, DECK_SIZE } from "@ashfall/shared";
import type { WsGateway } from "../ws.js";

export function registerRest(app: FastifyInstance, gw?: () => WsGateway | undefined): void {
  app.get("/api/health", async () => ({
    ok: true,
    version: process.env.APP_VERSION ?? "0.1.0",
    ws: true,
    rooms: gw?.()?.manager.roomCount() ?? 0,
    uptime: process.uptime(),
  }));

  app.get("/api/rooms", async () => {
    const g = gw?.();
    if (!g) return { rooms: [] };
    return { rooms: g.manager.listOpenRooms() };
  });

  // Public game metadata for UI rendering (no secrets — definitions only)
  app.get("/api/meta", async () => ({
    cards: CARD_DEFS,
    survivors: SURVIVOR_DEFS,
    roleDistribution: ROLE_DISTRIBUTION,
    deckSize: DECK_SIZE,
  }));
}
