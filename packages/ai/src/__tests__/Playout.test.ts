import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AIDifficulty,
  GamePhase,
  Rank,
  Suit,
  type Card,
  type VisibleGameState,
} from "@card-game/shared-types";
import { FortyFivesEngine, SevenSixEngine } from "@card-game/game-engine";
import { determinize, unseenCards } from "../playout/determinize.js";
import { chooseFortyFivesBid, chooseFortyFivesCard, imagine, margin, playOut } from "../playout/fortyFives.js";
import { fortyFivesPlayCard } from "../games/FortyFivesAI.js";
import { chooseSevenSixBid, chooseSevenSixCard } from "../playout/sevenSix.js";
import { createAIPlayer } from "../strategies/StrategyFactory.js";

function rng(seed: number) {
  return () => {
    seed = (Math.imul(1664525, seed) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}
const card = (rank: Rank, suit: Suit): Card => ({ rank, suit });
const key = (c: Card) => `${c.suit}${c.rank}`;

/** A 45s table dealt and bid by the Medium bot, stopped at seat 0's first play. */
function fortyFivesAtPlay(seed = 7) {
  vi.spyOn(Math, "random").mockImplementation(rng(seed));
  const engine = new FortyFivesEngine("p", { maxPlayers: 4, targetScore: 45 });
  const medium = createAIPlayer(AIDifficulty.Intermediate);
  engine.startGame();
  while (engine.getState().phase === GamePhase.Bidding) {
    const seat = engine.getState().currentPlayerSeat;
    const view = engine.getVisibleState(seat);
    if (engine.getLegalTrumpCalls(seat).length) engine.callTrump(seat, medium.chooseTrump(view));
    else {
      const bid = medium.chooseBid(view);
      engine.placeBid(seat, bid === "pass" ? -1 : bid);
    }
  }
  return engine;
}

afterEach(() => vi.restoreAllMocks());

describe("imagining the cards this seat cannot see", () => {
  it("deals every other seat the number of cards it holds, from cards not seen", () => {
    const engine = fortyFivesAtPlay();
    const seat = engine.getState().currentPlayerSeat;
    const view = engine.getVisibleState(seat);
    const hands = determinize(view);
    expect(hands[seat]).toEqual(view.myHand);
    const all = hands.flat();
    expect(new Set(all.map(key)).size).toBe(all.length);
    for (const player of view.players)
      expect(hands[player.seatIndex]).toHaveLength(player.cardCount);
    const seen = new Set([...view.myHand, ...view.currentTrick.map((p) => p.card)].map(key));
    for (const player of view.players)
      if (player.seatIndex !== seat)
        for (const c of hands[player.seatIndex]) expect(seen.has(key(c))).toBe(false);
  });

  it("rules out cards already played this hand", () => {
    const engine = fortyFivesAtPlay();
    // Play one full trick with the simple line, then look again.
    const medium = createAIPlayer(AIDifficulty.Intermediate);
    for (let i = 0; i < 4; i++) {
      const seat = engine.getState().currentPlayerSeat;
      engine.playCard(seat, medium.chooseCard(engine.getVisibleState(seat)));
    }
    const seat = engine.getState().currentPlayerSeat;
    const view = engine.getVisibleState(seat);
    expect(view.playedCards).toHaveLength(4);
    const gone = new Set(view.playedCards!.map((p) => key(p.card)));
    for (const c of unseenCards(view)) expect(gone.has(key(c))).toBe(false);
    for (const c of determinize(view).flat()) expect(gone.has(key(c))).toBe(false);
  });

  it("redraws a world the auction has ruled out, and gives up gracefully", () => {
    const engine = fortyFivesAtPlay();
    const seat = engine.getState().currentPlayerSeat;
    const view = engine.getVisibleState(seat);
    let calls = 0;
    const hands = determinize(view, [], () => ++calls > 3, 8);
    expect(calls).toBe(4);
    expect(hands.flat()).toHaveLength(20);
    // Never plausible: still a complete, legal deal after the last try.
    const stubborn = determinize(view, [], () => false, 5);
    expect(stubborn.flat()).toHaveLength(20);
  });
});

describe("the 45s playout", () => {
  it("chooses at least as well as the simple line, without wasting the five", () => {
    const engine = fortyFivesAtPlay(3);
    const seat = engine.getState().currentPlayerSeat;
    const trump = engine.getState().trumpSuit!;
    // Re-deal by hand: this seat gets the five of trump, the one card nothing
    // beats, plus junk; everyone else gets five cards from what is left, so
    // the hands stay equal and the hand plays out to the end.
    const state = engine.getState();
    const five = card(Rank.Five, trump);
    const mine = [five, card(Rank.Two, Suit.Hearts), card(Rank.Three, Suit.Diamonds), card(Rank.Four, Suit.Clubs), card(Rank.Six, Suit.Spades)]
      .filter((c, i, arr) => arr.findIndex((o) => key(o) === key(c)) === i)
      .slice(0, 5);
    const taken = new Set(mine.map(key));
    const rest: Card[] = [];
    for (const suit of [Suit.Clubs, Suit.Diamonds, Suit.Hearts, Suit.Spades])
      for (let rank = Rank.Two; rank <= Rank.Ace; rank++)
        if (!taken.has(`${suit}${rank}`)) rest.push(card(rank, suit));
    let next = 0;
    for (const p of state.players)
      p.hand = p.seatIndex === seat ? mine : rest.slice(next, (next += 5));
    const view = engine.getVisibleState(seat);
    vi.spyOn(Math, "random").mockImplementation(rng(21));
    const chosen = chooseFortyFivesCard(view, 30);
    expect(view.legalMoves).toContainEqual(chosen);
    // The five wins whenever it is played, so leading it is not forced: the
    // bot may keep it. What must hold is that its choice scores at least as
    // well as the simple line's, over the same imagined deals.
    const simple = fortyFivesPlayCard(view);
    const score = (move: Card, seed: number) => {
      vi.spyOn(Math, "random").mockImplementation(rng(seed));
      let total = 0;
      for (let i = 0; i < 30; i++) {
        const hands = determinize(view);
        const world = imagine(view, hands);
        world.playCard(seat, move);
        total += margin(playOut(world), seat);
      }
      return total;
    };
    expect(score(chosen, 21)).toBeGreaterThanOrEqual(score(simple, 21));
    // And it never throws the five away under a card that beats nothing.
    expect(chosen).not.toEqual(card(Rank.Two, Suit.Hearts));
  });

  it("bids only among the legal bids, and passes when nothing is safe", () => {
    vi.spyOn(Math, "random").mockImplementation(rng(11));
    const engine = new FortyFivesEngine("b", { maxPlayers: 4, targetScore: 45 });
    engine.startGame();
    const seat = engine.getState().currentPlayerSeat;
    const view = engine.getVisibleState(seat);
    const bid = chooseFortyFivesBid(view, 20);
    expect(bid === "pass" || view.legalBids!.includes(bid)).toBe(true);
    // A hand of nothing passes when it may.
    const weak: VisibleGameState = {
      ...view,
      myHand: [card(Rank.Two, Suit.Hearts), card(Rank.Three, Suit.Diamonds), card(Rank.Four, Suit.Clubs), card(Rank.Six, Suit.Spades), card(Rank.Seven, Suit.Hearts)],
    };
    expect(chooseFortyFivesBid(weak, 20)).toBe("pass");
    // A dealer who may not pass bids the least.
    const stuck: VisibleGameState = { ...weak, legalBids: [15, 20, 25, 30] };
    expect(chooseFortyFivesBid(stuck, 20)).toBe(15);
  });
});

describe("the Seven-Six playout", () => {
  function atBidding(seed = 5) {
    vi.spyOn(Math, "random").mockImplementation(rng(seed));
    const engine = new SevenSixEngine("s", { maxPlayers: 4 });
    engine.startGame();
    return engine;
  }

  it("bids a number the table allows, within the hand", () => {
    const engine = atBidding();
    const seat = engine.getState().currentPlayerSeat;
    const view = engine.getVisibleState(seat);
    expect(view.legalBids!.length).toBeGreaterThan(0);
    const bid = chooseSevenSixBid(view, 20);
    expect(view.legalBids).toContain(bid);
    expect(bid).toBeLessThanOrEqual(view.myHand.length);
  });

  it("respects the dealer's restriction when it is the last to bid", () => {
    const engine = atBidding(9);
    const medium = createAIPlayer(AIDifficulty.Intermediate);
    // Everyone but the dealer bids first.
    while (engine.getState().currentPlayerSeat !== engine.getVisibleState(0).dealerSeat) {
      const seat = engine.getState().currentPlayerSeat;
      const bid = medium.chooseBid(engine.getVisibleState(seat));
      engine.placeBid(seat, bid === "pass" ? 0 : bid);
    }
    const dealer = engine.getState().currentPlayerSeat;
    const view = engine.getVisibleState(dealer);
    const forbidden = view.handSize! - view.bids!.filter((b): b is number => b !== null).reduce((s, b) => s + b, 0);
    expect(view.legalBids).not.toContain(forbidden);
    const bid = chooseSevenSixBid(view, 20);
    expect(bid).not.toBe(forbidden);
    expect(view.legalBids).toContain(bid);
  });

  it("plays a legal card when every seat has bid", () => {
    const engine = atBidding(13);
    const medium = createAIPlayer(AIDifficulty.Intermediate);
    while (engine.getState().phase === GamePhase.Bidding) {
      const seat = engine.getState().currentPlayerSeat;
      const bid = medium.chooseBid(engine.getVisibleState(seat));
      engine.placeBid(seat, bid === "pass" ? 0 : bid);
    }
    const seat = engine.getState().currentPlayerSeat;
    const view = engine.getVisibleState(seat);
    expect(view.legalMoves).toContainEqual(chooseSevenSixCard(view, 20));
  });
});
