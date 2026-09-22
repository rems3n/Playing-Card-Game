/**
 * Inviting someone to a private table.
 *
 * A room code is a capability: anyone holding it can take a seat. Sending one
 * is therefore treated like any other privileged action — only a seated player
 * can ask, the server writes the message, and the rate is capped.
 */
export type InviteChannel = "email" | "sms";

/** What the server can send on the player's behalf. Contains no secrets. */
export interface InviteConfig {
  /** Channels the server will send itself. */
  channels: InviteChannel[];
  /** Provider name for display and support, e.g. "resend". */
  provider: string;
}

export const INVITE_ERROR_CODES = {
  disabled: "INVITE_DISABLED",
  notSeated: "INVITE_NOT_SEATED",
  badAddress: "INVITE_BAD_ADDRESS",
  tooMany: "INVITE_TOO_MANY",
  failed: "INVITE_FAILED",
} as const;

export type InviteErrorCode =
  (typeof INVITE_ERROR_CODES)[keyof typeof INVITE_ERROR_CODES];
