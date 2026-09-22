import {
  INVITE_ERROR_CODES,
  type InviteChannel,
  type InviteConfig,
  type InviteErrorCode,
} from "@card-game/shared-types";
import type { FamilyRoom } from "./RoomService.js";
import type { InviteProvider } from "./invite/InviteProvider.js";

export class InviteError extends Error {
  constructor(
    readonly code: InviteErrorCode,
    message: string,
  ) {
    super(message);
  }
}

/** Enough for a family table; far short of anything worth abusing. */
export const INVITES_PER_ROOM = 10;
export const INVITE_WINDOW_MS = 10 * 60 * 1000;

// Deliberately strict rather than clever: a wrong address is better refused
// than delivered to a stranger.
const EMAIL = /^[^\s@,;<>"]+@[^\s@,;<>".]+(?:\.[^\s@,;<>".]+)*\.[a-z]{2,}$/i;
const E164 = /^\+[1-9]\d{7,14}$/;

/** Normalise what a person typed, or explain why it cannot be used. */
export function normaliseAddress(channel: InviteChannel, raw: unknown): string {
  const value = typeof raw === "string" ? raw.trim() : "";
  if (channel === "email") {
    if (!EMAIL.test(value) || value.length > 254)
      throw new InviteError(
        INVITE_ERROR_CODES.badAddress,
        "That does not look like an email address.",
      );
    return value;
  }
  // Keep a leading +, drop the spaces, brackets and dashes people type.
  const digits = value.replace(/[\s()\-.]/g, "");
  if (!E164.test(digits))
    throw new InviteError(
      INVITE_ERROR_CODES.badAddress,
      "Enter the phone number with its country code, like +353871234567.",
    );
  return digits;
}

export function inviteMessage(
  room: FamilyRoom,
  fromName: string,
  webUrl: string,
) {
  const game = room.gameType === "seven-six" ? "Seven-Six" : "45s";
  const link = `${webUrl.replace(/\/$/, "")}/room/${room.id}`;
  return {
    subject: `${fromName} invited you to a game of ${game}`,
    body: [
      `${fromName} has a seat for you at a game of ${game}.`,
      "",
      `Join here: ${link}`,
      `Room code: ${room.id}`,
      "",
      "No account is needed. The link works until the table is closed.",
    ].join("\n"),
  };
}

/**
 * Sends an invitation on a seated player's behalf.
 *
 * A room code is a capability: anyone holding it can take a seat. So the caller
 * only supplies a room, a channel and an address. Whether they hold a seat, who
 * the message says it is from, and what it says are all decided here.
 */
export class InviteService {
  private sent = new Map<string, number[]>();

  constructor(
    private provider: InviteProvider,
    private webUrl: string,
  ) {}

  config(): InviteConfig {
    return { channels: this.provider.channels, provider: this.provider.name };
  }

  private allow(roomId: string) {
    const now = Date.now();
    const recent = (this.sent.get(roomId) ?? []).filter(
      (at) => now - at < INVITE_WINDOW_MS,
    );
    if (recent.length >= INVITES_PER_ROOM)
      throw new InviteError(
        INVITE_ERROR_CODES.tooMany,
        "That is a lot of invitations at once. Try again in a few minutes.",
      );
    recent.push(now);
    this.sent.set(roomId, recent);
  }

  async send(
    room: FamilyRoom | null | undefined,
    participantId: string,
    channel: unknown,
    to: unknown,
  ): Promise<{ channel: InviteChannel; to: string }> {
    const wanted = channel === "sms" ? "sms" : "email";
    if (!this.provider.channels.includes(wanted))
      throw new InviteError(
        INVITE_ERROR_CODES.disabled,
        wanted === "sms"
          ? "This server does not send text messages. Share the link from your phone instead."
          : "This server does not send email. Share the link instead.",
      );
    const player = room?.players.find((p) => p.id === participantId);
    if (!room || !player)
      throw new InviteError(
        INVITE_ERROR_CODES.notSeated,
        "You are not at this table.",
      );
    const address = normaliseAddress(wanted, to);
    this.allow(room.id);
    // The player supplies the address and nothing else: the name comes from
    // their seat and the wording from here.
    const { subject, body } = inviteMessage(
      room,
      player.displayName,
      this.webUrl,
    );
    try {
      await this.provider.send({ channel: wanted, to: address, subject, body });
    } catch (error) {
      // Never surface the provider's wording: it can name the account.
      console.error("Invitation send failed", error);
      throw new InviteError(
        INVITE_ERROR_CODES.failed,
        "The invitation could not be sent. Share the link instead.",
      );
    }
    return { channel: wanted, to: address };
  }
}
