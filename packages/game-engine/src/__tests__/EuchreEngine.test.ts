import { describe, it, expect, beforeEach } from 'vitest';
import { Suit, Rank, GamePhase } from '@card-game/shared-types';
import { EuchreEngine } from '../games/euchre/EuchreEngine.js';
import { createCard } from '../core/Card.js';

describe('EuchreEngine', () => {
  let engine: EuchreEngine;

  beforeEach(() => {
    engine = new EuchreEngine('test-euchre');
  });

  describe('initialization', () => {
    it('creates a game in waiting phase', () => {
      const state = engine.getState();
      expect(state.phase).toBe(GamePhase.Waiting);
      expect(state.players).toHaveLength(4);
      expect(state.config.targetScore).toBe(10);
    });
  });

  describe('dealing', () => {
    it('deals 5 cards per player from 24-card deck', () => {
      engine.startGame();
      const state = engine.getState();
      expect(state.phase).toBe(GamePhase.Bidding);
      for (const player of state.players) {
        expect(player.hand).toHaveLength(5);
      }
      // All ranks should be >= 9
      for (const player of state.players) {
        for (const card of player.hand) {
          expect(card.rank).toBeGreaterThanOrEqual(9);
        }
      }
    });

    it('has a turned-up card', () => {
      engine.startGame();
      expect(engine.getTurnedUpCard()).not.toBeNull();
      expect(engine.getTurnedUpCard()!.rank).toBeGreaterThanOrEqual(9);
    });
  });

  describe('trump calling', () => {
    beforeEach(() => {
      engine.startGame();
    });

    it('allows passing', () => {
      const seat = engine.getState().currentPlayerSeat;
      engine.callTrump(seat, 'pass');
      expect(engine.getState().phase).toBe(GamePhase.Bidding);
    });

    it('sets trump when a suit is called', () => {
      const seat = engine.getState().currentPlayerSeat;
      const turnedUp = engine.getTurnedUpCard()!;
      engine.callTrump(seat, turnedUp.suit);
      expect(engine.getState().trumpSuit).toBe(turnedUp.suit);
      expect(engine.getState().phase).toBe(GamePhase.Playing);
    });

    it('rejects calling wrong suit in round 1', () => {
      const seat = engine.getState().currentPlayerSeat;
      const turnedUp = engine.getTurnedUpCard()!;
      const wrongSuit = turnedUp.suit === Suit.Hearts ? Suit.Clubs : Suit.Hearts;
      expect(() => engine.callTrump(seat, wrongSuit)).toThrow('round 1');
    });
  });

  describe('partnerships', () => {
    it('seats 0+2 and 1+3 are partners', () => {
      expect(engine.getPartner(0)).toBe(2);
      expect(engine.getPartner(1)).toBe(3);
    });
  });

  describe('scoring', () => {
    it('awards 1 point when maker takes 3-4 tricks', () => {
      engine.startGame();
      // Force trump call
      const seat = engine.getState().currentPlayerSeat;
      const turnedUp = engine.getTurnedUpCard()!;
      engine.callTrump(seat, turnedUp.suit);

      const state = engine.getState();
      // Simulate maker team getting 3 tricks
      state.players[engine.getMaker()].tricksWon = 2;
      state.players[engine.getPartner(engine.getMaker())].tricksWon = 1;

      const scores = engine.calculateRoundScores();
      const makerScore = scores[engine.getMaker()];
      expect(makerScore).toBe(1);
    });

    it('awards 2 points for march (all 5 tricks)', () => {
      engine.startGame();
      const seat = engine.getState().currentPlayerSeat;
      const turnedUp = engine.getTurnedUpCard()!;
      engine.callTrump(seat, turnedUp.suit);

      const state = engine.getState();
      state.players[engine.getMaker()].tricksWon = 3;
      state.players[engine.getPartner(engine.getMaker())].tricksWon = 2;

      const scores = engine.calculateRoundScores();
      expect(scores[engine.getMaker()]).toBe(2);
    });

    it('awards 2 points to defenders when maker is euchred', () => {
      engine.startGame();
      const seat = engine.getState().currentPlayerSeat;
      const turnedUp = engine.getTurnedUpCard()!;
      engine.callTrump(seat, turnedUp.suit);

      const state = engine.getState();
      // Maker team only gets 2 tricks
      state.players[engine.getMaker()].tricksWon = 1;
      state.players[engine.getPartner(engine.getMaker())].tricksWon = 1;

      const scores = engine.calculateRoundScores();
      expect(scores[engine.getMaker()]).toBe(0);
      // Defenders get 2
      const defenderSeat = [0, 1, 2, 3].find(
        (s) => s !== engine.getMaker() && s !== engine.getPartner(engine.getMaker())
      )!;
      expect(scores[defenderSeat]).toBe(2);
    });
  });

  describe('full game simulation', () => {
    it('can play a complete round without errors', () => {
      engine.startGame();

      // Call trump
      const seat = engine.getState().currentPlayerSeat;
      const turnedUp = engine.getTurnedUpCard()!;
      engine.callTrump(seat, turnedUp.suit);

      // Play 5 tricks
      for (let trick = 0; trick < 5; trick++) {
        const activePlayers = engine.isGoingAlone() ? 3 : 4;
        for (let card = 0; card < activePlayers; card++) {
          const state = engine.getState();
          if (state.phase !== GamePhase.Playing) break;
          const currentSeat = state.currentPlayerSeat;
          const moves = engine.getLegalMoves(currentSeat);
          expect(moves.length).toBeGreaterThan(0);
          engine.playCard(currentSeat, moves[0]);
        }
      }

      const state = engine.getState();
      expect(
        state.phase === GamePhase.Bidding ||
        state.phase === GamePhase.Dealing ||
        state.phase === GamePhase.GameOver
      ).toBe(true);
    });
  });
});
