# CardArena — Playing Card Game Platform

Chess.com-inspired web and mobile platform for playing card games (Hearts, Spades, Euchre) against AI or friends.

**Production**: https://cardarena.vercel.app
**Server**: https://playing-card-game-production.up.railway.app

## Quick Start

```bash
npm install
docker compose up -d                      # Postgres + Redis
cd apps/server && npm run db:push         # Push schema
cd apps/server && npm run dev             # Server on :3001
cd apps/web && npm run dev                # Web app on :3000
```

## Monorepo Structure

```
packages/                   # Pure TS — shared across web, mobile, and server
  shared-types/             # TypeScript interfaces (Card, GameState, socket events, API types)
  shared-socket/            # Platform-agnostic Socket.io client wrapper (web + mobile)
  shared-store/             # Zustand stores — gameStore, lobbyStore, settingsStore (web + mobile)
  game-engine/              # Game logic — Card, Deck, StateMachine, HeartsEngine, SpadesEngine, EuchreEngine
  ai/                       # AI strategies — RandomStrategy, HeuristicStrategy, MonteCarloStrategy
apps/
  server/                   # Fastify + Socket.io — GameService, gameRoom, matchmaking, ratings, friends
  web/                      # Next.js 15 — lobby, game board, profile, leaderboard, settings
  mobile/                   # Expo React Native — scaffold with lobby + game screens
```

## Tech Stack

- **Monorepo**: Turborepo with npm workspaces
- **Web**: Next.js 15 + React 19 + TypeScript + Tailwind CSS
- **Mobile**: Expo React Native (shares all packages/ with web)
- **State**: Zustand (shared-store package, works in web + React Native)
- **Backend**: Fastify + Socket.io
- **Game Engine**: Pure TypeScript (shared between client and server)
- **Database**: PostgreSQL 16 + Drizzle ORM
- **Cache**: Redis 7 (presence, matchmaking queues)
- **Auth**: NextAuth.js v5 with Google OAuth
- **AI**: Custom per-game strategies (Random, Heuristic, Monte Carlo)
- **Ratings**: Glicko-2 with pairwise decomposition for multiplayer
- **Testing**: Vitest (62 tests across 6 test files)
- **Hosting**: Vercel (web) + Railway (server, Postgres, Redis)

## Architecture Principles

### Cross-Platform Strategy (Web + Mobile)
- **5 shared packages** contain all business logic — zero DOM or platform-specific dependencies
- Web app adds Next.js routing + Tailwind components; mobile adds React Native components + Expo navigation
- Only UI components are platform-specific — game logic, state, sockets, AI are identical across platforms
- When adding features, put logic in `packages/` and only put rendering in `apps/`

### Game Engine
- Abstract `GameEngine` base class — each card game extends it
- Embedded `StateMachine` enforces valid phase transitions: WAITING → DEALING → [PASSING|BIDDING] → PLAYING → TRICK_RESOLUTION → ROUND_SCORING → GAME_OVER
- `getVisibleState(seat)` returns personalized state — **never expose other players' cards**
- Same engine runs on server (authoritative) and client (optimistic validation)
- Event sourcing: all game actions stored as `GameEvent[]` for replay

### WebSocket Protocol
- Defined in `packages/shared-types/src/socket-events.ts` — single source of truth
- Client → Server: `game:play_card`, `game:pass_cards`, `game:bid`, `game:call_trump`, `lobby:create_game`, `matchmaking:join`, `chat:message`
- Server → Client: `game:state`, `game:card_played`, `game:trick_complete`, `game:over`, `game:error`, `matchmaking:found`
- Server broadcasts personalized `game:state` to each player after every action
- AI card plays broadcast individually with 1.5-2.5s delays; 2.5s pause after each completed trick

### AI
- 4 difficulty tiers: Beginner (random), Intermediate (heuristic), Advanced (heuristic+), Expert (Monte Carlo)
- AI runs server-side — clients can't distinguish AI from human players
- Bot personalities: Dealer Danny (😎), Lucky Lucy (🤩), Card Shark Sally (🦊), Steady Steve (🧐), Professor Pip (🎩), The Oracle (🔮)
- Per-game AI: SpadesAI (bid counting, trump management), EuchreAI (trump evaluation, bower awareness)

### Ratings
- Glicko-2 with pairwise decomposition for FFA games (Hearts: 4-player → 6 virtual 1v1 matchups)
- Team-based for partnerships (Spades/Euchre: winning team beats losing team)
- Daily rating snapshots for history charts on profile page
- Ratings update automatically after every completed game

### Adding a New Card Game
1. Create `packages/game-engine/src/games/<name>/<Name>Engine.ts` extending `GameEngine`
2. Implement: `deal()`, `isLegalMove()`, `getLegalMoves()`, `resolveTrick()`, `calculateRoundScores()`, `isGameOver()`, `getWinnerSeat()`
3. Define state machine transitions for the game's phases
4. Add AI strategy in `packages/ai/src/games/<Name>AI.ts`
5. Add game type to `GameType` enum in `packages/shared-types/src/game.ts`
6. Add game-specific UI components in `apps/web/src/components/game/`
7. Register in `apps/server/src/services/GameService.ts`

## UI/UX Guidelines

- **Layout**: Left sidebar navigation (208px), full-height game table + right sidebar
- **Theme**: Dark (`#262421` bg), navy blue default card table (configurable via Settings)
- **Text contrast**: White (`#fff`) primary, `#c4c0bc` secondary, `#8a8682` muted
- **Cards**: Off-white (`#f7f6f5`) face, `#c33` red suits, `#1a1a1a` black suits
- **Player seats**: Compact badges with emoji avatars for bots, max-w-220px, truncated names
- **Scoreboard**: Right sidebar, tabular-nums scores, your row highlighted in gold
- **Chat**: Off-white (`#f0ede8`) background contrasting the dark sidebar
- **Animations**: 0.5s card-play with spring curve, 2.5s trick pause

## Testing

```bash
npx turbo run test --filter=@card-game/game-engine   # 62 tests
npx turbo run build                                    # Build all packages
```

Tests cover: Card utilities, Deck operations, StateMachine transitions, HeartsEngine (21 tests), SpadesEngine (13 tests), EuchreEngine (11 tests) — including bidding, trick resolution, scoring, nil bids, bower logic, full game simulations.

## Database

Schema: `apps/server/src/db/schema.ts` (Drizzle ORM)
Tables: `users` (with username), `ratings`, `games`, `game_players`, `game_events`, `friendships`, `invitations`, `rating_history`

```bash
cd apps/server && npm run db:generate    # Generate migration after schema changes
cd apps/server && npm run db:push        # Push schema to database
cd apps/server && npm run db:studio      # Browse database
```

## Deployment

### Vercel (Web App)
```bash
vercel --prod --yes
```
Env vars: `NEXTAUTH_URL`, `NEXTAUTH_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `NEXT_PUBLIC_SERVER_URL`

### Railway (Game Server)
Auto-deploys on push to `main` via Dockerfile. Env vars: `DATABASE_URL` (Postgres ref), `REDIS_URL` (Redis ref), `JWT_SECRET`, `WEB_URL`

### Google OAuth
Console: https://console.cloud.google.com/apis/credentials
Authorized origins: `http://localhost:3000`, `https://cardarena.vercel.app`
Authorized redirects: `http://localhost:3000/api/auth/callback/google`, `https://cardarena.vercel.app/api/auth/callback/google`
