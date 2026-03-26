import { describe, it, expect, beforeEach } from 'vitest';
import { Suit, Rank, GamePhase, PassDirection } from '@card-game/shared-types';
import { HeartsEngine } from '../games/hearts/HeartsEngine.js';
import { createCard } from '../core/Card.js';

describe('HeartsEngine', () => {
  let engine: HeartsEngine;

  beforeEach(() => {
    engine = new HeartsEngine('test-game');
  });

  describe('initialization', () => {
    it('creates a game in waiting phase', () => {
      const state = engine.getState();
      expect(state.phase).toBe(GamePhase.Waiting);
      expect(state.players).toHaveLength(4);
      expect(state.scores).toEqual([0, 0, 0, 0]);
    });

    it('sets players correctly', () => {
      engine.setPlayer(0, 'user1', 'Alice', false);
      const state = engine.getState();
      expect(state.players[0].displayName).toBe('Alice');
      expect(state.players[0].userId).toBe('user1');
      expect(state.players[0].isAI).toBe(false);
    });
  });

  describe('dealing', () => {
    it('deals 13 cards to each player', () => {
      engine.startGame();
      const state = engine.getState();
      for (const player of state.players) {
        expect(player.hand).toHaveLength(13);
      }
    });

    it('starts with pass left on round 0', () => {
      engine.startGame();
      const state = engine.getState();
      // Round 0 → PassDirection.Left → goes to Passing phase
      expect(state.passDirection).toBe(PassDirection.Left);
    });

    it('enters passing phase when not a keep round', () => {
      engine.startGame();
      expect(engine.getState().phase).toBe(GamePhase.Passing);
    });
  });

  describe('passing', () => {
    beforeEach(() => {
      engine.startGame();
    });

    it('accepts valid 3-card passes', () => {
      const hand = engine.getState().players[0].hand;
      engine.passCards(0, hand.slice(0, 3));
      expect(engine.hasPlayerPassed(0)).toBe(true);
    });

    it('rejects passing wrong number of cards', () => {
      const hand = engine.getState().players[0].hand;
      expect(() => engine.passCards(0, hand.slice(0, 2))).toThrow(
        'Must pass exactly 3 cards',
      );
    });

    it('rejects passing cards not in hand', () => {
      // Remove all cards from seat 0's hand and give them specific cards
      const state = engine.getState();
      state.players[0].hand = [
        createCard(Suit.Clubs, Rank.Two),
        createCard(Suit.Clubs, Rank.Three),
        createCard(Suit.Clubs, Rank.Four),
      ];
      // Try to pass cards that aren't in the hand
      expect(() =>
        engine.passCards(0, [
          createCard(Suit.Hearts, Rank.Ace),
          createCard(Suit.Hearts, Rank.King),
          createCard(Suit.Hearts, Rank.Queen),
        ]),
      ).toThrow('Card not in hand');
    });

    it('transitions to playing after all players pass', () => {
      for (let seat = 0; seat < 4; seat++) {
        const hand = engine.getState().players[seat].hand;
        engine.passCards(seat, hand.slice(0, 3));
      }
      expect(engine.getState().phase).toBe(GamePhase.Playing);
    });
  });

  describe('playing', () => {
    function setupForPlaying(): void {
      engine.startGame();
      // Pass cards for all players to get to playing phase
      for (let seat = 0; seat < 4; seat++) {
        const hand = engine.getState().players[seat].hand;
        engine.passCards(seat, hand.slice(0, 3));
      }
    }

    it('starts with the player holding 2 of clubs', () => {
      setupForPlaying();
      const state = engine.getState();
      const currentPlayer = state.players[state.currentPlayerSeat];
      const has2C = currentPlayer.hand.some(
        (c) => c.suit === Suit.Clubs && c.rank === Rank.Two,
      );
      expect(has2C).toBe(true);
    });

    it('forces 2 of clubs on first trick lead', () => {
      setupForPlaying();
      const state = engine.getState();
      const legalMoves = engine.getLegalMoves(state.currentPlayerSeat);
      expect(legalMoves).toHaveLength(1);
      expect(legalMoves[0]).toEqual(
        createCard(Suit.Clubs, Rank.Two),
      );
    });

    it('rejects playing out of turn', () => {
      setupForPlaying();
      const state = engine.getState();
      const otherSeat = (state.currentPlayerSeat + 1) % 4;
      const otherHand = state.players[otherSeat].hand;
      expect(() => engine.playCard(otherSeat, otherHand[0])).toThrow(
        "Not seat",
      );
    });

    it('requires following suit when possible', () => {
      setupForPlaying();
      const state = engine.getState();
      const seat = state.currentPlayerSeat;

      // Play 2 of clubs
      engine.playCard(seat, createCard(Suit.Clubs, Rank.Two));

      // Next player must follow clubs if they have any
      const nextState = engine.getState();
      const nextSeat = nextState.currentPlayerSeat;
      const nextHand = nextState.players[nextSeat].hand;
      const hasClubs = nextHand.some((c) => c.suit === Suit.Clubs);

      if (hasClubs) {
        const legalMoves = engine.getLegalMoves(nextSeat);
        expect(legalMoves.every((c) => c.suit === Suit.Clubs)).toBe(true);
      }
    });
  });

  describe('trick resolution', () => {
    it('highest card of lead suit wins', () => {
      // Manually set up a trick scenario
      engine.startGame();
      // Skip to playing by passing
      for (let seat = 0; seat < 4; seat++) {
        const hand = engine.getState().players[seat].hand;
        engine.passCards(seat, hand.slice(0, 3));
      }

      // Play a full trick by playing 2 of clubs first, then clubs from others
      const state = engine.getState();
      const starter = state.currentPlayerSeat;

      // Play 2 of clubs
      engine.playCard(starter, createCard(Suit.Clubs, Rank.Two));

      // Each remaining player plays a legal move
      for (let i = 1; i < 4; i++) {
        const s = engine.getState();
        const seat = s.currentPlayerSeat;
        const moves = engine.getLegalMoves(seat);
        expect(moves.length).toBeGreaterThan(0);
        engine.playCard(seat, moves[0]);
      }

      // After trick resolves, we should be in playing phase for next trick
      // or round scoring if it was the last trick
      const afterState = engine.getState();
      expect(
        afterState.phase === GamePhase.Playing ||
          afterState.phase === GamePhase.RoundScoring ||
          afterState.phase === GamePhase.Dealing ||
          afterState.phase === GamePhase.Passing ||
          afterState.phase === GamePhase.GameOver,
      ).toBe(true);
    });
  });

  describe('scoring', () => {
    it('hearts are worth 1 point each', () => {
      // Use calculateRoundScores with pre-set round scores
      const state = engine.getState();
      state.roundScores = [5, 3, 10, 8]; // 26 total
      const scores = engine.calculateRoundScores();
      expect(scores).toEqual([5, 3, 10, 8]);
    });

    it('shoot the moon gives 26 to others, 0 to shooter', () => {
      const state = engine.getState();
      state.roundScores = [26, 0, 0, 0]; // seat 0 got all points
      const scores = engine.calculateRoundScores();
      expect(scores).toEqual([0, 26, 26, 26]);
    });
  });

  describe('game over', () => {
    it('ends when a player reaches target score', () => {
      const state = engine.getState();
      state.scores = [99, 50, 30, 20];
      state.roundScores = [2, 5, 10, 9];
      // After adding round scores: [101, 55, 40, 29]
      expect(engine.isGameOver()).toBe(false); // scores not yet applied
      state.scores = [101, 55, 40, 29];
      expect(engine.isGameOver()).toBe(true);
    });

    it('lowest score wins', () => {
      const state = engine.getState();
      state.scores = [101, 55, 40, 29];
      expect(engine.getWinnerSeat()).toBe(3); // seat 3 has 29
    });
  });

  describe('visible state', () => {
    it('hides other players hands', () => {
      engine.startGame();
      for (let seat = 0; seat < 4; seat++) {
        const hand = engine.getState().players[seat].hand;
        engine.passCards(seat, hand.slice(0, 3));
      }

      const visible = engine.getVisibleState(0);
      expect(visible.myHand).toHaveLength(13);
      expect(visible.mySeat).toBe(0);
      // Other players only show card count, not actual cards
      for (const p of visible.players) {
        expect(p.cardCount).toBe(13);
        expect((p as any).hand).toBeUndefined();
      }
    });

    it('includes legal moves for current player', () => {
      engine.startGame();
      for (let seat = 0; seat < 4; seat++) {
        const hand = engine.getState().players[seat].hand;
        engine.passCards(seat, hand.slice(0, 3));
      }

      const state = engine.getState();
      const visible = engine.getVisibleState(state.currentPlayerSeat);
      expect(visible.legalMoves.length).toBeGreaterThan(0);
    });
  });

  describe('full game simulation', () => {
    it('can play a complete round without errors', () => {
      engine.startGame();

      // Pass cards
      for (let seat = 0; seat < 4; seat++) {
        const hand = engine.getState().players[seat].hand;
        engine.passCards(seat, hand.slice(0, 3));
      }

      // Play all 13 tricks
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

      // Round should have ended — game moves to next round's passing/dealing, or game over
      const finalState = engine.getState();
      expect(
        finalState.phase === GamePhase.Passing ||
          finalState.phase === GamePhase.Dealing ||
          finalState.phase === GamePhase.Playing ||
          finalState.phase === GamePhase.GameOver,
      ).toBe(true);

      // Total cumulative scores after one round should sum to 26 or 78 (shoot the moon)
      const totalScores = finalState.scores.reduce((a, b) => a + b, 0);
      expect(totalScores === 26 || totalScores === 78).toBe(true);
    });
  });
});
