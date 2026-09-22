import { describe, expect, it } from "vitest";
import {
  GameEventType,
  GamePhase,
  Rank,
  Suit,
  type Card,
} from "@card-game/shared-types";
import { EuchreEngine } from "../games/euchre/EuchreEngine.js";
import { createEuchreDeck } from "../core/Deck.js";

/**
 * Move validation for the engine the app labels "45s / Euchre". It plays
 * Euchre; docs/FORTY-FIVES.md records how the two games differ. These tests pin
 * the Euchre behaviour so that difference stays a documented choice rather than
 * something nobody checked.
 */
const c = (rank: Rank, suit: Suit): Card => ({ rank, suit });
const key = (card: Card) => `${card.rank}${card.suit}`;

/**
 * A table dealt exactly these hands.
 *
 * Bidding runs for real so the engine's phase machine is in the state it would
 * be in during a game; only the cards and the trump suit are then replaced.
 */
function table(hands: Card[][], trump: Suit, lead = 0, maker = 0) {
  const engine = new EuchreEngine("moves");
  for (let i = 0; i < 4; i++) engine.setPlayer(i, `u${i}`, `Player ${i}`, false);
  engine.startGame();
  const state = engine.getState();
  engine.callTrump(state.currentPlayerSeat, engine.getVisibleState(0).turnedUpCard!.suit);
  expect(state.phase).toBe(GamePhase.Playing);
  // Whoever called during the real bidding is not the seat these tests want to
  // reason about, so the maker is named here instead.
  (engine as unknown as { maker: number }).maker = maker;
  for (let i = 0; i < 4; i++) state.players[i].hand = [...hands[i]];
  state.trumpSuit = trump;
  state.currentTrick = [];
  state.trickNumber = 0;
  state.leadSeat = lead;
  state.currentPlayerSeat = lead;
  return engine;
}
const legal = (engine: EuchreEngine, seat: number) =>
  engine.getLegalMoves(seat).map(key).sort();

describe("the Euchre deck", () => {
  it("is 24 cards, nine to ace, and deals five each with one turned up", () => {
    const deck = createEuchreDeck();
    expect(deck).toHaveLength(24);
    expect(new Set(deck.map((card) => card.rank))).toEqual(
      new Set([Rank.Nine, Rank.Ten, Rank.Jack, Rank.Queen, Rank.King, Rank.Ace]),
    );
    expect(deck.filter((card) => card.rank < Rank.Nine)).toEqual([]);

    const engine = new EuchreEngine("deck");
    engine.startGame();
    const state = engine.getState();
    expect(state.players.map((p) => p.hand.length)).toEqual([5, 5, 5, 5]);
    const turned = engine.getVisibleState(0).turnedUpCard!;
    expect(turned).toBeTruthy();
    const dealt = state.players.flatMap((p) => p.hand.map(key));
    expect(new Set(dealt).size).toBe(20);
    expect(dealt).not.toContain(key(turned));
  });
});

