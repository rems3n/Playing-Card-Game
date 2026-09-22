# CardArena redevelopment

## Decisions

- **Games:** Seven-Six (7/6) and **Auction 45s** at 2, 4 or 6 seats, bidding
  15/20/25/30. This supersedes the earlier decision to ship the Euchre engine as a
  stand-in: that engine, its AI and its tests have been removed, and 45s is
  implemented from the rules in [FORTY-FIVES.md](FORTY-FIVES.md). The game key is
  `forty-fives`; the retired `euchre` key survives only in old stored records.
- **Hosting:** Railway for web, game server, Postgres, and Redis. See [deployment
  instructions](RAILWAY.md). Start with one authoritative server replica.
- **First audience:** invited family and friends, with basic solo bots. Ship a
  responsive website first; follow with installable web support, then Expo parity.
- **Progression:** casual results and a private family scoreboard first. Advanced
  AI, ranked matchmaking, calibrated ratings, and public discovery come later.
- **Architecture:** retain the monorepo, TypeScript engines, Next.js, Fastify,
  Socket.IO, Drizzle/Postgres, and Redis. Repair the contracts and replace weak UI
  areas incrementally. There is no need for a framework rewrite.

## This first implementation slice

The branch begins redevelopment and is **not a production-ready release**.

| Area | Implemented here | Still required |
| --- | --- | --- |
| 45s rules | 52-card deal, colour-dependent ranking with the 5/jack/A♥ trumps, reneging, the auction with the dealer's hold and stuck dealer, bid-or-lose scoring to 45, at 2/4/6 seats | Bot bidding calibration; a per-hand scoring breakdown in the interface |
| Seven-Six | Reject fractional/non-finite bids and unsupported player counts; full 13-round tests at 2, 4, and 7 seats | Public legal-bid projection; structured round results and score history |
| Basic bots | One in-flight scheduler per game; continue across bidding/round boundaries; legal 45s bidding and trump naming; cancel stale delayed core actions | Atomic command processing, durable scheduler wake-up, browser recovery tests |
| Lobby | Personalized host identity; repeated full-room join works; start request deduplication and retry; listener cleanup no longer leaves the room during React effect cleanup | Stable guest identity, reconnect leases, persistent waiting rooms, atomic lifecycle |
| Membership | Reject strangers entering active games; reject outsider end/replace commands; require a disconnected replacement target | Verified identities and per-command authorization across all endpoints |
| Discovery | Both family games and their rules are reachable; expose Beginner/Casual bots only | New home, table, results, and navigation designs |
| Railway | Standalone Next build, separate Docker/config files, health endpoint, lockfile-based installs, CI workflow | Staging deployment, real infrastructure checks, cutover |

Regression tests cover complete games, concurrent bot scheduling, single restoration
of an engine, stale delayed actions, lobby ownership with duplicate names, duplicate
start requests, failure/retry, and outsider commands. They use in-memory persistence
and transport where appropriate. They do not prove real Redis/Postgres durability,
OAuth correctness, mobile usability, or browser reconnect behavior.

## Delivery sequence

Each milestone should land as a focused PR with its acceptance evidence. The next
implementation work is M1. M0 establishes a usable test/build gate for that work.

### M0 — Rules and delivery foundation (this branch)

- [x] Expose both family games. (The Euchre stand-in was later replaced by 45s.)
- [x] Fix confirmed trick counting and bidding defects.
- [x] Test bot progression through complete games and concurrent requests.
- [x] Fix immediate lobby host/join/start defects.
- [x] Prepare Railway web/server packaging and CI.
- [ ] Run Docker images and cross-service checks in Railway staging.

### M1 — Stable identity and authoritative commands (next)

**Problem:** the socket handshake currently trusts caller-supplied email; account
routes also trust email parameters. Some paths use an email where Postgres requires
a user UUID. Guests cannot reliably reclaim their seat after reconnecting.

