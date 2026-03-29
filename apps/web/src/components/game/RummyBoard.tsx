'use client';

import { useEffect, useCallback, useState, useRef } from 'react';
import { GamePhase, GameType, type Card, type VisiblePlayerState } from '@card-game/shared-types';
import { useSocket } from '@/hooks/useSocket';
import { useScale } from '@/hooks/useScale';
import { useGameStore, useSettingsStore } from '@card-game/shared-store';
import { PlayingCard, CardBack } from './PlayingCard';
import { PlayerSeat } from './PlayerSeat';
import { ScoreBoard } from './ScoreBoard';
import { ChatPanel } from './ChatPanel';
import { RulesModal } from '../RulesModal';

// ── Seat position layouts for 2–6 players ──
// Positions around the table, starting from the current player (bottom)
type SeatPos = 'bottom' | 'top' | 'left' | 'right' | 'top-left' | 'top-right';

const SEAT_LAYOUTS: Record<number, SeatPos[]> = {
  2: ['bottom', 'top'],
  3: ['bottom', 'top-left', 'top-right'],
  4: ['bottom', 'left', 'top', 'right'],
  5: ['bottom', 'left', 'top-left', 'top-right', 'right'],
  6: ['bottom', 'left', 'top-left', 'top', 'top-right', 'right'],
};

function getPos(seatIndex: number, mySeat: number, numPlayers: number): SeatPos {
  const layout = SEAT_LAYOUTS[numPlayers] ?? SEAT_LAYOUTS[4];
  const relative = (seatIndex - mySeat + numPlayers) % numPlayers;
  return layout[relative] ?? 'top';
}

