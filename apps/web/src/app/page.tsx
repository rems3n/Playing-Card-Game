'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { AIDifficulty, GameType, type GameConfig } from '@card-game/shared-types';
import { useSocket } from '@/hooks/useSocket';
import { useGameStore } from '@card-game/shared-store';
import { FriendsList } from '@/components/lobby/FriendsList';

const GAME_OPTIONS = [
  {
    type: GameType.SevenSix,
    name: 'Seven-Six',
    icon: '7',
    color: 'text-purple-400',
    description: 'Bid exactly how many tricks you\'ll win. Hands shrink then grow — every round counts!',
    players: '2-7 players',
    available: true,
  },
];

const DEFAULT_TARGET_SCORES: Record<GameType, number> = {
  [GameType.Hearts]: 100,
  [GameType.Spades]: 500,
  [GameType.Euchre]: 10,
  [GameType.Rummy]: 100,
  [GameType.SevenSix]: 0, // not used — fixed round count
};

const TARGET_SCORE_LABELS: Record<GameType, { label: string; description: string; min: number; max: number; step: number }> = {
  [GameType.Hearts]: { label: 'Points to Lose', description: 'Game ends when a player reaches this score', min: 25, max: 500, step: 25 },
  [GameType.Spades]: { label: 'Points to Win', description: 'First team to reach this score wins', min: 100, max: 1000, step: 50 },
  [GameType.Euchre]: { label: 'Points to Win', description: 'First team to reach this score wins', min: 5, max: 20, step: 1 },
  [GameType.Rummy]: { label: 'Points to Lose', description: 'Game ends when a player reaches this score', min: 50, max: 500, step: 25 },
  [GameType.SevenSix]: { label: 'Rounds', description: 'Fixed number of rounds based on player count', min: 0, max: 0, step: 1 },
};

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
  const [selectedGame, setSelectedGame] = useState<GameType>(GameType.SevenSix);
  const [targetScore, setTargetScore] = useState<number>(DEFAULT_TARGET_SCORES[GameType.SevenSix]);
  const [playerCount, setPlayerCount] = useState<number>(4);
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

  const getConfig = (): Partial<GameConfig> | undefined => {
    const config: Partial<GameConfig> = {};
    if (targetScore !== DEFAULT_TARGET_SCORES[selectedGame]) {
      config.targetScore = targetScore;
    }
    if ((selectedGame === GameType.Rummy || selectedGame === GameType.SevenSix) && playerCount !== 4) {
      config.maxPlayers = playerCount;
    }
    return Object.keys(config).length > 0 ? config : undefined;
  };

  const handleCreateRoom = () => {
    socket.emit('room:create', { gameType: selectedGame, config: getConfig() });
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
      config: getConfig(),
      aiDifficulty: difficulty,
      fillWithAI: true,
    });
  };

  const handleMatchmaking = () => {
    setMatchmaking(true);
    setQueuePosition(null);
    socket.emit('matchmaking:join', { gameType: selectedGame, config: getConfig() });
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
                            setTargetScore(DEFAULT_TARGET_SCORES[game.type]);
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
                      onClick={() => { if (game.available) { setSelectedGame(game.type); setTargetScore(DEFAULT_TARGET_SCORES[game.type]); } }}
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

          {/* Game Settings */}
          <div className="mb-6">
            <h2 className="text-sm font-semibold mb-3 text-[var(--text-secondary)]">Game Settings</h2>
            {selectedGame === GameType.SevenSix ? (
              <div className="bg-[var(--bg-secondary)] border border-[var(--border-subtle)] rounded-lg px-4 py-3">
                <p className="text-sm font-medium">Fixed Rounds</p>
                <p className="text-[11px] text-[var(--text-muted)]">
                  Hand sizes go down then back up (e.g. 7, 6, 5, ..., 1, ..., 5, 6, 7). Number of rounds depends on player count.
                </p>
              </div>
            ) : (() => {
              const info = TARGET_SCORE_LABELS[selectedGame];
              const defaultVal = DEFAULT_TARGET_SCORES[selectedGame];
              const isCustom = targetScore !== defaultVal;
              return (
                <div className="bg-[var(--bg-secondary)] border border-[var(--border-subtle)] rounded-lg px-4 py-3">
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-sm font-medium">{info.label}</label>
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        value={targetScore}
                        onChange={(e) => {
                          const val = parseInt(e.target.value, 10);
                          if (!isNaN(val) && val >= info.min && val <= info.max) {
                            setTargetScore(val);
                          }
                        }}
                        min={info.min}
                        max={info.max}
                        step={info.step}
                        className="w-20 bg-[var(--bg-primary)] border border-[var(--border-subtle)] rounded px-2 py-1 text-sm text-center font-mono focus:outline-none focus:border-[var(--accent-blue)]/50"
                      />
                      {isCustom && (
                        <button
                          onClick={() => setTargetScore(defaultVal)}
                          className="text-[11px] text-[var(--text-muted)] hover:text-white transition-colors"
                          title="Reset to default"
                        >
                          Reset
                        </button>
                      )}
                    </div>
                  </div>
                  <p className="text-[11px] text-[var(--text-muted)]">
                    {info.description} (default: {defaultVal})
                  </p>
                </div>
              );
            })()}

            {/* Player count (Rummy & Seven-Six) */}
            {(selectedGame === GameType.Rummy || selectedGame === GameType.SevenSix) && (
              <div className="bg-[var(--bg-secondary)] border border-[var(--border-subtle)] rounded-lg px-4 py-3 mt-2">
                <div className="flex items-center justify-between mb-1">
                  <label className="text-sm font-medium">Players</label>
                  <div className="flex gap-1">
                    {(selectedGame === GameType.SevenSix ? [2, 3, 4, 5, 6, 7] : [2, 3, 4, 5, 6]).map((n) => (
                      <button
                        key={n}
                        onClick={() => setPlayerCount(n)}
                        className={`w-8 h-8 rounded text-sm font-bold transition-all ${
                          playerCount === n
                            ? 'bg-[var(--accent-green)] text-white'
                            : 'bg-[var(--bg-primary)] border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:border-white/20'
                        }`}
                      >
                        {n}
                      </button>
                    ))}
                  </div>
                </div>
                <p className="text-[11px] text-[var(--text-muted)]">
                  {playMode === 'ai' ? 'AI fills remaining seats' : 'AI fills empty seats when game starts'}
                </p>
              </div>
            )}
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