describe("following suit", () => {
  it("makes the left bower part of trump, not of its printed suit", () => {
    // Trump is hearts, so the jack of diamonds is a heart for every purpose.
    const engine = table(
      [
        [c(Rank.Ace, Suit.Spades)],
        [c(Rank.Jack, Suit.Diamonds), c(Rank.Nine, Suit.Spades)],
        [c(Rank.Nine, Suit.Hearts)],
        [c(Rank.Ten, Suit.Clubs)],
      ],
      Suit.Hearts,
    );
    // Diamonds are led: the jack of diamonds does not follow them.
    engine.getState().currentTrick = [
      { seatIndex: 3, card: c(Rank.Queen, Suit.Diamonds) },
    ];
    engine.getState().currentPlayerSeat = 1;
    expect(legal(engine, 1)).toEqual(
      [c(Rank.Jack, Suit.Diamonds), c(Rank.Nine, Suit.Spades)].map(key).sort(),
    );
    expect(engine.isLegalMove(1, c(Rank.Nine, Suit.Spades))).toBe(true);
  });

  it("treats a led left bower as a led trump", () => {
    const engine = table(
      [
        [c(Rank.Jack, Suit.Diamonds)],
        [c(Rank.Nine, Suit.Hearts), c(Rank.Ace, Suit.Spades)],
        [c(Rank.Nine, Suit.Clubs)],
        [c(Rank.Ten, Suit.Clubs)],
      ],
      Suit.Hearts,
    );
    engine.playCard(0, c(Rank.Jack, Suit.Diamonds));
    // Seat 1 holds a heart, so it must be played even though a diamond led.
    expect(legal(engine, 1)).toEqual([key(c(Rank.Nine, Suit.Hearts))]);
    expect(engine.isLegalMove(1, c(Rank.Ace, Suit.Spades))).toBe(false);
  });

  it("requires the lead suit while a player holds it, and frees them when void", () => {
    const engine = table(
      [
        [c(Rank.Ace, Suit.Clubs)],
        [c(Rank.Nine, Suit.Clubs), c(Rank.King, Suit.Clubs), c(Rank.Ace, Suit.Hearts)],
        [c(Rank.Nine, Suit.Diamonds), c(Rank.Ace, Suit.Spades)],
        [c(Rank.Ten, Suit.Spades)],
      ],
      Suit.Hearts,
    );
    engine.playCard(0, c(Rank.Ace, Suit.Clubs));
    expect(legal(engine, 1)).toEqual(
      [c(Rank.Nine, Suit.Clubs), c(Rank.King, Suit.Clubs)].map(key).sort(),
    );
    engine.playCard(1, c(Rank.Nine, Suit.Clubs));
    // Seat 2 has no clubs: anything goes, including a trump.
    expect(legal(engine, 2)).toEqual(
      [c(Rank.Nine, Suit.Diamonds), c(Rank.Ace, Suit.Spades)].map(key).sort(),
    );
  });

  it("lets the leader play any card in hand", () => {
    const hand = [
      c(Rank.Nine, Suit.Clubs),
      c(Rank.Ace, Suit.Hearts),
      c(Rank.Ten, Suit.Spades),
    ];
    const engine = table([hand, [], [], []], Suit.Hearts);
    expect(legal(engine, 0)).toEqual(hand.map(key).sort());
  });
});

describe("moves the engine refuses", () => {
  const hands = () => [
    [c(Rank.Ace, Suit.Clubs), c(Rank.Nine, Suit.Hearts)],
    [c(Rank.King, Suit.Clubs)],
    [c(Rank.Queen, Suit.Clubs)],
    [c(Rank.Ten, Suit.Clubs)],
  ];

  it("refuses a card the player does not hold", () => {
    const engine = table(hands(), Suit.Hearts);
    const before = JSON.stringify(engine.serialize());
    expect(engine.isLegalMove(0, c(Rank.King, Suit.Diamonds))).toBe(false);
    expect(() => engine.playCard(0, c(Rank.King, Suit.Diamonds))).toThrow(
      /Illegal move/,
    );
    expect(JSON.stringify(engine.serialize())).toBe(before);
  });

  it("refuses a card played out of turn", () => {
    const engine = table(hands(), Suit.Hearts);
    const before = JSON.stringify(engine.serialize());
    for (const seat of [1, 2, 3])
      expect(() => engine.playCard(seat, hands()[seat][0])).toThrow(/turn/);
    expect(JSON.stringify(engine.serialize())).toBe(before);
  });

  it("refuses a card that does not follow the lead suit", () => {
    const engine = table(
      [
        [c(Rank.Ace, Suit.Clubs)],
        [c(Rank.King, Suit.Clubs), c(Rank.Nine, Suit.Hearts)],
        [],
        [],
      ],
      Suit.Hearts,
    );
    engine.playCard(0, c(Rank.Ace, Suit.Clubs));
    const before = JSON.stringify(engine.serialize());
    expect(() => engine.playCard(1, c(Rank.Nine, Suit.Hearts))).toThrow(
      /Illegal move/,
    );
    expect(JSON.stringify(engine.serialize())).toBe(before);
  });

  it("refuses a card outside the playing phase", () => {
    const engine = new EuchreEngine("phases");
    engine.startGame();
    const state = engine.getState();
    expect(state.phase).toBe(GamePhase.Bidding);
    expect(() =>
      engine.playCard(state.currentPlayerSeat, state.players[state.currentPlayerSeat].hand[0]),
    ).toThrow(/Cannot play card during/);
    expect(engine.getLegalMoves(state.currentPlayerSeat)).toEqual([]);
  });

  it("offers legal moves only to the player whose turn it is", () => {
    const engine = table(hands(), Suit.Hearts);
    expect(engine.getLegalMoves(0).length).toBeGreaterThan(0);
    for (const seat of [1, 2, 3]) expect(engine.getLegalMoves(seat)).toEqual([]);
  });
});

