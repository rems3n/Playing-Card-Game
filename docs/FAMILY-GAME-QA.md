# Family-game QA and defect review

Scope: the supported family web flows, Seven-Six (2–7 players), and the existing
Euchre implementation labeled 45s / Euchre. Native app release certification,
legacy Hearts/Spades/Rummy screens, and stronger AI are separate workstreams.

## Defects fixed in this pass

| Finding | Cause | Correction and regression check |
| --- | --- | --- |
| Bid controls were redundant | The stepper duplicated the number tiles | Seven-Six now uses number tiles and Submit bid on desktop/mobile web. Component tests exercise selection, Enter, dealer restriction and duplicate-submit prevention. |
| Last card disappears when a bot finishes a trick | Engine clears the trick synchronously; bot broadcast skipped the human-only delay | GameService preserves a personalized completed-trick view and holds progression for 3.5 seconds for both human/bot endings. Tests cover every trick, round transition, final-game transition, and restore during review. |
| Winner is not identifiable | Active family table ignores old trick events | The completed state includes winner and all cards; gold card/player highlight, winner text, reduced-motion support and Last trick dialog. |
| Table cards become square; suit is off center | A 72px flex basis acts on height inside a column; fixed suit offsets | Non-shrinking, explicit portrait dimensions and 50% centering. Live desktop DOM measurements confirmed 72 × 104px cards with centered suits. |
| Last trick dialog overflows its container | Content width exceeded the native dialog width | Fit the content to its dialog, with a scroll limit for short screens. |
| Number by player disagrees with trick column | It was cumulative score without a label | Each player shows labeled tricks and points, including on small screens. Tests compare rendered counters. |
| Euchre displays -1 | Internal pass sentinel is rendered directly | Display Pass. |
| A malformed bid silently becomes zero | Socket handler coerced a non-number to 0 | Reject non-integer/non-number submissions; engine validates bounds and dealer restriction. |
| Intermediate bot bids arrive together | AI scheduler only broadcast card plays | Persist and broadcast each bid/trump decision. |

## Automated acceptance coverage

- **160 seeded complete engine games:** 120 Seven-Six games (20 for each of 2–7
  seats), plus 40 Euchre games. Independently calculate each trick winner and
  round score, including bowers; reject illegal/out-of-turn moves without
  mutation; verify hidden hands, unique event sequence numbers, final completion,
  and repeated serialize/restore equivalence.
- **Presentation integration:** complete human-driven and all-bot games in both
  engines. Check all cards remain in the review state, the final card is present,
  tricks update before the hold, no early move is accepted, old-round hand/trump
  data stays consistent, and reconnect/restart can recover the review.
- **Real Socket.IO clients:** signed authentication, rejection of unsigned clients
  and outsiders, two identically named players, host-only start, guest reconnect,
  two human clients with bots, all tricks through game-over and saved feedback.
  Storage is isolated in memory in this transport suite.
- **UI interaction tests:** number/keyboard bidding, duplicate-submit
  prevention, selection-then-play, winner and counters, Last trick after a new
  round, Euchre pass labels, and ignoring another game's delayed state.
- **Existing room/auth/AI coverage:** duplicate starts, failed starts and retry,
  stable identities, host transfer, signed-session validation, and AI strategies.
- **Real Postgres/Redis CI suite:** migrated disposable services; failed-result
  transaction rollback, concurrent idempotent saves, private history access,
  room and participant restoration. This is separate from the mocked socket suite.
- Web/server/native TypeScript, production builds, dependency audit, and both
  Railway Docker images are CI gates.

No finite simulation suite checks every possible game or proves visual quality.
The engine simulations use accelerated execution. Browser tests must separately
verify the real-time pause, portrait card shape, centered symbols, focus and layout.

## Deployed desktop acceptance

On the Railway preview, selected a bid and submitted it using the
Submit button, then played through multiple tricks against a bot. Confirmed
completed cards and winner feedback appear, own-seat trick counts agree with the
scoreboard, and Last trick retains the cards and winner after play resumes.
The automated timer regression verifies the 3.5-second hold. These checks do not
constitute real phone, multi-person network, or native-app acceptance.

## Remaining release work identified by review

1. Full touch-device acceptance on iOS Safari and Android Chrome, including small
   landscape screens, slow networks, keyboard-only navigation, and reduced motion.
2. Multi-person live acceptance and reconnect/restart drills on Railway; the socket
   tests cover the protocol but do not replace real network/device behavior.
3. Rejoining a table with multiple disconnected people needs a complete, replayable
   disconnect-state UI rather than relying only on a single transient notice.
4. Same-group rematches and stronger round-end summaries. Last trick is available,
   but a full per-round scoreboard/replay is not implemented.
5. Background retry/outbox for unsaved completed results, service rate/resource
   limits, complete socket payload schemas, active-game cleanup, monitoring and
   backup/restore rehearsal. Keep the API at one replica.
6. Google OAuth setup and live acceptance. Preview guest history belongs to its
   browser identity and does not merge into a later account.
7. Full native app UX and legacy social/rating screens remain outside this release.

Use the Railway preview for acceptance. Do not describe this pass as a production
certification or claim that simulation covers every interface or failure mode.

## Trump card and next-hand follow-up

- The full Seven-Six trump card appears in a prominent panel with the suit name.
  It is drawn from the undealt cards and set aside; simulations check it is never
  in a player's hand across all supported seat counts and hand sizes.
- Family tables now stop in RoundScoring after the final-trick review. Scores,
  bids, trick counts and the previous trump remain visible until Deal next hand.
  No next-round cards are dealt in advance. Any seated player can continue the table.
- Automatically deal next hand is a shared, game-scoped setting, off by default.
  When enabled, the scored-hand summary remains for five seconds after the
  3.5-second final-trick review. Disabling it cancels the pending automatic deal.
  The setting and paused round survive restoration; a new game starts with it off.
- Regression checks cover both family engines, stale/double deals, premature
  deals, outsider requests, retained scores, dealer rotation, delay cancellation,
  re-enabling, and manual dealing throughout complete socket-driven games.
- Native compatibility controls are included; real-device acceptance is still open.
- Existing Euchre pickup rules are unchanged: its ordered upcard can enter the
  dealer's hand. The set-aside rule above applies to Seven-Six.
