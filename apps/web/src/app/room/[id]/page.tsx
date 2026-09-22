"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { useSocket } from "@/hooks/useSocket";
import { connectPlayer, useConnection } from "@/components/ConnectionProvider";
import type { WaitingRoomState } from "@card-game/shared-types";
import { InvitePanel, useInviteConfig } from "@/components/lobby/InvitePanel";

export default function WaitingRoom() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const socket = useSocket();
  const connection = useConnection();
  const { data: session } = useSession();
  const [name, setName] = useState("");
  const [room, setRoom] = useState<WaitingRoomState | null>(null);
  const [error, setError] = useState("");
  const [starting, setStarting] = useState(false);
  const invites = useInviteConfig();
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
  const me = room?.players.find((p) => p.seatIndex === room.mySeat);
  const host = me?.isHost;
  const notReady = room?.players.filter((p) => !p.ready) ?? [];
  const gameName =
    room?.gameType === "seven-six"
      ? "Seven-Six"
      : room?.gameType === "forty-fives"
        ? "45s"
        : "cards";
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
            : room?.gameType === "forty-fives"
              ? "45s"
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
                        ? `${player.isHost ? "Host · " : ""}${
                            player.connected === false
                              ? "Reconnecting"
                              : player.ready
                                ? "Ready"
                                : "Not ready yet"
                          }`
                        : "A bot joins here when the game starts"}
                    </small>
                  </div>
                  {host && player && i !== room.mySeat && (
                    <button
                      className="button secondary seat-action"
                      disabled={!connection.connected}
                      onClick={() =>
                        socket.emit("room:remove_player", {
                          roomId: id,
                          seatIndex: i,
                        })
                      }
                    >
                      Free seat
                    </button>
                  )}
                  <span className="seat-number">
                    {room.gameType === "forty-fives"
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
              ? notReady.length
                ? `Waiting for ${notReady.map((p) => (p.seatIndex === room?.mySeat ? "you" : p.displayName)).join(" and ")}. At least two people are needed; bots fill any remaining seats.`
                : "Everyone is ready. Bots fill any remaining seats."
              : `${room?.host ?? "The host"} starts the game once everyone is ready.`}
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
            <button
              className={`button ${me?.ready ? "secondary" : "primary"} ready-toggle`}
              aria-pressed={me?.ready === true}
              disabled={!connection.connected || !me}
              onClick={() =>
                socket.emit("room:set_ready", {
                  roomId: id,
                  ready: !me?.ready,
                })
              }
            >
              {me?.ready ? "Not ready" : "I'm ready"}
            </button>
            {host && (
              <button
                className="button primary"
                disabled={
                  starting ||
                  !connection.connected ||
                  !room ||
                  room.players.length < 2 ||
                  notReady.length > 0 ||
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
        <InvitePanel
          roomId={id}
          gameName={gameName}
          myName={me?.displayName ?? name}
          canSend={invites?.channels ?? []}
        />
      </div>
    </div>
  );
}
