# ASHFALL: The Last Bastion (เถ้าธุลี: ป้อมสุดท้าย)

Multiplayer post-apocalyptic hidden-role card game for the browser. 3–10 players,
secret roles (Sovereign / Warden / Raider / Phantom), 25+2 survivors with unique skills,
108-card deck, pixel-art UI. Server-authoritative engine — anti-cheat by design.

> Original world & characters. Turn mechanics inspired by classic hidden-role card board games.

## Stack

TypeScript monorepo (pnpm):

| Package | Role |
|---------|------|
| `packages/shared` | zod schemas, types, card/survivor/deck data (bilingual TH/EN) |
| `packages/engine` | **pure** deterministic rules engine (seeded RNG, zero I/O) |
| `packages/bots` | AI players (seat filling + simulation testing) |
| `packages/server` | Fastify + ws: rooms, realtime protocol, SQLite (best-effort) |
| `packages/client` | Svelte 5 + Vite pixel UI |
| `tools/artgen` | PixelLab API batch asset generator (design-time) |
| `tools/sim` | bot-vs-bot simulation runner |

## Develop

```bash
pnpm install
pnpm dev          # server on :3000
pnpm dev:client   # client on :5173 (proxies /api + /ws)
pnpm test         # vitest: engine + shared
pnpm typecheck && pnpm build
```

## Deploy

Docker image (`deploy/Dockerfile`) → Render Free. See `docs/07-deployment.md`.
Prod bakes approved pixel assets into the image; no external API keys at runtime.

## Docs

Full design & test documentation in [`docs/`](./docs) — game design, architecture,
art pipeline, roadmap (M0–M9), SIT plan (~130 cases), UAT plan, deployment plan.
