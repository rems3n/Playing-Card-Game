import { describe, it, expect } from 'vitest';
import { Suit, Rank, GameType } from '@card-game/shared-types';
import { RandomStrategy } from '../strategies/RandomStrategy.js';
import { card, makeState } from './helpers.js';

describe('RandomStrategy', () => {
  const ai = new RandomStrategy('TestBot');

  it('has Beginner difficulty', () => {
    expect(ai.difficulty).toBe('beginner');
  });

  describe('chooseCard', () => {
    it('returns one of the legal moves', () => {
      const moves = [card(Suit.Hearts, Rank.Two), card(Suit.Clubs, Rank.Ace)];
      const state = makeState({ gameType: GameType.Hearts, myHand: moves, legalMoves: moves });

      for (let i = 0; i < 20; i++) {
        const chosen = ai.chooseCard(state);
        expect(moves).toContainEqual(chosen);
      }
    });

    it('returns the only card when one legal move', () => {
      const moves = [card(Suit.Spades, Rank.King)];
      const state = makeState({ gameType: GameType.Hearts, myHand: moves, legalMoves: moves });
      expect(ai.chooseCard(state)).toEqual(moves[0]);
    });

    it('throws when no legal moves', () => {
      const state = makeState({ gameType: GameType.Hearts, myHand: [], legalMoves: [] });
      expect(() => ai.chooseCard(state)).toThrow();
    });
  });

  describe('choosePassCards', () => {
    it('returns exactly the requested number of cards', () => {
      const hand = [
        card(Suit.Hearts, Rank.Two),
        card(Suit.Hearts, Rank.Three),
        card(Suit.Clubs, Rank.Ace),
        card(Suit.Diamonds, Rank.King),
        card(Suit.Spades, Rank.Ten),
      ];
      const state = makeState({ gameType: GameType.Hearts, myHand: hand, legalMoves: [] });

      const passed = ai.choosePassCards(state, 3);
      expect(passed).toHaveLength(3);
    });

    it('returns cards from the hand', () => {
      const hand = [
        card(Suit.Hearts, Rank.Ace),
        card(Suit.Clubs, Rank.King),
        card(Suit.Diamonds, Rank.Queen),
        card(Suit.Spades, Rank.Jack),
      ];
      const state = makeState({ gameType: GameType.Hearts, myHand: hand, legalMoves: [] });

      const passed = ai.choosePassCards(state, 3);
      for (const c of passed) {
        expect(hand).toContainEqual(c);
      }
    });

    it('does not return duplicate cards', () => {
      const hand = [
        card(Suit.Hearts, Rank.Two),
        card(Suit.Hearts, Rank.Three),
        card(Suit.Hearts, Rank.Four),
        card(Suit.Hearts, Rank.Five),
        card(Suit.Hearts, Rank.Six),
      ];
      const state = makeState({ gameType: GameType.Hearts, myHand: hand, legalMoves: [] });

      const passed = ai.choosePassCards(state, 3);
      const unique = new Set(passed.map((c) => `${c.suit}${c.rank}`));
      expect(unique.size).toBe(3);
    });
  });

  describe('chooseBid', () => {
    it('returns a number >= 1', () => {
      const hand = [card(Suit.Spades, Rank.Ace), card(Suit.Hearts, Rank.King)];
      const state = makeState({ gameType: GameType.Spades, myHand: hand, legalMoves: [] });

      for (let i = 0; i < 20; i++) {
        expect(ai.chooseBid(state)).toBeGreaterThanOrEqual(1);
      }
    });
  });
});
