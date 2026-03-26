FROM node:20-alpine AS builder

WORKDIR /app

# Copy root config
COPY package.json package-lock.json turbo.json tsconfig.base.json ./

# Copy all package.json files for install
COPY packages/shared-types/package.json packages/shared-types/
COPY packages/shared-socket/package.json packages/shared-socket/
COPY packages/shared-store/package.json packages/shared-store/
COPY packages/game-engine/package.json packages/game-engine/
COPY packages/ai/package.json packages/ai/
COPY apps/server/package.json apps/server/

# Install deps
RUN npm install --ignore-scripts

# Copy source
COPY packages/ packages/
COPY apps/server/ apps/server/

# Build
RUN npx turbo run build --filter=@card-game/server

# ── Production image ──
FROM node:20-alpine

WORKDIR /app

COPY --from=builder /app/package.json /app/package-lock.json /app/turbo.json ./
COPY --from=builder /app/packages/shared-types/package.json packages/shared-types/
COPY --from=builder /app/packages/shared-types/dist packages/shared-types/dist
COPY --from=builder /app/packages/shared-socket/package.json packages/shared-socket/
COPY --from=builder /app/packages/shared-socket/dist packages/shared-socket/dist
COPY --from=builder /app/packages/shared-store/package.json packages/shared-store/
COPY --from=builder /app/packages/shared-store/dist packages/shared-store/dist
COPY --from=builder /app/packages/game-engine/package.json packages/game-engine/
COPY --from=builder /app/packages/game-engine/dist packages/game-engine/dist
COPY --from=builder /app/packages/ai/package.json packages/ai/
COPY --from=builder /app/packages/ai/dist packages/ai/dist
COPY --from=builder /app/apps/server/package.json apps/server/
COPY --from=builder /app/apps/server/dist apps/server/dist
COPY --from=builder /app/apps/server/drizzle apps/server/drizzle

RUN npm install --omit=dev --ignore-scripts

WORKDIR /app/apps/server

EXPOSE 3001

CMD ["node", "dist/index.js"]
