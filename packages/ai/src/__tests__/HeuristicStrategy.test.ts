import { describe, it, expect } from 'vitest';
import { Suit, Rank, GameType } from '@card-game/shared-types';
import { HeuristicStrategy } from '../strategies/HeuristicStrategy.js';
import { card, makeState } from './helpers.js';

describe('HeuristicStrategy', () => {
  const ai = new HeuristicStrategy('TestBot');

  describe('Hearts — chooseCard', () => {
    it('leads with lowest non-heart when leading', () => {
      const hand = [
        card(Suit.Clubs, Rank.King),
        card(Suit.Diamonds, Rank.Three),
        card(Suit.Hearts, Rank.Two),
      ];
      const state = makeState({
        gameType: GameType.Hearts,
        myHand: hand,
        legalMoves: hand,
        currentTrick: [],
      });

      const chosen = ai.chooseCard(state);
      // Should pick Diamonds 3 (lowest non-heart)
      expect(chosen).toEqual(card(Suit.Diamonds, Rank.Three));
    });

    it('follows suit with lowest card', () => {
      const hand = [
        card(Suit.Clubs, Rank.King),
        card(Suit.Clubs, Rank.Three),
        card(Suit.Hearts, Rank.Ace),
      ];
      const state = makeState({
        gameType: GameType.Hearts,
        myHand: hand,
        legalMoves: [card(Suit.Clubs, Rank.King), card(Suit.Clubs, Rank.Three)],
        currentTrick: [{ seatIndex: 1, card: card(Suit.Clubs, Rank.Ten) }],
      });

      const chosen = ai.chooseCard(state);
      expect(chosen).toEqual(card(Suit.Clubs, Rank.Three));
    });

    it('dumps Queen of Spades when void in lead suit', () => {
      const hand = [
        card(Suit.Spades, Rank.Queen),
        card(Suit.Hearts, Rank.Two),
        card(Suit.Diamonds, Rank.Five),
      ];
      // Void in clubs, holding QoS
      const state = makeState({
        gameType: GameType.Hearts,
        myHand: hand,
        legalMoves: hand,
        currentTrick: [{ seatIndex: 1, card: card(Suit.Clubs, Rank.Ten) }],
      });

      const chosen = ai.chooseCard(state);
      expect(chosen).toEqual(card(Suit.Spades, Rank.Queen));
    });

    it('dumps highest heart when void and no QoS', () => {
      const hand = [
        card(Suit.Hearts, Rank.King),
        card(Suit.Hearts, Rank.Two),
        card(Suit.Diamonds, Rank.Five),
      ];
      const state = makeState({
        gameType: GameType.Hearts,
        myHand: hand,
        legalMoves: hand,
        currentTrick: [{ seatIndex: 1, card: card(Suit.Clubs, Rank.Ten) }],
      });

      const chosen = ai.chooseCard(state);
      expect(chosen).toEqual(card(Suit.Hearts, Rank.King));
    });

    it('returns only legal move when one option', () => {
      const hand = [card(Suit.Clubs, Rank.Two)];
      const state = makeState({
        gameType: GameType.Hearts,
        myHand: hand,
        legalMoves: hand,
      });
      expect(ai.chooseCard(state)).toEqual(hand[0]);
    });
  });

  describe('Hearts — choosePassCards', () => {
    it('prioritizes hearts and high spades', () => {
      const hand = [
        card(Suit.Spades, Rank.Ace),
        card(Suit.Spades, Rank.Queen),
        card(Suit.Hearts, Rank.King),
        card(Suit.Clubs, Rank.Two),
        card(Suit.Diamonds, Rank.Three),
      ];
      const state = makeState({
        gameType: GameType.Hearts,
        myHand: hand,
        legalMoves: [],
      });

      const passed = ai.choosePassCards(state, 3);
      expect(passed).toHaveLength(3);
      // Should include QoS and Hearts King (dangerous cards)
      expect(passed).toContainEqual(card(Suit.Spades, Rank.Queen));
      expect(passed).toContainEqual(card(Suit.Hearts, Rank.King));
      expect(passed).toContainEqual(card(Suit.Spades, Rank.Ace));
    });

    it('fills with highest remaining when fewer dangerous cards than count', () => {
      const hand = [
        card(Suit.Clubs, Rank.Two),
        card(Suit.Clubs, Rank.Three),
        card(Suit.Clubs, Rank.Four),
        card(Suit.Diamonds, Rank.King),
        card(Suit.Hearts, Rank.Two),
      ];
      const state = makeState({
        gameType: GameType.Hearts,
        myHand: hand,
        legalMoves: [],
      });

      const passed = ai.choosePassCards(state, 3);
      expect(passed).toHaveLength(3);
      // Should include the one heart
      expect(passed).toContainEqual(card(Suit.Hearts, Rank.Two));
    });
  });

  describe('Spades — chooseBid', () => {
    it('bids at least 1', () => {
      const hand = [
        card(Suit.Clubs, Rank.Two),
        card(Suit.Clubs, Rank.Three),
      ];
      const state = makeState({
        gameType: GameType.Spades,
        myHand: hand,
        legalMoves: [],
      });
      expect(ai.chooseBid(state)).toBeGreaterThanOrEqual(1);
    });

    it('bids higher with aces and high spades', () => {
      const strongHand = [
        card(Suit.Spades, Rank.Ace),
        card(Suit.Spades, Rank.King),
        card(Suit.Spades, Rank.Queen),
        card(Suit.Hearts, Rank.Ace),
        card(Suit.Diamonds, Rank.Ace),
        card(Suit.Clubs, Rank.Ace),
        card(Suit.Clubs, Rank.Two),
      ];
      const weakHand = [
        card(Suit.Clubs, Rank.Two),
        card(Suit.Clubs, Rank.Three),
        card(Suit.Diamonds, Rank.Four),
        card(Suit.Hearts, Rank.Five),
      ];

      const strongState = makeState({ gameType: GameType.Spades, myHand: strongHand, legalMoves: [] });
      const weakState = makeState({ gameType: GameType.Spades, myHand: weakHand, legalMoves: [] });

      expect(ai.chooseBid(strongState)).toBeGreaterThan(ai.chooseBid(weakState));
    });
  });
});
