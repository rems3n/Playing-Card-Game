import { describe, expect, it } from "vitest";
import { GamePhase, Rank, Suit, type Card } from "@card-game/shared-types";
import {
  FortyFivesEngine,
  LEGAL_BIDS,
  PASS,
} from "../games/forty-fives/FortyFivesEngine.js";
import {
  effectiveSuit,
  isTopTrump,
  isTrump,
  plainOrder,
  strength,
  trumpOrder,
} from "../games/forty-fives/ranking.js";

const c = (rank: Rank, suit: Suit): Card => ({ rank, suit });
const key = (card: Card) => `${card.rank}${card.suit}`;
const spell = (cards: Card[]) => cards.map(key).join(" ");

describe("the Forty-Fives ranking", () => {
  // Transcribed from the rules, strongest first, not derived from the engine.
  it.each([
    [Suit.Hearts, "5H 11H 14H 13H 12H 10H 9H 8H 7H 6H 4H 3H 2H"],
    [Suit.Diamonds, "5D 11D 14H 14D 13D 12D 10D 9D 8D 7D 6D 4D 3D 2D"],
    [Suit.Clubs, "5C 11C 14H 14C 13C 12C 2C 3C 4C 6C 7C 8C 9C 10C"],
    [Suit.Spades, "5S 11S 14H 14S 13S 12S 2S 3S 4S 6S 7S 8S 9S 10S"],
  ])("orders trump %s from the five down", (trump, expected) => {
    expect(spell(trumpOrder(trump))).toBe(expected);
    const order = trumpOrder(trump);
    for (let i = 1; i < order.length; i++)
      expect(strength(order[i - 1], trump)).toBeGreaterThan(
        strength(order[i], trump),
      );
  });

  it.each([
    // Hearts has no ace as a plain suit: the ace of hearts is always trump.
    [Suit.Hearts, "13H 12H 11H 10H 9H 8H 7H 6H 5H 4H 3H 2H"],
    [Suit.Diamonds, "14D 13D 12D 11D 10D 9D 8D 7D 6D 5D 4D 3D 2D"],
    [Suit.Clubs, "13C 12C 11C 14C 2C 3C 4C 5C 6C 7C 8C 9C 10C"],
    [Suit.Spades, "13S 12S 11S 14S 2S 3S 4S 5S 6S 7S 8S 9S 10S"],
  ])("orders the plain suit %s highest in red and lowest in black", (suit, expected) => {
    expect(spell(plainOrder(suit))).toBe(expected);
  });

  it("makes the ace of hearts trump in every suit", () => {
    for (const trump of [Suit.Hearts, Suit.Diamonds, Suit.Clubs, Suit.Spades]) {
      expect(isTrump(c(Rank.Ace, Suit.Hearts), trump)).toBe(true);
      expect(effectiveSuit(c(Rank.Ace, Suit.Hearts), trump)).toBe(trump);
      // It sits third, under the five and the jack of trump.
      expect(trumpOrder(trump)[2]).toEqual(c(Rank.Ace, Suit.Hearts));
    }
  });

  it("puts the two of clubs above the ten of clubs when clubs are trump", () => {
    expect(strength(c(Rank.Two, Suit.Clubs), Suit.Clubs)).toBeGreaterThan(
      strength(c(Rank.Ten, Suit.Clubs), Suit.Clubs),
    );
    // And the other way round in a red trump suit.
    expect(strength(c(Rank.Ten, Suit.Hearts), Suit.Hearts)).toBeGreaterThan(
      strength(c(Rank.Two, Suit.Hearts), Suit.Hearts),
    );
  });

  it("puts every trump above every plain card", () => {
    const trump = Suit.Spades;
    const weakest = trumpOrder(trump).at(-1)!;
    for (const suit of [Suit.Hearts, Suit.Diamonds, Suit.Clubs])
      for (const card of plainOrder(suit))
        expect(strength(weakest, trump)).toBeGreaterThan(strength(card, trump));
  });

  it("names exactly three cards a player may hold back", () => {
    const trump = Suit.Clubs;
    const top = [
      c(Rank.Five, trump),
      c(Rank.Jack, trump),
      c(Rank.Ace, Suit.Hearts),
    ];
    for (const card of top) expect(isTopTrump(card, trump)).toBe(true);
    for (const card of trumpOrder(trump).slice(3))
      expect(isTopTrump(card, trump)).toBe(false);
  });
});

