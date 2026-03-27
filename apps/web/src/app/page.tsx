'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { AIDifficulty, GameType } from '@card-game/shared-types';
import { useSocket } from '@/hooks/useSocket';
import { useGameStore } from '@card-game/shared-store';
import { FriendsList } from '@/components/lobby/FriendsList';

const GAME_OPTIONS = [
  {
    type: GameType.Hearts,
    name: 'Hearts',
    icon: '♥',
    color: 'text-red-500',
    description: 'Avoid taking hearts and the queen of spades. Lowest score wins!',
    players: '4 players',
    available: true,
  },
  {
    type: GameType.Spades,
    name: 'Spades',
    icon: '♠',
    color: 'text-blue-400',
    description: 'Bid tricks with your partner. Meet your bid to score points.',
    players: '4 players (2v2)',
    available: true,
  },
  {
    type: GameType.Euchre,
    name: 'Euchre',
    icon: '🃏',
    color: 'text-yellow-400',
    description: 'Call trump, take tricks, and race to 10 points with your partner.',
    players: '4 players (2v2)',
    available: true,
  },
  {
    type: 'rummy' as GameType,
    name: 'Rummy',
    icon: '🂡',
    color: 'text-green-400',
    description: 'Form sets and runs to be the first to go out. Classic meld-building game.',
    players: '2-4 players',
    available: false,
  },
  {
    type: 'poker' as GameType,
    name: 'Poker',
    icon: '🎰',
    color: 'text-amber-400',
    description: 'Texas Hold\'em. Bet, bluff, and build the best 5-card hand.',
    players: '2-8 players',
    available: false,
  },
];

const DIFFICULTY_OPTIONS = [
  { value: AIDifficulty.Beginner, label: 'Beginner', emoji: '😊', desc: 'Random play' },
  { value: AIDifficulty.Intermediate, label: 'Intermediate', emoji: '🧐', desc: 'Smart play' },
  { value: AIDifficulty.Advanced, label: 'Advanced', emoji: '😤', desc: 'Card counting' },
  { value: AIDifficulty.Expert, label: 'Expert', emoji: '🧠', desc: 'Monte Carlo' },
];

