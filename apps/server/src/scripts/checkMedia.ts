/**
 * Checks a LiveKit deployment end to end, short of two people talking.
 *
 * It validates the configuration the way the server does at start-up, mints a
 * table token with the same grants a player gets, and then calls the LiveKit
 * API with the same key and secret. That last step is the one that can only
 * pass if the URL, key and secret really belong together, which is what a
 * successful deploy on its own does not prove.
 *
 *   MEDIA_PROVIDER=livekit LIVEKIT_URL=wss://... LIVEKIT_API_KEY=... \
 *   LIVEKIT_API_SECRET=... npm run media:check --workspace=@card-game/server
 *
 * Nothing is recorded and no room is created: listing rooms is a read.
 */
import { RoomServiceClient } from "livekit-server-sdk";
import { createMediaProvider } from "../services/media/index.js";
import { DEFAULT_MEDIA_TTL_SECONDS, mediaRoomName } from "../services/MediaService.js";

function fail(message: string): never {
  console.error(`FAILED: ${message}`);
  process.exit(1);
}

const env = {
  MEDIA_PROVIDER: process.env.MEDIA_PROVIDER,
  LIVEKIT_URL: process.env.LIVEKIT_URL,
  LIVEKIT_API_KEY: process.env.LIVEKIT_API_KEY,
  LIVEKIT_API_SECRET: process.env.LIVEKIT_API_SECRET,
};

let provider;
try {
  provider = createMediaProvider(env);
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}

if (!provider.enabled)
  fail(
    `MEDIA_PROVIDER is "${env.MEDIA_PROVIDER ?? "unset"}", so calls are off. ` +
      'Set MEDIA_PROVIDER=livekit to check a real deployment.',
  );
console.log(`provider: ${provider.name}`);
console.log(`url:      ${env.LIVEKIT_URL}`);

const issued = await provider.issueToken({
  roomName: mediaRoomName("check-0000"),
  identity: "seat-0",
  displayName: "Configuration check",
  ttlSeconds: DEFAULT_MEDIA_TTL_SECONDS,
});
const parts = issued.token.split(".");
if (parts.length !== 3) fail("the provider did not return a JWT");
const claims = JSON.parse(Buffer.from(parts[1], "base64url").toString());
console.log(
  `token:    ${parts[0].length + parts[1].length + parts[2].length + 2} bytes, ` +
    `room ${claims.video?.room}, publish ${claims.video?.canPublish}, ` +
    `record ${claims.video?.roomRecord ?? false}, expires in ${
      claims.exp - Math.floor(Date.now() / 1000)
    }s`,
);
if (claims.video?.roomRecord) fail("the token grants recording; it must not");

// The API is served over https on the same host as the wss endpoint.
const apiUrl = env.LIVEKIT_URL!.replace(/^ws/, "http");
try {
  const rooms = await new RoomServiceClient(
    apiUrl,
    env.LIVEKIT_API_KEY!,
    env.LIVEKIT_API_SECRET!,
  ).listRooms();
  console.log(`api:      reachable at ${apiUrl}, ${rooms.length} room(s) open`);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  // A 401 means the credentials are wrong; anything else usually means the
  // host could not be reached at all, which is a different thing to go and fix.
  const unauthorized = /401|unauthorized|invalid (api )?key|permission/i.test(message);
  fail(
    unauthorized
      ? `${apiUrl} rejected the key and secret: ${message}\n` +
          "Check that all three values come from the same LiveKit project."
      : `could not reach ${apiUrl}: ${message}\n` +
          "The credentials were not tested. Check the host and this machine's network access.",
  );
}

console.log("\nOK. Two people still have to hear each other: open the table in");
console.log("two browsers, sign in as different players, and start the call.");
