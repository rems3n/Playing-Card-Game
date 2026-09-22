import type { InviteChannel } from "@card-game/shared-types";
import type { InviteMessage, InviteProvider } from "./InviteProvider.js";

export interface ResendSettings {
  apiKey: string;
  /** A verified sender on your domain, e.g. "CardArena <table@example.com>". */
  from: string;
}

/**
 * Email only. Plain text, one recipient per request, no tracking pixels and no
 * stored copy: the message exists to carry a room code and nothing else.
 */
export class ResendProvider implements InviteProvider {
  readonly name = "resend";
  readonly channels: InviteChannel[] = ["email"];

  constructor(private settings: ResendSettings) {
    if (!settings.apiKey || !settings.from)
      throw new Error("RESEND_API_KEY and INVITE_FROM_EMAIL are both required");
  }

  async send(message: InviteMessage): Promise<void> {
    if (message.channel !== "email")
      throw new Error("This server can only send email invitations");
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.settings.apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        from: this.settings.from,
        to: [message.to],
        subject: message.subject,
        text: message.body,
      }),
    });
    if (!response.ok) {
      // The provider's own wording is not shown to a player; it can name the
      // account or the domain.
      const detail = await response.text().catch(() => "");
      throw new Error(
        `Invitation provider returned ${response.status}${detail ? `: ${detail.slice(0, 200)}` : ""}`,
      );
    }
  }
}
