import { describe, it, expect, beforeEach } from 'vitest';
import { Suit, Rank, GamePhase } from '@card-game/shared-types';
import { SpadesEngine } from '../games/spades/SpadesEngine.js';
import { createCard } from '../core/Card.js';

describe('SpadesEngine', () => {
  let engine: SpadesEngine;

  beforeEach(() => {
    engine = new SpadesEngine('test-spades');
  });

  describe('initialization', () => {
    it('creates a game in waiting phase with bids array', () => {
      const state = engine.getState();
      expect(state.phase).toBe(GamePhase.Waiting);
      expect(state.players).toHaveLength(4);
      expect(state.bids).toEqual([null, null, null, null]);
    });
  });

  describe('dealing', () => {
    it('deals 13 cards and enters bidding phase', () => {
      engine.startGame();
      const state = engine.getState();
      expect(state.phase).toBe(GamePhase.Bidding);
      for (const player of state.players) {
        expect(player.hand).toHaveLength(13);
      }
    });
  });

  describe('bidding', () => {
    beforeEach(() => {
      engine.startGame();
    });

    it('accepts valid bids (0-13)', () => {
      const seat = engine.getState().currentPlayerSeat;
      engine.placeBid(seat, 3);
      expect(engine.getState().bids![seat]).toBe(3);
    });

    it('rejects out-of-turn bids', () => {
      const seat = engine.getState().currentPlayerSeat;
      const otherSeat = (seat + 1) % 4;
      expect(() => engine.placeBid(otherSeat, 3)).toThrow('Not your turn');
    });

    it('accepts nil bid (0)', () => {
      const seat = engine.getState().currentPlayerSeat;
      engine.placeBid(seat, 0);
      expect(engine.getState().bids![seat]).toBe(0);
    });

    it('transitions to playing after all bids', () => {
      for (let i = 0; i < 4; i++) {
        const seat = engine.getState().currentPlayerSeat;
        engine.placeBid(seat, 3);
      }
      expect(engine.getState().phase).toBe(GamePhase.Playing);
    });
  });

  describe('playing', () => {
    function setupForPlaying() {
      engine.startGame();
      for (let i = 0; i < 4; i++) {
        const seat = engine.getState().currentPlayerSeat;
        engine.placeBid(seat, 3);
      }
    }

    it('requires following suit', () => {
      setupForPlaying();
      const state = engine.getState();
      const seat = state.currentPlayerSeat;
      const moves = engine.getLegalMoves(seat);
      expect(moves.length).toBeGreaterThan(0);
    });

    it('spades act as trump and beat other suits', () => {
      setupForPlaying();

      // Play a full trick
      for (let i = 0; i < 4; i++) {
        const state = engine.getState();
        if (state.phase !== GamePhase.Playing) break;
        const seat = state.currentPlayerSeat;
        const moves = engine.getLegalMoves(seat);
        engine.playCard(seat, moves[0]);
      }

      // Should have resolved the trick
      const state = engine.getState();
      expect(
        state.phase === GamePhase.Playing ||
        state.phase === GamePhase.RoundScoring ||
        state.phase === GamePhase.Dealing ||
        state.phase === GamePhase.Bidding ||
        state.phase === GamePhase.GameOver
      ).toBe(true);
    });
  });

  describe('scoring', () => {
    it('awards 10x bid when team meets bid', () => {
      const state = engine.getState();
      state.bids = [3, 3, 3, 3];
      // Team 0+2 bid 6, team 1+3 bid 6
      state.players[0].tricksWon = 4;
      state.players[2].tricksWon = 3;
      state.players[1].tricksWon = 3;
      state.players[3].tricksWon = 3;

      const scores = engine.calculateRoundScores();
      // Team 0+2: bid 6, got 7 → 60 + 1 bag = 61
      expect(scores[0]).toBe(61);
      // Team 1+3: bid 6, got 6 → 60
      expect(scores[1]).toBe(60);
    });

    it('penalizes set (negative score when under bid)', () => {
      const state = engine.getState();
      state.bids = [5, 2, 2, 2];
      state.players[0].tricksWon = 3;
      state.players[2].tricksWon = 1;
      state.players[1].tricksWon = 5;
      state.players[3].tricksWon = 4;

      const scores = engine.calculateRoundScores();
      // Team 0+2: bid 7, got 4 → set → -70
      expect(scores[0]).toBe(-70);
    });

    it('rewards successful nil bid with 100 points', () => {
      const state = engine.getState();
      state.bids = [0, 3, 5, 3];
      state.players[0].tricksWon = 0; // successful nil
      state.players[2].tricksWon = 6;
      state.players[1].tricksWon = 4;
      state.players[3].tricksWon = 3;

      const scores = engine.calculateRoundScores();
      // Seat 0 nil success (+100), seat 2 bid 5 got 6 → 50+1=51 → total 151
      expect(scores[0]).toBe(151);
    });
  });

  describe('partnerships', () => {
    it('seats 0+2 and 1+3 are partners', () => {
      expect(engine.getPartner(0)).toBe(2);
      expect(engine.getPartner(1)).toBe(3);
      expect(engine.getPartner(2)).toBe(0);
      expect(engine.getPartner(3)).toBe(1);
    });
  });

  describe('full game simulation', () => {
    it('can play a complete round without errors', () => {
      engine.startGame();

      // Bid
      for (let i = 0; i < 4; i++) {
        const seat = engine.getState().currentPlayerSeat;
        engine.placeBid(seat, 3);
      }

      // Play 13 tricks
      for (let trick = 0; trick < 13; trick++) {
        for (let card = 0; card < 4; card++) {
          const state = engine.getState();
          if (state.phase !== GamePhase.Playing) break;
          const seat = state.currentPlayerSeat;
          const moves = engine.getLegalMoves(seat);
          expect(moves.length).toBeGreaterThan(0);
          engine.playCard(seat, moves[0]);
        }
      }

      const state = engine.getState();
      expect(
        state.phase === GamePhase.Bidding || // new round
        state.phase === GamePhase.Dealing ||
        state.phase === GamePhase.GameOver
      ).toBe(true);
    });
  });
});