export function RummyBoard() {
  const socket = useSocket();
  const {
    gameId, gameState, selectedCards, gameOver, error,
    setGameState, setGameOver, toggleCardSelection, clearSelectedCards, setError,
  } = useGameStore();
  const { tableColor } = useSettingsStore();
  const { ref: tableRef, scale } = useScale(900);

  useEffect(() => {
    socket.on('game:state', (state) => setGameState(state));
    socket.on('game:over', (result) => setGameOver(result));
    socket.on('game:error', (err) => setError(err.message));
    return () => { socket.off('game:state'); socket.off('game:over'); socket.off('game:error'); };
  }, [socket, setGameState, setGameOver, setError]);

  // ── Rummy actions ──
  const handleDraw = useCallback((source: 'stock' | 'discard') => {
    if (!gameId || !gameState) return;
    socket.emit('game:draw_card', { gameId, source });
  }, [socket, gameId, gameState]);

  const handleLayMeld = useCallback(() => {
    if (!gameId || !gameState || selectedCards.length < 3) return;
    socket.emit('game:lay_meld', { gameId, cards: selectedCards });
    clearSelectedCards();
  }, [socket, gameId, gameState, selectedCards, clearSelectedCards]);

  const handleDiscard = useCallback((card: Card) => {
    if (!gameId || !gameState) return;
    socket.emit('game:discard', { gameId, card });
    clearSelectedCards();
  }, [socket, gameId, gameState, clearSelectedCards]);

  const [rulesOpen, setRulesOpen] = useState(false);
  const [disconnectedPlayer, setDisconnectedPlayer] = useState<{ seatIndex: number; secondsLeft: number } | null>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    socket.on('game:player_disconnected', ({ seatIndex, timeoutSeconds }) => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (timeoutSeconds === 0) {
        setDisconnectedPlayer({ seatIndex, secondsLeft: 0 });
      } else {
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

  const isMyTurn = gameState.currentPlayerSeat === gameState.mySeat && gameState.phase === GamePhase.Playing;
  const isDrawPhase = isMyTurn && gameState.rummyPhase === 'draw';
  const isDiscardPhase = isMyTurn && gameState.rummyPhase === 'discard';
  const numPlayers = gameState.players.length;
  const s = scale;

  // Categorize players by position
  const myPlayer = gameState.players.find((p) => p.seatIndex === gameState.mySeat)!;
  const opponents = gameState.players.filter((p) => p.seatIndex !== gameState.mySeat);

  // Group opponents by position region
  const topPlayers: VisiblePlayerState[] = [];
  const leftPlayers: VisiblePlayerState[] = [];
  const rightPlayers: VisiblePlayerState[] = [];

  for (const opp of opponents) {
    const pos = getPos(opp.seatIndex, gameState.mySeat, numPlayers);
    if (pos === 'top' || pos === 'top-left' || pos === 'top-right') topPlayers.push(opp);
    else if (pos === 'left') leftPlayers.push(opp);
    else if (pos === 'right') rightPlayers.push(opp);
  }

  // Melds for each player
  const allMelds = gameState.melds ?? [];

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
            <div className="flex gap-3 mt-1.5 text-[12px] text-[var(--text-secondary)] flex-wrap">
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

        {/* Disconnect banner */}
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
                  <span className="text-[12px] text-[var(--text-muted)] ml-2">Timed out</span>
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
            {isDrawPhase && <span className="text-[var(--accent-blue)] font-semibold">Draw a card from the pile or discard</span>}
            {isDiscardPhase && <span className="text-[var(--accent-green)] font-semibold">Lay melds or discard to end your turn</span>}
            {gameState.phase === GamePhase.Playing && !isMyTurn && (
              <span className="text-[var(--text-muted)]">
                Waiting for <span className="text-[var(--text-secondary)]">{gameState.players[gameState.currentPlayerSeat]?.displayName}</span>
              </span>
            )}
            {gameState.phase === GamePhase.RoundScoring && (
              <span className="text-[var(--accent-gold)] font-semibold">Round over — scoring...</span>
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
            <span>Rummy</span>
            <span className="w-px h-3 bg-[var(--border-subtle)]" />
            <span>R{gameState.roundNumber + 1}</span>
            <span className="w-px h-3 bg-[var(--border-subtle)]" />
            <span>Draw pile: {gameState.drawPileCount ?? 0}</span>
          </div>
        </div>

        {/* Game table */}
        <div
          ref={tableRef}
          className="relative rounded-xl overflow-hidden flex-1"
          style={{
            background: tableColor.gradient,
            border: `1px solid ${tableColor.border}`,
            boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.04), 0 2px 12px rgba(0,0,0,0.5)',
          }}
        >
          <div className="relative flex flex-col h-full" style={{ padding: `${s * 12}px` }}>

            {/* Top row: opponents at top */}
            <div className="flex justify-center gap-4" style={{ minHeight: 90 * s }}>
              {topPlayers.map((p) => (
                <div key={p.seatIndex} className="flex flex-col items-center">
                  <PlayerSeat player={p} isCurrentTurn={gameState.currentPlayerSeat === p.seatIndex} position="top" scale={s} />
                  <MeldsDisplay melds={allMelds[p.seatIndex] ?? []} scale={s} compact />
                </div>
              ))}
            </div>

            {/* Middle row: left opponents — center piles — right opponents */}
            <div className="flex-1 flex items-center justify-between" style={{ gap: 8 * s }}>
              {/* Left column */}
              <div className="flex flex-col items-center gap-2 shrink-0" style={{ width: 180 * s }}>
                {leftPlayers.map((p) => (
                  <div key={p.seatIndex} className="flex flex-col items-center">
                    <PlayerSeat player={p} isCurrentTurn={gameState.currentPlayerSeat === p.seatIndex} position="left" scale={s} />
                    <MeldsDisplay melds={allMelds[p.seatIndex] ?? []} scale={s} compact />
                  </div>
                ))}
              </div>

              {/* Center: Draw pile + Discard pile */}
              <div className="flex flex-col items-center gap-3">
                <div className="flex items-center justify-center" style={{ gap: 20 * s }}>
                  {/* Draw pile */}
                  <div className="flex flex-col items-center" style={{ gap: 4 * s }}>
                    <button
                      onClick={() => isDrawPhase && handleDraw('stock')}
                      disabled={!isDrawPhase}
                      className={`relative transition-all ${isDrawPhase ? 'cursor-pointer hover:scale-105 hover:-translate-y-1' : 'cursor-default'}`}
                      title={isDrawPhase ? 'Draw from pile' : undefined}
                    >
                      {/* Stacked card effect */}
                      <div className="relative">
                        {(gameState.drawPileCount ?? 0) > 2 && (
                          <div className="absolute" style={{ top: -3 * s, left: 3 * s }}>
                            <CardBack scale={s} />
                          </div>
                        )}
                        {(gameState.drawPileCount ?? 0) > 1 && (
                          <div className="absolute" style={{ top: -1.5 * s, left: 1.5 * s }}>
                            <CardBack scale={s} />
                          </div>
                        )}
                        <div className="relative">
                          <CardBack scale={s} />
                        </div>
                      </div>
                      {isDrawPhase && (
                        <div className="absolute inset-0 rounded-md border-2 border-[var(--accent-blue)] animate-pulse" style={{ borderRadius: 6 * s }} />
                      )}
                    </button>
                    <span className="text-[var(--text-muted)] font-mono" style={{ fontSize: 10 * s }}>
                      {gameState.drawPileCount ?? 0}
                    </span>
                  </div>

                  {/* Discard pile */}
                  <div className="flex flex-col items-center" style={{ gap: 4 * s }}>
                    <button
                      onClick={() => isDrawPhase && gameState.discardTop && handleDraw('discard')}
                      disabled={!isDrawPhase || !gameState.discardTop}
                      className={`relative transition-all ${isDrawPhase && gameState.discardTop ? 'cursor-pointer hover:scale-105 hover:-translate-y-1' : 'cursor-default'}`}
                      title={isDrawPhase ? 'Draw from discard' : undefined}
                    >
                      {gameState.discardTop ? (
                        <PlayingCard card={gameState.discardTop} scale={s} />
                      ) : (
                        <div
                          className="rounded-md border-2 border-dashed border-white/20"
                          style={{ width: 56 * s, height: 80 * s, borderRadius: 6 * s }}
                        />
                      )}
                      {isDrawPhase && gameState.discardTop && (
                        <div className="absolute inset-0 rounded-md border-2 border-[var(--accent-blue)] animate-pulse" style={{ borderRadius: 6 * s }} />
                      )}
                    </button>
                    <span className="text-[var(--text-muted)]" style={{ fontSize: 10 * s }}>Discard</span>
                  </div>
                </div>

                {/* My melds (shown near center for prominence) */}
                {(allMelds[gameState.mySeat] ?? []).length > 0 && (
                  <div className="flex flex-col items-center" style={{ marginTop: 4 * s }}>
                    <span className="text-[var(--accent-gold)]" style={{ fontSize: 10 * s, marginBottom: 2 * s }}>Your melds</span>
                    <MeldsDisplay melds={allMelds[gameState.mySeat] ?? []} scale={s} />
                  </div>
                )}
              </div>

              {/* Right column */}
              <div className="flex flex-col items-center gap-2 shrink-0" style={{ width: 180 * s }}>
                {rightPlayers.map((p) => (
                  <div key={p.seatIndex} className="flex flex-col items-center">
                    <PlayerSeat player={p} isCurrentTurn={gameState.currentPlayerSeat === p.seatIndex} position="right" scale={s} />
                    <MeldsDisplay melds={allMelds[p.seatIndex] ?? []} scale={s} compact />
                  </div>
                ))}
              </div>
            </div>

            {/* Bottom: my seat + hand */}
            <div>
              <div className="flex justify-center" style={{ marginBottom: 6 * s }}>
                <PlayerSeat player={myPlayer} isCurrentTurn={isMyTurn} position="bottom" isMe scale={s} />
              </div>

              {/* My hand */}
              <div className="flex justify-center">
                <div className="flex" style={{ gap: 3 * s }}>
                  {gameState.myHand.map((card) => {
                    const isSelected = selectedCards.some((c) => c.suit === card.suit && c.rank === card.rank);
                    return (
                      <PlayingCard
                        key={`${card.suit}${card.rank}`}
                        card={card}
                        scale={s}
                        selected={isSelected}
                        disabled={!isDiscardPhase && !isDrawPhase}
                        onClick={() => {
                          if (isDiscardPhase) {
                            toggleCardSelection(card);
                          }
                        }}
                      />
                    );
                  })}
                </div>
              </div>

              {/* Action buttons */}
              {isDiscardPhase && (
                <div className="flex justify-center gap-3" style={{ marginTop: 8 * s }}>
                  {selectedCards.length >= 3 && (
                    <button
                      onClick={handleLayMeld}
                      className="px-5 py-1.5 text-[13px] font-semibold bg-[var(--accent-gold)] text-[#1a1a1a] rounded-md hover:brightness-110 transition-all"
                    >
                      Lay Meld ({selectedCards.length} cards)
                    </button>
                  )}
                  {selectedCards.length === 1 && (
                    <button
                      onClick={() => handleDiscard(selectedCards[0])}
                      className="px-5 py-1.5 text-[13px] font-semibold bg-[var(--accent-red)] text-white rounded-md hover:brightness-110 transition-all"
                    >
                      Discard
                    </button>
                  )}
                  {selectedCards.length === 0 && (
                    <span className="text-[12px] text-[var(--text-muted)] py-1.5">
                      Select cards to meld or pick one to discard
                    </span>
                  )}
                  {selectedCards.length === 2 && (
                    <span className="text-[12px] text-[var(--text-muted)] py-1.5">
                      Select 3+ for a meld, or 1 to discard
                    </span>
                  )}
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
              <span className="text-[var(--text-primary)]">Rummy</span>
            </div>
            <div className="flex justify-between">
              <span>Target</span>
              <span className="text-[var(--text-primary)]">{gameState.config.targetScore}</span>
            </div>
            <div className="flex justify-between">
              <span>Players</span>
              <span className="text-[var(--text-primary)]">{numPlayers}</span>
            </div>
            <div className="flex justify-between">
              <span>Draw pile</span>
              <span className="text-[var(--text-primary)]">{gameState.drawPileCount ?? 0}</span>
            </div>
          </div>
        </div>

        {/* All players' melds summary */}
        <div className="bg-[var(--bg-secondary)] rounded-lg border border-[var(--border-subtle)] overflow-hidden flex-1 min-h-0">
          <div className="px-3 py-2 border-b border-[var(--border-subtle)]">
            <span className="text-[11px] font-semibold text-[var(--text-secondary)] uppercase tracking-wider">Melds</span>
          </div>
          <div className="p-2 space-y-2 overflow-y-auto max-h-60">
            {gameState.players.map((p) => {
              const melds = allMelds[p.seatIndex] ?? [];
              if (melds.length === 0) return null;
              return (
                <div key={p.seatIndex}>
                  <div className="text-[11px] text-[var(--text-muted)] mb-1">
                    {p.seatIndex === gameState.mySeat ? 'You' : p.displayName}
                    <span className="text-[var(--text-muted)]"> ({melds.length})</span>
                  </div>
                  {melds.map((meld, mi) => (
                    <div key={mi} className="flex gap-0.5 mb-1 flex-wrap">
                      {meld.map((card, ci) => (
                        <MiniCard key={ci} card={card} />
                      ))}
                    </div>
                  ))}
                </div>
              );
            })}
            {allMelds.every((m) => !m || m.length === 0) && (
              <div className="text-[11px] text-[var(--text-muted)] text-center py-2">No melds yet</div>
            )}
          </div>
        </div>

        <ChatPanel />
      </div>

      <RulesModal
        gameType={'rummy' as any}
        open={rulesOpen}
        onClose={() => setRulesOpen(false)}
      />
    </div>
  );
}

// ── Meld display on the table ──
function MeldsDisplay({ melds, scale: s, compact }: { melds: Card[][]; scale: number; compact?: boolean }) {
  if (melds.length === 0) return null;
  const cardScale = compact ? s * 0.55 : s * 0.65;

  return (
    <div className="flex flex-wrap justify-center" style={{ gap: 4 * s, marginTop: 4 * s }}>
      {melds.map((meld, mi) => (
        <div key={mi} className="flex" style={{ gap: 1 }}>
          {meld.map((card, ci) => (
            <PlayingCard key={ci} card={card} scale={cardScale} small />
          ))}
        </div>
      ))}
    </div>
  );
}

// ── Tiny card for sidebar meld list ──
function MiniCard({ card }: { card: Card }) {
  const isRed = card.suit === 'H' || card.suit === 'D';
  const RANK_DISPLAY: Record<number, string> = {
    2: '2', 3: '3', 4: '4', 5: '5', 6: '6', 7: '7', 8: '8', 9: '9', 10: '10',
    11: 'J', 12: 'Q', 13: 'K', 14: 'A',
  };
  const SUIT_SYM: Record<string, string> = { H: '\u2665', D: '\u2666', C: '\u2663', S: '\u2660' };

  return (
    <span className={`inline-flex items-center px-1 py-0.5 rounded text-[10px] font-mono font-bold ${isRed ? 'text-[#c33]' : 'text-[#1a1a1a]'} bg-[#f7f6f5]`}>
      {RANK_DISPLAY[card.rank]}{SUIT_SYM[card.suit]}
    </span>
  );
}
