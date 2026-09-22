import type { InviteChannel } from "@card-game/shared-types";

/**
 * The seam between a table and whatever actually delivers a message.
 *
 * Everything above this interface deals in rooms and players; everything below
 * deals in addresses and providers. A deployment with no sender configured
 * still invites people — the browser hands the message to the player's own mail
 * or messaging app instead.
 */
export interface InviteMessage {
  channel: InviteChannel;
  /** An email address or a phone number in E.164 form. */
  to: string;
  subject: string;
  /** Plain text. No HTML, no tracking, no images. */
  body: string;
}

export interface InviteProvider {
  readonly name: string;
  /** Channels this provider will actually deliver. */
  readonly channels: InviteChannel[];
  send(message: InviteMessage): Promise<void>;
}

/** Used when nothing is configured. The browser falls back to the device. */
export class DisabledInviteProvider implements InviteProvider {
  readonly name = "none";
  readonly channels: InviteChannel[] = [];
  async send(): Promise<void> {
    throw new Error("This server does not send invitations itself");
  }
}
