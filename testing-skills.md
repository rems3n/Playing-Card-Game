# CardArena — Testing Skills

Test plan and scripts for the CardArena platform. Organized by package/layer, from the most critical (game logic) to integration-level concerns.

---

## 1. Game Engine Tests (packages/game-engine)

**Status:** 62 existing tests across 6 files. These are the most important tests in the project.

### Existing Coverage
- `Card.test.ts` — Card creation, equality, sorting, string conversion
- `Deck.test.ts` — Deck creation, deterministic shuffle, dealing
- `StateMachine.test.ts` — Phase transitions, invalid transition rejection
- `HeartsEngine.test.ts` — 21 tests: dealing, passing, legal moves, trick resolution, shoot the moon, game over
- `SpadesEngine.test.ts` — 13 tests: bidding, nil bids, bag scoring, set penalties, partnerships
- `EuchreEngine.test.ts` — 11 tests: trump calling, bower ranking, march scoring, euchre penalties

### Gaps to Fill
- **Edge cases:** Hearts — Queen of Spades on first trick disallowed, hearts lead restriction
- **Edge cases:** Spades — blind nil, both teams reach 500 simultaneously
- **Edge cases:** Euchre — stick the dealer (forced pick), left bower suit membership
- **Stress test:** Run 100+ random full games per engine to catch rare state corruption

### Run
```bash
npx turbo run test --filter=@card-game/game-engine
```

---

## 2. AI Strategy Tests (packages/ai)

**Status:** No tests. High priority — AI drives most gameplay.

### Test Scripts

#### 2a. RandomStrategy
- Given legal moves, always returns one of them
- Given a hand, choosePassCards returns exactly `count` cards from the hand
- chooseBid returns a number >= 1

#### 2b. HeuristicStrategy (Hearts)
- When leading, prefers non-hearts, lowest rank
- When following suit, plays lowest card of that suit
- When void in lead suit, dumps Queen of Spades if held
- When void in lead suit and no QoS, dumps highest heart
- choosePassCards prioritizes hearts and high spades (Q, K, A)

#### 2c. HeuristicStrategy (Spades)
- spadesBid counts aces/kings and spades to estimate tricks
- spadesPlayCard trumps when void in lead suit

#### 2d. HeuristicStrategy (Euchre)
- shouldCallTrump returns true when hand has bowers + high trump
- chooseTrumpSuit picks the suit with most strength
- euchrePlayCard leads trump when strong, avoids wasting bowers

