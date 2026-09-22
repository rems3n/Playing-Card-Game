import { afterEach, describe, expect, it, vi } from "vitest";
import {
  GameEventType,
  GamePhase,
  Suit,
  type PlayedCard,
} from "@card-game/shared-types";
import {
  FortyFivesEngine,
  HIGH_TRUMP_BONUS,
  PASS,
  TRICK_POINTS,
} from "../games/forty-fives/FortyFivesEngine.js";

function rng(seed: number) {
  return () => {
    seed = (Math.imul(1664525, seed) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}
afterEach(() => vi.restoreAllMocks());

/**
 * The ranking, transcribed from the rules rather than derived, so that this is
 * a check on the engine and not a copy of it. Strongest first.
 * A card is written rank-then-suit, with 11=J, 12=Q, 13=K, 14=A.
 */
const TRUMP_ORDER: Record<Suit, string[]> = {
  [Suit.Hearts]: "5H 11H 14H 13H 12H 10H 9H 8H 7H 6H 4H 3H 2H".split(" "),
  [Suit.Diamonds]:
    "5D 11D 14H 14D 13D 12D 10D 9D 8D 7D 6D 4D 3D 2D".split(" "),
  [Suit.Clubs]: "5C 11C 14H 14C 13C 12C 2C 3C 4C 6C 7C 8C 9C 10C".split(" "),
  [Suit.Spades]: "5S 11S 14H 14S 13S 12S 2S 3S 4S 6S 7S 8S 9S 10S".split(" "),
};
const PLAIN_ORDER: Record<Suit, string[]> = {
  // Hearts has no ace as a plain suit: the ace of hearts is always trump.
  [Suit.Hearts]: "13H 12H 11H 10H 9H 8H 7H 6H 5H 4H 3H 2H".split(" "),
  [Suit.Diamonds]: "14D 13D 12D 11D 10D 9D 8D 7D 6D 5D 4D 3D 2D".split(" "),
  [Suit.Clubs]: "13C 12C 11C 14C 2C 3C 4C 5C 6C 7C 8C 9C 10C".split(" "),
  [Suit.Spades]: "13S 12S 11S 14S 2S 3S 4S 5S 6S 7S 8S 9S 10S".split(" "),
};
const name = (play: PlayedCard) => `${play.card.rank}${play.card.suit}`;
function power(play: PlayedCard, trump: Suit) {
  const inTrump = TRUMP_ORDER[trump].indexOf(name(play));
  if (inTrump >= 0) return 1000 - inTrump;
  const plain = PLAIN_ORDER[play.card.suit];
  const index = plain.indexOf(name(play));
  return 100 - (index < 0 ? plain.length : index);
}
const isTrumpCard = (play: PlayedCard, trump: Suit) =>
  TRUMP_ORDER[trump].includes(name(play));

function expectedWinner(cards: PlayedCard[], trump: Suit) {
  const ledSuit = isTrumpCard(cards[0], trump) ? trump : cards[0].card.suit;
  const contenders = cards.filter(
    (play) => isTrumpCard(play, trump) || play.card.suit === ledSuit,
  );
  const anyTrump = contenders.some((play) => isTrumpCard(play, trump));
  const eligible = anyTrump
    ? contenders.filter((play) => isTrumpCard(play, trump))
    : contenders;
  return eligible.reduce((best, play) =>
    power(play, trump) > power(best, trump) ? play : best,
  ).seatIndex;
}

/** The suit this hand holds most of: enough sense to make a bid winnable. */
function pickTrump(hand: { rank: number; suit: Suit }[]): Suit {
  const suits = [Suit.Hearts, Suit.Diamonds, Suit.Clubs, Suit.Spades];
  return suits.reduce((best, suit) =>
    hand.filter((c) => c.suit === suit).length >
    hand.filter((c) => c.suit === best).length
      ? suit
      : best,
  );
}

const cases = Array.from({ length: 60 }, (_, index) => ({
  seats: [2, 4, 6][index % 3],
  seed: index + 1,
}));

describe("seeded complete Forty-Fives games", () => {
  it.each(cases)("$seats players, seed $seed", ({ seats, seed }) => {
    const random = rng(seed);
    vi.spyOn(Math, "random").mockImplementation(random);
    const make = () => new FortyFivesEngine("simulation", { maxPlayers: seats });
    let engine = make();
    engine.startGame();

    let steps = 0;
    let roundTricks = new Array(seats).fill(0);
    let highTrumpSeat = -1;
    let highTrumpPower = -1;
    let hands = 0;

    while (engine.getState().phase !== GamePhase.GameOver && steps++ < 20000) {
      const state = engine.getState();
      const seat = state.currentPlayerSeat;
      const before = structuredClone(state);
      // The engine deals the next hand as soon as one is scored, so the
      // contract has to be read before the step, not after the event.
      const declarerBefore = engine.getDeclarerSeat();
      const contractBefore = engine.getContract();
      const eventCount = engine.getEvents().length;

      for (let viewer = 0; viewer < seats; viewer++) {
        const visible = engine.getVisibleState(viewer);
        expect(visible.players.some((p) => "hand" in p)).toBe(false);
        expect(visible.myHand).toEqual(state.players[viewer].hand);
        expect(visible.myHand.length).toBeLessThanOrEqual(5);
        if (viewer !== seat) expect(visible.legalMoves).toHaveLength(0);
      }

      if (state.phase === GamePhase.Bidding) {
        const calls = engine.getLegalTrumpCalls(seat);
        if (calls.length) {
          // The auction is over and the winner names trump.
          expect(seat).toBe(engine.getDeclarerSeat());
          expect(calls).toHaveLength(4);
          engine.callTrump(seat, pickTrump(state.players[seat].hand));
        } else {
          const bids = engine.getLegalBids(seat);
          expect(bids.length).toBeGreaterThan(0);
          const standing = (state.bids ?? []).reduce<number>(
            (best, bid) => (typeof bid === "number" && bid > best ? bid : best),
            0,
          );
          // Only the dealer may hold a bid at its standing level.
          for (const bid of bids)
            if (bid !== PASS && seat !== engine.getDealerSeat())
              expect(bid).toBeGreaterThan(standing);
          // Bid the minimum: a table that always shoots for 30 never finishes.
          // With 30 standing there is nothing left to say but pass.
          const numeric = bids.filter((bid) => bid !== PASS);
          const canPass = bids.includes(PASS);
          expect(numeric.length || canPass).toBeTruthy();
          const pass = canPass && (!numeric.length || random() < 0.5);
          engine.placeBid(seat, pass ? PASS : numeric[0]);
        }
      } else {
        expect(state.phase).toBe(GamePhase.Playing);
        const legal = engine.getLegalMoves(seat);
        expect(legal.length).toBeGreaterThan(0);
        const card = legal[Math.floor(random() * legal.length)];
        if (steps % 19 === 0) {
          const saved = JSON.stringify(engine.serialize());
          expect(() => engine.playCard((seat + 1) % seats, card)).toThrow();
          expect(JSON.stringify(engine.serialize())).toBe(saved);
          const illegal = before.players[seat].hand.find(
            (c) => !legal.some((l) => l.rank === c.rank && l.suit === c.suit),
          );
          if (illegal) {
            expect(() => engine.playCard(seat, illegal)).toThrow();
            expect(JSON.stringify(engine.serialize())).toBe(saved);
          }
        }
        engine.playCard(seat, card);
      }

      for (const event of engine.getEvents().slice(eventCount)) {
        if (event.type === GameEventType.TrickCompleted) {
          const cards = event.payload.cards as PlayedCard[];
          const trump = before.trumpSuit!;
          expect(cards).toHaveLength(seats);
          expect(new Set(cards.map((p) => p.seatIndex)).size).toBe(seats);
          expect(new Set(cards.map(name)).size).toBe(seats);
          expect(event.seatIndex).toBe(expectedWinner(cards, trump));
          roundTricks[event.seatIndex!]++;
          for (const play of cards) {
            if (!isTrumpCard(play, trump)) continue;
            if (power(play, trump) > highTrumpPower) {
              highTrumpPower = power(play, trump);
              highTrumpSeat = play.seatIndex;
            }
          }
        }
        if (event.type === GameEventType.RoundEnded) {
          hands++;
          expect(roundTricks.reduce((a, b) => a + b, 0)).toBe(5);
          const team = (s: number) => (seats === 2 ? s : s % 2);
          const taken = [0, 0];
          for (let s = 0; s < seats; s++)
            taken[team(s)] += roundTricks[s] * TRICK_POINTS;
          // Nobody holding trump is possible, and then the bonus is not won.
          if (highTrumpSeat >= 0) taken[team(highTrumpSeat)] += HIGH_TRUMP_BONUS;
          expect(taken[0] + taken[1]).toBe(
            5 * TRICK_POINTS + (highTrumpSeat >= 0 ? HIGH_TRUMP_BONUS : 0),
          );

          const declaring = team(declarerBefore);
          const contract = contractBefore;
          const expected = Array.from({ length: seats }, (_, s) => {
            const t = team(s);
            return t === declaring && taken[t] < contract ? -contract : taken[t];
          });
          expect(event.payload.roundScores).toEqual(expected);
          expect(event.payload.totalScores).toEqual(
            before.scores.map((score, i) => score + expected[i]),
          );
          roundTricks = new Array(seats).fill(0);
          highTrumpSeat = -1;
          highTrumpPower = -1;
        }
      }

      if (steps % 29 === 0) {
        const restored = make();
        restored.restore(JSON.parse(JSON.stringify(engine.serialize())));
        for (let viewer = 0; viewer < seats; viewer++)
          expect(restored.getVisibleState(viewer)).toEqual(
            engine.getVisibleState(viewer),
          );
        engine = restored;
      }
    }

    expect(engine.getState().phase).toBe(GamePhase.GameOver);
    expect(hands).toBeGreaterThan(0);
    expect(
      engine.getEvents().filter((e) => e.type === GameEventType.GameEnded),
    ).toHaveLength(1);
    expect(new Set(engine.getEvents().map((e) => e.sequenceNum)).size).toBe(
      engine.getEvents().length,
    );
    // Somebody reached the target, and the winner is on the leading side.
    const scores = engine.getState().scores;
    expect(Math.max(...scores)).toBeGreaterThanOrEqual(
      engine.getState().config.targetScore,
    );
    expect(scores[engine.getWinnerSeat()]).toBe(Math.max(...scores));
  });
});
