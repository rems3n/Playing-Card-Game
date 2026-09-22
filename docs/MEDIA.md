# Live audio and video at a table

People should be able to see and hear each other while they play, and nothing
about that call should be able to interrupt the card game.

**Media is off by default.** A deployment with no media variables set runs
exactly as before and hides the call controls. Nothing below is required to run
Seven-Six.

## How it is put together

```
browser ──game socket──►  API service  ──► Postgres / Redis      (authoritative)
   │                          │
   │                          └── MediaService: is this socket seated here?
   │                                   │  yes → short-lived, room-scoped token
   └──────────WebRTC──────────►  SFU (LiveKit)                   (media only)
```

- The game socket stays the single authority for game state. Media never
  carries a game action and never gates one.
- The SFU carries audio and video only. The API service never proxies media.
- `MediaProvider` (`apps/server/src/services/media/MediaProvider.ts`) is the
  seam. `LiveKitProvider` is the only implementation today; swapping to Daily or
  Twilio Video means adding one file and a `MEDIA_PROVIDER` value. Nothing above
  that interface knows which provider is in use.

## What the server guarantees

`MediaService.issueCredentials` takes a game id and the participant id that the
socket's **signed session** carries. Everything else is read from server state:

- The seat comes from the game's participant map. Someone without a seat, or a
  bot seat, is refused with `MEDIA_NOT_SEATED` and no token is requested from
  the provider.
- The room name is `table-<gameId>`, derived on the server. A client cannot ask
  for another table's room.
- The display name comes from the seated player's state, not from the request.
- The identity is `seat-<n>`: unique inside the room, and it carries no account
  or participant identifier.
- The token grants `roomJoin`, `canPublish` and `canSubscribe` for that one
  room. `roomCreate`, `roomList`, `roomAdmin`, `roomRecord`, `canPublishData`
  and `canUpdateOwnMetadata` are all withheld.
- Tokens last `MEDIA_TOKEN_TTL_SECONDS` (300 by default): long enough to join
  and reconnect once, short enough to be worth little if it leaks.
- Nothing is recorded or stored. No media passes through the API service, and
  no media is written to Postgres, Redis or disk.

These properties are covered by `apps/server/src/__tests__/Media.test.ts`,
including the exact grants inside an issued LiveKit token.

## Variables

| Service | Variable                  | Purpose                                                                          |
| ------- | ------------------------- | -------------------------------------------------------------------------------- |
| Server  | `MEDIA_PROVIDER`          | `none` (default) or `livekit`. Any other value fails at start-up rather than silently disabling media. |
| Server  | `LIVEKIT_URL`             | The project's realtime endpoint, e.g. `wss://your-project.livekit.cloud`.        |
| Server  | `LIVEKIT_API_KEY`         | LiveKit API key. Server only; never reaches the browser.                         |
| Server  | `LIVEKIT_API_SECRET`      | LiveKit API secret. Server only; never reaches the browser.                      |
| Server  | `MEDIA_TOKEN_TTL_SECONDS` | Optional, default `300`.                                                         |

The web app asks the API service for `GET /media/config`, which returns only
`{ enabled, provider }`. No key or secret is ever sent to a browser, and there
is no separate web-side media variable to keep in step.

## Setting up LiveKit Cloud

1. Create a LiveKit Cloud project at https://cloud.livekit.io.
2. Copy the project URL (`wss://<project>.livekit.cloud`) and create an API key
   and secret.
3. On the Railway **API service**, set `MEDIA_PROVIDER=livekit`, `LIVEKIT_URL`,
   `LIVEKIT_API_KEY` and `LIVEKIT_API_SECRET` as runtime variables. Do not put
   them in Docker build arguments.
4. Redeploy the API service. No web rebuild is needed: the web app reads
   `/media/config` at runtime.
5. Confirm `GET https://<api-host>/media/config` returns
   `{"enabled":true,"provider":"livekit"}`.

To turn media off again, set `MEDIA_PROVIDER=none` and redeploy. Players keep
playing; the call controls disappear.

Self-hosting LiveKit on Railway is possible and uses the same variables, but it
needs UDP and a TURN path that a standard Railway HTTP service does not
provide. Use the managed service unless there is a reason not to.

## What it will cost

LiveKit Cloud bills mainly on bandwidth out of the SFU. Check
https://livekit.io/pricing for current rates and free-tier limits before
enabling this in production; the figures there change and are not repeated here.

What you can work out in advance is the traffic. In an SFU every participant
receives one stream per other participant, so for `n` participants each
publishing at `r`:

```
egress ≈ n × (n − 1) × r
```

| Table         | Per publisher | Egress   | Per hour of call |
| ------------- | ------------- | -------- | ---------------- |
| 4, audio only | 40 kbps       | 0.5 Mbps | ≈ 0.2 GB         |
| 4, video      | 500 kbps      | 6 Mbps   | ≈ 2.7 GB         |
| 7, audio only | 40 kbps       | 1.7 Mbps | ≈ 0.8 GB         |
| 7, video      | 500 kbps      | 21 Mbps  | ≈ 9.5 GB         |

Cameras are off by default, so an ordinary family game costs the audio row.
A seven-seat table with every camera on is roughly forty times that, which is
the number to watch. Set a spending cap in the provider's dashboard before
enabling media for a group you do not control.

## Not in this version

- No recording, and no plan to add it.
- No host moderation beyond each player muting themselves. Muting someone else
  needs a moderation role on the token and is deliberately not granted yet.
- No dial-in, no screen share, no background blur.
- Physical-device acceptance for the call UI is still outstanding, as it is for
  the rest of the mobile table.