Implement a backend-verified session exchange from Auth.js. The server resolves
provider identity to the canonical `users.id` UUID and issues a short-lived game/API
credential with explicit issuer, audience, expiration, and subject validation.
Use a separate server-issued anonymous participant identity with a protected resume
credential for guests. A participant ID, socket ID, display name, and account ID are
different concepts; model them separately. Browser and native clients share the
identity protocol; native secure storage and login need their own integration.

Replace direct email authorization in socket auth, profile, friends, history, and
uploads. Derive the acting user from verified credentials. Centralize the browser
socket lifecycle, refresh credentials on reconnect, and handle login/logout changes.
Guests remain guests until an explicit, verified account association occurs.

Introduce runtime schemas for all commands and game configs. Commands carry
`commandId`, `gameId`, and `expectedVersion`; responses acknowledge accepted/rejected
actions with a reason and resulting version. A per-game queue serializes human and
bot mutations. Persist the accepted transition before broadcasting it. Duplicate
commands return the original outcome. Reject stale or unauthorized actions without
mutating state. Snapshot schema and ruleset versions are explicit.

**Acceptance:** forged email cannot take a seat or modify a profile; two people with
the same name stay distinct; refreshing a guest page restores their seat; duplicate
plays affect the game once; stale tabs cannot play; account switching clears access;
all negative tests leave state unchanged. Legacy insecure clients receive a clear
upgrade/reconnect error, not a silent insecure fallback.

### M2 — Durable rooms and reconnects

Extract the large socket handler into command handlers and a room service. Persist
room code, host participant, seat assignments, rules/config, state version, status,
and reconnect deadlines. Persist one `gameId` when a room starts, atomically, so
repeated requests and a restart cannot create separate games for the same group.

Model `waiting → starting → playing → completed/abandoned` explicitly. Invitations
use a code/link; code lookup returns distinct full, expired, and started states.
Treat temporary loss of connection as a lease, with a proposed 90-second reconnect
window. Retain the seat during that window, show the countdown, and transfer the
host only after explicit departure or expiry. Define a single active seat per
participant and a deliberate takeover policy for another tab/device.

Make **Leave table** explicit. Navigation and an interrupted mobile connection must
not accidentally abandon the game. After lease expiry, remaining players may
continue with a bot or end the game. Preserve the original participant identity and
record the bot takeover for results. A bot never silently erases an account's score.
Rematch returns the same group to a room with the same settings and fresh readiness.

**Acceptance:** host and guest refreshes, phone backgrounding, duplicate Start,
join/start races, host departure, expired links, server restart, and reconnect after
bot takeover all have tested outcomes. No stranded spinners or orphaned games.

### M3 — Reliable scores and history

Add structured round results with bids, tricks, awarded points, running totals,
ruleset version, and participants. Store final game, seats, rounds, and event sequence
in one Postgres transaction with uniqueness on game/round/sequence as appropriate.
Make finalization idempotent and retryable; surface pending/retrying saves instead of
swallowing a database failure. Persist abandoned games distinctly from completed ones.

Fix Seven-Six placements as individual high-score results; 45s uses team results.
Record ties explicitly. Preserve guest names in historical results without inventing
account UUIDs. Build the recent-games page from real records. The first scoreboard
shows family wins, games played, and per-game totals with understandable definitions.
Do not mix incompatible game scores into one ranking. Defer rating updates until the
identity and placement models are correct and rated play is explicitly selected.

**Acceptance:** retrying completion ten times creates one result; a failed write
leaves no partial result and can recover; a restart shows the same scorecard;
Seven-Six ties and 45s partnerships display correctly; abandoned games don't
award a win; history is restricted to the intended viewers.

### M4 — Responsive redesign and teaching

Translate the useful chess.com patterns into a family card experience: a clear main
action, easy invitations, stable board orientation, visible turn state, available
actions highlighted, contextual help, and an understandable result/rematch loop.
Use the board as the visual focus and progressively reveal settings.

