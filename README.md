# CardArena

Chess.com-inspired web and mobile platform for playing card games online.

**Live at: [cardarena.vercel.app](https://cardarena.vercel.app)**

Redevelopment is underway for **7/6 and 45s / Euchre**, using the existing Euchre
rules as the baseline. The new hosting target is Railway for both web and server;
the live website has not been migrated. See the [redevelopment backlog](docs/REDEVELOPMENT.md),
the [Railway deployment guide](docs/RAILWAY.md), the [QA and defect review](docs/FAMILY-GAME-QA.md)
the [live audio and video notes](docs/MEDIA.md), the
[invitation notes](docs/INVITES.md) and the
[45s versus Euchre audit](docs/FORTY-FIVES.md). Identity, reconnects, durable rooms,
score storage, and the responsive redesign remain release blockers.

## Existing features (being rebuilt)

- **Family Games** — Seven-Six and 45s / Euchre are selectable; Hearts, Spades, and Rummy engines are also present
- **AI Opponents** — Beginner and Casual in the web selector; stronger calibrated levels are future work
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
| Media | Optional WebRTC through an SFU behind a provider abstraction (LiveKit); off unless configured |
| Testing | Vitest, plus a Chromium phone-viewport suite (`npm run qa:mobile` in `apps/web`) |
| Hosting | Railway target for web, server, Postgres, Redis; existing web deployment remains on Vercel |

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
# Every workspace
npm test

# Database and Redis durability (needs both running)
RUN_DURABILITY_TESTS=1 npm run test --workspace=@card-game/server -- \
  src/__tests__/Durability.integration.test.ts

# Phone viewports against a running local stack (Chromium, real layout)
cd apps/web && npm run qa:mobile

# Build all packages
npx turbo run build
```

See [apps/web/qa/README.md](apps/web/qa/README.md) for what the viewport suite
checks and what still needs a physical device.

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
