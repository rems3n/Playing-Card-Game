"use client";

import { useState } from "react";
import type { VisibleGameState } from "@card-game/shared-types";
import { GameType, Suit } from "@card-game/shared-types";

interface BiddingPanelProps {
  gameState: VisibleGameState;
  onBid: (bid: number) => void;
  pending?: boolean;
  onCallTrump: (suit: string) => void;
}

export function BiddingPanel({
  gameState,
  onBid,
  onCallTrump,
  pending = false,
}: BiddingPanelProps) {
  const [selectedBid, setSelectedBid] = useState<number | null>(null);
  const isMyTurn = gameState.currentPlayerSeat === gameState.mySeat;

  if (gameState.gameType === GameType.Spades) {
    // Legacy Spades surface: it keeps a stepper with a default of 1.
    const spadesBid = selectedBid ?? 1;
    return (
      <div className="bg-[var(--bg-secondary)] rounded-lg border border-[var(--border-subtle)] p-4 text-center">
        <div className="text-[11px] font-semibold text-[var(--text-secondary)] uppercase tracking-wider mb-3">
          Bidding
        </div>

        {/* Bids so far */}
        <div className="flex justify-center gap-4 mb-4">
          {gameState.players.map((p) => (
            <div key={p.seatIndex} className="text-center min-w-0">
              <div className="text-[11px] text-[var(--text-muted)] truncate max-w-[80px]">
                {p.displayName}
              </div>
              <div className="text-lg font-bold mt-0.5">
                {gameState.bids?.[p.seatIndex] != null
                  ? gameState.bids[p.seatIndex]
                  : "\u2014"}
              </div>
            </div>
          ))}
        </div>

        {isMyTurn ? (
          <div>
            <p className="text-[12px] text-[var(--accent-green)] font-semibold mb-2">
              Your bid
            </p>
            <div className="flex items-center justify-center gap-2 mb-3">
              <button
                onClick={() => setSelectedBid(Math.max(0, spadesBid - 1))}
                className="w-7 h-7 rounded bg-[var(--bg-tertiary)] border border-[var(--border-subtle)] hover:border-[var(--border-medium)] flex items-center justify-center text-sm"
              >
                -
              </button>
              <span className="text-xl font-bold w-8 text-center tabular-nums">
                {spadesBid}
              </span>
              <button
                onClick={() => setSelectedBid(Math.min(13, spadesBid + 1))}
                className="w-7 h-7 rounded bg-[var(--bg-tertiary)] border border-[var(--border-subtle)] hover:border-[var(--border-medium)] flex items-center justify-center text-sm"
              >
                +
              </button>
            </div>
            <div className="flex justify-center gap-2">
              <button
                onClick={() => onBid(0)}
                className="px-3 py-1.5 text-[12px] border border-[var(--border-subtle)] rounded hover:bg-white/[0.04] transition-colors"
              >
                Nil
              </button>
              <button
                onClick={() => onBid(spadesBid)}
                className="px-5 py-1.5 text-[12px] font-semibold bg-[var(--accent-green)] text-white rounded hover:brightness-110 transition-all"
              >
                Bid {spadesBid}
              </button>
            </div>
          </div>
        ) : (
          <p className="text-[12px] text-[var(--text-muted)]">
            Waiting for{" "}
            {gameState.players[gameState.currentPlayerSeat]?.displayName}
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
    const currentTotal = bids
      .filter((b): b is number => b !== null)
      .reduce((s, b) => s + b, 0);
    const restrictedBid = isDealer ? handSize - currentTotal : -1;

    const legalBids = Array.from({ length: handSize + 1 }, (_, i) => i).filter(
      (bid) => bid !== restrictedBid,
    );
    // No bid is preselected: the player must choose a number before submitting.
    const validBid =
      selectedBid !== null && legalBids.includes(selectedBid)
        ? selectedBid
        : null;
    return (
      <section className="bidding-panel" aria-label="Choose your bid">
        <h2>Bidding</h2>
        {isMyTurn ? (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (!pending && validBid !== null) onBid(validBid);
            }}
          >
            <p id="bid-help">
              Choose how many tricks you expect to win, then submit your bid.
            </p>
            <div className="bid-options" role="group" aria-label="Bid options">
              {Array.from({ length: handSize + 1 }, (_, bid) => (
                <button
                  type="button"
                  key={bid}
                  aria-label={`Select bid ${bid}`}
                  aria-pressed={bid === validBid}
                  disabled={pending || bid === restrictedBid}
                  title={
                    bid === restrictedBid
                      ? "The dealer cannot make total bids equal the number of tricks."
                      : undefined
                  }
                  onClick={() => setSelectedBid(bid)}
                >
                  {bid}
                </button>
              ))}
            </div>
            {isDealer && restrictedBid >= 0 && restrictedBid <= handSize && (
              <p className="bid-restriction">
                As dealer, you cannot bid {restrictedBid}: total bids cannot
                equal {handSize}.
              </p>
            )}
            <button
              className="button primary full"
              type="submit"
              disabled={pending || validBid === null}
              aria-describedby="bid-help"
            >
              {pending
                ? "Submitting…"
                : validBid === null
                  ? "Submit bid"
                  : `Submit bid: ${validBid}`}
            </button>
          </form>
        ) : (
          <p role="status">
            Waiting for{" "}
            {gameState.players[gameState.currentPlayerSeat]?.displayName} to
            bid.
          </p>
        )}
      </section>
    );
  }

  if (gameState.gameType === GameType.Euchre) {
    const legalCalls = gameState.legalTrumpCalls ?? [];
    const suitNames: Record<string, string> = {
      H: "Hearts",
      D: "Diamonds",
      C: "Clubs",
      S: "Spades",
    };
    const suits = [
      { suit: "H", symbol: "\u2665", color: "text-[#c33]" },
      { suit: "D", symbol: "\u2666", color: "text-[#c33]" },
      { suit: "C", symbol: "\u2663", color: "text-[var(--text-primary)]" },
      { suit: "S", symbol: "\u2660", color: "text-[var(--accent-blue)]" },
    ];

    return (
      <div className="bg-[var(--bg-secondary)] rounded-lg border border-[var(--border-subtle)] p-4 text-center">
        <div className="text-[11px] font-semibold text-[var(--text-secondary)] uppercase tracking-wider mb-3">
          Call Trump
        </div>
        <p className="text-sm text-[var(--text-secondary)] mb-3">
          {gameState.trumpCallRound === 1
            ? `Order up ${suitNames[gameState.turnedUpCard?.suit ?? ""] ?? "the turned suit"}, or pass.`
            : "Choose a different suit. The dealer must call."}
        </p>

        {isMyTurn ? (
          <div>
            <p className="text-[12px] text-[var(--accent-green)] font-semibold mb-3">
              Choose trump or pass
            </p>
            <div className="flex justify-center gap-2 mb-3">
              {suits.map((s) => (
                <button
                  key={s.suit}
                  onClick={() => onCallTrump(s.suit)}
                  disabled={pending || !legalCalls.includes(s.suit as Suit)}
                  aria-label={`Call ${suitNames[s.suit]}`}
                  className="w-12 h-12 rounded-lg border border-[var(--border-subtle)] enabled:hover:border-[var(--accent-gold)] disabled:opacity-25 disabled:cursor-not-allowed flex items-center justify-center transition-all"
                >
                  <span className={`text-2xl ${s.color}`}>{s.symbol}</span>
                </button>
              ))}
            </div>
            <button
              onClick={() => onCallTrump("pass")}
              disabled={pending || !legalCalls.includes("pass")}
              className="min-h-11 px-5 text-sm border border-[var(--border-subtle)] rounded enabled:hover:bg-white/[0.04] disabled:opacity-25 transition-colors"
            >
              Pass
            </button>
          </div>
        ) : (
          <p className="text-[12px] text-[var(--text-muted)]">
            Waiting for{" "}
            {gameState.players[gameState.currentPlayerSeat]?.displayName}
          </p>
        )}
      </div>
    );
  }

  return null;
}
