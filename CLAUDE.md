# CardArena — Playing Card Game Platform

Chess.com-inspired web and mobile platform for playing card games (Hearts, Spades, Euchre) against AI or friends.

## Quick Start

```bash
# Install dependencies
npm install

# Start Postgres + Redis (required for Phase 2+)
docker compose up -d

# Run all tests
npx turbo run test

# Build everything
npx turbo run build

# Dev mode — run in separate terminals:
cd apps/server && npm run dev    # Game server on :3001
cd apps/web && npm run dev       # Web app on :3000
```

## Monorepo Structure

```
packages/                   # All packages are pure TS — shared across web, mobile, and server
  shared-types/             # TypeScript interfaces — Card, GameState, socket events, API types
  shared-socket/            # Platform-agnostic Socket.io client wrapper (web + mobile)
  shared-store/             # Zustand stores — gameStore, lobbyStore (web + mobile)
  game-engine/              # Pure TS game logic — Card, Deck, StateMachine, GameEngine, HeartsEngine
  ai/                       # AI strategies — RandomStrategy, HeuristicStrategy, StrategyFactory
apps/
  server/                   # Fastify + Socket.io — GameService, gameRoom handlers, AIService
  web/                      # Next.js 15 — lobby, game board, scoreboard, Tailwind CSS
  mobile/                   # (planned) Expo React Native — shares all packages/ with web
```

## Tech Stack

- **Monorepo**: Turborepo with npm workspaces
- **Web**: Next.js 15 + React 19 + TypeScript + Tailwind CSS
- **State**: Zustand
- **Backend**: Fastify + Socket.io
- **Game Engine**: Pure TypeScript (shared between client and server)
- **Database**: PostgreSQL 16 + Drizzle ORM (Phase 2)
- **Cache**: Redis 7 (Phase 3)
- **Auth**: NextAuth.js v5 with Google/Facebook OAuth (Phase 2)
- **AI**: Custom strategies per difficulty (Random → Heuristic → Monte Carlo)
- **Ratings**: Glicko-2 (Phase 5)
- **Testing**: Vitest (game engine), Playwright (E2E)

## Architecture Principles

### Cross-Platform Strategy (Web + Mobile)
- **5 shared packages** (`shared-types`, `shared-socket`, `shared-store`, `game-engine`, `ai`) contain all business logic — zero DOM or platform-specific dependencies
- **Web app** (`apps/web`) imports shared packages + adds Next.js routing, Tailwind UI components
- **Mobile app** (`apps/mobile`) will import the same shared packages + add React Native UI components and Expo navigation
- **Only UI components are platform-specific** — game logic, state management, socket communication, and AI are identical across platforms
- Socket.io-client and Zustand both work natively in React Native — no polyfills needed
- When adding features, put logic in `packages/` and only put platform-specific rendering in `apps/`

### Game Engine
- Abstract `GameEngine` base class — each card game extends it (HeartsEngine, SpadesEngine, EuchreEngine)
- Embedded `StateMachine` enforces valid phase transitions: WAITING → DEALING → [PASSING|BIDDING] → PLAYING → TRICK_RESOLUTION → ROUND_SCORING → GAME_OVER
- `getVisibleState(seat)` returns personalized state that hides opponents' hands — **never expose other players' cards**
- Same engine package runs on server (authoritative) and client (optimistic validation)
- Event sourcing: all game actions stored as `GameEvent[]` for replay capability

### WebSocket Protocol
- Defined in `packages/shared-types/src/socket-events.ts` — single source of truth
- Client → Server: `game:play_card`, `game:pass_cards`, `game:bid`, `lobby:create_game`, `matchmaking:join`
- Server → Client: `game:state` (full visible state), `game:card_played`, `game:trick_complete`, `game:over`, `game:error`
- Server broadcasts personalized `game:state` to each player (each sees only their own hand)

### AI
- 4 difficulty tiers: Beginner (random), Intermediate (heuristic), Advanced (card counting), Expert (MCTS)
- AI runs server-side in `AIService` — clients can't distinguish AI from human players
- Bot personalities with names/avatars: "Dealer Danny", "Card Shark Sally", "Professor Pip", "The Oracle"
- AI moves have artificial delays (500-1200ms) to feel natural

### Adding a New Card Game
1. Create `packages/game-engine/src/games/<name>/<Name>Engine.ts` extending `GameEngine`
2. Implement: `deal()`, `isLegalMove()`, `getLegalMoves()`, `resolveTrick()`, `calculateRoundScores()`, `isGameOver()`, `getWinnerSeat()`
3. Define the state machine transitions for the game's phases
4. Add AI strategy in `packages/ai/src/games/<Name>AI.ts`
5. Add game type to `GameType` enum in `packages/shared-types/src/game.ts`
6. Add game-specific UI components in `apps/web/src/components/game/`

## UI/UX Guidelines

- **Chess.com inspired**: Dark theme (`#262421` background), clean felt-green game table, compact player badges
- **Card table**: CSS gradient green felt with inset shadow and dot texture
- **Player seats**: Compact badges showing avatar, name, tricks, score, card count — no card back images
- **Your hand**: Cards at bottom of table with hover lift, gold highlight on selection
- **Scoreboard**: Sidebar panel, your row highlighted in gold
- **Colors**: Gold (`#e8a63a`) for accents/your info, green (`#81b64c`) for actions/turn indicator, red for hearts/points

## Testing

```bash
# Run game engine tests (38 tests)
npx turbo run test --filter=@card-game/game-engine

# Build all packages
npx turbo run build
```

Game engine tests cover: Card utilities, Deck operations, StateMachine transitions, HeartsEngine (dealing, passing, playing, trick resolution, scoring, shoot the moon, game over, visible state, full game simulation).

## Roadmap Status

- [x] **Phase 1**: Foundation — Monorepo, shared types, game engine, HeartsEngine, AI, server, web UI
- [x] **Phase 2**: Infrastructure — PostgreSQL, Drizzle, NextAuth, game persistence, profiles
- [x] **Phase 3**: Social & Multiplayer — Redis, matchmaking, friends, invitations, chat
- [x] **Phase 4**: More Games — SpadesEngine, EuchreEngine
- [x] **Phase 5**: AI & Ratings — Advanced/Expert AI, Glicko-2, leaderboard
- [x] **Phase 6**: Polish & Mobile — UI overhaul, animations, Expo React Native mobile app

## Database

Schema defined in `apps/server/src/db/schema.ts` using Drizzle ORM. Migration at `apps/server/drizzle/0000_simple_the_professor.sql`.

Key tables: `users`, `ratings` (per game type, Glicko-2), `games`, `game_players` (includes AI seats), `game_events` (event sourcing), `friendships`, `invitations`, `rating_history` (daily snapshots for charts).

```bash
# Generate new migration after schema changes
cd apps/server && npm run db:generate

# Push schema to database (requires running Postgres)
cd apps/server && npm run db:push
```

## Auth

NextAuth v5 in `apps/web/src/lib/auth.ts` with Google OAuth provider. Login page at `/auth/login`. Server-side JWT verification in `apps/server/src/middleware/auth.ts` using `jose`. Socket.io auth middleware allows guest connections for AI-only games.

See the full plan at `.claude/plans/indexed-soaring-turing.md`.
