import { v4 as uuidv4 } from 'uuid';
import {
  type Card,
  type GameConfig,
  type VisibleGameState,
  AIDifficulty,
  GamePhase,
  GameType,
  Suit,
} from '@card-game/shared-types';
import { HeartsEngine, SpadesEngine, EuchreEngine, type GameEngine } from '@card-game/game-engine';
import {
  createAIPlayer,
  type AIPlayer,
  shouldCallTrump,
  chooseTrumpSuit,
} from '@card-game/ai';

type AnyEngine = HeartsEngine | SpadesEngine | EuchreEngine;

export interface GameRoom {
  engine: AnyEngine;
  gameType: GameType;
  aiPlayers: Map<number, AIPlayer>;
  playerSockets: Map<number, string>;
  socketSeats: Map<string, number>;
}

export class GameService {
  private games = new Map<string, GameRoom>();

  createGame(
    gameType: GameType,
    config?: Partial<GameConfig>,
    aiDifficulty?: AIDifficulty,
  ): string {
    const gameId = uuidv4();

    let engine: AnyEngine;
    switch (gameType) {
      case GameType.Hearts:
        engine = new HeartsEngine(gameId, config);
        break;
      case GameType.Spades:
        engine = new SpadesEngine(gameId, config);
        break;
      case GameType.Euchre:
        engine = new EuchreEngine(gameId, config);
        break;
      default:
        throw new Error(`Unknown game type: ${gameType}`);
    }

    const room: GameRoom = {
      engine,
      gameType,
      aiPlayers: new Map(),
      playerSockets: new Map(),
      socketSeats: new Map(),
    };

    this.games.set(gameId, room);
    return gameId;
  }

  getRoom(gameId: string): GameRoom | undefined {
    return this.games.get(gameId);
  }

  joinGame(
    gameId: string,
    socketId: string,
    displayName: string,
    userId?: string,
  ): number {
    const room = this.games.get(gameId);
    if (!room) throw new Error('Game not found');

    // Check if this socket is already in the game
    const existingSeat = room.socketSeats.get(socketId);
    if (existingSeat !== undefined) return existingSeat;

    // Check if this user is already in the game (reconnecting with a new socket)
    if (userId) {
      for (const [seat, sid] of room.playerSockets) {
        const state = room.engine.getState();
        if (state.players[seat].userId === userId) {
          // Update socket mapping
          room.socketSeats.delete(sid);
          room.playerSockets.set(seat, socketId);
          room.socketSeats.set(socketId, seat);
          return seat;
        }
      }
    }

    // Find first seat not occupied by a human
    let seat = -1;
    for (let i = 0; i < 4; i++) {
      if (!room.playerSockets.has(i)) {
        seat = i;
        break;
      }
    }
    if (seat === -1) throw new Error('Game is full');

    room.engine.setPlayer(seat, userId ?? null, displayName, false);
    room.playerSockets.set(seat, socketId);
    room.socketSeats.set(socketId, seat);

    return seat;
  }

  fillWithAI(gameId: string, difficulty: AIDifficulty): void {
    const room = this.games.get(gameId);
    if (!room) throw new Error('Game not found');

    const botNames = ['Dealer Danny', 'Lucky Lucy', 'Card Shark Sally', 'Steady Steve'];
    let botIdx = 0;

    for (let seat = 0; seat < 4; seat++) {
      if (!room.playerSockets.has(seat)) {
        const name = botNames[botIdx++ % botNames.length];
        const ai = createAIPlayer(difficulty, name);
        room.aiPlayers.set(seat, ai);
        room.engine.setPlayer(seat, null, ai.displayName, true);
      }
    }
  }

  startGame(gameId: string): void {
    const room = this.games.get(gameId);
    if (!room) throw new Error('Game not found');
    room.engine.startGame();
  }

  playCard(gameId: string, seatIndex: number, card: Card): void {
    const room = this.games.get(gameId);
    if (!room) throw new Error('Game not found');
    room.engine.playCard(seatIndex, card);
  }

  passCards(gameId: string, seatIndex: number, cards: Card[]): void {
    const room = this.games.get(gameId);
    if (!room) throw new Error('Game not found');
    if (!(room.engine instanceof HeartsEngine)) throw new Error('Not a Hearts game');
    room.engine.passCards(seatIndex, cards);
  }

  placeBid(gameId: string, seatIndex: number, bid: number): void {
    const room = this.games.get(gameId);
    if (!room) throw new Error('Game not found');
    if (!(room.engine instanceof SpadesEngine)) throw new Error('Not a Spades game');
    room.engine.placeBid(seatIndex, bid);
  }

  callTrump(gameId: string, seatIndex: number, suit: Suit | 'pass'): void {
    const room = this.games.get(gameId);
    if (!room) throw new Error('Game not found');
    if (!(room.engine instanceof EuchreEngine)) throw new Error('Not a Euchre game');
    room.engine.callTrump(seatIndex, suit);
  }

  getVisibleState(gameId: string, seatIndex: number): VisibleGameState {
    const room = this.games.get(gameId);
    if (!room) throw new Error('Game not found');
    return room.engine.getVisibleState(seatIndex);
  }

  getPhase(gameId: string): GamePhase {
    const room = this.games.get(gameId);
    if (!room) throw new Error('Game not found');
    return room.engine.getState().phase;
  }

  getCurrentSeat(gameId: string): number {
    const room = this.games.get(gameId);
    if (!room) throw new Error('Game not found');
    return room.engine.getState().currentPlayerSeat;
  }

  getSeatForSocket(gameId: string, socketId: string): number | undefined {
    const room = this.games.get(gameId);
    if (!room) return undefined;
    return room.socketSeats.get(socketId);
  }

