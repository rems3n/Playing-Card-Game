/**
 * Live audio and video at a table.
 *
 * Media is a separate subsystem: the game socket stays authoritative for game
 * state, and every media failure is recoverable without leaving the game. The
 * server issues short-lived, room-scoped credentials after checking that the
 * caller holds a seat; the client never chooses its own room or permissions.
 */

/** What the server will hand out, if anything. Contains no secrets. */
export interface MediaConfig {
  /** False when no provider is configured. The call controls stay hidden. */
  enabled: boolean;
  /** Provider name for display and support, e.g. "livekit". */
  provider: string;
}

/** A single-use, short-lived ticket for one seat at one table. */
export interface MediaCredentials {
  provider: string;
  /** The provider's realtime endpoint. */
  url: string;
  token: string;
  /** Derived from the game id on the server, never sent by the client. */
  roomName: string;
  /** Stable within a room and carries no account information. */
  identity: string;
  displayName: string;
  seatIndex: number;
  /** Epoch milliseconds. Clients refresh before this. */
  expiresAt: number;
}

export type MediaConnectionState =
  | "connected"
  | "reconnecting"
  | "disconnected";

export interface MediaParticipant {
  identity: string;
  seatIndex: number;
  displayName: string;
  isLocal: boolean;
  microphoneOn: boolean;
  cameraOn: boolean;
  speaking: boolean;
  connection: MediaConnectionState;
}

/**
 * "unavailable" means no provider is configured; "failed" means the call could
 * not be joined or was dropped. Neither stops the card game.
 */
export type MediaStatus =
  | "unavailable"
  | "off"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "failed";

export const MEDIA_ERROR_CODES = {
  disabled: "MEDIA_DISABLED",
  notSeated: "MEDIA_NOT_SEATED",
  failed: "MEDIA_TOKEN_FAILED",
} as const;

export type MediaErrorCode =
  (typeof MEDIA_ERROR_CODES)[keyof typeof MEDIA_ERROR_CODES];
