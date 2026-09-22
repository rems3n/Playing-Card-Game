FROM node:22-alpine AS builder

WORKDIR /app

# Copy root config
COPY package.json package-lock.json turbo.json tsconfig.base.json ./

# Copy package.json files needed for the server build
COPY packages/shared-types/package.json packages/shared-types/
COPY packages/game-engine/package.json packages/game-engine/
COPY packages/ai/package.json packages/ai/
COPY apps/server/package.json apps/server/

# Stub out packages the server doesn't need but npm workspaces expects
COPY packages/shared-socket/package.json packages/shared-socket/
COPY packages/shared-store/package.json packages/shared-store/
COPY apps/web/package.json apps/web/
COPY apps/mobile/package.json apps/mobile/

# Install deps
RUN npm ci --ignore-scripts

# Copy source
COPY packages/shared-types/ packages/shared-types/
COPY packages/game-engine/ packages/game-engine/
COPY packages/ai/ packages/ai/
COPY apps/server/ apps/server/

# Build only the server and its dependencies
RUN npx turbo run build --filter=@card-game/server

# ── Production image ──
FROM node:22-alpine

WORKDIR /app

COPY --from=builder /app/package.json /app/package-lock.json /app/turbo.json ./

# Server dependencies (only packages the server actually imports)
COPY --from=builder /app/packages/shared-types/package.json packages/shared-types/
COPY --from=builder /app/packages/shared-types/dist packages/shared-types/dist
COPY --from=builder /app/packages/game-engine/package.json packages/game-engine/
COPY --from=builder /app/packages/game-engine/dist packages/game-engine/dist
COPY --from=builder /app/packages/ai/package.json packages/ai/
COPY --from=builder /app/packages/ai/dist packages/ai/dist

# Stub workspaces that server doesn't use (needed for npm install to not fail)
COPY --from=builder /app/packages/shared-socket/package.json packages/shared-socket/
COPY --from=builder /app/packages/shared-store/package.json packages/shared-store/
COPY --from=builder /app/apps/web/package.json apps/web/
COPY --from=builder /app/apps/mobile/package.json apps/mobile/
RUN mkdir -p packages/shared-socket/dist packages/shared-store/dist

# Server itself
COPY --from=builder /app/apps/server/package.json apps/server/
COPY --from=builder /app/apps/server/dist apps/server/dist
COPY --from=builder /app/apps/server/drizzle apps/server/drizzle

# Create uploads dir
RUN mkdir -p apps/server/uploads/avatars

RUN npm ci --omit=dev --ignore-scripts --workspace=@card-game/server --include-workspace-root

RUN chown -R node:node /app/apps/server/uploads
ENV NODE_ENV=production
USER node
WORKDIR /app/apps/server

CMD ["node", "dist/index.js"]
# CardArena
