# Railway deployment

Railway is the deployment target for both the Next.js website and the long-running
Fastify/Socket.IO game server. Vercel is optional and is not required by this design.
The existing backend is already documented in this repository as running on Railway.

This branch prepares deployment artifacts. It has not migrated the live website.
Use an isolated staging environment until the release blockers in
[REDEVELOPMENT.md](REDEVELOPMENT.md) are complete.

## Services

Create two GitHub-backed services from this monorepo, plus Postgres and Redis in
the same Railway project and region. Keep the repository root as the root directory
for both application services: their builds need the shared packages and lockfile.

| Setting | Web | Game server |
| --- | --- | --- |
| Config file path (service settings) | `/railway.web.toml` | `/railway.server.toml` |
| Dockerfile | `Dockerfile.web` | `Dockerfile` |
| Start command | Image default: `node apps/web/server.js` | Image default: `node dist/index.js` |
| Health path | `/api/health` | `/health` |
| Public endpoint | HTTPS website | HTTPS API and WSS Socket.IO |
| Replicas initially | 1 | 1 |

Do not override the images' working directories or start commands. The server must
remain a single replica while rooms, disconnect timers, and match proposals still
use process memory. Redis snapshots alone do not coordinate multiple game servers.
Disable service sleeping for the game server; active tables need a persistent process.

Railway supports [custom Dockerfiles and build arguments](https://docs.railway.com/builds/dockerfiles)
and [deployment configuration in source control](https://docs.railway.com/config-as-code/reference).
Select the config file explicitly for each service so the web service does not
accidentally build the default server Dockerfile.

## Variables

Set these in each Railway service. Values below are placeholders, not credentials.

| Service | Variable | Value / purpose |
| --- | --- | --- |
| Web | `NEXT_PUBLIC_SERVER_URL` | Public HTTPS game-server origin, e.g. `https://api.example.com`. Required **at build time**; changing it requires a rebuild. Never use a `railway.internal` address here. |
| Web | `NEXTAUTH_URL` | Public HTTPS website origin. |
| Web | `NEXTAUTH_SECRET` | A strong random secret for Auth.js sessions. |
| Web | `AUTH_TRUST_HOST` | `true`, for the Railway reverse proxy. |
| Web | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Google OAuth credentials, if Google sign-in is enabled. |
| Server | `DATABASE_URL` | Railway reference to Postgres's private connection string. |
| Server | `REDIS_URL` | Railway reference to Redis's private connection string. |
| Server | `WEB_URL` | Exact website origin, including `https://`, without a trailing slash; used by HTTP and socket CORS. |
| Server | `JWT_SECRET` | A separate strong random secret. Setting this does **not** fix the existing client authentication flow; that is the next redevelopment milestone. |
| Both | `NODE_ENV` | `production` (already set in the web runner image). |
| Both | `PORT` | Railway supplies this. Both processes bind on `0.0.0.0` and honor it. |

Keep secrets as runtime variables; do not put them into Docker build arguments.
Only the public backend URL is intentionally baked into the browser bundle.
`turbo.json` includes that URL in the build cache key.

Register `https://<web-domain>/api/auth/callback/google` as the authorized Google
OAuth redirect URI. Maintain the old redirect until the cutover is verified.

## Storage and database changes

Postgres stores accounts, historical results, and ratings. Redis stores expiring
active-game snapshots. Neither substitutes for the other. Waiting rooms currently
remain in memory and will not survive a restart; the next milestone addresses this.

Avatar uploads currently use local disk. Attach a volume at
`/app/apps/server/uploads` if this feature is enabled during staging, or complete
the planned object-storage migration before relying on uploads. Railway service
filesystems are [ephemeral outside a volume](https://docs.railway.com/services).

This branch has no schema changes. For a new environment, apply the repository's
existing Drizzle migrations using a controlled migration job with database access.
`npm run db:migrate --workspace=@card-game/server` requires a full dependency install;
the production image intentionally omits `drizzle-kit`. Do not configure that command
as a pre-deploy command in the current runtime image. Future schema work must add a
dedicated migration image/job and an expand/contract rollout plan.

## Staging and cutover

1. Create staging services and fresh staging databases; select the redevelopment
   branch. Use separate domains and secrets from production.
2. Generate public domains, populate the variables above, then build both services.
3. Check both health endpoints and load a JavaScript/static asset. Confirm the
   browser calls the intended backend rather than localhost.
4. Verify Google sign-in, exact-origin CORS, and a WebSocket connection through the
   Railway domain. `/health` currently proves process health, not durable writes.
5. Exercise two separate browser identities: create room, invite, join, start,
   finish, leave, rematch. Run the reconnect, restart, and score-persistence gates
   in the redevelopment plan before calling the release production ready.
6. Only after those gates pass, point the family-facing domain at Railway and update
   the OAuth/CORS origins together. Preserve the previous deployment for rollback.

Do not switch production traffic to this foundation branch: identity and durable
scorekeeping still have known defects. This is a release dependency from the code
review, not a limitation of Railway.

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
