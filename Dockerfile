# syntax=docker/dockerfile:1.6
# Multi-stage build: deps → build → runner. Final image only ships the
# Next standalone output + native node_modules, ~200MB instead of 1.5GB.

# ---------- deps ----------
FROM node:22-bookworm-slim AS deps
WORKDIR /app
# Build tooling for better-sqlite3 (compiled native module).
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci

# ---------- build ----------
FROM node:22-bookworm-slim AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# AUTH_SECRET is read at module load time (src/lib/auth.ts throws if missing).
# A placeholder lets the build run; the real secret is injected at runtime.
RUN AUTH_SECRET=build-placeholder npm run build

# ---------- runner ----------
FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# Non-root user for the running process.
RUN groupadd --system --gid 1001 nodejs \
  && useradd --system --uid 1001 --gid nodejs nextjs

# Standalone output bundles Next + the minimum node_modules tree it needs.
COPY --from=build --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=build --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=build --chown=nextjs:nodejs /app/public ./public
# better-sqlite3 native build doesn't always come along with standalone trace;
# copy explicitly so it's available at runtime.
COPY --from=deps --chown=nextjs:nodejs /app/node_modules/better-sqlite3 ./node_modules/better-sqlite3
COPY --from=deps --chown=nextjs:nodejs /app/node_modules/bindings ./node_modules/bindings
COPY --from=deps --chown=nextjs:nodejs /app/node_modules/file-uri-to-path ./node_modules/file-uri-to-path

# Persistent state lives in /app/data (SQLite) and /app/public/apps (deployed
# user apps). Mount host volumes onto those paths in docker compose.
RUN mkdir -p /app/data /app/public/apps \
  && chown -R nextjs:nodejs /app/data /app/public/apps

USER nextjs
EXPOSE 3000
CMD ["node", "server.js"]
