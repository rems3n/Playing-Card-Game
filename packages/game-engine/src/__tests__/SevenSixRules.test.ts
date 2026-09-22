import { afterEach, describe, expect, it, vi } from "vitest";
import {
  GameEventType,
  GamePhase,
  Suit,
  type Card,
} from "@card-game/shared-types";
import { SevenSixEngine } from "../games/seven-six/SevenSixEngine.js";

/** Deterministic PRNG so every assertion below is reproducible. */
function rng(seed: number) {
  return () => {
    seed = (Math.imul(1664525, seed) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}
function seed(value: number) {
  vi.spyOn(Math, "random").mockImplementation(rng(value));
}
function table(seats: number, value = 1) {
  seed(value);
  const engine = new SevenSixEngine("rules", { maxPlayers: seats });
  for (let i = 0; i < seats; i++)
    engine.setPlayer(i, `u${i}`, `Player ${i}`, i > 0);
  // The table service, not the engine, decides when the next hand is dealt.
  engine.setRoundPause(true);
  engine.startGame();
  return engine;
}
function bidAll(engine: SevenSixEngine) {
  const order: number[] = [];
  while (engine.getState().phase === GamePhase.Bidding) {
    const seat = engine.getState().currentPlayerSeat;
    order.push(seat);
    engine.placeBid(seat, engine.getLegalBids(seat)[0]);
  }
  return order;
}
/** playCard resolves a full trick itself, so read the winner from the event. */
function lastTrick(engine: SevenSixEngine) {
  const completed = engine
    .getEvents()
    .filter((e) => e.type === GameEventType.TrickCompleted);
  return completed[completed.length - 1];
}
function playTrick(engine: SevenSixEngine) {
  const seats = engine.getState().players.length;
  const cards: Array<{ seatIndex: number; card: Card }> = [];
  for (let i = 0; i < seats; i++) {
    const seat = engine.getState().currentPlayerSeat;
    const move = engine.getLegalMoves(seat)[0];
    cards.push({ seatIndex: seat, card: move });
    engine.playCard(seat, move);
  }
  return { cards, winningSeat: lastTrick(engine).seatIndex! };
}
function playHand(engine: SevenSixEngine) {
  while (engine.getState().phase === GamePhase.Playing) playTrick(engine);
}
/** Score a finished hand and deal the next one. */
function dealNext(engine: SevenSixEngine) {
  engine.startNextRound();
}
const SEATS = [2, 3, 4, 5, 6, 7];

afterEach(() => vi.restoreAllMocks());

describe("Seven-Six bidding turn order", () => {
  it.each(SEATS)("%s seats bid clockwise from the dealer, dealer last", (seats) => {
    const engine = table(seats);
    const dealer = engine.getDealerSeat();
    expect(engine.getState().currentPlayerSeat).toBe((dealer + 1) % seats);
    const order = bidAll(engine);
    expect(order).toEqual(
      Array.from({ length: seats }, (_, i) => (dealer + 1 + i) % seats),
    );
    expect(order[order.length - 1]).toBe(dealer);
    expect(engine.getBids().every((b) => b !== null)).toBe(true);
  });

  it.each(SEATS)("%s seats reject an out-of-turn bid without changing state", (seats) => {
    const engine = table(seats);
    const current = engine.getState().currentPlayerSeat;
    const before = JSON.stringify(engine.serialize());
    for (let seat = 0; seat < seats; seat++) {
      if (seat === current) continue;
      expect(() => engine.placeBid(seat, 1)).toThrow("Not your turn to bid");
    }
    expect(JSON.stringify(engine.serialize())).toBe(before);
  });

  it("rejects a bid once bidding is over", () => {
    const engine = table(4);
    bidAll(engine);
    expect(engine.getState().phase).toBe(GamePhase.Playing);
    const before = JSON.stringify(engine.serialize());
    expect(() => engine.placeBid(engine.getState().currentPlayerSeat, 1)).toThrow(
      "Not in bidding phase",
    );
    expect(JSON.stringify(engine.serialize())).toBe(before);
  });
});

describe("Seven-Six bid validation", () => {
  it.each([-1, 8, 1.5, NaN, Infinity, -Infinity])(
    "rejects the bid %s and leaves the hand untouched",
    (bid) => {
      const engine = table(4);
      const seat = engine.getState().currentPlayerSeat;
      const before = JSON.stringify(engine.serialize());
      expect(() => engine.placeBid(seat, bid as number)).toThrow(/Bid must be/);
      expect(JSON.stringify(engine.serialize())).toBe(before);
      expect(engine.getBids()[seat]).toBeNull();
    },
  );

  it.each(SEATS)("%s seats: the dealer cannot make the bids total the hand size", (seats) => {
    const engine = table(seats);
    const dealer = engine.getDealerSeat();
    const handSize = engine.getState().handSize!;
    // Everyone before the dealer bids; then the dealer's forbidden bid is known.
    while (engine.getState().currentPlayerSeat !== dealer) {
      const seat = engine.getState().currentPlayerSeat;
      engine.placeBid(seat, engine.getLegalBids(seat)[0]);
    }
    const placed = engine
      .getBids()
      .filter((b): b is number => b !== null)
      .reduce((a, b) => a + b, 0);
    const forbidden = handSize - placed;
    if (forbidden >= 0 && forbidden <= handSize) {
      expect(engine.getLegalBids(dealer)).not.toContain(forbidden);
      const before = JSON.stringify(engine.serialize());
      expect(() => engine.placeBid(dealer, forbidden)).toThrow(
        /total bids would equal hand size/,
      );
      expect(JSON.stringify(engine.serialize())).toBe(before);
    }
    const legal = engine.getLegalBids(dealer);
    engine.placeBid(dealer, legal[0]);
    expect(engine.getBids()[dealer]).toBe(legal[0]);
    expect(
      engine.getBids().reduce((a, b) => a! + b!, 0),
    ).not.toBe(handSize);
  });

  it("only restricts the dealer, never the other seats", () => {
    const engine = table(4);
    const dealer = engine.getDealerSeat();
    const handSize = engine.getState().handSize!;
    for (let seat = 0; seat < 4; seat++) {
      if (seat === dealer) continue;
      expect(engine.getLegalBids(seat)).toEqual(
        Array.from({ length: handSize + 1 }, (_, i) => i),
      );
    }
  });
});

describe("Seven-Six trump reservation", () => {
  it.each(SEATS)("%s seats: the trump card is set aside in every round", (seats) => {
    const engine = table(seats, seats * 31);
    const sizes: number[] = [];
    for (let round = 0; round < 13; round++) {
      const trump = engine.getTrumpCard()!;
      const state = engine.getState();
      sizes.push(state.handSize!);
      expect(trump).toBeTruthy();
      expect(state.trumpSuit).toBe(trump.suit);
      const dealt = state.players.flatMap((p) => p.hand);
      expect(dealt).toHaveLength(seats * state.handSize!);
      expect(
        dealt.some((c) => c.suit === trump.suit && c.rank === trump.rank),
      ).toBe(false);
      // No card is dealt twice either.
      expect(new Set(dealt.map((c) => `${c.rank}${c.suit}`)).size).toBe(
        dealt.length,
      );
      bidAll(engine);
      playHand(engine);
      if (engine.getState().phase === GamePhase.GameOver) break;
      dealNext(engine);
    }
    expect(sizes).toEqual([7, 6, 5, 4, 3, 2, 1, 2, 3, 4, 5, 6, 7]);
  });
});

describe("Seven-Six trick resolution", () => {
  const card = (rank: number, suit: Suit): Card => ({ rank, suit });
  function trickWinner(
    played: Array<{ seatIndex: number; card: Card }>,
    trump: Suit,
  ) {
    const lead = played[0].card.suit;
    return played.reduce((best, p) => {
      const power = (c: Card) =>
        (c.suit === trump ? 200 : c.suit === lead ? 100 : 0) + c.rank;
      return power(p.card) > power(best.card) ? p : best;
    }).seatIndex;
  }

  it("a trump beats every card of the lead suit", () => {
    const trump = Suit.Spades;
    const played = [
      { seatIndex: 0, card: card(14, Suit.Hearts) },
      { seatIndex: 1, card: card(2, Suit.Spades) },
      { seatIndex: 2, card: card(13, Suit.Hearts) },
      { seatIndex: 3, card: card(3, Suit.Hearts) },
    ];
    expect(trickWinner(played, trump)).toBe(1);
  });

  it("the highest lead-suit card wins when nobody trumps, and an off-suit discard never wins", () => {
    const trump = Suit.Spades;
    const played = [
      { seatIndex: 0, card: card(9, Suit.Hearts) },
      { seatIndex: 1, card: card(14, Suit.Diamonds) },
      { seatIndex: 2, card: card(12, Suit.Hearts) },
      { seatIndex: 3, card: card(14, Suit.Clubs) },
    ];
    expect(trickWinner(played, trump)).toBe(2);
  });

  it.each(SEATS)("%s seats: the engine agrees with an independent winner for every trick", (seats) => {
    const engine = table(seats, seats * 7 + 3);
    bidAll(engine);
    const trump = engine.getState().trumpSuit!;
    let tricks = 0;
    while (engine.getState().phase === GamePhase.Playing) {
      const { cards, winningSeat } = playTrick(engine);
      expect(winningSeat).toBe(trickWinner(cards, trump));
      // The winner leads the next trick.
      if (engine.getState().phase === GamePhase.Playing)
        expect(engine.getState().currentPlayerSeat).toBe(winningSeat);
      tricks++;
    }
    expect(tricks).toBe(7);
    expect(
      engine.getState().players.reduce((a, p) => a + p.tricksWon, 0),
    ).toBe(7);
  });
});

describe("Seven-Six round progression", () => {
  it.each(SEATS)("%s seats: the dealer rotates once per round for all 13 rounds", (seats) => {
    const engine = table(seats, seats * 13);
    const first = engine.getDealerSeat();
    const seen: number[] = [];
    for (let round = 0; round < 13; round++) {
      seen.push(engine.getDealerSeat());
      expect(engine.getState().dealerSeat).toBe(engine.getDealerSeat());
      bidAll(engine);
      playHand(engine);
      if (engine.getState().phase === GamePhase.GameOver) break;
      dealNext(engine);
    }
    expect(seen).toEqual(
      Array.from({ length: 13 }, (_, i) => (first + i) % seats),
    );
  });

  it.each(SEATS)("%s seats: totals stay the sum of every round scored so far", (seats) => {
    const engine = table(seats, seats * 17);
    const running = new Array(seats).fill(0);
    for (let round = 0; round < 13; round++) {
      bidAll(engine);
      const bids = engine.getBids().map((b) => b!);
      playHand(engine);
      const tricks = engine.getState().players.map((p) => p.tricksWon);
      const roundScores = engine.getState().roundScores;
      // Exact bid pays 10 plus a point per trick; otherwise nothing.
      expect(roundScores).toEqual(
        tricks.map((won, i) => (won === bids[i] ? 10 + won : 0)),
      );
      expect(tricks.reduce((a, b) => a + b, 0)).toBe(
        engine.getState().handSize,
      );
      for (let i = 0; i < seats; i++) running[i] += roundScores[i];
      expect(engine.getState().scores).toEqual(running);
      if (engine.getState().phase === GamePhase.GameOver) break;
      dealNext(engine);
    }
    expect(engine.getState().phase).toBe(GamePhase.GameOver);
    const best = Math.max(...running);
    expect(running[engine.getWinnerSeat()]).toBe(best);
  });

  it.each(SEATS)("%s seats: a restored game keeps the same visible state for every seat", (seats) => {
    const engine = table(seats, seats * 23);
    bidAll(engine);
    playTrick(engine);
    const clone = new SevenSixEngine("rules", { maxPlayers: seats });
    clone.restore(engine.serialize());
    for (let seat = 0; seat < seats; seat++)
      expect(clone.getVisibleState(seat)).toEqual(engine.getVisibleState(seat));
    expect(clone.getTrumpCard()).toEqual(engine.getTrumpCard());
    expect(clone.getDealerSeat()).toBe(engine.getDealerSeat());
    expect(clone.getRoundSequence()).toEqual(engine.getRoundSequence());
  });
});

describe("Seven-Six hidden information", () => {
  it.each(SEATS)("%s seats: a seat only ever sees its own hand", (seats) => {
    const engine = table(seats, seats * 29);
    for (let seat = 0; seat < seats; seat++) {
      const visible = engine.getVisibleState(seat);
      expect(visible.myHand).toEqual(engine.getState().players[seat].hand);
      expect(visible.players.some((p) => "hand" in p)).toBe(false);
      expect(JSON.stringify(visible)).not.toContain('"hand"');
      if (seat !== engine.getState().currentPlayerSeat)
        expect(visible.legalMoves).toHaveLength(0);
    }
  });
});

describe("Seven-Six table size", () => {
  it.each([0, 1, 8, 2.5, NaN, -3])("rejects a table of %s", (seats) => {
    expect(() => new SevenSixEngine("rules", { maxPlayers: seats as number })).toThrow(
      "Seven-Six requires 2-7 players",
    );
  });

  it.each(SEATS)("%s seats always play 13 rounds of 7,6,5,4,3,2,1,2,3,4,5,6,7", (seats) => {
    expect(SevenSixEngine.buildRoundSequence(seats)).toEqual([
      7, 6, 5, 4, 3, 2, 1, 2, 3, 4, 5, 6, 7,
    ]);
  });
});
