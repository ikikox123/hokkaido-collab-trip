# ---- stage 1: build React client ----
FROM node:22-alpine AS client-build
WORKDIR /app/client
COPY client/package.json client/package-lock.json ./
RUN npm ci
COPY client/ ./
# Bill-split math lives with the server and is bundled into the client.
COPY server/src/split.js /app/server/src/split.js
COPY server/src/split.d.ts /app/server/src/split.d.ts
COPY server/src/fx.js /app/server/src/fx.js
COPY server/src/fx.d.ts /app/server/src/fx.d.ts
# Vite inlines VITE_* at build time. Leave the key empty to keep Leaflet.
# Railway/Render should pass the same variable names as build args — never bake a key into the repo.
ARG VITE_MAP_PROVIDER=leaflet
ARG VITE_GOOGLE_MAPS_API_KEY=
ARG VITE_TILE_URL=
ARG VITE_TILE_ATTRIBUTION=
ENV VITE_MAP_PROVIDER=$VITE_MAP_PROVIDER \
    VITE_GOOGLE_MAPS_API_KEY=$VITE_GOOGLE_MAPS_API_KEY \
    VITE_TILE_URL=$VITE_TILE_URL \
    VITE_TILE_ATTRIBUTION=$VITE_TILE_ATTRIBUTION
RUN npm run build

# ---- stage 2: production runtime (Express + Socket.io + static) ----
FROM node:22-alpine
WORKDIR /app

# Install only server deps (root concurrently not needed in prod)
COPY server/package.json server/package-lock.json ./server/
RUN npm ci --omit=dev --prefix server

COPY server/src ./server/src
COPY --from=client-build /app/client/dist ./client/dist

# Empty data dir only. state.json and users.json are not copied into the image.
# Bucket copies are uploaded at runtime and are not part of this image.
# Production exits if /app/data/state.json is missing; it does not seed.
RUN mkdir -p /app/data

ENV NODE_ENV=production
ENV PORT=3001
EXPOSE 3001

# JWT_SECRET must be provided at runtime
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:${PORT}/api/health || exit 1

CMD ["node", "server/src/index.js"]
