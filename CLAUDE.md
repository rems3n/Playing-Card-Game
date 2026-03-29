# CardArena — Playing Card Game Platform

Chess.com-inspired web and mobile platform for playing card games (Hearts, Spades, Euchre, Rummy) against AI or friends.

**Production**: https://cardarena.vercel.app
**Server**: https://playing-card-game-production.up.railway.app

## Quick Start

```bash
npm install
docker compose up -d                      # Postgres + Redis
cd apps/server && npm run db:push         # Push schema
cd apps/server && npm run dev             # Server on :3001 (auto-reloads)
cd apps/web && npm run dev                # Web app on :3000 (auto-reloads)
```

Test locally at http://localhost:3000. Both servers hot-reload on file changes.

## Monorepo Structure

```
packages/                   # Pure TS — shared across web, mobile, and server
  shared-types/             # TypeScript interfaces (Card, GameState, socket events, API types)
  shared-socket/            # Platform-agnostic Socket.io client wrapper (web + mobile)
  shared-store/             # Zustand stores — gameStore, lobbyStore, settingsStore (web + mobile)
  game-engine/              # Game logic — Card, Deck, StateMachine, HeartsEngine, SpadesEngine, EuchreEngine, RummyEngine
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
- **State**: Zustand (shared-store package, persisted settings via localStorage)
- **Backend**: Fastify + Socket.io
- **Game Engine**: Pure TypeScript (shared between client and server, serializable for Redis)
- **Database**: PostgreSQL 16 + Drizzle ORM
- **Cache**: Redis 7 (game state persistence, presence, matchmaking queues)
- **Auth**: NextAuth.js v5 with Google OAuth
- **AI**: Custom per-game strategies (Random, Heuristic, Monte Carlo)
- **Ratings**: Glicko-2 with pairwise decomposition for multiplayer
- **Testing**: Vitest (62 tests across 6 test files)
- **Hosting**: Vercel (web) + Railway (server, Postgres, Redis)

## Architecture Principles

### Data Persistence (Production-Safe)
- **Game state** → Redis with 4-hour TTL. Survives server restarts and deploys. Serialized via `GameEngine.serialize()/restore()`.
- **User profiles, ratings, game history** → PostgreSQL (permanent)
- **Avatar photos** → base64 data URLs stored in PostgreSQL `avatar_url` column (permanent, no filesystem dependency)
- **Settings** → localStorage in browser via Zustand `persist` middleware
- **Matchmaking queues, presence** → Redis
- **Never store user data on the filesystem** — Railway's filesystem is ephemeral

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
- `serialize()/restore()` for Redis persistence — HeartsEngine saves pendingPasses, EuchreEngine saves maker/bower/trump state, RummyEngine saves drawPile/discardPile/playerMelds
- Event sourcing: all game actions stored as `GameEvent[]` for replay

### WebSocket Protocol
- Defined in `packages/shared-types/src/socket-events.ts` — single source of truth
- Client → Server: `game:play_card`, `game:pass_cards`, `game:bid`, `game:call_trump`, `lobby:create_game`, `matchmaking:join`, `matchmaking:accept`, `matchmaking:decline`, `room:create`, `room:join`, `room:start`, `chat:message`
- Server → Client: `game:state`, `game:card_played`, `game:trick_complete`, `game:over`, `game:error`, `matchmaking:proposed`, `matchmaking:found`, `room:update`, `room:started`
- Server broadcasts personalized `game:state` to each player after every action
- AI card plays broadcast individually with 1.5-2.5s delays; 2.5s pause after each completed trick

### Multiplayer Flow
- **Create Room** → host gets room code, shares link, others join, host starts when ready
- **Quick Match** → join queue, 2+ players triggers a match proposal, all must accept (15s timer), AI fills remaining seats
- **Disconnect handling** → 30s reconnect window with countdown, then "Continue with AI" or "End Game" choice
- **Game state in Redis** → games resume after server restart when players reconnect

### AI
- 4 difficulty tiers: Beginner (random), Intermediate (heuristic), Advanced (heuristic+), Expert (Monte Carlo)
- AI runs server-side — clients can't distinguish AI from human players
- Bot personalities: Dealer Danny (😎), Lucky Lucy (🤩), Card Shark Sally (🦊), Steady Steve (🧐), Professor Pip (🎩), The Oracle (🔮)
- Per-game AI: SpadesAI (bid counting, trump management), EuchreAI (trump evaluation, bower awareness), RummyAI (meld finding, draw/discard heuristics)

### Ratings
- Glicko-2 with pairwise decomposition for FFA games (Hearts: 4-player → 6 virtual 1v1 matchups)
- Team-based for partnerships (Spades/Euchre: winning team beats losing team)
- Daily rating snapshots for history charts on profile page
- Ratings update automatically after every completed game

### Adding a New Card Game
1. Create `packages/game-engine/src/games/<name>/<Name>Engine.ts` extending `GameEngine`
2. Implement: `deal()`, `isLegalMove()`, `getLegalMoves()`, `resolveTrick()`, `calculateRoundScores()`, `isGameOver()`, `getWinnerSeat()`
3. Add `serialize()/restore()` overrides for any extra state
4. Add AI strategy in `packages/ai/src/games/<Name>AI.ts`
5. Add game type to `GameType` enum in `packages/shared-types/src/game.ts`
6. Add UI components in `apps/web/src/components/game/`
7. Register in `apps/server/src/services/GameService.ts`

## UI/UX Guidelines

- **Layout**: Left sidebar navigation (208px), full-height game table + right sidebar
- **Theme**: Dark (`#262421` bg), configurable table color (Navy default, 6 options)
- **Text contrast**: White (`#fff`) primary, `#c4c0bc` secondary, `#8a8682` muted
- **Cards**: Off-white (`#f7f6f5`) face, `#c33` red suits, `#1a1a1a` black suits. Scale with screen via ResizeObserver (0.7x–1.6x).
- **Card selection**: Lifts 18px + 112% scale with gold border and glow
- **Opponent cards**: Face-down overlapping row showing actual card count, same size as hand cards
- **Card backs**: 6 designs (Classic Blue, Royal Red, Forest Green, Gold & Black, Purple Velvet, Midnight) with SVG patterns
- **Animations**: Directional card-play (0.6s from player's direction), 2.5s trick pause
- **Bidding**: Overlay on table with dark backdrop (doesn't push layout)
- **Card dimming**: Only dim illegal cards when it's your turn. Bright during bidding/waiting/passing.
- **Settings persist**: Table color + card back stored in localStorage

## Testing

```bash
npx turbo run test --filter=@card-game/game-engine   # 62 tests
npx turbo run build                                    # Build all packages
```

Tests cover: Card utilities, Deck operations, StateMachine transitions, HeartsEngine (21 tests), SpadesEngine (13 tests), EuchreEngine (11 tests).

Note: Server integration tests (`GameService.test.ts`) were removed during the Redis persistence refactor — they need Redis mocking to work with the async API.

## Database

Schema: `apps/server/src/db/schema.ts` (Drizzle ORM)
Tables: `users` (with username, base64 avatar), `ratings`, `games`, `game_players`, `game_events`, `friendships`, `invitations`, `rating_history`

```bash
cd apps/server && npm run db:generate    # Generate migration after schema changes
cd apps/server && npm run db:push        # Push schema to database
cd apps/server && npm run db:studio      # Browse database
```

**Important**: When pushing schema changes to production Railway Postgres, use the public URL:
```bash
DATABASE_URL="postgresql://postgres:PASSWORD@crossover.proxy.rlwy.net:PORT/railway" npx drizzle-kit push
```

## Deployment

### Local Testing (fast iteration)
Both servers hot-reload. Test at http://localhost:3000. Only deploy when happy with changes.

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

## Known Issues / TODO
- Server integration tests need Redis mock for async GameService API
- Poker shown as "Coming Soon" in lobby — engine not implemented yet
- Mobile app is scaffold only — needs full game UI screens
- File upload route still exists but unused (photos are base64 now)
- Google profile photo used as fallback if no custom avatar set
