"use client";
import { useEffect, useState } from "react";
import type { InviteChannel, InviteConfig } from "@card-game/shared-types";
import { useServerConfig } from "@/hooks/useServerConfig";
import { useSocket } from "@/hooks/useSocket";

const INVITES_OFF: InviteConfig = { channels: [], provider: "none" };

export function useInviteConfig(fetcher: typeof fetch | null = null) {
  return useServerConfig<InviteConfig>("/invite/config", INVITES_OFF, fetcher);
}

export function inviteText(game: string, from: string, link: string, code: string) {
  const who = from.trim() ? from.trim() : "Someone";
  return {
    subject: `${who} invited you to a game of ${game}`,
    body: `${who} has a seat for you at a game of ${game}.\n\nJoin here: ${link}\nRoom code: ${code}\n\nNo account is needed.`,
  };
}

/** Hands the message to the player's own mail or messaging app. */
export function deviceInviteLink(
  channel: InviteChannel,
  to: string,
  subject: string,
  body: string,
) {
  const address = to.trim();
  if (channel === "email")
    return `mailto:${encodeURIComponent(address)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  // iOS wants ?body=, Android wants ?body= too on modern versions; the
  // separator is the one real difference between them and & is accepted.
  return `sms:${address.replace(/[^\d+]/g, "")}?&body=${encodeURIComponent(body)}`;
}

/**
 * Invite someone by email or phone.
 *
 * Where the server has a sender configured it sends the message itself. Where
 * it does not — which is the default — the invitation opens in the player's own
 * mail or messaging app, already written, so it always works and costs nothing.
 */
export function InvitePanel({
  roomId,
  gameName,
  myName,
  canSend,
  open,
}: {
  roomId: string;
  gameName: string;
  myName: string;
  /** Channels the server will send itself. */
  canSend: InviteChannel[];
  /** Injected in tests; defaults to opening a link in this window. */
  open?: (href: string) => void;
}) {
  const socket = useSocket();
  const [channel, setChannel] = useState<InviteChannel>("email");
  const [to, setTo] = useState("");
  const [note, setNote] = useState("");
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const sent = ({ to: address }: { to: string }) => {
      setBusy(false);
      setTo("");
      setNote(`Invitation sent to ${address}.`);
    };
    const failed = () => setBusy(false);
    socket.on("room:invite_sent", sent);
    socket.on("room:error", failed);
    return () => {
      socket.off("room:invite_sent", sent);
      socket.off("room:error", failed);
    };
  }, [socket]);

  const link =
    typeof location === "undefined"
      ? `/room/${roomId}`
      : `${location.origin}/room/${roomId}`;
  const { subject, body } = inviteText(gameName, myName, link, roomId);
  const serverSends = canSend.includes(channel);
  const openLink = open ?? ((href: string) => { location.href = href; });

  async function share() {
    setNote("");
    if (typeof navigator !== "undefined" && navigator.share) {
      try {
        await navigator.share({ title: subject, text: body, url: link });
        return;
      } catch {
        // The person closed the share sheet; fall through to copying.
      }
    }
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 4000);
    } catch {
      setNote("Copy the room code below and send it yourself.");
    }
  }

  function send(event: React.FormEvent) {
    event.preventDefault();
    setNote("");
    if (!to.trim()) return;
    if (serverSends) {
      setBusy(true);
      socket.emit("room:send_invite", { roomId, channel, to: to.trim() });
      return;
    }
    openLink(deviceInviteLink(channel, to, subject, body));
    setNote(
      channel === "email"
        ? "Your email app should open with the invitation ready to send."
        : "Your messaging app should open with the invitation ready to send.",
    );
  }

  return (
    <aside className="panel invitation-panel">
      <h2>Invite people</h2>
      <p>Send the link, or share it yourself.</p>
      <form className="invite-form" onSubmit={send}>
        <div className="invite-channels" role="group" aria-label="Invite by">
          {(["email", "sms"] as const).map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={channel === value}
              onClick={() => {
                setChannel(value);
                setTo("");
                setNote("");
              }}
            >
              {value === "email" ? "Email" : "Phone"}
            </button>
          ))}
        </div>
        <label>
          {channel === "email" ? "Email address" : "Phone number"}
          <input
            type={channel === "email" ? "email" : "tel"}
            value={to}
            onChange={(event) => setTo(event.target.value)}
            placeholder={
              channel === "email" ? "them@example.com" : "+353 87 123 4567"
            }
            autoComplete={channel === "email" ? "email" : "tel"}
            inputMode={channel === "email" ? "email" : "tel"}
            maxLength={254}
          />
        </label>
        <button className="button primary full" disabled={!to.trim() || busy}>
          {busy ? "Sending…" : "Send invitation"}
        </button>
        <p className="small-note" role="status">
          {note ||
            (serverSends
              ? "The invitation is sent for you."
              : channel === "email"
                ? "This opens your own email app with the invitation written."
                : "This opens your own messaging app with the invitation written.")}
        </p>
      </form>
      <button className="button secondary full" onClick={share}>
        {copied ? "Link copied" : "Share the link"}
      </button>
      <label className="room-code-field">
        ROOM CODE
        <input
          readOnly
          value={roomId}
          onFocus={(event) => event.target.select()}
          aria-label="Room code"
        />
      </label>
      <p className="small-note">
        Anyone with this code can take a seat. Only share it with people you
        want at the table.
      </p>
    </aside>
  );
}
