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
CI builds both Railway Docker images. Locally, 133 tests pass (80 engine, 36 AI,
17 server); the two database/Redis tests require the CI service containers.

The cloud browser could not open the local development server. Screenshots,
real device interaction, and browser end-to-end acceptance are not yet verified.
Do not infer visual QA from a successful Next.js build.

## Remaining release gates

1. Deploy this branch to isolated Railway staging with the new migration and matching
   session-exchange secret. Verify Google sign-in, guest creation, CORS, and sockets.
2. Test two independent browser profiles through create → join → start → complete →
   history; refresh both lobby and active table; interrupt Wi-Fi; restart the server.
   Repeat with 2 and 7 Seven-Six seats and 4 Euchre seats including a partial bot table.
3. Inspect 360/390/768/1440-pixel layouts, keyboard focus, portrait/landscape, long
   player names, card readability, and touch controls on actual iOS/Android browsers.
4. Add complete-trick presentation for bot tricks and same-group rematches. The
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
