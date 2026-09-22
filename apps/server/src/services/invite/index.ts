import {
  DisabledInviteProvider,
  type InviteProvider,
} from "./InviteProvider.js";
import { ResendProvider } from "./ResendProvider.js";

export * from "./InviteProvider.js";
export { ResendProvider } from "./ResendProvider.js";

export interface InviteEnv {
  INVITE_PROVIDER?: string;
  RESEND_API_KEY?: string;
  INVITE_FROM_EMAIL?: string;
}

/**
 * No sender unless one is named. Without it the table still invites people;
 * the browser opens the player's own mail or messaging app.
 */
export function createInviteProvider(env: InviteEnv): InviteProvider {
  switch ((env.INVITE_PROVIDER ?? "none").toLowerCase()) {
    case "":
    case "none":
      return new DisabledInviteProvider();
    case "resend":
      return new ResendProvider({
        apiKey: env.RESEND_API_KEY ?? "",
        from: env.INVITE_FROM_EMAIL ?? "",
      });
    default:
      throw new Error(
        `Unknown INVITE_PROVIDER "${env.INVITE_PROVIDER}". Use "resend" or "none".`,
      );
  }
}
