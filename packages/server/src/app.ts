// ASHFALL server entrypoint — Fastify + ws. M0 skeleton.
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import { websocketServer } from "./ws.js";

const PORT = Number(process.env.PORT ?? 3000);
const HOST = "0.0.0.0";

export async function buildApp() {
  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? "info",
      // redact any accidental secret logging
      redact: ["req.headers.authorization", "*.apiKey", "*.token"],
    },
  });

  app.get("/api/health", async () => {
    return {
      ok: true,
      version: process.env.APP_VERSION ?? "0.1.0",
      ws: true,
      uptime: process.uptime(),
    };
  });

  // Serve built client if present (prod layout: packages/client/dist next to server dist)
  const clientDist = fileURLToPath(new URL("../../client/dist", import.meta.url));
  if (existsSync(clientDist)) {
    await app.register(fastifyStatic, { root: clientDist });
    // SPA fallback
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith("/api") || req.url.startsWith("/ws")) {
        return reply.code(404).send({ error: "not_found" });
      }
      return reply.sendFile("index.html");
    });
  }

  return app;
}

export async function main() {
  const app = await buildApp();
  await app.listen({ port: PORT, host: HOST });
  websocketServer(app.server);
  app.log.info(`ASHFALL server listening (pid ${process.pid})`);

  // Graceful shutdown (Render/deploy SIGTERM): stop accepting, let rooms finish.
  for (const sig of ["SIGTERM", "SIGINT"] as const) {
    process.on(sig, () => {
      app.log.info(`${sig} received, shutting down gracefully`);
      const t = setTimeout(() => process.exit(1), 30_000);
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
  return app;
}
