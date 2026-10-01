"use client";

import { useState } from "react";
import { ChoiceGroup } from "../ChoiceGroup";
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
    // Nil is a bid of no tricks at all; the tiles run one to thirteen.
    const validBid =
      selectedBid !== null && selectedBid >= 0 && selectedBid <= 13
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
              Choose how many tricks you expect to win with spades as trump.
              Your pair needs its two bids together.
            </p>
            <ChoiceGroup name="bid" label="Bid options" value={validBid} onChange={setSelectedBid} className="bid-options spades-bids"
              options={Array.from({length: 14}, (_, bid) => ({ value: bid, label: bid === 0 ? "Bid nil: no tricks" : `Bid ${bid}`, content: bid === 0 ? "Nil" : bid, disabled: pending }))} />
            <button
              className="button primary full"
              type="submit"
              disabled={pending || validBid === null}
              aria-describedby="bid-help"
            >
              {pending
                ? "Submitting\u2026"
                : validBid === null
                  ? "Submit bid"
                  : validBid === 0
                    ? "Bid nil"
                    : `Bid ${validBid}`}
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
              How many tricks will you win?
            </p>
            <ChoiceGroup name="bid" label="Bid options" value={validBid} onChange={setSelectedBid} className="bid-options seven-six-bids"
              options={Array.from({length: handSize + 1}, (_, bid) => ({ value: bid, label: `Select bid ${bid}`, content: bid, disabled: pending || bid === restrictedBid,
                title: bid === restrictedBid ? "The dealer cannot make total bids equal the number of tricks." : undefined }))} />
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
                  : `Bid ${validBid}`}
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

  if (gameState.gameType === GameType.FortyFives) {
    const suitNames: Record<string, string> = {
      H: "hearts",
      D: "diamonds",
      C: "clubs",
      S: "spades",
    };
    const suits = [
      { suit: Suit.Hearts, symbol: "\u2665", red: true },
      { suit: Suit.Diamonds, symbol: "\u2666", red: true },
      { suit: Suit.Clubs, symbol: "\u2663", red: false },
      { suit: Suit.Spades, symbol: "\u2660", red: false },
    ];
    const legalCalls = gameState.legalTrumpCalls ?? [];
    const legalBids = gameState.legalBids ?? [];
    const naming = legalCalls.length > 0;
    const standing = (gameState.bids ?? []).reduce<number>(
      (best, bid) => (typeof bid === "number" && bid > best ? bid : best),
      0,
    );

    if (!isMyTurn)
      return (
        <section className="bidding-panel" aria-label="The auction">
          <h2>{naming ? "Naming trump" : "Bidding"}</h2>
          <p role="status">
            Waiting for{" "}
            {gameState.players[gameState.currentPlayerSeat]?.displayName}
            {naming ? " to name trump." : " to bid."}
          </p>
        </section>
      );

    // The winner of the auction names trump before anyone leads.
    if (naming)
      return (
        <section className="bidding-panel" aria-label="Name trump">
          <h2>Name trump</h2>
          <p id="trump-help">
            You won the auction at {gameState.contract}. Name the suit you want
            as trump.
          </p>
          <div className="trump-options" role="group" aria-label="Trump suits">
            {suits.map((s) => (
              <button
                type="button"
                key={s.suit}
                className={s.red ? "red" : ""}
                aria-label={`Trump is ${suitNames[s.suit]}`}
                disabled={pending || !legalCalls.includes(s.suit)}
                onClick={() => onCallTrump(s.suit)}
              >
                <span aria-hidden>{s.symbol}</span>
                <small>{suitNames[s.suit]}</small>
              </button>
            ))}
          </div>
        </section>
      );

    return (
      <section className="bidding-panel" aria-label="Choose your bid">
        <h2>Bidding</h2>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (!pending && selectedBid !== null && legalBids.includes(selectedBid)) onBid(selectedBid);
          }}
        >
          <p id="bid-help">
            {standing
              ? `The bid stands at ${standing}. Bid higher or pass.`
              : "Bid the points you expect to take, or pass. Each trick is worth 5, and the highest trump is worth 5 more."}
          </p>
          <ChoiceGroup name="bid" label="Bid options" value={selectedBid} onChange={setSelectedBid} className="bid-options forty-fives-bids"
            options={[15, 20, 25, 30].map(bid => ({value: bid, label: `Bid ${bid}`, content: bid, disabled: pending || !legalBids.includes(bid)}))} />
          <button
            className="button primary full"
            type="submit"
            disabled={pending || selectedBid === null || !legalBids.includes(selectedBid)}
            aria-describedby="bid-help"
          >
            {pending
              ? "Submitting\u2026"
              : selectedBid === null
                ? "Submit bid"
                : `Bid ${selectedBid}`}
          </button>
          <button
            type="button"
            className="button secondary full"
            disabled={pending || !legalBids.includes(-1)}
            onClick={() => !pending && onBid(-1)}
          >
            {legalBids.includes(-1)
              ? "Pass"
              : "You must bid \u2014 nobody else did"}
          </button>
        </form>
      </section>
    );
  }

  return null;
}