/** A table in the playing phase with exactly these hands and this trump. */
function table(hands: Card[][], trump: Suit, lead = 0) {
  const seats = hands.length;
  const engine = new FortyFivesEngine("rules", { maxPlayers: seats });
  for (let i = 0; i < seats; i++) engine.setPlayer(i, `u${i}`, `P${i}`, false);
  // The table service decides when the next hand is dealt, so a scored hand
  // stays put and its contract and highest trump can still be read.
  engine.setRoundPause(true);
  engine.startGame();
  const state = engine.getState();
  // Run the auction for real so the phase machine is where a game leaves it.
  while (state.phase === GamePhase.Bidding && !engine.getLegalTrumpCalls(state.currentPlayerSeat).length)
    engine.placeBid(state.currentPlayerSeat, engine.getLegalBids(state.currentPlayerSeat)[0]);
  engine.callTrump(engine.getDeclarerSeat(), trump);
  for (let i = 0; i < seats; i++) state.players[i].hand = [...hands[i]];
  state.trumpSuit = trump;
  state.currentTrick = [];
  state.trickNumber = 0;
  state.leadSeat = lead;
  state.currentPlayerSeat = lead;
  return engine;
}
const legal = (engine: FortyFivesEngine, seat: number) =>
  engine.getLegalMoves(seat).map(key).sort();

describe("following suit and reneging", () => {
  it("requires the led suit while a player holds it", () => {
    const engine = table(
      [
        [c(Rank.King, Suit.Diamonds)],
        [c(Rank.Nine, Suit.Diamonds), c(Rank.Three, Suit.Clubs)],
      ],
      Suit.Spades,
    );
    engine.playCard(0, c(Rank.King, Suit.Diamonds));
    expect(legal(engine, 1)).toEqual([key(c(Rank.Nine, Suit.Diamonds))]);
  });

  it("frees a player who is void of the led suit", () => {
    const hand = [c(Rank.Three, Suit.Clubs), c(Rank.Two, Suit.Spades)];
    const engine = table([[c(Rank.King, Suit.Diamonds)], hand], Suit.Spades);
    engine.playCard(0, c(Rank.King, Suit.Diamonds));
    expect(legal(engine, 1)).toEqual(hand.map(key).sort());
  });

  it("counts the ace of hearts as trump when following", () => {
    const engine = table(
      [
        // The five is the one trump the ace of hearts cannot be held back from.
        [c(Rank.Five, Suit.Spades)],
        [c(Rank.Ace, Suit.Hearts), c(Rank.Three, Suit.Clubs)],
      ],
      Suit.Spades,
    );
    engine.playCard(0, c(Rank.Five, Suit.Spades));
    expect(legal(engine, 1)).toEqual([key(c(Rank.Ace, Suit.Hearts))]);
  });

  it("lets a top trump be held back when a lower trump is led", () => {
    const engine = table(
      [
        [c(Rank.King, Suit.Spades)],
        [c(Rank.Five, Suit.Spades), c(Rank.Three, Suit.Clubs)],
      ],
      Suit.Spades,
    );
    engine.playCard(0, c(Rank.King, Suit.Spades));
    // The five of trump outranks the king led, so it may be kept back.
    expect(legal(engine, 1)).toEqual(
      [c(Rank.Five, Suit.Spades), c(Rank.Three, Suit.Clubs)].map(key).sort(),
    );
  });

  it("requires a top trump to be played when a higher trump is led", () => {
    const engine = table(
      [
        [c(Rank.Five, Suit.Spades)],
        [c(Rank.Jack, Suit.Spades), c(Rank.Three, Suit.Clubs)],
      ],
      Suit.Spades,
    );
    engine.playCard(0, c(Rank.Five, Suit.Spades));
    // The five is the highest trump there is; the jack must follow it.
    expect(legal(engine, 1)).toEqual([key(c(Rank.Jack, Suit.Spades))]);
    expect(engine.isLegalMove(1, c(Rank.Three, Suit.Clubs))).toBe(false);
  });

  it("does not let an ordinary trump be held back", () => {
    const engine = table(
      [
        [c(Rank.Two, Suit.Spades)],
        [c(Rank.King, Suit.Spades), c(Rank.Three, Suit.Clubs)],
      ],
      Suit.Spades,
    );
    engine.playCard(0, c(Rank.Two, Suit.Spades));
    // The king of trump beats the two led, but it is not one of the top three.
    expect(legal(engine, 1)).toEqual([key(c(Rank.King, Suit.Spades))]);
  });

  it("only allows reneging when every trump held may be held back", () => {
    const engine = table(
      [
        [c(Rank.Queen, Suit.Spades)],
        [
          c(Rank.Five, Suit.Spades),
          c(Rank.King, Suit.Spades),
          c(Rank.Three, Suit.Clubs),
        ],
      ],
      Suit.Spades,
    );
    engine.playCard(0, c(Rank.Queen, Suit.Spades));
    // The king is an ordinary trump and must follow, so nothing may be thrown.
    expect(legal(engine, 1)).toEqual(
      [c(Rank.Five, Suit.Spades), c(Rank.King, Suit.Spades)].map(key).sort(),
    );
  });

  it("never lets reneging apply to a plain suit lead", () => {
    const engine = table(
      [
        [c(Rank.King, Suit.Diamonds)],
        [c(Rank.Ace, Suit.Diamonds), c(Rank.Five, Suit.Spades)],
      ],
      Suit.Spades,
    );
    engine.playCard(0, c(Rank.King, Suit.Diamonds));
    expect(legal(engine, 1)).toEqual([key(c(Rank.Ace, Suit.Diamonds))]);
  });
});

