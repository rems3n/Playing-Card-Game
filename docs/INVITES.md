# Inviting people to a table

A room code is a capability: anyone holding it can take a seat. So the lobby
treats sending one like any other privileged action — only a seated player can
ask, the server writes the message, and the rate is capped.

**No setup is required.** Out of the box the invitation opens in the player's
own mail or messaging app, already written. That costs nothing, needs no
account, has no deliverability problem and cannot be abused to send mail from
your domain. Configure a sender only if you want the server to send it instead.

## What a player sees

In the waiting room: a channel switch (Email / Phone), one address field, and
**Send invitation**.

- Where the server has a sender for that channel, it sends the message and the
  field clears with "Invitation sent to …".
- Where it does not, the button opens `mailto:` or `sms:` with the subject and
  body filled in. One tap in their own app sends it.
- **Share the link** uses the phone's native share sheet where there is one
  (`navigator.share`), so people can send it through whatever they already use.
  On a desktop browser it copies the link.
- The room code is shown with a plain statement of what it grants.

The message names the sender, the game, the link and the code. A player supplies
the address and nothing else: the name comes from their seat and the wording
from the server, so nobody can send arbitrary text from your domain.

## Variables

| Service | Variable | Purpose |
| --- | --- | --- |
| Server | `INVITE_PROVIDER` | `none` (default) or `resend`. Any other value fails at start-up rather than silently disabling invitations. |
| Server | `RESEND_API_KEY` | Resend API key. Server only. |
| Server | `INVITE_FROM_EMAIL` | A verified sender on your domain, e.g. `CardArena <table@yourdomain.com>`. |

`GET /invite/config` returns only `{ channels, provider }`, which is how the web
app knows whether to send through the server or through the device.

## Setting up email with Resend

1. Create an account at https://resend.com.
2. Add and verify your sending domain (DNS records: SPF, DKIM, and a return
   path). Sending from an unverified domain lands in spam.
3. Create an API key with send permission.
4. On the Railway **API service**, set `INVITE_PROVIDER=resend`,
   `RESEND_API_KEY` and `INVITE_FROM_EMAIL` as runtime variables. Set all three
   together: `INVITE_PROVIDER=resend` without the other two fails at start-up on
   purpose, rather than pretending invitations work.
5. Redeploy the API service. No web rebuild is needed.
6. Confirm `GET https://<api-host>/invite/config` returns
   `{"channels":["email"],"provider":"resend"}`.

Resend's free tier is generous for a family game; check
https://resend.com/pricing for current limits. Any provider with a plain HTTPS
send endpoint fits the same interface — `InviteProvider` in
`apps/server/src/services/invite/InviteProvider.ts` is one method.

## Why there is no SMS sender

Sending text messages from a server means Twilio or similar: a rented number,
per-message cost, and — for United States numbers — A2P 10DLC brand and campaign
registration, which takes days and is rejected for vague use cases. For a family
card game that is a great deal of work to replace a button that already opens
the phone's own messaging app with the invitation written.

The interface is ready if you want it: add a provider that reports
`channels: ["sms"]` and the lobby will use it without any change to the UI.

## Limits

- At most 10 invitations per room per 10 minutes.
- Email addresses and phone numbers are validated strictly; a phone number must
  carry its country code (`+353871234567`).
- The provider's own error text is never shown to a player — it can name your
  account or domain. Players see "The invitation could not be sent. Share the
  link instead."
- Nothing about an invitation is stored. There is no open tracking, no pixel,
  and no record of who was invited.
