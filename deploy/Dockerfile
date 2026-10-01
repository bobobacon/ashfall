# ASHFALL: The Last Bastion — single image: REST + WS + static client + baked pixel assets.
# Deployed to Render Free (binds 0.0.0.0:$PORT). NO PIXELLAB_API_KEY in prod.

# ---- deps & build ----
FROM node:22-alpine AS build
RUN corepack enable
WORKDIR /app
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/engine/package.json packages/engine/
COPY packages/bots/package.json packages/bots/
COPY packages/server/package.json packages/server/
COPY packages/client/package.json packages/client/
RUN pnpm install --frozen-lockfile
COPY packages ./packages
RUN pnpm --filter @ashfall/shared build \
 && pnpm --filter @ashfall/engine build \
 && pnpm --filter @ashfall/bots build \
 && pnpm --filter @ashfall/server build \
 && pnpm --filter @ashfall/client build
# prune to production deps only
RUN pnpm prune --prod

# ---- runtime ----
FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages/shared/dist ./packages/shared/dist
COPY --from=build /app/packages/shared/package.json ./packages/shared/package.json
COPY --from=build /app/packages/engine/dist ./packages/engine/dist
COPY --from=build /app/packages/engine/package.json ./packages/engine/package.json
COPY --from=build /app/packages/bots/dist ./packages/bots/dist
COPY --from=build /app/packages/bots/package.json ./packages/bots/package.json
COPY --from=build /app/packages/server/dist ./packages/server/dist
COPY --from=build /app/packages/server/package.json ./packages/server/package.json
COPY --from=build /app/packages/client/dist ./packages/client/dist
COPY package.json pnpm-workspace.yaml ./
EXPOSE 3000
USER node
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD wget -qO- http://127.0.0.1:${PORT:-3000}/api/health | grep -q '"ok":true' || exit 1
CMD ["node", "packages/server/dist/main.js"]