describe("winning a trick", () => {
  function winner(played: Array<[number, Card]>, trump: Suit, seats = 4) {
    const hands: Card[][] = Array.from({ length: seats }, () => []);
    for (const [seat, card] of played) hands[seat] = [card];
    const engine = table(hands, trump, played[0][0]);
    for (const [seat, card] of played) engine.playCard(seat, card);
    return engine
      .getEvents()
      .filter((e) => e.type === "trick_completed")
      .at(-1)!.seatIndex;
  }

  it("gives it to the five of trump over everything", () => {
    expect(
      winner(
        [
          [0, c(Rank.Ace, Suit.Hearts)],
          [1, c(Rank.Jack, Suit.Spades)],
          [2, c(Rank.Five, Suit.Spades)],
          [3, c(Rank.Ace, Suit.Spades)],
        ],
        Suit.Spades,
      ),
    ).toBe(2);
  });

  it("puts the ace of hearts above the ace of trump", () => {
    expect(
      winner(
        [
          [0, c(Rank.Ace, Suit.Spades)],
          [1, c(Rank.Ace, Suit.Hearts)],
          [2, c(Rank.King, Suit.Spades)],
          [3, c(Rank.Two, Suit.Spades)],
        ],
        Suit.Spades,
      ),
    ).toBe(1);
  });

  it("gives any trump the trick over the best plain card", () => {
    expect(
      winner(
        [
          [0, c(Rank.Ace, Suit.Diamonds)],
          [1, c(Rank.King, Suit.Diamonds)],
          [2, c(Rank.Ten, Suit.Spades)],
          [3, c(Rank.Queen, Suit.Diamonds)],
        ],
        Suit.Spades,
      ),
    ).toBe(2);
  });

  it("uses the black ranking among plain clubs", () => {
    // Clubs led with hearts as trump: the two beats the ten, the king beats all.
    expect(
      winner(
        [
          [0, c(Rank.Ten, Suit.Clubs)],
          [1, c(Rank.Two, Suit.Clubs)],
          [2, c(Rank.Nine, Suit.Clubs)],
          [3, c(Rank.Three, Suit.Clubs)],
        ],
        Suit.Hearts,
      ),
    ).toBe(1);
  });

  it("ignores a card of neither trump nor the led suit", () => {
    expect(
      winner(
        [
          [0, c(Rank.Nine, Suit.Diamonds)],
          [1, c(Rank.King, Suit.Clubs)],
          [2, c(Rank.Ten, Suit.Diamonds)],
          [3, c(Rank.Queen, Suit.Clubs)],
        ],
        Suit.Spades,
      ),
    ).toBe(2);
  });
});

