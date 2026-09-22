import { AccessToken } from "livekit-server-sdk";
import type {
  MediaProvider,
  MediaTokenRequest,
  MediaTokenResult,
} from "./MediaProvider.js";

export interface LiveKitSettings {
  url: string;
  apiKey: string;
  apiSecret: string;
}

/**
 * LiveKit tokens are scoped to one room and grant publish and subscribe only.
 * Room creation, recording and data publishing are withheld: a player can talk
 * at their own table and nowhere else, and nothing is recorded.
 */
export class LiveKitProvider implements MediaProvider {
  readonly name = "livekit";
  readonly enabled = true;

  constructor(private settings: LiveKitSettings) {
    if (!settings.url || !settings.apiKey || !settings.apiSecret)
      throw new Error(
        "LIVEKIT_URL, LIVEKIT_API_KEY and LIVEKIT_API_SECRET are all required",
      );
    // The browser opens a WebSocket to this URL. Pasting the project's https://
    // dashboard address instead of its wss:// endpoint is the easy mistake, and
    // without this check it starts cleanly and every call fails in the browser.
    if (!/^wss?:\/\//.test(settings.url))
      throw new Error(
        `LIVEKIT_URL must be a WebSocket URL starting with wss:// (got "${settings.url}"). ` +
          "The LiveKit Cloud dashboard shows it as the project URL.",
      );
  }

  async issueToken(request: MediaTokenRequest): Promise<MediaTokenResult> {
    const token = new AccessToken(this.settings.apiKey, this.settings.apiSecret, {
      identity: request.identity,
      name: request.displayName,
      ttl: request.ttlSeconds,
    });
    token.addGrant({
      room: request.roomName,
      roomJoin: true,
      canPublish: true,
      canSubscribe: true,
      canPublishData: false,
      canUpdateOwnMetadata: false,
      roomCreate: false,
      roomList: false,
      roomRecord: false,
      roomAdmin: false,
      hidden: false,
    });
    return {
      token: await token.toJwt(),
      url: this.settings.url,
      expiresAt: Date.now() + request.ttlSeconds * 1000,
    };
  }
}
