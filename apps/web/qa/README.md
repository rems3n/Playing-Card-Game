# Mobile layout QA

Two tools, both driving the real application. Neither replaces a pass on a
physical phone.

## `mobile-layout.mjs` — automated, repeatable

Drives a complete Seven-Six hand at five phone viewports in Chromium with
`isMobile` and touch enabled, and fails on:

- horizontal or vertical page scrolling on the game page
- tracked controls rendered outside the viewport
- controls cut off by an ancestor that hides its overflow, which is how the
  game shell keeps its height — a control can be inside the viewport and still
  be clipped
- overlapping hand cards
- touch targets under 44px (hand cards are measured separately, see below)
- a call panel that covers the hand, the bid tiles or the round-end action,
  a missing **Call** button in the table header, or no way to join once open —
  all only where a media provider is configured. Run the suite with
  `MEDIA_PROVIDER=livekit` and a `wss://` URL on the game server to exercise
  these; with media off the call steps say so and are skipped.
- flow breaks: Escape not closing a dialog, a bid submitted before one is
  chosen, a lost scoring pause on reload, auto-deal not toggling, "Deal next
  hand" not starting the next hand, or leaving not returning to the games page

Run it against a local stack:

```bash
# terminal 1: postgres + redis, then the game server
cd apps/server && npm run dev
# terminal 2
cd apps/web && npm run dev
# terminal 3
cd apps/web && npm run qa:mobile
```

Prefer a production build (`npm run build` then `npm run start` in `apps/web`,
and `node dist/index.js` in `apps/server`) for a run you intend to quote: `next
dev` reloads on every edit and draws a floating indicator in the bottom-left
corner, and `tsx watch` restarts the game server, either of which will make a
long run fail for reasons that have nothing to do with the layout. The suite
hides the dev indicator, but it cannot hide a reload. Do not edit files while a
run is in progress.

### `npm run qa:call` — a real two-person call

`qa/call-flows.mjs` drives a host on a desktop viewport and a guest on a phone
through the waiting room to one table, both with Chromium's fake camera and
microphone, against a real LiveKit server. It measures that the other person's
audio element is playing with signal in it on both sides, that both cameras
show, that the phone layout holds with two videos up, that hiding the call
keeps the sound and leaving ends it. It needs a LiveKit server this machine can
reach — `livekit-server --dev` on `ws://127.0.0.1:7880` — and the game server
started with `MEDIA_PROVIDER=livekit LIVEKIT_URL=ws://127.0.0.1:7880
LIVEKIT_API_KEY=devkey LIVEKIT_API_SECRET=secret`. `PHONE=320x568` picks the
guest's viewport (default `402x682`, an iPhone 16 Pro in Safari).

Environment variables: `BASE_URL` (default `http://localhost:3000`), `SEATS`
(default 7), `GAME` (`Seven-Six` or `45s`), `SIZES` (comma-separated,
e.g. `320x568,844x390`), `MIN_TOUCH`, `MIN_HAND_CARD`, `CHROMIUM_PATH`.

It is not a CI gate: it needs a running server, a database and a browser
download. Run it before shipping a change to the game page or `globals.css`.

### Known measured constraint

At 320×568 a seven-card hand gives 42×60px cards. Seven 44px cards plus
readable gaps do not fit 320px. Playing a card is therefore two steps —
select, then press "Play card" — and the selected card is named in the action
row before it is played, so a mis-tap is visible and recoverable.
`MIN_HAND_CARD` defaults to 42 for this reason; raise it if the hand layout
changes.

## `lobby-flows.mjs` — the waiting room, two real browsers

`npm run qa:lobby` opens a host on a desktop viewport and a guest on a phone and
drives: nobody starts ready, Start stays disabled until everyone is, the note
names who is still deciding, un-readying blocks it again, the invite panel says
which app it will open and keeps full touch targets, freeing a seat tells the
person why, a rejoin and a refresh keep the right state, and the host can start
with both players landing at the table. Same setup as the layout suite; run it
against a production build for a result worth quoting.

## `../public/qa/mobile.html` — manual, in-browser

Loads the running app in a phone-sized iframe and reports the same layout
measurements on demand. Use it to eyeball a specific screen, or from a phone
browser where the script cannot run. Point it at a real app path; it does not
mock the app.

## Still required on hardware

iOS Safari and Android Chrome, covering safe-area insets, browser chrome
appearing and collapsing on scroll, keyboard behaviour, portrait/landscape
transitions, and how card selection actually feels under a thumb.
