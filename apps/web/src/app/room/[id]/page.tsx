"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { useSocket } from "@/hooks/useSocket";
import { connectPlayer, useConnection } from "@/components/ConnectionProvider";
import type { WaitingRoomState } from "@card-game/shared-types";

export default function WaitingRoom() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const socket = useSocket();
  const connection = useConnection();
  const { data: session } = useSession();
  const [name, setName] = useState("");
  const [room, setRoom] = useState<WaitingRoomState | null>(null);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [starting, setStarting] = useState(false);
  useEffect(() => {
    const update = (state: WaitingRoomState) => {
      if (state.roomId === id) {
        setRoom(state);
        setError("");
      }
    };
    const started = ({ gameId }: { gameId: string }) =>
      router.push(`/game/${gameId}`);
    const failed = ({ message }: { message: string }) => {
      setError(message);
      setStarting(false);
    };
    const join = () => socket.emit("room:join", { roomId: id });
    socket.on("room:update", update);
    socket.on("room:started", started);
    socket.on("room:error", failed);
    socket.on("connect", join);
    if (socket.connected) join();
    return () => {
      socket.off("room:update", update);
      socket.off("room:started", started);
      socket.off("room:error", failed);
      socket.off("connect", join);
      if (socket.connected) socket.emit("room:leave", { roomId: id });
    };
  }, [id, router, socket]);
  useEffect(() => {
    if (!starting) return;
    const timer = setTimeout(() => {
      setStarting(false);
      setError("Starting took too long. Rejoin the room to check its status.");
    }, 15000);
    return () => clearTimeout(timer);
  }, [starting]);
  const host = room?.players.find((p) => p.seatIndex === room.mySeat)?.isHost;
  async function copy() {
    try {
      await navigator.clipboard.writeText(`${location.origin}/room/${id}`);
      setCopied(true);
    } catch {
      setError("Copy the room code below and share it with your group.");
    }
  }
  return (
    <div className="waiting-page">
      <Link className="text-link" href="/">
        ← Games
      </Link>
      <div className="waiting-intro">
        <p className="eyebrow">PRIVATE TABLE</p>
        <h1>
          {room?.gameType === "seven-six"
            ? "Seven-Six"
            : room?.gameType === "euchre"
              ? "45s / Euchre"
              : "Your private table"}
        </h1>
        <p>Share the room code below. Seats are held for people who join.</p>
      </div>
      {!connection.connected && (
        <p className="notice" role="status">
          {connection.message || "Connecting…"}{" "}
          <button onClick={connection.retry}>Retry</button>
        </p>
      )}
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
      {!session?.user && (
        <form
          className="room-name-form"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!name.trim()) return;
            try {
              await connectPlayer(name.trim());
            } catch (error) {
              setError(
                error instanceof Error
                  ? error.message
                  : "Could not update name",
              );
            }
          }}
        >
          <label>
            Your name
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={
                room?.players[room.mySeat ?? 0]?.displayName ??
                "Enter your name"
              }
              maxLength={50}
              autoComplete="nickname"
            />
          </label>
          <button className="button secondary" disabled={!name.trim()}>
            Update name
          </button>
        </form>
      )}
      <div className="waiting-grid">
        <section className="panel seats-panel">
          <div className="section-heading">
            <h2>At the table</h2>
            <span className="small-note">
              {room?.players.length ?? 0} / {room?.maxPlayers ?? "—"} players
            </span>
          </div>
          {room ? (
            Array.from({ length: room.maxPlayers }, (_, i) => {
              const player = room.players[i];
              return (
                <div
                  className={`waiting-seat ${player ? "" : "empty"}`}
                  key={i}
                >
                  <span className="avatar">
                    {player ? player.displayName[0] : "+"}
                  </span>
                  <div>
                    <strong>
                      {player
                        ? `${player.displayName}${i === room.mySeat ? " (you)" : ""}`
                        : "An open seat"}
                    </strong>
                    <small>
                      {player
                        ? `${player.isHost ? "Host · " : ""}${player.connected === false ? "Reconnecting" : "Ready to play"}`
                        : "A bot joins here when the game starts"}
                    </small>
                  </div>
                  <span className="seat-number">
                    {room.gameType === "euchre"
                      ? `Team ${(i % 2) + 1}`
                      : `Seat ${i + 1}`}
                  </span>
                </div>
              );
            })
          ) : (
            <p role="status">Finding your table…</p>
          )}
          <p className="setup-note">
            {host
              ? "Start when everyone is here. At least two people are needed; bots fill any remaining seats."
              : `Waiting for ${room?.host ?? "the host"} to start the game.`}
          </p>
          <div className="waiting-actions">
            <button
              className="button secondary"
              disabled={!connection.connected}
              onClick={() => {
                socket.emit("room:leave", { roomId: id });
                router.push("/");
              }}
            >
              Leave room
            </button>
            {host && (
              <button
                className="button primary"
                disabled={
                  starting ||
                  !connection.connected ||
                  !room ||
                  room.players.length < 2 ||
                  room.players.some((p) => p.connected === false)
                }
                onClick={() => {
                  setStarting(true);
                  socket.emit("room:start", { roomId: id });
                }}
              >
                {starting ? "Dealing…" : "Start game →"}
              </button>
            )}
          </div>
        </section>
        <aside className="panel invitation-panel">
          <span className="round-icon" aria-hidden>
            ↗
          </span>
          <h2>Bring everyone in.</h2>
          <p>Share the link or the room code with your friends and family.</p>
          <label>
            ROOM CODE
            <input
              readOnly
              value={id}
              onFocus={(e) => e.target.select()}
              aria-label="Room code"
            />
          </label>
          <button className="button primary full" onClick={copy}>
            {copied ? "Link copied ✓" : "Copy invite link"}
          </button>
          <p className="small-note">
            Only people with your invitation can find this table. Room links
            expire after 24 hours of inactivity.
          </p>
          <Link href="/rules" className="text-link">
            Review the rules →
          </Link>
        </aside>
      </div>
    </div>
  );
}
