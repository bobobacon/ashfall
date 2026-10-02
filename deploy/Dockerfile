# ASHFALL: The Last Bastion — single image: REST + WS + static client + baked pixel assets.
# Deployed to Render Free (binds 0.0.0.0:$PORT). NO PIXELLAB_API_KEY in prod.
#
# IMPORTANT: we copy the ENTIRE build-stage tree, not selected dirs. pnpm
# installs each package's deps as symlinks in packages/*/node_modules →
# /app/node_modules/.pnpm; copying only the root node_modules breaks runtime
# resolution (ERR_MODULE_NOT_FOUND: fastify). Full-tree copy keeps symlinks
# and their targets intact.

# ---- deps & build ----
FROM node:22-alpine AS build
RUN corepack enable
WORKDIR /app
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json tsconfig.base.json ./
# copy the tools workspace stub so pnpm resolves it in the lockfile
COPY tools/artgen/package.json tools/artgen/package.json
# package.json files first for layer caching
COPY packages/shared/package.json packages/shared/
COPY packages/engine/package.json packages/engine/
COPY packages/bots/package.json packages/bots/
COPY packages/server/package.json packages/server/
COPY packages/client/package.json packages/client/
RUN pnpm install --frozen-lockfile
# full source
COPY packages ./packages
COPY tools ./tools
# build all deployable packages (artgen is a CLI tool, not shipped)
RUN pnpm --filter @ashfall/shared build \
 && pnpm --filter @ashfall/engine build \
 && pnpm --filter @ashfall/bots build \
 && pnpm --filter @ashfall/server build \
 && pnpm --filter @ashfall/client build \
 && pnpm --filter @ashfall/artgen build
# prune to production deps only (keeps workspace symlinks intact)
RUN pnpm prune --prod

# ---- runtime ----
FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
# full tree — preserves packages/*/node_modules symlinks → .pnpm store
COPY --from=build /app ./
# strip artifacts that must not ship (defense in depth; assets are baked in
# client/dist, source maps are fine to keep)
RUN rm -rf /app/packages/*/src /app/tools && \
    chown -R node:node /app
EXPOSE 3000
USER node
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD wget -qO- http://127.0.0.1:${PORT:-3000}/api/health | grep -q '"ok":true' || exit 1
CMD ["node", "packages/server/dist/main.js"]