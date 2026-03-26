'use client';

import { useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { GameType } from '@card-game/shared-types';

const SERVER_URL = process.env.NEXT_PUBLIC_SERVER_URL ?? 'http://localhost:3001';

interface LeaderboardEntry {
  rank: number;
  userId: string;
  displayName: string;
  username: string | null;
  avatarUrl: string | null;
  rating: number;
  gamesPlayed: number;
  provisional: boolean;
}

const GAME_TABS = [
  { type: 'hearts', label: 'Hearts', icon: '♥', color: 'text-red-500' },
  { type: 'spades', label: 'Spades', icon: '♠', color: 'text-blue-400' },
  { type: 'euchre', label: 'Euchre', icon: '🃏', color: 'text-yellow-400' },
];

export default function LeaderboardPage() {
  const { data: session } = useSession();
  const [gameType, setGameType] = useState('hearts');
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [myRank, setMyRank] = useState<{ rank: number; rating: number } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);

    async function load() {
      try {
        const res = await fetch(`${SERVER_URL}/api/leaderboard?gameType=${gameType}&limit=50`);
        const data = await res.json();
        if (data.success) setEntries(data.entries);

        if (session?.user?.email) {
          const rankRes = await fetch(
            `${SERVER_URL}/api/leaderboard/rank?gameType=${gameType}&email=${encodeURIComponent(session.user.email)}`,
          );
          const rankData = await rankRes.json();
          if (rankData.success && rankData.rank) {
            setMyRank({ rank: rankData.rank, rating: rankData.rating });
          } else {
            setMyRank(null);
          }
        }
      } catch {}
      setLoading(false);
    }

    load();
  }, [gameType, session]);

  const resolveAvatar = (url: string) =>
    url.startsWith('/') ? `${SERVER_URL}${url}` : url;

  return (
    <div className="max-w-3xl mx-auto p-6">
      <h1 className="text-2xl font-bold mb-6">Leaderboard</h1>

      {/* Game type tabs */}
      <div className="flex gap-1 p-1 bg-[var(--bg-secondary)] rounded-lg w-fit mb-6">
        {GAME_TABS.map((tab) => (
          <button
            key={tab.type}
            onClick={() => setGameType(tab.type)}
            className={`flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-md transition-colors ${
              gameType === tab.type
                ? 'bg-[var(--accent-gold)] text-black'
                : 'text-[var(--text-secondary)] hover:text-white'
            }`}
          >
            <span className={gameType === tab.type ? '' : tab.color}>{tab.icon}</span>
            {tab.label}
          </button>
        ))}
      </div>

      {/* My rank */}
      {myRank && (
        <div className="mb-4 px-4 py-3 bg-[var(--accent-gold)]/10 border border-[var(--accent-gold)]/20 rounded-lg flex items-center justify-between">
          <span className="text-sm">
            Your rank: <span className="font-bold text-[var(--accent-gold)]">#{myRank.rank}</span>
          </span>
          <span className="text-sm">
            Rating: <span className="font-bold">{myRank.rating}</span>
          </span>
        </div>
      )}

      {/* Leaderboard table */}
      <div className="bg-[var(--bg-secondary)] rounded-xl border border-[var(--border-subtle)] overflow-hidden">
        {/* Header */}
        <div className="grid grid-cols-[60px_1fr_100px_80px] px-4 py-3 text-xs text-[var(--text-secondary)] uppercase tracking-wider border-b border-[var(--border-subtle)]">
          <span>Rank</span>
          <span>Player</span>
          <span className="text-right">Rating</span>
          <span className="text-right">Games</span>
        </div>

        {loading ? (
          <div className="py-12 text-center text-[var(--text-secondary)] text-sm">Loading...</div>
        ) : entries.length === 0 ? (
          <div className="py-12 text-center text-[var(--text-secondary)] text-sm">
            No ranked players yet. Play a game to appear on the leaderboard!
          </div>
        ) : (
          <div className="divide-y divide-[var(--border-subtle)]">
            {entries.map((entry) => (
              <div
                key={entry.userId}
                className="grid grid-cols-[60px_1fr_100px_80px] px-4 py-3 items-center hover:bg-white/[0.02] transition-colors"
              >
                {/* Rank */}
                <span className={`text-sm font-bold ${
                  entry.rank === 1 ? 'text-[var(--accent-gold)]' :
                  entry.rank === 2 ? 'text-gray-400' :
                  entry.rank === 3 ? 'text-amber-700' : 'text-[var(--text-secondary)]'
                }`}>
                  {entry.rank <= 3 ? ['🥇', '🥈', '🥉'][entry.rank - 1] : `#${entry.rank}`}
                </span>

                {/* Player */}
                <div className="flex items-center gap-2.5 min-w-0">
                  {entry.avatarUrl ? (
                    <img
                      src={resolveAvatar(entry.avatarUrl)}
                      alt=""
                      className="w-8 h-8 rounded-full object-cover shrink-0"
                    />
                  ) : (
                    <div className="w-8 h-8 rounded-full bg-[var(--accent-blue)]/60 flex items-center justify-center text-xs font-bold shrink-0">
                      {entry.displayName[0].toUpperCase()}
                    </div>
                  )}
                  <div className="min-w-0">
                    <div className="text-sm font-medium truncate">
                      {entry.username ? `@${entry.username}` : entry.displayName}
                    </div>
                    {entry.username && (
                      <div className="text-xs text-[var(--text-secondary)] truncate">
                        {entry.displayName}
                      </div>
                    )}
                  </div>
                </div>

                {/* Rating */}
                <div className="text-right">
                  <span className="text-sm font-bold">{entry.rating}</span>
                  {entry.provisional && (
                    <span className="text-[10px] text-[var(--text-secondary)] ml-1">?</span>
                  )}
                </div>

                {/* Games */}
                <span className="text-right text-sm text-[var(--text-secondary)]">
                  {entry.gamesPlayed}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