#### 2e. MonteCarloStrategy
- Returns a legal move (doesn't crash with valid state)
- With overwhelming advantage, picks the obvious winning card
- Runs within time budget (< 2s per decision)

### Run
```bash
npx turbo run test --filter=@card-game/ai
```

---

## 3. GameService Tests (apps/server — unit, no DB/Redis)

**Status:** No tests. High priority — orchestrates all game logic server-side.

### Test Scripts

#### 3a. Game Lifecycle
- createGame returns a valid UUID and stores the room
- createGame with each GameType (hearts, spades, euchre) succeeds
- createGame with unknown type throws

#### 3b. Player Management
- joinGame assigns sequential seats (0, 1, 2, 3)
- joinGame with same socketId returns existing seat (reconnect)
- joinGame on full game throws
- joinGame on nonexistent game throws
- fillWithAI fills remaining seats with AI players of correct difficulty
- fillWithAI bot names are from the personality pool

#### 3c. Game Actions
- playCard on valid turn succeeds and advances state
- playCard on wrong turn throws
- passCards with correct count succeeds (Hearts)
- placeBid with valid number succeeds (Spades)
- callTrump with valid suit succeeds (Euchre)

#### 3d. AI Turn Execution
- executeAITurns plays cards for all consecutive AI seats
- executeAITurns stops when reaching a human player's turn
- AI callback fires for each card played

### Run
```bash
cd apps/server && npx vitest run src/__tests__/GameService.test.ts
```

---

## 4. Server API Route Tests (apps/server — integration)

**Status:** No tests. Medium priority.

### Test Scripts

#### 4a. User Sync & Profile (`/api/users/*`)
- POST /api/users/sync creates new user on first call
- POST /api/users/sync updates displayName/avatarUrl on subsequent calls
- POST /api/users/sync with conflicting email updates existing row
- GET /api/users/me returns profile with ratings and stats
- GET /api/users/me with missing email returns 400
- PATCH /api/users/me updates displayName
- PATCH /api/users/me rejects duplicate username with 409
- PATCH /api/users/me accepts valid username
- GET /api/users/check-username returns available: true for unused name
- GET /api/users/check-username returns available: false for taken name
- GET /api/users/check-username rejects invalid format

#### 4b. Friends (`/api/friends/*`)
- POST /api/friends/request creates pending friendship
- POST /api/friends/request to self fails
- POST /api/friends/respond accept updates status
- GET /api/friends returns accepted friends
- DELETE /api/friends/:id removes friendship

#### 4c. Leaderboard (`/api/leaderboard`)
- Returns users sorted by rating descending
- Respects limit parameter
- Returns correct rank for queried user

#### 4d. Rating History (`/api/ratings/history`)
- Returns daily snapshots within date range
- Returns empty array for new user

### Prerequisites
These tests require a test database. Use:
```bash
docker compose up -d
DATABASE_URL=postgres://... npx vitest run
```

---

## 5. Socket/Real-time Tests (apps/server)

**Status:** No tests. Medium priority.

### Test Scripts

#### 5a. Game Room Flow
- lobby:create_game creates game, joins player, fills AI, starts game
- lobby:create_game emits game:state to the creating player
- game:play_card broadcasts updated state to all players in room
- game:play_card with illegal move emits game:error
- AI turns fire after human plays with delays

#### 5b. Matchmaking
- matchmaking:join adds player to queue
- matchmaking:cancel removes from queue
- When enough players queued, matchmaking:found fires for all

#### 5c. Chat
- chat:message broadcasts to game room only

### Approach
Use `socket.io-client` in tests connecting to a test server instance.

---

## 6. Shared Store Tests (packages/shared-store)

**Status:** No tests. Lower priority (thin Zustand wrappers).

### Test Scripts
- gameStore: setGameState updates state, toggleCardSelection adds/removes cards
- lobbyStore: set/clear game list
- settingsStore: setTableColor persists selection

---

## 7. Rating System Tests (apps/server — unit)

**Status:** No tests. Medium priority — math-heavy.

### Test Scripts
- Equal-rated players: winner gains, loser loses roughly equal amounts
- High RD (provisional) player: rating changes more dramatically
- Low RD (established) player: rating changes less
- FFA decomposition (Hearts): 4 players generate 6 virtual matchups
- Team decomposition (Spades/Euchre): winning team beats losing team
- Rating never goes below 0 or above a sane ceiling
- Volatility decreases as more games are played

---

## 8. End-to-End Smoke Tests

### Manual Checklist
1. [ ] Sign in with Google OAuth
2. [ ] Create a Hearts game vs AI — play through to completion
3. [ ] Verify scores update on profile page
4. [ ] Create a Spades game — bid and play a full round
5. [ ] Create a Euchre game — call trump and play to completion
6. [ ] Check leaderboard shows updated ratings
7. [ ] Set username on profile — verify uniqueness check works
8. [ ] Open Games & Rules page — click each game, verify modal opens
9. [ ] During a game, click the Rules help button — verify correct game rules show
10. [ ] Sign out and sign in with a second account — verify correct profile loads

---

## Priority Order for Implementation

| Priority | Area | Why |
|----------|------|-----|
| **P0** | AI Strategy tests | AI plays every game, zero coverage today |
| **P0** | GameService unit tests | Orchestrates all gameplay, zero coverage |
| **P1** | Game engine edge cases | Existing tests miss important edge cases |
| **P1** | Rating system unit tests | Math errors silently corrupt all ratings |
| **P2** | API route tests | Requires DB setup, lower risk |
| **P2** | Socket integration tests | Complex setup, covered by manual testing |
| **P3** | Shared store tests | Thin wrappers, low risk |

---

## Running All Tests

```bash
# All packages
npm test

# Specific package
npx turbo run test --filter=@card-game/game-engine
npx turbo run test --filter=@card-game/ai

# Watch mode (during development)
cd packages/game-engine && npx vitest
cd packages/ai && npx vitest

# With coverage
cd packages/game-engine && npx vitest run --coverage
```
