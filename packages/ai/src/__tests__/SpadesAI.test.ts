import { describe, it, expect } from 'vitest';
import { Suit, Rank, GameType } from '@card-game/shared-types';
import { spadesBid, spadesPlayCard } from '../games/SpadesAI.js';
import { card, makeState } from './helpers.js';

describe('SpadesAI', () => {
  describe('spadesBid', () => {
    it('returns at least 1', () => {
      const hand = [card(Suit.Clubs, Rank.Two)];
      expect(spadesBid(hand)).toBeGreaterThanOrEqual(1);
    });

    it('counts aces as winners', () => {
      const handWithAces = [
        card(Suit.Hearts, Rank.Ace),
        card(Suit.Diamonds, Rank.Ace),
        card(Suit.Clubs, Rank.Ace),
        card(Suit.Clubs, Rank.Two),
      ];
      const handWithoutAces = [
        card(Suit.Hearts, Rank.Two),
        card(Suit.Diamonds, Rank.Three),
        card(Suit.Clubs, Rank.Four),
        card(Suit.Clubs, Rank.Five),
      ];
      expect(spadesBid(handWithAces)).toBeGreaterThan(spadesBid(handWithoutAces));
    });

    it('counts high spades as winners', () => {
      const hand = [
        card(Suit.Spades, Rank.Ace),
        card(Suit.Spades, Rank.King),
        card(Suit.Spades, Rank.Queen),
        card(Suit.Clubs, Rank.Two),
      ];
      expect(spadesBid(hand)).toBeGreaterThanOrEqual(3);
    });

    it('gives bonus for 4+ spades (length)', () => {
      const longSpades = [
        card(Suit.Spades, Rank.Ace),
        card(Suit.Spades, Rank.King),
        card(Suit.Spades, Rank.Queen),
        card(Suit.Spades, Rank.Jack),
        card(Suit.Clubs, Rank.Two),
      ];
      // 3 high spades + 1 length bonus = 4+
      expect(spadesBid(longSpades)).toBeGreaterThanOrEqual(4);
    });
  });

  describe('spadesPlayCard', () => {
    it('leads with high non-spade', () => {
      const moves = [
        card(Suit.Hearts, Rank.Ace),
        card(Suit.Hearts, Rank.Two),
        card(Suit.Spades, Rank.King),
      ];
      const state = makeState({
        gameType: GameType.Spades,
        myHand: moves,
        legalMoves: moves,
        currentTrick: [],
      });

      expect(spadesPlayCard(state, moves)).toEqual(card(Suit.Hearts, Rank.Ace));
    });

    it('leads lowest spade when all spades', () => {
      const moves = [
        card(Suit.Spades, Rank.Ace),
        card(Suit.Spades, Rank.Three),
        card(Suit.Spades, Rank.King),
      ];
      const state = makeState({
        gameType: GameType.Spades,
        myHand: moves,
        legalMoves: moves,
        currentTrick: [],
      });

      expect(spadesPlayCard(state, moves)).toEqual(card(Suit.Spades, Rank.Three));
    });

    it('wins cheaply when following suit', () => {
      const moves = [
        card(Suit.Hearts, Rank.Ace),
        card(Suit.Hearts, Rank.Queen),
        card(Suit.Hearts, Rank.Three),
      ];
      const state = makeState({
        gameType: GameType.Spades,
        myHand: moves,
        legalMoves: moves,
        currentTrick: [{ seatIndex: 1, card: card(Suit.Hearts, Rank.Jack) }],
      });

      // Should play Queen (cheapest winner above Jack)
      expect(spadesPlayCard(state, moves)).toEqual(card(Suit.Hearts, Rank.Queen));
    });

    it('dumps lowest when cannot win following suit', () => {
      const moves = [
        card(Suit.Hearts, Rank.Three),
        card(Suit.Hearts, Rank.Five),
      ];
      const state = makeState({
        gameType: GameType.Spades,
        myHand: moves,
        legalMoves: moves,
        currentTrick: [{ seatIndex: 1, card: card(Suit.Hearts, Rank.Ace) }],
      });

      expect(spadesPlayCard(state, moves)).toEqual(card(Suit.Hearts, Rank.Three));
    });

    it('trumps with lowest spade when void in lead suit', () => {
      const moves = [
        card(Suit.Spades, Rank.King),
        card(Suit.Spades, Rank.Three),
        card(Suit.Diamonds, Rank.Two),
      ];
      const state = makeState({
        gameType: GameType.Spades,
        myHand: moves,
        legalMoves: moves,
        currentTrick: [{ seatIndex: 1, card: card(Suit.Hearts, Rank.Ace) }],
      });

      expect(spadesPlayCard(state, moves)).toEqual(card(Suit.Spades, Rank.Three));
    });

    it('returns only card when one legal move', () => {
      const moves = [card(Suit.Clubs, Rank.Two)];
      const state = makeState({
        gameType: GameType.Spades,
        myHand: moves,
        legalMoves: moves,
      });

      expect(spadesPlayCard(state, moves)).toEqual(moves[0]);
    });
  });
});
