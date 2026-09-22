# Railway deployment

Railway is the deployment target for both the Next.js website and the long-running
Fastify/Socket.IO game server. Vercel is optional and is not required by this design.
The existing backend is already documented in this repository as running on Railway.

The redesign preview runs in the separate `cardarena-preview` Railway project.
The original `cardarena` production project has not been migrated.
Use the isolated preview until the release blockers in
[REDEVELOPMENT.md](REDEVELOPMENT.md) are complete.

## Services

Create two GitHub-backed services from this monorepo, plus Postgres and Redis in
the same Railway project and region. Keep the repository root as the root directory
for both application services: their builds need the shared packages and lockfile.

| Setting                             | Web                                      | Game server                         |
| ----------------------------------- | ---------------------------------------- | ----------------------------------- |
| Dockerfile                          | `Dockerfile.web`                         | `Dockerfile`                        |
| Start command                       | Image default: `node apps/web/server.js` | Image default: `node dist/index.js` |
| Health path                         | `/api/health`                            | `/health`                           |
| Public endpoint                     | HTTPS website                            | HTTPS API and WSS Socket.IO         |
| Replicas initially                  | 1                                        | 1                                   |

Do not override the images' working directories or start commands. The server must
remain a single replica while rooms, disconnect timers, and match proposals still
use process memory. Redis snapshots alone do not coordinate multiple game servers.
Disable service sleeping for the game server; active tables need a persistent process.

