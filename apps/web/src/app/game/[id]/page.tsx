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

  // Redirect to lobby if signed out
  useEffect(() => {
    if (status === 'unauthenticated') {
      reset();
      router.push('/');
    }
  }, [status, reset, router]);

  // Join game room on mount and on reconnect
  useEffect(() => {
    if (!params.id) return;

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
  }, [params.id, socket, setGameId]);

  if (status === 'unauthenticated') {
    return null;
  }

  return (
    <div className="h-full">
      <GameBoard />
    </div>
  );
}
