"use client";

import { useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { useSocket } from "@/hooks/useSocket";
import { useGameStore } from "@card-game/shared-store";
import { GameBoard } from "@/components/game/GameBoard";

export default function GamePage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { status } = useSession();
  const socket = useSocket();
  const { gameId, setGameId, reset } = useGameStore();

  useEffect(() => {
    reset();
    localStorage.setItem("cardarena-last-game", params.id);
  }, [params.id, reset]);

  // Join game room on mount and on reconnect
  useEffect(() => {
    if (!params.id || status === "loading") return;

    function joinGame() {
      setGameId(params.id);
      socket.emit("game:join", { gameId: params.id });
    }

    // Join now if already connected
    if (socket.connected) {
      joinGame();
    }

    // Re-join on (re)connect
    socket.on("connect", joinGame);

    return () => {
      socket.off("connect", joinGame);
      if (socket.connected) socket.emit("game:leave", { gameId: params.id });
    };
  }, [params.id, socket, setGameId, status]);

  return (
    <div className="h-full">
      <GameBoard />
    </div>
  );
}
