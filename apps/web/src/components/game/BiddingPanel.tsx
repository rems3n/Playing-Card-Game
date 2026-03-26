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
