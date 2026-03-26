'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { useSocket } from '@/hooks/useSocket';
import { useGameStore } from '@card-game/shared-store';
import type { WaitingRoomState } from '@card-game/shared-types';

export default function WaitingRoomPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { status } = useSession();
  const socket = useSocket();
  const { setGameId } = useGameStore();
  const [room, setRoom] = useState<WaitingRoomState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!params.id || status === 'loading') return;

    function onUpdate(state: WaitingRoomState) {
      setRoom(state);
      setError(null);
    }

    function onStarted({ gameId }: { gameId: string }) {
      setGameId(gameId);
      router.push(`/game/${gameId}`);
    }

    function onError({ message }: { message: string }) {
      setError(message);
    }

    socket.on('room:update', onUpdate);
    socket.on('room:started', onStarted);
    socket.on('room:error', onError);

    // Join the room
    if (socket.connected) {
      socket.emit('room:join', { roomId: params.id });
    }
    socket.on('connect', () => {
      socket.emit('room:join', { roomId: params.id });
    });

    return () => {
      socket.off('room:update', onUpdate);
      socket.off('room:started', onStarted);
      socket.off('room:error', onError);
      socket.off('connect');
      socket.emit('room:leave', { roomId: params.id });
    };
  }, [params.id, socket, status, setGameId, router]);

  const handleStart = () => {
    if (params.id) {
      socket.emit('room:start', { roomId: params.id });
    }
  };

  const handleLeave = () => {
    if (params.id) {
      socket.emit('room:leave', { roomId: params.id });
      router.push('/');
    }
  };

  const copyLink = () => {
    const url = `${window.location.origin}/room/${params.id}`;
    navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const isHost = room?.players.some((p) => p.isHost && p.displayName === room.host);

  if (status === 'loading' || !room) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-[var(--accent-blue)] border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <div className="text-[var(--text-muted)] text-sm">
            {error ?? 'Joining room...'}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-center h-full p-6">
      <div className="bg-[var(--bg-secondary)] rounded-xl border border-[var(--border-subtle)] p-6 w-full max-w-md">
        {/* Header */}
        <div className="text-center mb-6">
          <div className="text-2xl mb-1">
            {room.gameType === 'hearts' ? '♥' : room.gameType === 'spades' ? '♠' : '🃏'}
          </div>
          <h1 className="text-xl font-bold capitalize">{room.gameType}</h1>
          <p className="text-[var(--text-muted)] text-sm mt-1">Waiting for players...</p>
        </div>

        {/* Room code + copy link */}
        <div className="flex items-center justify-between bg-[var(--bg-primary)] rounded-lg px-4 py-3 mb-4">
          <div>
            <div className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider">Room Code</div>
            <div className="text-lg font-bold font-mono tracking-widest">{room.roomId}</div>
          </div>
          <button
            onClick={copyLink}
            className="px-3 py-1.5 text-[12px] font-medium bg-[var(--accent-blue)] text-white rounded hover:brightness-110 transition-all"
          >
            {copied ? 'Copied!' : 'Copy Link'}
          </button>
        </div>

        {/* Players */}
        <div className="mb-6">
          <div className="text-[11px] text-[var(--text-muted)] uppercase tracking-wider mb-2">
            Players ({room.players.length}/{room.maxPlayers})
          </div>
          <div className="space-y-2">
            {room.players.map((player, i) => (
              <div
                key={i}
                className="flex items-center gap-3 bg-[var(--bg-primary)] rounded-lg px-3 py-2"
              >
                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0 ${
                  player.isHost ? 'bg-[var(--accent-gold)] text-[#1a1a1a]' : 'bg-[var(--accent-blue)]/50 text-white'
                }`}>
                  {player.displayName[0]?.toUpperCase() ?? '?'}
                </div>
                <div className="min-w-0">
                  <div className="text-[13px] font-semibold truncate">
                    {player.displayName}
                    {player.isHost && (
                      <span className="text-[var(--accent-gold)] text-[10px] font-normal ml-1.5">HOST</span>
                    )}
                  </div>
                </div>
              </div>
            ))}
            {/* Empty seats */}
            {Array.from({ length: room.maxPlayers - room.players.length }).map((_, i) => (
              <div
                key={`empty-${i}`}
                className="flex items-center gap-3 border border-dashed border-[var(--border-subtle)] rounded-lg px-3 py-2"
              >
                <div className="w-8 h-8 rounded-full bg-[var(--bg-tertiary)] flex items-center justify-center text-[var(--text-muted)] text-sm">?</div>
                <span className="text-[13px] text-[var(--text-muted)]">
                  {room.fillWithAI ? 'AI will fill' : 'Waiting...'}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Error */}
        {error && (
          <div className="mb-4 px-3 py-2 rounded bg-[var(--accent-red)]/10 border border-[var(--accent-red)]/30 text-[12px] text-[var(--accent-red)]">
            {error}
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-2">
          <button
            onClick={handleLeave}
            className="flex-1 px-4 py-2.5 text-[13px] border border-[var(--border-subtle)] rounded-lg hover:bg-white/[0.04] transition-colors"
          >
            Leave
          </button>
          {isHost && (
            <button
              onClick={handleStart}
              disabled={room.players.length < 2}
              className="flex-1 px-4 py-2.5 text-[13px] font-semibold bg-[var(--accent-green)] text-white rounded-lg hover:brightness-110 disabled:opacity-40 transition-all"
            >
              Start Game ({room.players.length}/{room.maxPlayers})
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
