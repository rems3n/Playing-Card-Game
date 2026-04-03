'use client';

import { useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { useSocket } from '@/hooks/useSocket';
import { useGameStore } from '@card-game/shared-store';
import { GameBoard } from '@/components/game/GameBoard';

export default function GamePage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { status } = useSession();
  const socket = useSocket();
  const { gameId, setGameId, reset } = useGameStore();

  // Join game room on mount and on reconnect
  useEffect(() => {
    if (!params.id || status === 'loading') return;

    function joinGame() {
      setGameId(params.id);
      socket.emit('game:join', { gameId: params.id });
    }

    // Join now if already connected
    if (socket.connected) {
      joinGame();
    }

    // Re-join on (re)connect
    socket.on('connect', joinGame);

    return () => {
      socket.off('connect', joinGame);
    };
  }, [params.id, socket, setGameId, status]);

  return (
    <div className="h-full">
      <GameBoard />
    </div>
  );
}
