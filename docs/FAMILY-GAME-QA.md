# Family-game QA and defect review

Scope: the supported family web flows, Seven-Six (2–7 players), and the existing
Euchre implementation labeled 45s / Euchre. Native app release certification,
legacy Hearts/Spades/Rummy screens, and stronger AI are separate workstreams.

## Defects fixed in this pass

| Finding | Cause | Correction and regression check |
| --- | --- | --- |
| +/− bidding has no submit action | The stepper changes local state; only number tiles sent a bid | Stepper and number tiles select; a labeled Submit bid button confirms. Component tests exercise mouse and Enter, bounds, restricted dealer bid, pending requests and other-player turns. |
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
- **UI interaction tests:** stepper/number/keyboard bidding, duplicate-submit
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

On the Railway preview, selected a bid with +/− and submitted it using the new
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
