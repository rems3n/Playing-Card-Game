import { afterEach, describe, expect, it, vi } from "vitest";
import {
  GamePhase,
  GameType,
  GameEventType,
  Suit,
  type PlayedCard,
} from "@card-game/shared-types";
import { SevenSixEngine } from "../games/seven-six/SevenSixEngine.js";

function rng(seed: number) {
  return () => {
    seed = (Math.imul(1664525, seed) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}
function expectedWinner(cards: PlayedCard[], trump: Suit) {
  const lead = cards[0].card.suit;
  const power = (p: PlayedCard) =>
    (p.card.suit === trump ? 300 : p.card.suit === lead ? 150 : 0) + p.card.rank;
  return cards.reduce((best, p) => (power(p) > power(best) ? p : best))
    .seatIndex;
}
afterEach(() => vi.restoreAllMocks());
const cases = Array.from({ length: 120 }, (_, i) => ({
  type: GameType.SevenSix,
  seats: 2 + (i % 6),
  seed: i + 1,
}));
describe("seeded complete Seven-Six games", () => {
  it.each(cases)(
    "$type: $seats players, seed $seed",
    ({ type, seats, seed }) => {
      const random = rng(seed);
      vi.spyOn(Math, "random").mockImplementation(random);
      const make = () => new SevenSixEngine("simulation", { maxPlayers: seats });
      let engine = make();
      engine.startGame();
      let steps = 0,
        roundTricks = Array(seats).fill(0),
        rounds = 0;
      while (
        engine.getState().phase !== GamePhase.GameOver &&
        steps++ < 10000
      ) {
        const state = engine.getState();
        const seat = state.currentPlayerSeat;
        const before = structuredClone(state);
        const eventCount = engine.getEvents().length;
        for (let viewer = 0; viewer < seats; viewer++) {
          const visible = engine.getVisibleState(viewer);
          expect(visible.players.some((p) => "hand" in p)).toBe(false);
          expect(visible.myHand).toEqual(state.players[viewer].hand);
          if (viewer !== seat) expect(visible.legalMoves).toHaveLength(0);
        }
        if (state.phase === GamePhase.Bidding) {
          const trump = engine.getTrumpCard()!;
          expect(state.players.flatMap(p => p.hand).some(c => c.suit === trump.suit && c.rank === trump.rank)).toBe(false);
          expect(engine.getVisibleState(seat).trumpCard).toEqual(trump);
          const bids = engine.getLegalBids(seat);
          expect(bids.length).toBeGreaterThan(0);
          engine.placeBid(seat, bids[Math.floor(random() * bids.length)]);
        } else {
          expect(state.phase).toBe(GamePhase.Playing);
          const legal = engine.getLegalMoves(seat);
          expect(legal.length).toBeGreaterThan(0);
          const card = legal[Math.floor(random() * legal.length)];
          expect(before.players[seat].hand).toContainEqual(card);
          if (steps % 23 === 0) {
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
            expect(cards).toHaveLength(seats);
            expect(new Set(cards.map((p) => p.seatIndex)).size).toBe(seats);
            expect(
              new Set(cards.map((p) => `${p.card.rank}${p.card.suit}`)).size,
            ).toBe(seats);
            expect(event.seatIndex).toBe(
              expectedWinner(cards, before.trumpSuit!),
            );
            roundTricks[event.seatIndex!]++;
          }
          if (event.type === GameEventType.RoundEnded) {
            rounds++;
            expect(roundTricks.reduce((a, b) => a + b, 0)).toBe(before.handSize);
            const expected = roundTricks.map((tricks, i) =>
              tricks === before.bids![i] ? 10 + tricks : 0,
            );
            expect(event.payload.roundScores).toEqual(expected);
            expect(event.payload.totalScores).toEqual(
              before.scores.map((score, i) => score + expected[i]),
            );
            roundTricks = Array(seats).fill(0);
          }
        }
        if (
          engine.getState().roundNumber === before.roundNumber &&
          engine.getState().phase === GamePhase.Playing
        )
          expect(engine.getState().players.map((p) => p.tricksWon)).toEqual(
            roundTricks,
          );
        if (steps % 37 === 0) {
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
      expect(rounds).toBe(13);
      expect(
        engine.getEvents().filter((e) => e.type === GameEventType.GameEnded),
      ).toHaveLength(1);
      expect(new Set(engine.getEvents().map((e) => e.sequenceNum)).size).toBe(
        engine.getEvents().length,
      );
    },
  );
});
