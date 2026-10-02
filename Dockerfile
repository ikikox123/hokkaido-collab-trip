# ---- stage 1: build React client ----
FROM node:22-alpine AS client-build
WORKDIR /app/client
COPY client/package.json client/package-lock.json ./
RUN npm ci
COPY client/ ./
RUN npm run build

# ---- stage 2: production runtime (Express + Socket.io + static) ----
FROM node:22-alpine
WORKDIR /app

# Install only server deps (root concurrently not needed in prod)
COPY server/package.json server/package-lock.json ./server/
RUN npm ci --omit=dev --prefix server

COPY server/src ./server/src
COPY --from=client-build /app/client/dist ./client/dist

RUN mkdir -p /app/data

ENV NODE_ENV=production
ENV PORT=3001
EXPOSE 3001

# JWT_SECRET must be provided at runtime
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:${PORT}/api/health || exit 1

CMD ["node", "server/src/index.js"]
