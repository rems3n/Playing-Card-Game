'use client';

import { useState } from 'react';
import type { VisibleGameState } from '@card-game/shared-types';
import { GameType } from '@card-game/shared-types';

interface BiddingPanelProps {
  gameState: VisibleGameState;
  onBid: (bid: number) => void;
  onCallTrump: (suit: string) => void;
}

export function BiddingPanel({ gameState, onBid, onCallTrump }: BiddingPanelProps) {
  const [selectedBid, setSelectedBid] = useState(1);
  const isMyTurn = gameState.currentPlayerSeat === gameState.mySeat;

  if (gameState.gameType === GameType.Spades) {
    return (
      <div className="bg-[var(--bg-secondary)] rounded-lg border border-[var(--border-subtle)] p-4 text-center">
        <div className="text-[11px] font-semibold text-[var(--text-secondary)] uppercase tracking-wider mb-3">Bidding</div>

        {/* Bids so far */}
        <div className="flex justify-center gap-4 mb-4">
          {gameState.players.map((p) => (
            <div key={p.seatIndex} className="text-center min-w-0">
              <div className="text-[11px] text-[var(--text-muted)] truncate max-w-[80px]">{p.displayName}</div>
              <div className="text-lg font-bold mt-0.5">
                {gameState.bids?.[p.seatIndex] != null ? gameState.bids[p.seatIndex] : '\u2014'}
              </div>
            </div>
          ))}
        </div>

        {isMyTurn ? (
          <div>
            <p className="text-[12px] text-[var(--accent-green)] font-semibold mb-2">Your bid</p>
            <div className="flex items-center justify-center gap-2 mb-3">
              <button
                onClick={() => setSelectedBid(Math.max(0, selectedBid - 1))}
                className="w-7 h-7 rounded bg-[var(--bg-tertiary)] border border-[var(--border-subtle)] hover:border-[var(--border-medium)] flex items-center justify-center text-sm"
              >-</button>
              <span className="text-xl font-bold w-8 text-center tabular-nums">{selectedBid}</span>
              <button
                onClick={() => setSelectedBid(Math.min(13, selectedBid + 1))}
                className="w-7 h-7 rounded bg-[var(--bg-tertiary)] border border-[var(--border-subtle)] hover:border-[var(--border-medium)] flex items-center justify-center text-sm"
              >+</button>
            </div>
            <div className="flex justify-center gap-2">
              <button
                onClick={() => onBid(0)}
                className="px-3 py-1.5 text-[12px] border border-[var(--border-subtle)] rounded hover:bg-white/[0.04] transition-colors"
              >Nil</button>
              <button
                onClick={() => onBid(selectedBid)}
                className="px-5 py-1.5 text-[12px] font-semibold bg-[var(--accent-green)] text-white rounded hover:brightness-110 transition-all"
              >Bid {selectedBid}</button>
            </div>
          </div>
        ) : (
          <p className="text-[12px] text-[var(--text-muted)]">
            Waiting for {gameState.players[gameState.currentPlayerSeat]?.displayName}
          </p>
        )}
      </div>
    );
  }

  if (gameState.gameType === GameType.SevenSix) {
    const handSize = gameState.handSize ?? gameState.myHand.length;
    // Calculate restricted bid for dealer
    const bids = gameState.bids ?? [];
    const isDealer = gameState.dealerSeat === gameState.mySeat;
    const currentTotal = bids.filter((b): b is number => b !== null).reduce((s, b) => s + b, 0);
    const restrictedBid = isDealer ? handSize - currentTotal : -1;

    // Clamp selectedBid to valid range
    const validBid = Math.min(selectedBid, handSize);

    return (
      <div className="bg-[var(--bg-secondary)] rounded-lg border border-[var(--border-subtle)] p-4 text-center">
        <div className="text-[11px] font-semibold text-[var(--text-secondary)] uppercase tracking-wider mb-1">Bidding</div>
        <div className="text-[10px] text-[var(--text-muted)] mb-3">
          Round {(gameState.roundNumber ?? 0) + 1}/{gameState.totalRounds ?? '?'} — {handSize} card{handSize !== 1 ? 's' : ''}
          {gameState.trumpSuit && (
            <span className="ml-1 text-[var(--accent-gold)]">
              Trump: {{ H: '\u2665', D: '\u2666', C: '\u2663', S: '\u2660' }[gameState.trumpSuit]}
            </span>
          )}
        </div>

        {/* Bids so far */}
        <div className="flex justify-center gap-4 mb-4 flex-wrap">
          {gameState.players.map((p) => (
            <div key={p.seatIndex} className="text-center min-w-0">
              <div className="text-[11px] text-[var(--text-muted)] truncate max-w-[80px]">
                {p.displayName}
                {p.seatIndex === gameState.dealerSeat && <span className="ml-0.5 text-[var(--accent-gold)]">D</span>}
              </div>
              <div className="text-lg font-bold mt-0.5">
                {bids[p.seatIndex] != null ? bids[p.seatIndex] : '\u2014'}
              </div>
            </div>
          ))}
        </div>

        {isMyTurn ? (
          <div>
            <p className="text-[12px] text-[var(--accent-green)] font-semibold mb-2">
              Your bid{isDealer ? ' (dealer — total cannot equal hand size)' : ''}
            </p>
            <div className="flex items-center justify-center gap-2 mb-3">
              <button
                onClick={() => setSelectedBid(Math.max(0, validBid - 1))}
                className="w-7 h-7 rounded bg-[var(--bg-tertiary)] border border-[var(--border-subtle)] hover:border-[var(--border-medium)] flex items-center justify-center text-sm"
              >-</button>
              <span className="text-xl font-bold w-8 text-center tabular-nums">{validBid}</span>
              <button
                onClick={() => setSelectedBid(Math.min(handSize, validBid + 1))}
                className="w-7 h-7 rounded bg-[var(--bg-tertiary)] border border-[var(--border-subtle)] hover:border-[var(--border-medium)] flex items-center justify-center text-sm"
              >+</button>
            </div>
            <div className="flex justify-center gap-2 flex-wrap">
              {Array.from({ length: handSize + 1 }, (_, i) => i).map((b) => {
                const disabled = b === restrictedBid;
                return (
                  <button
                    key={b}
                    onClick={() => !disabled && onBid(b)}
                    disabled={disabled}
                    className={`w-8 h-8 rounded text-[12px] font-bold transition-all ${
                      disabled
                        ? 'opacity-30 cursor-not-allowed bg-[var(--bg-tertiary)] border border-[var(--border-subtle)]'
                        : 'bg-[var(--bg-tertiary)] border border-[var(--border-subtle)] hover:border-[var(--accent-gold)] hover:bg-[var(--accent-gold)]/8'
                    }`}
                  >
                    {b}
                  </button>
                );
              })}
            </div>
          </div>
        ) : (
          <p className="text-[12px] text-[var(--text-muted)]">
            Waiting for {gameState.players[gameState.currentPlayerSeat]?.displayName}
          </p>
        )}
      </div>
    );
  }

  if (gameState.gameType === GameType.Euchre) {
    const suits = [
      { suit: 'H', symbol: '\u2665', color: 'text-[#c33]' },
      { suit: 'D', symbol: '\u2666', color: 'text-[#c33]' },
      { suit: 'C', symbol: '\u2663', color: 'text-[var(--text-primary)]' },
      { suit: 'S', symbol: '\u2660', color: 'text-[var(--accent-blue)]' },
    ];

    return (
      <div className="bg-[var(--bg-secondary)] rounded-lg border border-[var(--border-subtle)] p-4 text-center">
        <div className="text-[11px] font-semibold text-[var(--text-secondary)] uppercase tracking-wider mb-3">Call Trump</div>

        {isMyTurn ? (
          <div>
            <p className="text-[12px] text-[var(--accent-green)] font-semibold mb-3">Choose trump or pass</p>
            <div className="flex justify-center gap-2 mb-3">
              {suits.map((s) => (
                <button
                  key={s.suit}
                  onClick={() => onCallTrump(s.suit)}
                  className="w-12 h-12 rounded-lg border border-[var(--border-subtle)] hover:border-[var(--accent-gold)] hover:bg-[var(--accent-gold)]/8 flex items-center justify-center transition-all"
                >
                  <span className={`text-2xl ${s.color}`}>{s.symbol}</span>
                </button>
              ))}
            </div>
            <button
              onClick={() => onCallTrump('pass')}
              className="px-5 py-1.5 text-[12px] border border-[var(--border-subtle)] rounded hover:bg-white/[0.04] transition-colors"
            >Pass</button>
          </div>
        ) : (
          <p className="text-[12px] text-[var(--text-muted)]">
            Waiting for {gameState.players[gameState.currentPlayerSeat]?.displayName}
          </p>
        )}
      </div>
    );
  }

  return null;
}