describe("who wins a trick", () => {
  function winner(played: Array<[number, Card]>, trump: Suit) {
    const hands: Card[][] = [[], [], [], []];
    for (const [seat, card] of played) hands[seat] = [card];
    const engine = table(hands, trump, played[0][0]);
    for (const [seat, card] of played) engine.playCard(seat, card);
    const completed = engine
      .getEvents()
      .filter((e) => e.type === GameEventType.TrickCompleted)
      .at(-1)!;
    return completed.seatIndex;
  }

  it("ranks the right bower above the left, and both above the ace of trump", () => {
    expect(
      winner(
        [
          [0, c(Rank.Ace, Suit.Hearts)],
          [1, c(Rank.Jack, Suit.Diamonds)],
          [2, c(Rank.Jack, Suit.Hearts)],
          [3, c(Rank.King, Suit.Hearts)],
        ],
        Suit.Hearts,
      ),
    ).toBe(2);
    expect(
      winner(
        [
          [0, c(Rank.Ace, Suit.Hearts)],
          [1, c(Rank.Jack, Suit.Diamonds)],
          [2, c(Rank.King, Suit.Hearts)],
          [3, c(Rank.Queen, Suit.Hearts)],
        ],
        Suit.Hearts,
      ),
    ).toBe(1);
  });

  it("gives any trump the trick over the highest card of the lead suit", () => {
    expect(
      winner(
        [
          [0, c(Rank.Ace, Suit.Clubs)],
          [1, c(Rank.Nine, Suit.Hearts)],
          [2, c(Rank.King, Suit.Clubs)],
          [3, c(Rank.Queen, Suit.Clubs)],
        ],
        Suit.Hearts,
      ),
    ).toBe(1);
  });

  it("gives it to the highest lead-suit card when nobody trumps, and an off-suit discard never wins", () => {
    expect(
      winner(
        [
          [0, c(Rank.Ten, Suit.Clubs)],
          [1, c(Rank.Ace, Suit.Diamonds)],
          [2, c(Rank.Ace, Suit.Clubs)],
          [3, c(Rank.King, Suit.Spades)],
        ],
        Suit.Hearts,
      ),
    ).toBe(2);
  });

  it("ranks the jack normally in a plain suit", () => {
    // Trump is spades, so the jack of hearts is an ordinary heart below the ace.
    expect(
      winner(
        [
          [0, c(Rank.Jack, Suit.Hearts)],
          [1, c(Rank.Ace, Suit.Hearts)],
          [2, c(Rank.Nine, Suit.Hearts)],
          [3, c(Rank.Ten, Suit.Hearts)],
        ],
        Suit.Spades,
      ),
    ).toBe(1);
  });
});

describe("calling trump", () => {
  it("offers the turned-up suit in the first round and the other three in the second", () => {
    const engine = new EuchreEngine("calls");
    engine.startGame();
    const first = engine.getVisibleState(engine.getState().currentPlayerSeat);
    const turned = first.turnedUpCard!;
    expect(first.legalTrumpCalls).toEqual([turned.suit, "pass"]);

    for (let i = 0; i < 4; i++)
      engine.callTrump(engine.getState().currentPlayerSeat, "pass");
    const second = engine.getVisibleState(engine.getState().currentPlayerSeat);
    expect(second.trumpCallRound).toBe(2);
    expect(second.legalTrumpCalls).not.toContain(turned.suit);
    expect(second.legalTrumpCalls).toHaveLength(4); // three suits plus pass
  });

  it("forces the dealer to name a suit rather than pass the hand out", () => {
    const engine = new EuchreEngine("stick");
    engine.startGame();
    const dealer = (engine.getState().roundNumber + 0) % 4;
    for (let i = 0; i < 4; i++)
      engine.callTrump(engine.getState().currentPlayerSeat, "pass");
    // Second round: everyone but the dealer passes.
    for (let i = 0; i < 3; i++)
      engine.callTrump(engine.getState().currentPlayerSeat, "pass");
    const stuck = engine.getState().currentPlayerSeat;
    expect(stuck).toBe(dealer);
    expect(engine.getVisibleState(stuck).legalTrumpCalls).not.toContain("pass");
    expect(() => engine.callTrump(stuck, "pass")).toThrow();
  });

  it("refuses a suit that is not on offer and a call out of turn", () => {
    const engine = new EuchreEngine("bad-calls");
    engine.startGame();
    const seat = engine.getState().currentPlayerSeat;
    const turned = engine.getVisibleState(seat).turnedUpCard!;
    const wrong = [Suit.Hearts, Suit.Diamonds, Suit.Clubs, Suit.Spades].find(
      (suit) => suit !== turned.suit,
    )!;
    const before = JSON.stringify(engine.serialize());
    expect(() => engine.callTrump(seat, wrong)).toThrow();
    expect(() => engine.callTrump((seat + 1) % 4, turned.suit)).toThrow();
    expect(JSON.stringify(engine.serialize())).toBe(before);
  });
});

