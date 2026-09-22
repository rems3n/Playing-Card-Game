/**
 * The seam between the table and whichever SFU carries the audio and video.
 *
 * Everything above this interface deals in seats and game ids; everything below
 * deals in rooms and tokens. Swapping providers means writing one more file.
 */
export interface MediaTokenRequest {
  /** Derived from the game id on the server. Never supplied by a client. */
  roomName: string;
  /** Unique within the room and free of account information. */
  identity: string;
  displayName: string;
  /** Seconds the credential stays valid. Kept short on purpose. */
  ttlSeconds: number;
}

export interface MediaTokenResult {
  token: string;
  url: string;
  expiresAt: number;
}

export interface MediaProvider {
  readonly name: string;
  /** False when the deployment has no provider configured. */
  readonly enabled: boolean;
  issueToken(request: MediaTokenRequest): Promise<MediaTokenResult>;
}

/** Used when no provider is configured. The call controls stay hidden. */
export class DisabledMediaProvider implements MediaProvider {
  readonly name = "none";
  readonly enabled = false;
  async issueToken(): Promise<MediaTokenResult> {
    throw new Error("Live audio and video are not configured on this server");
  }
}
