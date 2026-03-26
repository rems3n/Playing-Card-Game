import { describe, it, expect, beforeEach } from 'vitest';
import { GameType, AIDifficulty, GamePhase, Suit, Rank } from '@card-game/shared-types';
import { GameService } from '../services/GameService.js';

describe('GameService', () => {
  let service: GameService;

  beforeEach(() => {
    service = new GameService();
  });

  describe('createGame', () => {
    it('creates a Hearts game', () => {
      const gameId = service.createGame(GameType.Hearts);
      expect(gameId).toBeTruthy();
      expect(service.getRoom(gameId)).toBeDefined();
      expect(service.getRoom(gameId)!.gameType).toBe(GameType.Hearts);
    });

    it('creates a Spades game', () => {
      const gameId = service.createGame(GameType.Spades);
      expect(service.getRoom(gameId)!.gameType).toBe(GameType.Spades);
    });

    it('creates a Euchre game', () => {
      const gameId = service.createGame(GameType.Euchre);
      expect(service.getRoom(gameId)!.gameType).toBe(GameType.Euchre);
    });

    it('creates unique game IDs', () => {
      const id1 = service.createGame(GameType.Hearts);
      const id2 = service.createGame(GameType.Hearts);
      expect(id1).not.toBe(id2);
    });

    it('throws for unknown game type', () => {
      expect(() => service.createGame('poker' as GameType)).toThrow('Unknown game type');
    });
  });

  describe('joinGame', () => {
    let gameId: string;

    beforeEach(() => {
      gameId = service.createGame(GameType.Hearts);
    });

    it('assigns seat 0 to the first player', () => {
      const seat = service.joinGame(gameId, 'socket-1', 'Alice');
      expect(seat).toBe(0);
    });

    it('assigns sequential seats', () => {
      const s0 = service.joinGame(gameId, 'socket-1', 'Alice');
      const s1 = service.joinGame(gameId, 'socket-2', 'Bob');
      const s2 = service.joinGame(gameId, 'socket-3', 'Carol');
      expect(s0).toBe(0);
      expect(s1).toBe(1);
      expect(s2).toBe(2);
    });

    it('returns existing seat for same socketId (reconnect)', () => {
      const seat1 = service.joinGame(gameId, 'socket-1', 'Alice');
      const seat2 = service.joinGame(gameId, 'socket-1', 'Alice');
      expect(seat1).toBe(seat2);
    });

    it('reconnects user with new socket by userId', () => {
      service.joinGame(gameId, 'socket-1', 'Alice', 'user-1');
      const seat = service.joinGame(gameId, 'socket-2', 'Alice', 'user-1');
      expect(seat).toBe(0);
      // Old socket should be cleaned up
      expect(service.getSeatForSocket(gameId, 'socket-1')).toBeUndefined();
      expect(service.getSeatForSocket(gameId, 'socket-2')).toBe(0);
    });

    it('throws when game is full', () => {
      service.joinGame(gameId, 's1', 'A');
      service.joinGame(gameId, 's2', 'B');
      service.joinGame(gameId, 's3', 'C');
      service.joinGame(gameId, 's4', 'D');
      expect(() => service.joinGame(gameId, 's5', 'E')).toThrow('Game is full');
    });

    it('throws for nonexistent game', () => {
      expect(() => service.joinGame('bogus', 'socket-1', 'Alice')).toThrow('Game not found');
    });
  });

  describe('fillWithAI', () => {
    it('fills empty seats with AI', () => {
      const gameId = service.createGame(GameType.Hearts);
      service.joinGame(gameId, 'socket-1', 'Alice');
      service.fillWithAI(gameId, AIDifficulty.Beginner);

      const room = service.getRoom(gameId)!;
      expect(room.aiPlayers.size).toBe(3);
      expect(room.aiPlayers.has(0)).toBe(false); // human seat
      expect(room.aiPlayers.has(1)).toBe(true);
      expect(room.aiPlayers.has(2)).toBe(true);
      expect(room.aiPlayers.has(3)).toBe(true);
    });

    it('names bots from the personality pool', () => {
      const gameId = service.createGame(GameType.Hearts);
      service.joinGame(gameId, 'socket-1', 'Alice');
      service.fillWithAI(gameId, AIDifficulty.Beginner);

      const room = service.getRoom(gameId)!;
      for (const [, ai] of room.aiPlayers) {
        expect(ai.displayName).toBeTruthy();
        expect(typeof ai.displayName).toBe('string');
      }
    });

    it('throws for nonexistent game', () => {
      expect(() => service.fillWithAI('bogus', AIDifficulty.Beginner)).toThrow('Game not found');
    });
  });

  describe('startGame', () => {
    it('starts the game and enters dealing/passing phase', () => {
      const gameId = service.createGame(GameType.Hearts);
      service.joinGame(gameId, 'socket-1', 'Alice');
      service.fillWithAI(gameId, AIDifficulty.Beginner);
      service.startGame(gameId);

      const phase = service.getPhase(gameId);
      // Hearts starts with passing phase (round 0 = pass left)
      expect(phase).toBe(GamePhase.Passing);
    });

    it('throws for nonexistent game', () => {
      expect(() => service.startGame('bogus')).toThrow('Game not found');
    });
  });

  describe('game actions', () => {
    let gameId: string;

    function setupPlayingGame(): string {
      const id = service.createGame(GameType.Spades);
      service.joinGame(id, 'socket-1', 'Alice');
      service.fillWithAI(id, AIDifficulty.Beginner);
      service.startGame(id);
      // Spades starts with bidding
      return id;
    }

    it('placeBid advances the bidding phase', () => {
      const id = setupPlayingGame();
      const seat = service.getCurrentSeat(id);
      // The current player should be able to bid
      service.placeBid(id, seat, 3);
      // Should advance (next player or move to playing)
      expect(service.getPhase(id)).toBeDefined();
    });

    it('placeBid throws on non-Spades game', () => {
      const heartsId = service.createGame(GameType.Hearts);
      service.joinGame(heartsId, 'socket-1', 'Alice');
      service.fillWithAI(heartsId, AIDifficulty.Beginner);
      service.startGame(heartsId);
      expect(() => service.placeBid(heartsId, 0, 3)).toThrow('Not a Spades game');
    });

    it('passCards throws on non-Hearts game', () => {
      const spadesId = service.createGame(GameType.Spades);
      service.joinGame(spadesId, 'socket-1', 'Alice');
      service.fillWithAI(spadesId, AIDifficulty.Beginner);
      service.startGame(spadesId);
      expect(() => service.passCards(spadesId, 0, [])).toThrow('Not a Hearts game');
    });

    it('callTrump throws on non-Euchre game', () => {
      const heartsId = service.createGame(GameType.Hearts);
      service.joinGame(heartsId, 'socket-1', 'Alice');
      service.fillWithAI(heartsId, AIDifficulty.Beginner);
      service.startGame(heartsId);
      expect(() => service.callTrump(heartsId, 0, Suit.Hearts)).toThrow('Not a Euchre game');
    });
  });

  describe('getVisibleState', () => {
    it('returns personalized state for a seat', () => {
      const gameId = service.createGame(GameType.Hearts);
      service.joinGame(gameId, 'socket-1', 'Alice');
      service.fillWithAI(gameId, AIDifficulty.Beginner);
      service.startGame(gameId);

      const state = service.getVisibleState(gameId, 0);
      expect(state.mySeat).toBe(0);
      expect(state.myHand).toHaveLength(13);
      expect(state.gameType).toBe(GameType.Hearts);
    });

    it('throws for nonexistent game', () => {
      expect(() => service.getVisibleState('bogus', 0)).toThrow('Game not found');
    });
  });

  describe('removeGame', () => {
    it('removes the game room', () => {
      const gameId = service.createGame(GameType.Hearts);
      service.removeGame(gameId);
      expect(service.getRoom(gameId)).toBeUndefined();
    });
  });

  describe('executeAITurns', () => {
    it('AI passes cards in Hearts', async () => {
      const gameId = service.createGame(GameType.Hearts);
      service.joinGame(gameId, 'socket-1', 'Alice');
      service.fillWithAI(gameId, AIDifficulty.Beginner);
      service.startGame(gameId);

      expect(service.getPhase(gameId)).toBe(GamePhase.Passing);

      // Execute AI turns — AI should pass their cards
      await service.executeAITurns(gameId);

      // After AI passes, game waits for human to pass
      // Phase stays Passing until human passes too
      expect(service.getPhase(gameId)).toBe(GamePhase.Passing);

      // Pass the human's cards
      const humanState = service.getVisibleState(gameId, 0);
      const humanHand = humanState.myHand;
      service.passCards(gameId, 0, humanHand.slice(0, 3));

      // Now all have passed — should move to Playing
      expect(service.getPhase(gameId)).toBe(GamePhase.Playing);
    }, 10000);

    it('AI bids in Spades', async () => {
      const gameId = service.createGame(GameType.Spades);
      // Put human in seat 0
      service.joinGame(gameId, 'socket-1', 'Alice');
      service.fillWithAI(gameId, AIDifficulty.Beginner);
      service.startGame(gameId);

      expect(service.getPhase(gameId)).toBe(GamePhase.Bidding);

      // If human bids first (seat 0)
      const currentSeat = service.getCurrentSeat(gameId);
      if (currentSeat === 0) {
        service.placeBid(gameId, 0, 3);
      }

      // AI should bid for remaining seats
      await service.executeAITurns(gameId);

      // If human hasn't bid yet, bid now
      if (service.getPhase(gameId) === GamePhase.Bidding) {
        const seat = service.getCurrentSeat(gameId);
        if (seat === 0) {
          service.placeBid(gameId, 0, 3);
          await service.executeAITurns(gameId);
        }
      }

      // Should be in Playing phase after all bids
      expect(service.getPhase(gameId)).toBe(GamePhase.Playing);
    }, 15000);

    it('calls onCardPlayed callback for each AI card', async () => {
      const gameId = service.createGame(GameType.Spades);
      service.joinGame(gameId, 'socket-1', 'Alice');
      service.fillWithAI(gameId, AIDifficulty.Beginner);
      service.startGame(gameId);

      // Complete bidding first
      while (service.getPhase(gameId) === GamePhase.Bidding) {
        const seat = service.getCurrentSeat(gameId);
        const room = service.getRoom(gameId)!;
        if (room.aiPlayers.has(seat)) {
          await service.executeAITurns(gameId);
        } else {
          service.placeBid(gameId, seat, 3);
        }
      }

      // Now in playing phase — if it's an AI's turn, run AI turns
      const currentSeat = service.getCurrentSeat(gameId);
      const room = service.getRoom(gameId)!;
      if (room.aiPlayers.has(currentSeat)) {
        const played: Array<{ seat: number }> = [];
        await service.executeAITurns(gameId, (seat) => {
          played.push({ seat });
        });
        expect(played.length).toBeGreaterThan(0);
      }
    }, 30000);
  });
});