describe("the auction", () => {
  function auction(seats = 4) {
    const engine = new FortyFivesEngine("auction", { maxPlayers: seats });
    for (let i = 0; i < seats; i++) engine.setPlayer(i, `u${i}`, `P${i}`, false);
    engine.startGame();
    return engine;
  }

  it("starts left of the dealer and offers fifteen upward or a pass", () => {
    const engine = auction();
    const state = engine.getState();
    expect(state.currentPlayerSeat).toBe((engine.getDealerSeat() + 1) % 4);
    expect(engine.getLegalBids(state.currentPlayerSeat)).toEqual([
      ...LEGAL_BIDS,
      PASS,
    ]);
  });

  it("makes each bid beat the last, and lets only the dealer hold one", () => {
    const engine = auction();
    const state = engine.getState();
    const first = state.currentPlayerSeat;
    engine.placeBid(first, 20);
    const second = state.currentPlayerSeat;
    expect(engine.getLegalBids(second)).toEqual([25, 30, PASS]);
    expect(() => engine.placeBid(second, 20)).toThrow();
    expect(() => engine.placeBid(second, 15)).toThrow();
    // Pass round to the dealer, who may take it at the standing level.
    while (state.currentPlayerSeat !== engine.getDealerSeat())
      engine.placeBid(state.currentPlayerSeat, PASS);
    expect(engine.getLegalBids(engine.getDealerSeat())).toEqual([
      20, 25, 30, PASS,
    ]);
  });

  it("will not let the dealer pass a hand nobody has bid on", () => {
    const engine = auction();
    const state = engine.getState();
    while (state.currentPlayerSeat !== engine.getDealerSeat())
      engine.placeBid(state.currentPlayerSeat, PASS);
    const dealer = engine.getDealerSeat();
    expect(engine.getLegalBids(dealer)).toEqual([...LEGAL_BIDS]);
    expect(() => engine.placeBid(dealer, PASS)).toThrow();
    engine.placeBid(dealer, 15);
    expect(engine.getDeclarerSeat()).toBe(dealer);
    expect(engine.getContract()).toBe(15);
  });

  it("refuses a bid out of turn, and any bid once the auction is over", () => {
    const engine = auction();
    const state = engine.getState();
    const seat = state.currentPlayerSeat;
    expect(() => engine.placeBid((seat + 1) % 4, 15)).toThrow(/turn/);
    while (state.phase === GamePhase.Bidding && !engine.getLegalTrumpCalls(state.currentPlayerSeat).length)
      engine.placeBid(state.currentPlayerSeat, engine.getLegalBids(state.currentPlayerSeat)[0]);
    expect(engine.getLegalBids(state.currentPlayerSeat)).toEqual([]);
  });

  it("lets only the winner name trump, and they must name a suit", () => {
    const engine = auction();
    const state = engine.getState();
    while (!engine.getLegalTrumpCalls(state.currentPlayerSeat).length)
      engine.placeBid(state.currentPlayerSeat, engine.getLegalBids(state.currentPlayerSeat)[0]);
    const declarer = engine.getDeclarerSeat();
    expect(engine.getLegalTrumpCalls((declarer + 1) % 4)).toEqual([]);
    expect(() => engine.callTrump((declarer + 1) % 4, Suit.Hearts)).toThrow();
    expect(() => engine.callTrump(declarer, "pass")).toThrow();
    engine.callTrump(declarer, Suit.Clubs);
    expect(state.trumpSuit).toBe(Suit.Clubs);
    expect(state.phase).toBe(GamePhase.Playing);
    // The winner of the auction leads.
    expect(state.currentPlayerSeat).toBe(declarer);
  });

  it("refuses a table that is not two, four or six", () => {
    for (const seats of [1, 3, 5, 7, 0, 2.5])
      expect(() => new FortyFivesEngine("bad", { maxPlayers: seats })).toThrow(
        /2, 4 or 6/,
      );
    for (const seats of [2, 4, 6])
      expect(
        new FortyFivesEngine("good", { maxPlayers: seats }).getState().players,
      ).toHaveLength(seats);
  });
});

describe("scoring a hand", () => {
  it("pays five a trick and five for the highest trump, to forty-five", () => {
    const engine = table(
      [
        [c(Rank.Five, Suit.Spades)],
        [c(Rank.Two, Suit.Spades)],
        [c(Rank.Three, Suit.Spades)],
        [c(Rank.Four, Suit.Spades)],
      ],
      Suit.Spades,
    );
    expect(engine.getState().config.targetScore).toBe(45);
    engine.playCard(0, c(Rank.Five, Suit.Spades));
    engine.playCard(1, c(Rank.Two, Suit.Spades));
    engine.playCard(2, c(Rank.Three, Suit.Spades));
    engine.playCard(3, c(Rank.Four, Suit.Spades));
    expect(engine.getHighTrumpSeat()).toBe(0);
    expect(engine.getState().players[0].tricksWon).toBe(1);
  });
});
