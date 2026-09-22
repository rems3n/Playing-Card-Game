# Family play redesign

The foundation PR (#1) is merged. This change advances the next release; it is
not a claim that the app has passed production acceptance.

## What changed

- Responsive cream-and-green home with game selection, private invites, practice,
  and guest names. No game search or public matchmaking in the primary flow.
- Responsive waiting room with visible host/seat/team assignments, invite copying,
  errors, and bounded start progress.
- The family table uses readable, non-overlapping card rows instead of a scaled
  desktop canvas. Select a legal card, then confirm with Play. Bidding leaves the
  hand visible. Scoreboard, rules, disconnect notices, results, and chat remain
  available on small screens. Native dialogs handle keyboard focus and Escape.
- Saved history for guests and accounts, including participant names and team
  scores. Winning partners and equal high scores appear together in results.
- Server-issued signed guest sessions and a short-lived signed OAuth exchange.
  Account endpoints derive identity from the token, never a caller-supplied email.
  Guest IDs are stored locally; sharing a name does not grant a seat.
- Redis waiting rooms, per-room command serialization, stable guest seat recovery,
  and saved room-to-game routing. Disconnected waiting-room seats are held for
  90 seconds; the next connected person becomes host after expiry or explicit leave.
- Completed game, players, and events save in one PostgreSQL transaction. Concurrent
  retries use the game ID as an idempotency key. The client distinguishes saved and
  unsaved results and can retry. Casual games no longer change ranked ratings.
- Additive participant-history migration and a compiled production migrator.
  Production secrets are required; both images run as the unprivileged node user.
- Updated the web runtime to Next.js 16.3.5 and Auth.js beta.32; updated server
  dependencies and removed the unused auth adapter. The web/server production
  dependency audit is enforced in CI. Native-mobile/dev-tool findings are a
  separate upgrade track.
- Native mobile socket authentication now uses a persisted signed guest token.
  The full native mobile interface is not redesigned in this change.

## Validation

Local checks cover engine rules, bot progression, signed-session forgery/expiry,
account-only authorization, guest seat restoration, lobby ownership, repeated
starts, and host transfer. CI additionally provisions disposable Postgres and Redis,
applies migrations, forces a mid-save database failure, verifies rollback and
concurrent retry, verifies private history access, and restores rooms/seats from Redis.
CI builds both Railway Docker images. The expanded suite includes 160 seeded complete
family games, real Socket.IO mixed-player games, trick presentation/restoration,
and web interaction regressions. See [FAMILY-GAME-QA.md](FAMILY-GAME-QA.md).
The database/Redis tests require the CI service containers.

The isolated Railway preview is deployed at https://cardarena-web-production.up.railway.app/.
Initial live desktop checks passed for room creation/exit, refresh, and both games.
User testing identified bidding and trick-presentation defects; their fixes and
expanded coverage are documented in the QA report. Real-device acceptance remains
required. Do not infer visual QA from a successful Next.js build.

## This pass

- A repeatable phone-viewport suite (`apps/web/qa/mobile-layout.mjs`) plays a
  complete Seven-Six hand in Chromium at 320x568, 390x664, 430x780, 844x390 and
  390x540 and fails on page scrolling, controls outside the viewport, controls
  cut off by a clipping ancestor, overlapping hand cards, touch targets under
  44px, and flow breaks. It found eight defects that are now fixed; see
  [FAMILY-GAME-QA.md](FAMILY-GAME-QA.md) for the measurements.
- Seven-Six no longer preselects a bid. Submit is disabled until a number is
  chosen, so a mis-tap cannot place a bid nobody picked.
- 76 new seeded engine tests cover bidding turn order, bid validation, the
  dealer restriction, trump reservation across all 13 rounds, trick winners
  against an independent calculation, dealer rotation, running totals and
  restore equality, for every seat count from two to seven.
- Eleven new socket tests cover a player leaving during bidding, during a trick
  and during round scoring; several clients agreeing on the table; duplicate and
  stale next-hand requests; and commands from someone without a seat.
- Live audio and video exist behind a provider abstraction and are off unless
  configured. See [MEDIA.md](MEDIA.md). No call has been placed against a real
  SFU from this repository.
- Interface copy is factual: the home, room, history and table headings say what
  they are instead of selling the idea.

## Remaining release gates

1. Isolated Railway staging and guest connections are running. Configure and verify
   Google sign-in before treating account support as released.
2. Test two independent browser profiles through create → join → start → complete →
   history; refresh both lobby and active table; interrupt Wi-Fi; restart the server.
   Repeat with 2 and 7 Seven-Six seats and 2, 4 and 6 45s seats including a partial bot table.
3. Inspect 360/390/768/1440-pixel layouts, keyboard focus, portrait/landscape, long
   player names, card readability, and touch controls on actual iOS/Android browsers.
4. Complete-trick presentation now covers humans and bots with winner highlighting
   and Last trick review. Add same-group rematches. The
   current results action returns to game selection; it does not replace friends
   with bots under a misleading “play again” action.
5. Add background retry/outbox processing for unsaved completed results before their
   four-hour Redis TTL. Current retry is explicit or triggered when a player rejoins.
6. Add socket command schemas, resource/rate limits, bounded retention and active-game
   cleanup, production error monitoring, backup/restore rehearsal, and load testing.
   Single-replica deployment is required; Redis snapshots do not provide distributed
   command ownership. Restart host leases are reconciled on room access.
7. Repair or remove legacy social/rating surfaces before exposing them as supported
   features. Native mobile OAuth, full native layouts, push notifications, and an
   installable PWA need separate validation. Higher-strength AI remains future work.

Guest history is tied to the browser token and expires with that identity; it is
not automatically merged into an account on sign-in. Changing identity during an
active game cannot claim the previous identity's seat. Bot replacement is final
for that seat. These limitations need product decisions before a wider release.
