// ASHFALL server entrypoint — Fastify + ws. Serves API, static client, WS.
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import Fastify, { type FastifyInstance } from "fastify";
import fastifyStatic from "@fastify/static";
import { websocketServer, type WsGateway } from "./ws.js";
import { registerRest } from "./rest/routes.js";

const PORT = Number(process.env.PORT ?? 3000);
const HOST = "0.0.0.0";

export interface AppContext {
  gateway?: WsGateway;
}

export async function buildApp(): Promise<FastifyInstance & { ashfall?: AppContext }> {
  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? "info",
      redact: ["req.headers.authorization", "*.apiKey", "*.token"],
    },
  });
  (app as unknown as { ashfall: AppContext }).ashfall = {};

  registerRest(app, () => (app as unknown as { ashfall?: AppContext }).ashfall?.gateway);

  // Serve built client if present (prod layout: packages/client/dist)
  const clientDist = fileURLToPath(new URL("../../client/dist", import.meta.url));
  if (existsSync(clientDist)) {
    await app.register(fastifyStatic, { root: clientDist });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith("/api") || req.url.startsWith("/ws")) {
        return reply.code(404).send({ error: "not_found" });
      }
      return reply.sendFile("index.html");
    });
  }

  return app;
}

export async function main(): Promise<void> {
  const app = await buildApp();
  await app.listen({ port: PORT, host: HOST });
  const gw = websocketServer(app.server, app);
  (app as unknown as { ashfall: AppContext }).ashfall.gateway = gw;
  app.log.info(`ASHFALL server listening (pid ${process.pid})`);

  // Optional self-ping keep-alive for Render free tier (docs/07 §6.1)
  if (process.env.KEEP_ALIVE_SELF_PING === "true") {
    const url = `http://127.0.0.1:${PORT}/api/health`;
    setInterval(() => {
      fetch(url).catch(() => undefined);
    }, 10 * 60 * 1000);
    app.log.info("keep-alive self-ping enabled");
  }

  for (const sig of ["SIGTERM", "SIGINT"] as const) {
    process.on(sig, () => {
      app.log.info(`${sig} received, shutting down gracefully`);
      const t = setTimeout(() => process.exit(1), 30_000);
      gw.closeAll();
      app
        .close()
        .then(() => {
          clearTimeout(t);
          process.exit(0);
        })
        .catch(() => {
          clearTimeout(t);
          process.exit(1);
        });
    });
  }
}
