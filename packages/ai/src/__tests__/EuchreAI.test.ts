import { describe, it, expect } from 'vitest';
import { Suit, Rank } from '@card-game/shared-types';
import { shouldCallTrump, chooseTrumpSuit } from '../games/EuchreAI.js';
import { card } from './helpers.js';

describe('EuchreAI', () => {
  describe('shouldCallTrump', () => {
    it('calls with 3+ trump cards', () => {
      const hand = [
        card(Suit.Hearts, Rank.Nine),
        card(Suit.Hearts, Rank.Ten),
        card(Suit.Hearts, Rank.Queen),
        card(Suit.Clubs, Rank.Ace),
        card(Suit.Diamonds, Rank.King),
      ];
      expect(shouldCallTrump(hand, Suit.Hearts)).toBe(true);
    });

    it('calls with 2 trump including right bower', () => {
      const hand = [
        card(Suit.Hearts, Rank.Jack), // right bower
        card(Suit.Hearts, Rank.Nine),
        card(Suit.Clubs, Rank.Ace),
        card(Suit.Diamonds, Rank.King),
        card(Suit.Spades, Rank.Ten),
      ];
      expect(shouldCallTrump(hand, Suit.Hearts)).toBe(true);
    });

    it('calls with 2 trump including left bower', () => {
      const hand = [
        card(Suit.Diamonds, Rank.Jack), // left bower for hearts
        card(Suit.Hearts, Rank.King),
        card(Suit.Clubs, Rank.Ace),
        card(Suit.Spades, Rank.Ten),
        card(Suit.Spades, Rank.Nine),
      ];
      expect(shouldCallTrump(hand, Suit.Hearts)).toBe(true);
    });

    it('does not call with only 1 trump and no bowers', () => {
      const hand = [
        card(Suit.Hearts, Rank.Nine),
        card(Suit.Clubs, Rank.Ace),
        card(Suit.Diamonds, Rank.King),
        card(Suit.Spades, Rank.Ten),
        card(Suit.Spades, Rank.Queen),
      ];
      expect(shouldCallTrump(hand, Suit.Hearts)).toBe(false);
    });

    it('does not call with 0 trump', () => {
      const hand = [
        card(Suit.Clubs, Rank.Ace),
        card(Suit.Clubs, Rank.King),
        card(Suit.Diamonds, Rank.Queen),
        card(Suit.Spades, Rank.Ten),
        card(Suit.Spades, Rank.Nine),
      ];
      expect(shouldCallTrump(hand, Suit.Hearts)).toBe(false);
    });

    it('counts left bower as trump', () => {
      // Jack of diamonds is left bower when hearts is trump
      const hand = [
        card(Suit.Diamonds, Rank.Jack),
        card(Suit.Hearts, Rank.Ace),
        card(Suit.Hearts, Rank.King),
        card(Suit.Clubs, Rank.Nine),
        card(Suit.Spades, Rank.Ten),
      ];
      // 3 trump (Ace, King of hearts + Jack of diamonds as left bower)
      expect(shouldCallTrump(hand, Suit.Hearts)).toBe(true);
    });
  });

  describe('chooseTrumpSuit', () => {
    it('excludes the turned-up suit', () => {
      const hand = [
        card(Suit.Spades, Rank.Jack),
        card(Suit.Spades, Rank.Ace),
        card(Suit.Spades, Rank.King),
        card(Suit.Hearts, Rank.Nine),
        card(Suit.Diamonds, Rank.Ten),
      ];
      // Hearts was turned up, so it's excluded
      const chosen = chooseTrumpSuit(hand, Suit.Hearts);
      if (chosen !== null) {
        expect(chosen).not.toBe(Suit.Hearts);
      }
    });

    it('picks the strongest suit', () => {
      const hand = [
        card(Suit.Spades, Rank.Jack), // right bower for spades
        card(Suit.Spades, Rank.Ace),
        card(Suit.Spades, Rank.King),
        card(Suit.Hearts, Rank.Nine),
        card(Suit.Diamonds, Rank.Ten),
      ];
      // Exclude diamonds (turned up)
      expect(chooseTrumpSuit(hand, Suit.Diamonds)).toBe(Suit.Spades);
    });

    it('returns null when no suit is strong enough', () => {
      // All low cards spread across suits — no suit has enough strength
      const hand = [
        card(Suit.Hearts, Rank.Nine),
        card(Suit.Clubs, Rank.Nine),
        card(Suit.Diamonds, Rank.Nine),
        card(Suit.Spades, Rank.Nine),
        card(Suit.Hearts, Rank.Ten),
      ];
      // Exclude hearts — remaining suits each have only a 9
      expect(chooseTrumpSuit(hand, Suit.Hearts)).toBeNull();
    });
  });
});
