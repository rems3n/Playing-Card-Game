'use client';

import { useEffect, useCallback, useState, useRef } from 'react';
import { GamePhase, GameType, type Card } from '@card-game/shared-types';
import { useSocket } from '@/hooks/useSocket';
import { useGameStore, useSettingsStore } from '@card-game/shared-store';
import { PlayingCard } from './PlayingCard';
import { PlayerSeat } from './PlayerSeat';
import { TrickArea } from './TrickArea';
import { ScoreBoard } from './ScoreBoard';
import { ChatPanel } from './ChatPanel';
import { BiddingPanel } from './BiddingPanel';
import { RulesModal } from '../RulesModal';

export function GameBoard() {
  const socket = useSocket();
  const {
    gameId, gameState, selectedCards, gameOver, error,
    setGameState, setGameOver, toggleCardSelection, clearSelectedCards, setError,
  } = useGameStore();
  const { tableColor } = useSettingsStore();

  useEffect(() => {
    socket.on('game:state', (state) => setGameState(state));
    socket.on('game:over', (result) => setGameOver(result));
    socket.on('game:error', (err) => setError(err.message));
    return () => { socket.off('game:state'); socket.off('game:over'); socket.off('game:error'); };
  }, [socket, setGameState, setGameOver, setError]);

  const handlePlayCard = useCallback((card: Card) => {
    if (!gameId || !gameState) return;
    if (gameState.phase !== GamePhase.Playing || gameState.currentPlayerSeat !== gameState.mySeat) return;
    socket.emit('game:play_card', { gameId, card });
  }, [socket, gameId, gameState]);

  const handlePassCards = useCallback(() => {
    if (!gameId || !gameState || selectedCards.length !== 3) return;
    socket.emit('game:pass_cards', { gameId, cards: selectedCards });
    clearSelectedCards();
  }, [socket, gameId, gameState, selectedCards, clearSelectedCards]);

  const handleBid = useCallback((bid: number) => {
    if (!gameId) return;
    socket.emit('game:bid', { gameId, bid });
  }, [socket, gameId]);

  const handleCallTrump = useCallback((suit: string) => {
    if (!gameId) return;
    socket.emit('game:call_trump', { gameId, suit });
  }, [socket, gameId]);

  const [rulesOpen, setRulesOpen] = useState(false);
  const [disconnectedPlayer, setDisconnectedPlayer] = useState<{ seatIndex: number; secondsLeft: number } | null>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  // Listen for player disconnect/reconnect
  useEffect(() => {
    socket.on('game:player_disconnected', ({ seatIndex, timeoutSeconds }) => {
      if (timerRef.current) clearInterval(timerRef.current);

      if (timeoutSeconds === 0) {
        // Timer expired — show choice modal
        setDisconnectedPlayer({ seatIndex, secondsLeft: 0 });
      } else {
        // Start countdown
        setDisconnectedPlayer({ seatIndex, secondsLeft: timeoutSeconds });
        timerRef.current = setInterval(() => {
          setDisconnectedPlayer((prev) => {
            if (!prev || prev.secondsLeft <= 1) {
              if (timerRef.current) clearInterval(timerRef.current);
              return prev ? { ...prev, secondsLeft: 0 } : null;
            }
            return { ...prev, secondsLeft: prev.secondsLeft - 1 };
          });
        }, 1000);
      }
    });

    socket.on('game:player_reconnected', ({ seatIndex }) => {
      if (disconnectedPlayer?.seatIndex === seatIndex) {
        if (timerRef.current) clearInterval(timerRef.current);
        setDisconnectedPlayer(null);
      }
    });

    return () => {
      socket.off('game:player_disconnected');
      socket.off('game:player_reconnected');
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [socket, disconnectedPlayer?.seatIndex]);

  if (!gameState) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="text-[var(--text-muted)] text-sm">Waiting for game...</div>
      </div>
    );
  }

  const isMyTurn = gameState.phase === GamePhase.Playing && gameState.currentPlayerSeat === gameState.mySeat;
  const isPassing = gameState.phase === GamePhase.Passing;
  const isBidding = gameState.phase === GamePhase.Bidding;

  const getPos = (seatIndex: number): 'top' | 'left' | 'right' | 'bottom' => {
    const r = (seatIndex - gameState.mySeat + gameState.players.length) % gameState.players.length;
    return (['bottom', 'left', 'top', 'right'] as const)[r];
  };

  const myPlayer = gameState.players.find((p) => p.seatIndex === gameState.mySeat)!;
  const topPlayer = gameState.players.find((p) => getPos(p.seatIndex) === 'top');
  const leftPlayer = gameState.players.find((p) => getPos(p.seatIndex) === 'left');
  const rightPlayer = gameState.players.find((p) => getPos(p.seatIndex) === 'right');

  const isCardLegal = (card: Card) =>
    gameState.legalMoves.some((m) => m.suit === card.suit && m.rank === card.rank);

  const trumpLabel = gameState.trumpSuit
    ? { H: '\u2665', D: '\u2666', C: '\u2663', S: '\u2660' }[gameState.trumpSuit] ?? ''
    : '';

  return (
    <div className="flex gap-3 p-3 h-full">
      {/* Main area */}
      <div className="flex-1 min-w-0 flex flex-col gap-2 h-full">
        {/* Game over banner */}
        {gameOver && (
          <div className="px-4 py-3 rounded-lg bg-[var(--accent-gold)]/10 border border-[var(--accent-gold)]/30">
            <div className="text-base font-bold text-[var(--accent-gold)]">Game Over</div>
            <div className="text-sm mt-1">
              Winner: {gameState.players[gameOver.winnerSeat]?.displayName}
            </div>
            <div className="flex gap-3 mt-1.5 text-[12px] text-[var(--text-secondary)]">
              {gameOver.finalScores.map((score, i) => (
                <span key={i}>{gameState.players[i]?.displayName}: <span className="font-bold text-[var(--text-primary)]">{score}</span></span>
              ))}
            </div>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="px-3 py-2 rounded-lg bg-[var(--accent-red)]/10 border border-[var(--accent-red)]/30 text-[12px] text-[var(--accent-red)]">
            {error}
          </div>
        )}

        {/* Player disconnected banner */}
        {disconnectedPlayer && (
          <div className="px-4 py-3 rounded-lg bg-[var(--accent-gold)]/10 border border-[var(--accent-gold)]/30">
            <div className="flex items-center justify-between">
              <div>
                <span className="text-[13px] font-semibold text-[var(--accent-gold)]">
                  {gameState.players[disconnectedPlayer.seatIndex]?.displayName} disconnected
                </span>
                {disconnectedPlayer.secondsLeft > 0 ? (
                  <span className="text-[12px] text-[var(--text-secondary)] ml-2">
                    Reconnecting... {disconnectedPlayer.secondsLeft}s
                  </span>
                ) : (
                  <span className="text-[12px] text-[var(--text-muted)] ml-2">
                    Timed out
                  </span>
                )}
              </div>
              {disconnectedPlayer.secondsLeft === 0 && gameId && (
                <div className="flex gap-2">
                  <button
                    onClick={() => {
                      socket.emit('game:replace_with_ai' as any, { gameId, seatIndex: disconnectedPlayer.seatIndex });
                      setDisconnectedPlayer(null);
                    }}
                    className="px-3 py-1.5 text-[12px] font-medium bg-[var(--accent-green)] text-white rounded hover:brightness-110 transition-all"
                  >
                    Continue with AI
                  </button>
                  <button
                    onClick={() => {
                      socket.emit('game:end' as any, { gameId });
                      setDisconnectedPlayer(null);
                    }}
                    className="px-3 py-1.5 text-[12px] border border-[var(--border-subtle)] rounded hover:bg-white/[0.04] transition-colors"
                  >
                    End Game
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Status bar */}
        <div className="flex items-center justify-between px-3 py-1.5 rounded-md bg-[var(--bg-secondary)] border border-[var(--border-subtle)] text-[13px]">
          <div className="truncate">
            {isPassing && (
              <span>Pass 3 cards <span className="text-[var(--accent-gold)] font-semibold">{gameState.passDirection}</span> ({selectedCards.length}/3)</span>
            )}
            {isBidding && <span className="text-[var(--accent-gold)] font-semibold">Bidding</span>}
            {isMyTurn && <span className="text-[var(--accent-green)] font-semibold">Your turn</span>}
            {gameState.phase === GamePhase.Playing && !isMyTurn && (
              <span className="text-[var(--text-muted)]">
                Waiting for <span className="text-[var(--text-secondary)]">{gameState.players[gameState.currentPlayerSeat]?.displayName}</span>
              </span>
            )}
          </div>
          <div className="flex items-center gap-2.5 text-[11px] text-[var(--text-muted)] shrink-0 ml-3">
            <button
              onClick={() => setRulesOpen(true)}
              className="flex items-center gap-1 px-1.5 py-0.5 rounded hover:bg-white/[0.08] text-[var(--text-muted)] hover:text-[var(--accent-gold)] transition-colors"
              title="How to play"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span>Rules</span>
            </button>
            <span className="w-px h-3 bg-[var(--border-subtle)]" />
            <span className="capitalize">{gameState.gameType}</span>
            <span className="w-px h-3 bg-[var(--border-subtle)]" />
            <span>R{gameState.roundNumber + 1}</span>
            {!isBidding && <span>T{gameState.trickNumber + 1}</span>}
            {gameState.gameType === GameType.Hearts && gameState.heartsBroken && (
              <span className="text-[var(--accent-red)]">{'\u2665'} broken</span>
            )}
            {trumpLabel && <span className="text-[var(--accent-gold)]">Trump {trumpLabel}</span>}
          </div>
        </div>

        {/* Bidding panel */}
        {isBidding && (
          <BiddingPanel gameState={gameState} onBid={handleBid} onCallTrump={handleCallTrump} />
        )}

        {/* Game table — seamless surface */}
        <div
          className="relative rounded-xl overflow-hidden flex-1"
          style={{
            background: tableColor.gradient,
            border: `1px solid ${tableColor.border}`,
            boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.04), 0 2px 12px rgba(0,0,0,0.5)',
          }}
        >
          <div className="relative flex flex-col h-full p-4">

            {/* Top player */}
            <div className="flex justify-center">
              {topPlayer && (
                <PlayerSeat player={topPlayer} isCurrentTurn={gameState.currentPlayerSeat === topPlayer.seatIndex} position="top" />
              )}
            </div>

            {/* Middle: left — trick — right */}
            <div className="flex-1 flex items-center justify-between gap-3 my-3">
              <div className="w-[220px] shrink-0 flex justify-start">
                {leftPlayer && (
                  <PlayerSeat player={leftPlayer} isCurrentTurn={gameState.currentPlayerSeat === leftPlayer.seatIndex} position="left" />
                )}
              </div>

              <TrickArea currentTrick={gameState.currentTrick} mySeat={gameState.mySeat} numPlayers={gameState.players.length} />

              <div className="w-[220px] shrink-0 flex justify-end">
                {rightPlayer && (
                  <PlayerSeat player={rightPlayer} isCurrentTurn={gameState.currentPlayerSeat === rightPlayer.seatIndex} position="right" />
                )}
              </div>
            </div>

            {/* Bottom: my info + hand */}
            <div>
              <div className="flex justify-center mb-2">
                <PlayerSeat player={myPlayer} isCurrentTurn={gameState.currentPlayerSeat === gameState.mySeat} position="bottom" isMe />
              </div>

              <div className="flex justify-center">
                <div className="flex" style={{ gap: '3px' }}>
                  {gameState.myHand.map((card) => {
                    const legal = isCardLegal(card);
                    const isSelected = selectedCards.some((c) => c.suit === card.suit && c.rank === card.rank);
                    return (
                      <PlayingCard
                        key={`${card.suit}${card.rank}`}
                        card={card}
                        selected={isSelected}
                        disabled={isPassing ? false : !isMyTurn || !legal}
                        onClick={() => {
                          if (isPassing) toggleCardSelection(card);
                          else if (isMyTurn && legal) handlePlayCard(card);
                        }}
                      />
                    );
                  })}
                </div>
              </div>

              {isPassing && selectedCards.length === 3 && (
                <div className="flex justify-center mt-3">
                  <button
                    onClick={handlePassCards}
                    className="px-5 py-1.5 text-[13px] font-semibold bg-[var(--accent-green)] text-white rounded-md hover:brightness-110 transition-all"
                  >
                    Pass cards {gameState.passDirection}
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Sidebar */}
      <div className="w-56 shrink-0 flex flex-col gap-2 h-full">
        <ScoreBoard players={gameState.players} scores={gameState.scores} roundScores={gameState.roundScores} mySeat={gameState.mySeat} />

        <div className="bg-[var(--bg-secondary)] rounded-lg border border-[var(--border-subtle)] overflow-hidden">
          <div className="px-3 py-2 border-b border-[var(--border-subtle)]">
            <span className="text-[11px] font-semibold text-[var(--text-secondary)] uppercase tracking-wider">Game Info</span>
          </div>
          <div className="p-3 text-[12px] text-[var(--text-secondary)] space-y-1.5">
            <div className="flex justify-between">
              <span>Game</span>
              <span className="text-[var(--text-primary)] capitalize">{gameState.gameType}</span>
            </div>
            <div className="flex justify-between">
              <span>Target</span>
              <span className="text-[var(--text-primary)]">{gameState.config.targetScore}</span>
            </div>
            {gameState.passDirection && (
              <div className="flex justify-between">
                <span>Pass</span>
                <span className="text-[var(--text-primary)] capitalize">{gameState.passDirection}</span>
              </div>
            )}
          </div>
        </div>

        <ChatPanel />
      </div>

      <RulesModal
        gameType={gameState.gameType as 'hearts' | 'spades' | 'euchre'}
        open={rulesOpen}
        onClose={() => setRulesOpen(false)}
      />
    </div>
  );
}