| Screen | Required design |
| --- | --- |
| Home | Two game tiles; **Play with family**, **Join a game**, **Practice**; resume an unfinished table; rules nearby |
| Create | Friendly defaults; names, seats/partners, rules summary; advanced options collapsed |
| Room | Invite link/code, identifiable host, your seat, human/bot occupants, connection status, ready/start state, explicit Leave |
| Table | Your hand anchored at the bottom; opponents around the table; persistent trump, bid, turn, and round labels; one primary action |
| Scores | Per-round bid/tricks/points and running totals; team grouping for 45s; drawer on phones, side panel on wide screens |
| Results | Winners/ties, why points were awarded, save state, **Rematch with this group**, **Back home** |
| Rules | Concise overview plus examples; in-game help explains why a particular move is unavailable |

Replace the fixed sidebar and fixed-width table/score combination. Design at 360,
390, 768, and 1280 CSS pixels, including phone landscape and safe-area insets.
Use a deliberate card-hand layout: readable rank/suit corners, consistent hit areas,
controlled fan/scroll on phones, selected-card elevation, and no ambiguous overlap
with action buttons or other seats. Never shrink the entire interface to fit.

Use tap-to-select and a clear Play action on touch; make the desktop fast-play option
explicit. Keep local seat orientation consistent. Make legal moves clear without
depending only on color; explain rejection beside the action. Provide keyboard
navigation, visible focus, screen-reader card labels, reduced motion, and at least
44px touch targets. Avoid modal overload and raw server error strings.

The first visual deliverable should be a working home → room → table → result flow,
using real state and empty/error/reconnect states, reviewed at phone and desktop sizes.

**Acceptance:** no horizontal page overflow, obscured controls, or unreadable cards
at target sizes and 200% zoom; first-time family testers join and play without spoken
instructions; accessibility and touch/keyboard flows are checked in real browsers.

### M5 — Family beta and operational readiness

Deploy staging using the Railway instructions. Add dependency readiness, structured
logs keyed by game/command (no private hands or tokens), error reporting, monitoring
for stalled turns/save failures, and an administrator recovery path. Plan schema
migrations and rollback before production. Configure Postgres backups and demonstrate
a restore. Document Redis snapshot expiry and how interrupted games resume.

Run browser tests with multiple isolated users for complete 7/6 and 45s games,
disconnect/reconnect, leave, restart, scoreboard, and rematch. Include iOS Safari and
Android Chrome on actual devices. Define a target beta capacity (initially 10
simultaneous private tables) and load-test that target with gameplay, not just sockets.

**Release gate:** all preceding acceptance criteria pass; no known identity, lost
score, illegal-move, stuck-turn, or data-loss blockers; a family group completes
several sessions from invitation to rematch; rollback and restore are documented.
Only then move the family-facing URL to the new Railway deployment.

### M6 — Mobile distribution and richer AI

Add an installable web manifest and app icons after the responsive experience works.
Do not cache private game state or pretend live multiplayer works offline. Bring
Expo to feature parity using the same protocol, rules, and state contracts; test
background/resume, deep links, native secure identity storage, and touch tables before
store distribution. Railway hosts the backend/web services, not native app-store builds.

Keep Beginner/Casual bots legal and responsive during beta. Later build clearly
distinct strengths using imperfect-information evaluation with seeded tournaments,
measured win rates, compute budgets, and reproducible decision logs. Bots receive
only the same visible information as a human. Stronger levels need evidence of
different performance; do not relabel identical strategies as advanced difficulty.

## Migration boundaries

Preserve existing user and game records. Games stored under the retired `euchre`
key are left as they are: the column is a varchar, so they load, and the history
page shows the stored key rather than inventing a label for a game the app no
longer plays. Introduce versioned snapshots and an explicit compatibility policy
before changing identity or persistence formats. Schedule a clean table boundary
for incompatible updates rather than trying to interpret old incomplete snapshots.
Add schema before deploying readers/writers that depend on it; remove old paths in
a later release. Never use live family data as a test fixture.