Railway supports [custom Dockerfiles and build arguments](https://docs.railway.com/builds/dockerfiles).
Set the Dockerfile path explicitly in each service's build settings so the web
service does not accidentally build the default server Dockerfile. On September
21, 2026, Railway's API rejected setting a TOML config path as deprecated. The
preview therefore uses the dashboard/API settings in the table above, a 120-second
health-check timeout, and the ON_FAILURE restart policy with three retries. The
TOML files remain as legacy references; do not rely on them being applied.

## Variables

Set these in each Railway service. Values below are placeholders, not credentials.

| Service | Variable                                   | Value / purpose                                                                                                                                                               |
| ------- | ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Web     | `NEXT_PUBLIC_SERVER_URL`                   | Public HTTPS game-server origin, e.g. `https://api.example.com`. Required **at build time**; changing it requires a rebuild. Never use a `railway.internal` address here.     |
| Web     | `NEXTAUTH_URL`                             | Public HTTPS website origin.                                                                                                                                                  |
| Web     | `NEXTAUTH_SECRET`                          | A strong random secret for Auth.js sessions.                                                                                                                                  |
| Web     | `AUTH_TRUST_HOST`                          | `true`, for the Railway reverse proxy.                                                                                                                                        |
| Web     | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Google OAuth credentials, if Google sign-in is enabled.                                                                                                                       |
| Server  | `DATABASE_URL`                             | Railway reference to Postgres's private connection string.                                                                                                                    |
| Server  | `REDIS_URL`                                | Railway reference to Redis's private connection string.                                                                                                                       |
| Server  | `WEB_URL`                                  | Exact website origin, including `https://`, without a trailing slash; used by HTTP and socket CORS.                                                                           |
| Server  | `JWT_SECRET`                               | A separate strong random secret. At least 32 random characters. Signs account and guest player sessions.                                                                      |
| Both    | `SESSION_EXCHANGE_SECRET`                  | The same random secret (at least 32 characters) on web and server. Authenticates the short-lived web-to-server OAuth assertion. Distinct from JWT_SECRET and NEXTAUTH_SECRET. |
| Web     | `SERVER_INTERNAL_URL`                      | Optional private HTTP server origin for server-to-server session exchange. Otherwise the public server URL is used.                                                           |
| Both    | `NODE_ENV`                                 | `production` (already set in the web runner image).                                                                                                                           |
| Both    | `PORT`                                     | Railway supplies this. Both processes bind on `0.0.0.0` and honor it.                                                                                                         |
| Server  | `MEDIA_PROVIDER`                           | Optional. `none` (default) or `livekit`. Live audio and video stay off until this is set. See [MEDIA.md](MEDIA.md).                                                           |
| Server  | `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` | Required when `MEDIA_PROVIDER=livekit`. Runtime variables only; they never reach the browser.                                                                     |
| Server  | `INVITE_PROVIDER`                          | Optional. `none` (default) or `resend`. Without it the lobby opens the player's own mail or messaging app. See [INVITES.md](INVITES.md).                                      |
| Server  | `RESEND_API_KEY`, `INVITE_FROM_EMAIL`      | Required when `INVITE_PROVIDER=resend`. Runtime variables only.                                                                                                              |

Keep secrets as runtime variables; do not put them into Docker build arguments.
Only the public backend URL is intentionally baked into the browser bundle.
`turbo.json` includes that URL in the build cache key.

Register `https://<web-domain>/api/auth/callback/google` as the authorized Google
OAuth redirect URI. Maintain the old redirect until the cutover is verified.
The preview currently uses guest play; Google OAuth credentials are not configured.
The sign-in page only offers Google when the provider is enabled.

## Storage and database changes

Postgres stores accounts, historical results, and ratings. Redis stores expiring
active-game snapshots. Neither substitutes for the other. Waiting rooms are stored in Redis with a 24-hour inactivity expiry. Active-game snapshots expire after 4 hours of inactivity. Signed guest IDs recover seats after a browser refresh. The game process and per-room command queue still require exactly one server replica.

Avatar uploads currently use local disk. Attach a volume at
`/app/apps/server/uploads` if this feature is enabled during staging, or complete
the planned object-storage migration before relying on uploads. Railway service
filesystems are [ephemeral outside a volume](https://docs.railway.com/services).

The redesign adds nullable `participant_id` and `display_name` columns plus an index
on `game_players` (migration `0002_fine_the_stranger`). Apply migrations before
starting the new application. This is an additive change: old code can still read
the database, and old rows remain available to their signed-in account. Old guest
results cannot be claimed because they did not store a verified guest identity.

The server image now includes the compiled Drizzle migrator. Configure the game
server Railway pre-deploy command as:

```sh
node dist/db/migrate.js
```

Run only one migration job at a time and take a database backup before the first
production upgrade. Test against a fresh staging database first. Do not use
`drizzle-kit push` against production. Roll back the application image if needed;
leave these additive columns in place.

## Staging and cutover

1. Create staging services and fresh staging databases; select the redevelopment
   branch. Use separate domains and secrets from production.
2. Generate public domains, populate the variables above, then build both services.
3. Check both health endpoints and load a JavaScript/static asset. Confirm the
   browser calls the intended backend rather than localhost.
4. Verify Google sign-in, exact-origin CORS, and a WebSocket connection through the
   Railway domain. `/health` currently proves process health, not durable writes.
5. Drain active games before switching the web and server together: the old
   unsigned socket protocol is intentionally rejected by the new server. Existing
   OAuth sessions may need sign-out/sign-in to obtain verified identity claims.
6. Exercise two separate browser identities: create room, invite, join, start,
   finish, leave, rematch. Run the reconnect, restart, and score-persistence gates
   in the redevelopment plan before calling the release production ready.
7. Only after those gates pass, point the family-facing domain at Railway and update
   the OAuth/CORS origins together. Preserve the previous deployment for rollback.

Do not switch family traffic until staging acceptance passes. OAuth through the real
Railway domains, mobile browser interaction, reconnects during deployment, and
full-game completion still require end-to-end staging validation. See
[REDESIGN-STATUS.md](REDESIGN-STATUS.md) for the current boundary.

## Local checks

```sh
npm ci --ignore-scripts
npm test
npx turbo run build --filter=@card-game/server --filter=@card-game/web
docker build -f Dockerfile.web --build-arg NEXT_PUBLIC_SERVER_URL=http://localhost:3001 -t cardarena-web .
docker run --rm -p 3000:3000 --env-file apps/web/.env.local cardarena-web
docker build -f Dockerfile -t cardarena-server .
```

Create the web runtime env file with the variables above before the `docker run`
command. Docker validation is also configured in GitHub Actions. The standalone
Next.js output contains the monorepo dependencies and is served with the static
assets copied explicitly; it does not depend on a Vercel runtime.