describe("going alone", () => {
  it("is the maker's to declare, before the first card, and skips their partner", () => {
    const engine = table(
      [
        [c(Rank.Jack, Suit.Hearts), c(Rank.Ace, Suit.Hearts)],
        [c(Rank.Nine, Suit.Clubs), c(Rank.Ten, Suit.Clubs)],
        [c(Rank.Queen, Suit.Clubs), c(Rank.King, Suit.Clubs)],
        [c(Rank.Nine, Suit.Spades), c(Rank.Ten, Suit.Spades)],
      ],
      Suit.Hearts,
    );
    expect(() => engine.goAlone(1)).toThrow(/Only the maker/);
    engine.goAlone(0);
    engine.playCard(0, c(Rank.Jack, Suit.Hearts));
    engine.playCard(1, c(Rank.Nine, Suit.Clubs));
    // Seat 2 is the maker's partner and sits the hand out.
    expect(engine.getState().currentPlayerSeat).toBe(3);
    engine.playCard(3, c(Rank.Nine, Suit.Spades));
    expect(engine.getState().players[0].tricksWon).toBe(1);
    expect(() => engine.goAlone(0)).toThrow(/before the first card/);
  });
});

describe("Euchre scoring", () => {
  function score(makerTricks: number, alone = false) {
    const engine = new EuchreEngine("score");
    for (let i = 0; i < 4; i++) engine.setPlayer(i, `u${i}`, `P${i}`, false);
    engine.startGame();
    const state = engine.getState();
    engine.callTrump(
      state.currentPlayerSeat,
      engine.getVisibleState(0).turnedUpCard!.suit,
    );
    state.trumpSuit = Suit.Hearts;
    (engine as unknown as { maker: number }).maker = 0;
    (engine as unknown as { goingAlone: boolean }).goingAlone = alone;
    (engine as unknown as { alonePlayer: number }).alonePlayer = alone ? 0 : -1;
    state.players[0].tricksWon = makerTricks;
    state.players[2].tricksWon = 0;
    state.players[1].tricksWon = 5 - makerTricks;
    state.players[3].tricksWon = 0;
    return engine.calculateRoundScores();
  }

  it("pays one point for three or four tricks and two for all five", () => {
    expect(score(3)).toEqual([1, 0, 1, 0]);
    expect(score(4)).toEqual([1, 0, 1, 0]);
    expect(score(5)).toEqual([2, 0, 2, 0]);
  });

  it("pays four for a march alone and two to the defenders for a euchre", () => {
    expect(score(5, true)).toEqual([4, 0, 4, 0]);
    expect(score(2)).toEqual([0, 2, 0, 2]);
    expect(score(0)).toEqual([0, 2, 0, 2]);
    // Being euchred while alone still pays the defenders two, not more.
    expect(score(2, true)).toEqual([0, 2, 0, 2]);
  });

  it("ends at ten points and names the winning team's seat", () => {
    const engine = new EuchreEngine("target");
    expect(engine.getState().config.targetScore).toBe(10);
    const state = engine.getState();
    state.scores = [9, 4, 9, 4];
    expect(engine.isGameOver()).toBe(false);
    state.scores = [10, 4, 10, 4];
    expect(engine.isGameOver()).toBe(true);
    expect(engine.getWinnerSeat()).toBe(0);
    state.scores = [4, 11, 4, 11];
    expect(engine.getWinnerSeat()).toBe(1);
  });
});
