# Family-game QA and defect review

Scope: the supported family web flows, Seven-Six (2–7 players), and Auction 45s
(2, 4 or 6 players). Native app release certification, legacy Hearts/Spades/Rummy
screens, and stronger AI are separate workstreams.

## Phone-viewport pass (Chromium at real viewports, driving the running app)

`apps/web/qa/mobile-layout.mjs` plays a complete Seven-Six hand at 320x568,
390x664, 430x780, 844x390 and 390x540 with `isMobile` and touch on, and fails on
page scrolling, controls outside the viewport, controls cut off by a clipping
ancestor, overlapping hand cards, touch targets under 44px, and flow breaks.
Run it with `npm run qa:mobile` in `apps/web` against a local stack. It is not a
CI gate: it needs a server, a database and a browser.

| Finding (measured, seven seats) | Correction |
| --- | --- |
| Bid tiles were 25–40px wide: the grid forced all eight onto one row | The grid wraps with a 46px minimum, so every tile is a full target at 320px |
| "Deal next hand" sat below the viewport at 320x568 and 844x390, because the whole scoring panel scrolled | Only the per-player list scrolls; the action stays in view |
| The Rules dialog close button was 36px tall; the auto-deal row 22px; "Retry connection" in a disconnect notice 90x18 | All are at least 44px now |
| A seven-card hand was 37px per card at 320px | The hand panel spans the full viewport width on narrow phones: 42x60px at 320px, 44x64px at 390px and above |
| The Table menu heading, holding "Back to game", scrolled away on short screens | It is sticky |
| With the call panel present, the bidding panel was cut off by the felt at 390x540 | The panel drops its heading on short screens, the seat strip and opponent status hide during bidding, and the call is not drawn until someone is in a call |
| `.table-layout` inherited the desktop grid's `align-items: start`, so the hand panel's full-bleed offset resolved against a content-sized parent and hung 6px off screen | The phone layout stretches its children |
| Seven-Six preselected a bid of 1, so a mis-tap on Submit placed a bid nobody chose | No bid is preselected; Submit is disabled until one is picked, and a selection the dealer restriction later makes illegal is rejected |

Residual, and stated rather than hidden: at 320px a seven-card hand gives 42x60px
cards. Seven 44px cards plus readable gaps do not fit 320px. Playing a card stays
two steps — select, then "Play card" — with the chosen card named in the action
row, so a mis-tap is visible and recoverable.

## Defects fixed in this pass

| Finding | Cause | Correction and regression check |
| --- | --- | --- |
| Bid controls were redundant | The stepper duplicated the number tiles | Seven-Six now uses number tiles and Submit bid on desktop/mobile web. Component tests exercise selection, Enter, dealer restriction and duplicate-submit prevention. |
| Last card disappears when a bot finishes a trick | Engine clears the trick synchronously; bot broadcast skipped the human-only delay | GameService preserves a personalized completed-trick view and holds progression for 3.5 seconds for both human/bot endings. Tests cover every trick, round transition, final-game transition, and restore during review. |
| Winner is not identifiable | Active family table ignores old trick events | The completed state includes winner and all cards; gold card/player highlight, winner text, reduced-motion support and Last trick dialog. |
| Table cards become square; suit is off center | A 72px flex basis acts on height inside a column; fixed suit offsets | Non-shrinking, explicit portrait dimensions and 50% centering. Live desktop DOM measurements confirmed 72 × 104px cards with centered suits. |
| Last trick dialog overflows its container | Content width exceeded the native dialog width | Fit the content to its dialog, with a scroll limit for short screens. |
| Number by player disagrees with trick column | It was cumulative score without a label | Each player shows labeled tricks and points, including on small screens. Tests compare rendered counters. |
| A pass displays as -1 | Internal pass sentinel is rendered directly | Display Pass. |
| A malformed bid silently becomes zero | Socket handler coerced a non-number to 0 | Reject non-integer/non-number submissions; engine validates bounds and dealer restriction. |
| Intermediate bot bids arrive together | AI scheduler only broadcast card plays | Persist and broadcast each bid/trump decision. |
| Call has video but no sound, both directions | Remote audio tracks were never attached to an element | Attach on subscribe into a hidden container; detach on unsubscribe and leave; `startAudio()` after joining and a Turn on sound control where the browser holds playback back. `qa:call` measures signal on both sides. |
| Other person's tile blank on a phone | A camera counted as on when published, before this browser subscribed, so the tile attached nothing | A camera is on once its track is here. |
| Speaker picker on an iPhone does nothing | iOS exposes `setSinkId` but routes sound itself | No picker on iPhone/iPad or at phone widths. |
| Table clipped and panned after tapping the picker | iOS zooms in on a form control under 16px and stays zoomed | Controls are 16px on phones. |
| Bidding card covers the rows above and below it with video up | Full call panel left the felt 67px tall | In-call strip ≤150px; bidding form drops to essentials while a call is up; a too-tall card scrolls inside its space instead of spilling. |
| Ready button off the edge on a 320px phone | Waiting-room grid track `1fr` would not shrink below a row's content, widening the layout to 370px | `minmax(0, 1fr)`; rows may shrink. The lobby suite now checks a 320px layout stays 320px. |

## Automated acceptance coverage

- **Seeded complete engine games:** 120 Seven-Six games (20 for each of 2–7
  seats), plus seeded 45s games at 2, 4 and 6 seats. Independently calculate each
  trick winner and round score from transcribed ranking tables; reject
  illegal/out-of-turn moves without mutation; verify hidden hands, unique event
  sequence numbers, final completion, and repeated serialize/restore equivalence.
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
  round, 45s pass labels, and ignoring another game's delayed state.
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

## Live audio and video

Off unless a provider is configured; see [MEDIA.md](MEDIA.md). Server-side
authorization, token grants and refusal paths are covered by
`apps/server/src/__tests__/Media.test.ts`; the panel, its controls and its
failure handling by `apps/web/src/__tests__/TableCall.test.tsx` against a fake
session. The phone-viewport suite opens and closes the call at every size and
fails if it covers the hand, the bid tiles or the round-end action. No call has
been placed against a real SFU from this repository: that needs LiveKit
credentials and is part of the outstanding device acceptance.

## 45s

The table labelled 45s plays **Auction Forty-Fives**: a 52-card deck, five cards
each, bidding 15/20/25/30, the 5 of trump and the ace of hearts above the jack,
ranking that reverses in black suits, 5 points a trick with a highest-trump
bonus, bid-or-lose scoring to 45, and reneging of the top three trumps.
[FORTY-FIVES.md](FORTY-FIVES.md) records the ranking in full and names the
variant rules that are deliberately not implemented. The Euchre engine it
replaced has been removed along with its tests, its AI and its 24-card deck.

Rules coverage: `FortyFivesRules.test.ts` (32 tests) checks the ranking against
tables transcribed independently from the rules, the auction including the
dealer's hold and the stuck dealer, six reneging cases, and the scoring;
`FortyFivesSimulation.test.ts` (60 tests) plays seeded complete games at every
supported seat count.

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
- The set-aside trump card is a Seven-Six rule. 45s has no turned-up card: its
  trump is named by whoever wins the auction.