  /**
   * Execute AI turns — handles passing, bidding, trump calling, and playing.
   * onCardPlayed is called after each AI card play so the socket handler can broadcast.
   */
  async executeAITurns(
    gameId: string,
    onCardPlayed?: (seatIndex: number, card: Card) => void,
  ): Promise<void> {
    const room = this.games.get(gameId);
    if (!room) return;

    const state = room.engine.getState();

    // ── Hearts: AI passing ──
    if (state.phase === GamePhase.Passing && room.engine instanceof HeartsEngine) {
      for (const [seat, ai] of room.aiPlayers) {
        if (!room.engine.hasPlayerPassed(seat)) {
          const visibleState = room.engine.getVisibleState(seat);
          const cards = ai.choosePassCards(visibleState, 3);
          await this.delay(300);
          room.engine.passCards(seat, cards);
        }
      }
      return;
    }

    // ── Spades: AI bidding ──
    if (state.phase === GamePhase.Bidding && room.engine instanceof SpadesEngine) {
      let currentSeat = state.currentPlayerSeat;
      let ai = room.aiPlayers.get(currentSeat);

      while (ai && room.engine.getState().phase === GamePhase.Bidding) {
        const visibleState = room.engine.getVisibleState(currentSeat);
        const bid = ai.chooseBid(visibleState);
        await this.delay(500);
        room.engine.placeBid(currentSeat, typeof bid === 'number' ? bid : 2);

        const newState = room.engine.getState();
        if (newState.phase !== GamePhase.Bidding) break;
        currentSeat = newState.currentPlayerSeat;
        ai = room.aiPlayers.get(currentSeat);
      }
      return;
    }

    // ── Euchre: AI trump calling ──
    if (state.phase === GamePhase.Bidding && room.engine instanceof EuchreEngine) {
      let currentSeat = state.currentPlayerSeat;
      let ai = room.aiPlayers.get(currentSeat);

      while (ai && room.engine.getState().phase === GamePhase.Bidding) {
        const hand = room.engine.getState().players[currentSeat].hand;
        const turnedUp = room.engine.getTurnedUpCard();
        await this.delay(500);

        if (turnedUp) {
          // Decide whether to call or pass
          if (shouldCallTrump(hand, turnedUp.suit)) {
            room.engine.callTrump(currentSeat, turnedUp.suit);
          } else {
            // Try round 2 suit
            const bestSuit = chooseTrumpSuit(hand, turnedUp.suit);
            if (bestSuit) {
              room.engine.callTrump(currentSeat, bestSuit);
            } else {
              room.engine.callTrump(currentSeat, 'pass');
            }
          }
        } else {
          room.engine.callTrump(currentSeat, 'pass');
        }

        const newState = room.engine.getState();
        if (newState.phase !== GamePhase.Bidding) break;
        currentSeat = newState.currentPlayerSeat;
        ai = room.aiPlayers.get(currentSeat);
      }
      return;
    }

    // ── All games: AI card plays ──
    if (state.phase !== GamePhase.Playing) return;

    let currentSeat = state.currentPlayerSeat;
    let ai = room.aiPlayers.get(currentSeat);

    while (ai && room.engine.getState().phase === GamePhase.Playing) {
      const visibleState = room.engine.getVisibleState(currentSeat);
      const card = ai.chooseCard(visibleState);

      await this.delay(1500 + Math.random() * 1000); // 1.5-2.5s per AI card
      room.engine.playCard(currentSeat, card);

      // Notify after each card so clients see it appear
      if (onCardPlayed) onCardPlayed(currentSeat, card);

      const newState = room.engine.getState();
      if (newState.phase !== GamePhase.Playing) break;

      currentSeat = newState.currentPlayerSeat;
      ai = room.aiPlayers.get(currentSeat);
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Mark a player as disconnected (remove socket mapping but keep seat).
   * Returns the seat index, or -1 if not found.
   */
  handlePlayerDisconnect(gameId: string, socketId: string): number {
    const room = this.games.get(gameId);
    if (!room) return -1;

    const seat = room.socketSeats.get(socketId);
    if (seat === undefined) return -1;

    room.engine.getState().players[seat].isConnected = false;
    // Don't remove socket mapping yet — they might reconnect
    return seat;
  }

  /**
   * Replace a disconnected human player with an AI bot.
   */
  replaceWithAI(gameId: string, seatIndex: number): void {
    const room = this.games.get(gameId);
    if (!room) return;

    const player = room.engine.getState().players[seatIndex];
    const ai = createAIPlayer(AIDifficulty.Intermediate, player.displayName + ' (AI)');
    room.aiPlayers.set(seatIndex, ai);
    room.engine.setPlayer(seatIndex, null, ai.displayName, true);

    // Remove old socket mapping
    const oldSocketId = room.playerSockets.get(seatIndex);
    if (oldSocketId) {
      room.socketSeats.delete(oldSocketId);
    }
    room.playerSockets.delete(seatIndex);
  }

  /**
   * Find which game a socket is in. Returns { gameId, seat } or null.
   */
  findGameBySocket(socketId: string): { gameId: string; seat: number } | null {
    for (const [gameId, room] of this.games) {
      const seat = room.socketSeats.get(socketId);
      if (seat !== undefined) return { gameId, seat };
    }
    return null;
  }

  /**
   * Check if there are any human players still connected in a game.
   */
  getConnectedHumanCount(gameId: string): number {
    const room = this.games.get(gameId);
    if (!room) return 0;
    return room.playerSockets.size;
  }

  removeGame(gameId: string): void {
    this.games.delete(gameId);
  }
}
