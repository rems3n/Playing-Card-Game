# CardArena

Chess.com-inspired web and mobile platform for playing card games online.

**Live at: [cardarena.vercel.app](https://cardarena.vercel.app)**

## Features

- **3 Card Games** — Hearts, Spades, Euchre with complete rules
- **AI Opponents** — 4 difficulty tiers: Beginner, Intermediate, Advanced, Expert (Monte Carlo)
- **Google Sign-In** — OAuth authentication with editable profiles (username, avatar, display name)
- **Glicko-2 Ratings** — Per-game-type ratings with pairwise decomposition for multiplayer
- **Leaderboard** — Ranked players by rating for each game
- **Friends System** — Add friends by username, accept/decline requests
- **Matchmaking** — Queue by game type, auto-match when enough players join
- **In-Game Chat** — Real-time messaging during gameplay
- **Settings** — Customizable table color (Navy, Emerald, Burgundy, Charcoal, Purple, Teal)
- **Cross-Platform** — Shared TypeScript packages for web and mobile (React Native scaffold included)

## Tech Stack

| Layer | Technology |
|---|---|
| Monorepo | Turborepo + npm workspaces |
| Web | Next.js 15, React 19, TypeScript, Tailwind CSS |
| Mobile | Expo React Native (scaffold) |
| State | Zustand |
| Backend | Fastify + Socket.io |
| Database | PostgreSQL 16 + Drizzle ORM |
| Cache | Redis 7 |
| Auth | NextAuth.js v5 (Google OAuth) |
| AI | Custom (Random, Heuristic, Monte Carlo) |
| Ratings | Glicko-2 |
| Testing | Vitest (62 tests) |
| Hosting | Vercel (web) + Railway (server, Postgres, Redis) |

## Project Structure

```
packages/
  shared-types/      TypeScript interfaces (Card, GameState, socket events)
  shared-socket/     Platform-agnostic Socket.io client
  shared-store/      Zustand stores (game, lobby, settings)
  game-engine/       Game logic (Hearts, Spades, Euchre engines + StateMachine)
  ai/                AI strategies (Random, Heuristic, MonteCarlo)
apps/
  server/            Fastify + Socket.io game server
  web/               Next.js web app
  mobile/            Expo React Native app (scaffold)
```

## Local Development

### Prerequisites

- Node.js 20+
- Docker (for PostgreSQL + Redis)

### Setup

```bash
# Install dependencies
npm install

# Start Postgres + Redis
docker compose up -d

# Push database schema
cd apps/server && npm run db:push

# Create apps/web/.env.local with:
NEXTAUTH_URL=http://localhost:3000
NEXTAUTH_SECRET=your-secret
GOOGLE_CLIENT_ID=your-google-client-id
GOOGLE_CLIENT_SECRET=your-google-client-secret
NEXT_PUBLIC_SERVER_URL=http://localhost:3001

# Create apps/server/.env with:
DATABASE_URL=postgresql://cardgame:cardgame_dev@localhost:5432/cardgame
REDIS_URL=redis://localhost:6379
JWT_SECRET=your-jwt-secret

# Run in separate terminals:
cd apps/server && npm run dev    # Server on :3001
cd apps/web && npm run dev       # Web app on :3000
```

### Testing

```bash
# Run all 62 tests
npx turbo run test --filter=@card-game/game-engine

# Build all packages
npx turbo run build
```

## Deployment

- **Web app**: Deployed to Vercel via `vercel --prod`
- **Game server**: Deployed to Railway via Dockerfile (auto-deploys on push to main)
- **Database**: Railway managed PostgreSQL
- **Cache**: Railway managed Redis

### Environment Variables

**Vercel** (web app):
- `NEXTAUTH_URL`, `NEXTAUTH_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `NEXT_PUBLIC_SERVER_URL`

**Railway** (game server):
- `DATABASE_URL` (reference to Postgres), `REDIS_URL` (reference to Redis), `JWT_SECRET`, `WEB_URL`

## Adding a New Card Game

1. Create `packages/game-engine/src/games/<name>/<Name>Engine.ts` extending `GameEngine`
2. Implement: `deal()`, `isLegalMove()`, `getLegalMoves()`, `resolveTrick()`, `calculateRoundScores()`, `isGameOver()`, `getWinnerSeat()`
3. Add AI strategy in `packages/ai/src/games/<Name>AI.ts`
4. Add game type to `GameType` enum in `packages/shared-types/src/game.ts`
5. Add UI components in `apps/web/src/components/game/`
6. Register in `apps/server/src/services/GameService.ts`

## License

Private