export default function LobbyPage() {
  const router = useRouter();
  const socket = useSocket();
  const { data: session } = useSession();
  const { setGameId } = useGameStore();
  const [selectedGame, setSelectedGame] = useState<GameType>(GameType.Hearts);
  const [difficulty, setDifficulty] = useState<AIDifficulty>(AIDifficulty.Beginner);
  const [isCreating, setIsCreating] = useState(false);
  const [matchmaking, setMatchmaking] = useState(false);
  const [queuePosition, setQueuePosition] = useState<number | null>(null);
  const [playMode, setPlayMode] = useState<'ai' | 'online'>('online');
  const [gameSearch, setGameSearch] = useState('');
  const [gameDropdownOpen, setGameDropdownOpen] = useState(false);
  const [joinCode, setJoinCode] = useState('');
  const [matchProposal, setMatchProposal] = useState<{
    matchId: string;
    gameType: string;
    players: Array<{ displayName: string }>;
    expiresIn: number;
    acceptedCount: number;
  } | null>(null);
  const [proposalTimer, setProposalTimer] = useState(0);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setGameDropdownOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  // Listen for matchmaking and room events
  useEffect(() => {
    socket.on('matchmaking:found', ({ gameId }) => {
      setMatchmaking(false);
      setMatchProposal(null);
      setGameId(gameId);
      router.push(`/game/${gameId}`);
    });

    socket.on('matchmaking:waiting', ({ position }) => {
      setQueuePosition(position);
    });

    socket.on('matchmaking:proposed', (data) => {
      setMatchmaking(false);
      setMatchProposal({
        matchId: data.matchId,
        gameType: data.gameType,
        players: data.players,
        expiresIn: data.expiresIn,
        acceptedCount: 0,
      });
      setProposalTimer(data.expiresIn);
    });

    socket.on('matchmaking:accepted', ({ matchId, acceptedCount, totalCount }) => {
      setMatchProposal((prev) => prev?.matchId === matchId ? { ...prev, acceptedCount } : prev);
    });

    socket.on('matchmaking:declined', ({ matchId, reason }) => {
      setMatchProposal(null);
      setMatchmaking(false);
    });

    socket.on('room:created', ({ roomId }) => {
      router.push(`/room/${roomId}`);
    });

    return () => {
      socket.off('matchmaking:found');
      socket.off('matchmaking:waiting');
      socket.off('matchmaking:proposed');
      socket.off('matchmaking:accepted');
      socket.off('matchmaking:declined');
      socket.off('room:created');
    };
  }, [socket, setGameId, router]);

  // Countdown timer for match proposal
  useEffect(() => {
    if (!matchProposal || proposalTimer <= 0) return;
    const interval = setInterval(() => {
      setProposalTimer((t) => Math.max(0, t - 1));
    }, 1000);
    return () => clearInterval(interval);
  }, [matchProposal, proposalTimer]);

  const handleCreateRoom = () => {
    socket.emit('room:create', { gameType: selectedGame });
  };

  const handlePlayAI = () => {
    setIsCreating(true);

    socket.once('lobby:game_created', ({ gameId }) => {
      setGameId(gameId);
      router.push(`/game/${gameId}`);
    });

    socket.once('game:error', ({ message }) => {
      setIsCreating(false);
      alert(`Failed to create game: ${message}`);
    });

    socket.emit('lobby:create_game', {
      gameType: selectedGame,
      aiDifficulty: difficulty,
      fillWithAI: true,
    });
  };

  const handleMatchmaking = () => {
    setMatchmaking(true);
    setQueuePosition(null);
    socket.emit('matchmaking:join', { gameType: selectedGame });
  };

  const handleCancelMatchmaking = () => {
    setMatchmaking(false);
    setQueuePosition(null);
    socket.emit('matchmaking:cancel');
  };

  return (
    <div className="max-w-6xl mx-auto p-6">
      {/* Hero */}
      <div className="text-center mb-8">
        <h1 className="text-4xl font-bold mb-2">
          <span className="text-[var(--accent-gold)]">Card</span>Arena
        </h1>
        <p className="text-[var(--text-secondary)]">
          Play classic card games against AI opponents or friends
        </p>
      </div>

      <div className="flex gap-6">
        {/* Main content */}
        <div className="flex-1 min-w-0">
          {/* Game selection */}
          <div className="mb-6">
            <h2 className="text-lg font-semibold mb-3">Choose a Game</h2>

            {/* Search bar + dropdown toggle */}
            <div className="relative mb-2" ref={dropdownRef}>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-muted)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                  </svg>
                  <input
                    type="text"
                    value={gameSearch}
                    onChange={(e) => { setGameSearch(e.target.value); setGameDropdownOpen(true); }}
                    onFocus={() => setGameDropdownOpen(true)}
                    placeholder="Search games..."
                    className="w-full bg-[var(--bg-secondary)] border border-[var(--border-subtle)] rounded-lg pl-9 pr-3 py-2.5 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--accent-blue)]/50"
                  />
                </div>
                <button
                  onClick={() => setGameDropdownOpen(!gameDropdownOpen)}
                  className="px-3 py-2.5 bg-[var(--bg-secondary)] border border-[var(--border-subtle)] rounded-lg hover:border-white/20 transition-colors"
                >
                  <svg className={`w-4 h-4 text-[var(--text-secondary)] transition-transform ${gameDropdownOpen ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
              </div>

              {/* Dropdown list */}
              {gameDropdownOpen && (
                <div className="absolute z-20 left-0 right-0 mt-1 bg-[var(--bg-tertiary)] border border-[var(--border-medium)] rounded-lg shadow-xl overflow-hidden">
                  {GAME_OPTIONS
                    .filter((g) =>
                      g.name.toLowerCase().includes(gameSearch.toLowerCase()) ||
                      g.description.toLowerCase().includes(gameSearch.toLowerCase())
                    )
                    .map((game) => (
                      <button
                        key={game.type}
                        onClick={() => {
                          if (game.available) {
                            setSelectedGame(game.type);
                            setGameDropdownOpen(false);
                            setGameSearch('');
                          }
                        }}
                        disabled={!game.available}
                        className={`
                          flex items-center gap-3 w-full text-left px-4 py-3 transition-colors
                          ${selectedGame === game.type ? 'bg-[var(--accent-gold)]/10' : 'hover:bg-white/[0.04]'}
                          ${!game.available ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
                        `}
                      >
                        <span className={`text-xl shrink-0 ${game.color}`}>{game.icon}</span>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-semibold">{game.name}</span>
                            <span className="text-[10px] text-[var(--text-muted)]">{game.players}</span>
                            {selectedGame === game.type && (
                              <svg className="w-4 h-4 text-[var(--accent-gold)] shrink-0 ml-auto" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                              </svg>
                            )}
                            {!game.available && (
                              <span className="text-[10px] bg-white/10 px-1.5 py-0.5 rounded-full">Soon</span>
                            )}
                          </div>
                          <p className="text-[11px] text-[var(--text-secondary)] mt-0.5">{game.description}</p>
                        </div>
                      </button>
                    ))}
                  {GAME_OPTIONS.filter((g) =>
                    g.name.toLowerCase().includes(gameSearch.toLowerCase()) ||
                    g.description.toLowerCase().includes(gameSearch.toLowerCase())
                  ).length === 0 && (
                    <div className="px-4 py-3 text-sm text-[var(--text-muted)] text-center">
                      No games found
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Game list — always visible, filtered by search */}
            {!gameDropdownOpen && (() => {
              const filtered = GAME_OPTIONS.filter((g) =>
                g.name.toLowerCase().includes(gameSearch.toLowerCase()) ||
                g.description.toLowerCase().includes(gameSearch.toLowerCase())
              );
              return (
                <div className="flex flex-col gap-1.5">
                  {filtered.map((game) => (
                    <button
                      key={game.type}
                      onClick={() => game.available && setSelectedGame(game.type)}
                      disabled={!game.available}
                      className={`
                        flex items-center gap-3 text-left px-4 py-2.5 rounded-lg border-2 transition-all
                        ${selectedGame === game.type
                          ? 'border-[var(--accent-gold)] bg-[var(--accent-gold)]/10'
                          : 'border-[var(--border-subtle)] bg-[var(--bg-secondary)] hover:border-white/20'
                        }
                        ${!game.available ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
                      `}
                    >
                      <span className={`text-xl shrink-0 ${game.color}`}>{game.icon}</span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-semibold">{game.name}</span>
                          <span className="text-[10px] text-[var(--text-muted)]">{game.players}</span>
                          {selectedGame === game.type && (
                            <svg className="w-4 h-4 text-[var(--accent-gold)] shrink-0 ml-auto" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                            </svg>
                          )}
                          {!game.available && (
                            <span className="text-[10px] bg-white/10 px-1.5 py-0.5 rounded-full ml-auto">Soon</span>
                          )}
                        </div>
                        <p className="text-[11px] text-[var(--text-secondary)] mt-0.5">{game.description}</p>
                      </div>
                    </button>
                  ))}
                  {filtered.length === 0 && (
                    <div className="text-sm text-[var(--text-muted)] text-center py-3">No games found</div>
                  )}
                </div>
              );
            })()}
          </div>

          {/* Play mode */}
          <div className="mb-4">
            <h2 className="text-lg font-semibold mb-3">Play</h2>
            <div className="flex gap-1 p-1 bg-[var(--bg-secondary)] rounded-lg w-fit">
              <button
                onClick={() => setPlayMode('online')}
                className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${
                  playMode === 'online'
                    ? 'bg-[var(--accent-blue)] text-white'
                    : 'text-[var(--text-secondary)] hover:text-white'
                }`}
              >
                With Friends
              </button>
              <button
                onClick={() => setPlayMode('ai')}
                className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${
                  playMode === 'ai'
                    ? 'bg-[var(--accent-green)] text-white'
                    : 'text-[var(--text-secondary)] hover:text-white'
                }`}
              >
                vs AI
              </button>
            </div>
          </div>

          {/* AI Difficulty (only shown for AI mode) */}
          {playMode === 'ai' && (
            <div className="mb-6">
              <h2 className="text-sm font-semibold mb-3 text-[var(--text-secondary)]">AI Difficulty</h2>
              <div className="flex flex-col gap-2">
                {DIFFICULTY_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => setDifficulty(opt.value)}
                    className={`
                      flex items-center gap-3 px-4 py-2.5 rounded-lg border-2 text-left transition-all
                      ${difficulty === opt.value
                        ? 'border-[var(--accent-green)] bg-[var(--accent-green)]/10'
                        : 'border-[var(--border-subtle)] bg-[var(--bg-secondary)] hover:border-white/20'
                      }
                    `}
                  >
                    <span className="text-xl shrink-0">{opt.emoji}</span>
                    <div>
                      <div className="text-sm font-medium">{opt.label}</div>
                      <div className="text-[11px] text-[var(--text-secondary)]">{opt.desc}</div>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Match proposal modal */}
          {matchProposal && (
            <div className="mb-6 bg-[var(--bg-secondary)] rounded-xl border border-[var(--accent-gold)]/30 p-5">
              <div className="text-center mb-4">
                <div className="text-sm font-semibold text-[var(--accent-gold)] mb-1">Match Found!</div>
                <div className="text-xs text-[var(--text-secondary)]">
                  {proposalTimer > 0
                    ? `Accept within ${proposalTimer}s`
                    : 'Waiting for response...'}
                </div>
              </div>

              <div className="flex justify-center gap-3 mb-4">
                {matchProposal.players.map((p, i) => (
                  <div key={i} className="flex flex-col items-center gap-1">
                    <div className="w-10 h-10 rounded-full bg-[var(--accent-blue)]/50 flex items-center justify-center text-sm font-bold">
                      {p.displayName[0]?.toUpperCase() ?? '?'}
                    </div>
                    <span className="text-[11px] text-[var(--text-secondary)] max-w-[80px] truncate">{p.displayName}</span>
                  </div>
                ))}
              </div>

              <div className="text-center text-[11px] text-[var(--text-muted)] mb-3">
                {matchProposal.acceptedCount}/{matchProposal.players.length} accepted
              </div>

              <div className="flex justify-center gap-3">
                <button
                  onClick={() => socket.emit('matchmaking:accept' as any, { matchId: matchProposal.matchId })}
                  className="px-6 py-2 text-sm font-semibold bg-[var(--accent-green)] text-white rounded-lg hover:brightness-110 transition-all"
                >
                  Accept
                </button>
                <button
                  onClick={() => {
                    socket.emit('matchmaking:decline' as any, { matchId: matchProposal.matchId });
                    setMatchProposal(null);
                  }}
                  className="px-6 py-2 text-sm border border-[var(--border-subtle)] rounded-lg hover:bg-white/[0.04] transition-colors"
                >
                  Decline
                </button>
              </div>
            </div>
          )}

          {/* Play button */}
          <div className="flex justify-center">
            {playMode === 'ai' ? (
              <button
                onClick={handlePlayAI}
                disabled={isCreating}
                className="px-12 py-4 rounded-xl text-lg font-bold bg-[var(--accent-green)] text-white hover:brightness-110 disabled:opacity-50 transition-all shadow-lg shadow-green-500/20"
              >
                {isCreating ? 'Creating Game...' : 'Play vs AI'}
              </button>
            ) : matchmaking ? (
              <div className="text-center">
                <div className="mb-3 flex items-center justify-center gap-3">
                  <div className="w-5 h-5 border-2 border-[var(--accent-blue)] border-t-transparent rounded-full animate-spin" />
                  <span className="text-[var(--accent-blue)] font-medium">
                    Searching for opponents...
                    {queuePosition !== null && ` (Position: ${queuePosition})`}
                  </span>
                </div>
                <button
                  onClick={handleCancelMatchmaking}
                  className="px-6 py-2 text-sm text-[var(--text-secondary)] hover:text-white border border-[var(--border-subtle)] rounded-lg transition-colors"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-3">
                <div className="flex gap-3">
                  <button
                    onClick={handleCreateRoom}
                    className="px-8 py-3 rounded-xl text-base font-bold bg-[var(--accent-green)] text-white hover:brightness-110 transition-all"
                  >
                    Create Room
                  </button>
                  <button
                    onClick={handleMatchmaking}
                    className="px-8 py-3 rounded-xl text-base font-bold bg-[var(--accent-blue)] text-white hover:brightness-110 transition-all"
                  >
                    Quick Match
                  </button>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={joinCode}
                    onChange={(e) => setJoinCode(e.target.value.trim())}
                    placeholder="Room code"
                    maxLength={8}
                    className="w-32 bg-[var(--bg-secondary)] border border-[var(--border-subtle)] rounded-lg px-3 py-2 text-sm text-center font-mono tracking-wider placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--accent-blue)]/50"
                    onKeyDown={(e) => e.key === 'Enter' && joinCode && router.push(`/room/${joinCode}`)}
                  />
                  <button
                    onClick={() => joinCode && router.push(`/room/${joinCode}`)}
                    disabled={!joinCode}
                    className="px-4 py-2 text-sm font-medium border border-[var(--border-subtle)] rounded-lg hover:bg-white/[0.04] disabled:opacity-40 transition-colors"
                  >
                    Join
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Right sidebar — Friends */}
        {session && (
          <div className="w-72 shrink-0">
            <FriendsList />
          </div>
        )}
      </div>
    </div>
  );
}
