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
import { HeartsEngine, SpadesEngine, EuchreEngine, RummyEngine, SevenSixEngine } from '@card-game/game-engine';
import {
  createAIPlayer,
  type AIPlayer,
  shouldCallTrump,
  chooseTrumpSuit,
  findMelds,
  chooseDrawSource,
  sevenSixBid,
} from '@card-game/ai';
import { GameStateStore, type SerializedGame } from './GameStateStore.js';

type AnyEngine = HeartsEngine | SpadesEngine | EuchreEngine | RummyEngine | SevenSixEngine;

export interface GameRoom {
  engine: AnyEngine;
  gameType: GameType;
  aiPlayers: Map<number, AIPlayer>;
  playerSockets: Map<number, string>;
  socketSeats: Map<string, number>;
}

export class GameService {
  private games = new Map<string, GameRoom>(); // in-memory cache
  private store = new GameStateStore();

  // ── Persistence helpers ──

  /** Save current game state to Redis. */
  private async persist(gameId: string): Promise<void> {
    const room = this.games.get(gameId);
    if (!room) return;

    const data: SerializedGame = {
      gameId,
      gameType: room.gameType,
      engineData: room.engine.serialize(),
      aiSeats: Array.from(room.aiPlayers.entries()).map(([seat, ai]) => ({
        seat,
        difficulty: ai.difficulty,
        displayName: ai.displayName,
      })),
      playerMappings: Array.from(room.playerSockets.entries()).map(([seat, socketId]) => {
        const state = room.engine.getState();
        const player = state.players[seat];
        return {
          seat,
          socketId,
          userId: player?.userId ?? null,
          displayName: player?.displayName ?? 'Player',
        };
      }),
    };

    await this.store.save(gameId, data);
  }

  /** Load a game from Redis into memory if not already cached. */
  private async ensureLoaded(gameId: string): Promise<GameRoom | undefined> {
    // Check memory cache first
    const cached = this.games.get(gameId);
    if (cached) return cached;

    // Try Redis
    const data = await this.store.load(gameId);
    if (!data) return undefined;

    return this.restoreFromData(data);
  }

  /** Reconstruct a GameRoom from serialized data. */
  private restoreFromData(data: SerializedGame): GameRoom {
    let engine: AnyEngine;
    switch (data.gameType) {
      case GameType.Hearts:
        engine = new HeartsEngine(data.gameId);
        break;
      case GameType.Spades:
        engine = new SpadesEngine(data.gameId);
        break;
      case GameType.Euchre:
        engine = new EuchreEngine(data.gameId);
        break;
      case GameType.Rummy:
        engine = new RummyEngine(data.gameId);
        break;
      case GameType.SevenSix:
        engine = new SevenSixEngine(data.gameId);
        break;
      default:
        throw new Error(`Unknown game type: ${data.gameType}`);
    }
    engine.restore(data.engineData);

    const aiPlayers = new Map<number, AIPlayer>();
    for (const ai of data.aiSeats) {
      aiPlayers.set(ai.seat, createAIPlayer(ai.difficulty, ai.displayName));
    }

    const playerSockets = new Map<number, string>();
    const socketSeats = new Map<string, number>();
    for (const mapping of data.playerMappings) {
      playerSockets.set(mapping.seat, mapping.socketId);
      socketSeats.set(mapping.socketId, mapping.seat);
    }

    const room: GameRoom = {
      engine,
      gameType: data.gameType,
      aiPlayers,
      playerSockets,
      socketSeats,
    };

    this.games.set(data.gameId, room);
    return room;
  }

  // ── Public API ──

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
      case GameType.Rummy:
        engine = new RummyEngine(gameId, config);
        break;
      case GameType.SevenSix:
        engine = new SevenSixEngine(gameId, config);
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

  async getRoom(gameId: string): Promise<GameRoom | undefined> {
    return this.ensureLoaded(gameId);
  }

  // Sync version for backward compatibility in socket handlers
  getRoomSync(gameId: string): GameRoom | undefined {
    return this.games.get(gameId);
  }

  async joinGame(
    gameId: string,
    socketId: string,
    displayName: string,
    userId?: string,
  ): Promise<number> {
    const room = await this.ensureLoaded(gameId);
    if (!room) throw new Error('Game not found');

    // Check if this socket is already in the game
    const existingSeat = room.socketSeats.get(socketId);
    if (existingSeat !== undefined) return existingSeat;

    // Check if this user is already in the game (reconnecting with new socket)
    if (userId) {
      for (const [seat] of room.playerSockets) {
        const state = room.engine.getState();
        if (state.players[seat].userId === userId) {
          const oldSid = room.playerSockets.get(seat);
          if (oldSid) room.socketSeats.delete(oldSid);
          room.playerSockets.set(seat, socketId);
          room.socketSeats.set(socketId, seat);
          await this.persist(gameId);
          return seat;
        }
      }
    }

    // Find first seat not occupied by a human
    const maxSeats = room.engine.getState().config.maxPlayers;
    let seat = -1;
    for (let i = 0; i < maxSeats; i++) {
      if (!room.playerSockets.has(i)) {
        seat = i;
        break;
      }
    }
    if (seat === -1) throw new Error('Game is full');

    room.engine.setPlayer(seat, userId ?? null, displayName, false);
    room.playerSockets.set(seat, socketId);
    room.socketSeats.set(socketId, seat);

    await this.persist(gameId);
    return seat;
  }

  async fillWithAI(gameId: string, difficulty: AIDifficulty): Promise<void> {
    const room = await this.ensureLoaded(gameId);
    if (!room) throw new Error('Game not found');

    const botNames = ['Dealer Danny', 'Lucky Lucy', 'Card Shark Sally', 'Steady Steve', 'Professor Pip', 'The Oracle'];
    let botIdx = 0;
    const maxSeats = room.engine.getState().config.maxPlayers;

    for (let seat = 0; seat < maxSeats; seat++) {
      if (!room.playerSockets.has(seat)) {
        const name = botNames[botIdx++ % botNames.length];
        const ai = createAIPlayer(difficulty, name);
        room.aiPlayers.set(seat, ai);
        room.engine.setPlayer(seat, null, ai.displayName, true);
      }
    }

    await this.persist(gameId);
  }

  async startGame(gameId: string): Promise<void> {
    const room = await this.ensureLoaded(gameId);
    if (!room) throw new Error('Game not found');
    room.engine.startGame();
    await this.persist(gameId);
  }

  async playCard(gameId: string, seatIndex: number, card: Card): Promise<void> {
    const room = await this.ensureLoaded(gameId);
    if (!room) throw new Error('Game not found');
    room.engine.playCard(seatIndex, card);
    await this.persist(gameId);
  }

  async passCards(gameId: string, seatIndex: number, cards: Card[]): Promise<void> {
    const room = await this.ensureLoaded(gameId);
    if (!room) throw new Error('Game not found');
    if (!(room.engine instanceof HeartsEngine)) throw new Error('Not a Hearts game');
    room.engine.passCards(seatIndex, cards);
    await this.persist(gameId);
  }

  async placeBid(gameId: string, seatIndex: number, bid: number): Promise<void> {
    const room = await this.ensureLoaded(gameId);
    if (!room) throw new Error('Game not found');
    if (!(room.engine instanceof SpadesEngine)) throw new Error('Not a Spades game');
    room.engine.placeBid(seatIndex, bid);
    await this.persist(gameId);
  }

  async rummyDraw(gameId: string, seatIndex: number, source: 'stock' | 'discard'): Promise<void> {
    const room = await this.ensureLoaded(gameId);
    if (!room) throw new Error('Game not found');
    if (!(room.engine instanceof RummyEngine)) throw new Error('Not a Rummy game');
    room.engine.drawCard(seatIndex, source);
    await this.persist(gameId);
  }

  async rummyLayMeld(gameId: string, seatIndex: number, cards: Card[]): Promise<void> {
    const room = await this.ensureLoaded(gameId);
    if (!room) throw new Error('Game not found');
    if (!(room.engine instanceof RummyEngine)) throw new Error('Not a Rummy game');
    room.engine.layMeld(seatIndex, cards);
    await this.persist(gameId);
  }

  async rummyDiscard(gameId: string, seatIndex: number, card: Card): Promise<void> {
    const room = await this.ensureLoaded(gameId);
    if (!room) throw new Error('Game not found');
    if (!(room.engine instanceof RummyEngine)) throw new Error('Not a Rummy game');
    room.engine.discardCard(seatIndex, card);
    await this.persist(gameId);
  }

  async sevenSixPlaceBid(gameId: string, seatIndex: number, bid: number): Promise<void> {
    const room = await this.ensureLoaded(gameId);
    if (!room) throw new Error('Game not found');
    if (!(room.engine instanceof SevenSixEngine)) throw new Error('Not a Seven-Six game');
    room.engine.placeBid(seatIndex, bid);
    await this.persist(gameId);
  }

  async callTrump(gameId: string, seatIndex: number, suit: Suit | 'pass'): Promise<void> {
    const room = await this.ensureLoaded(gameId);
    if (!room) throw new Error('Game not found');
    if (!(room.engine instanceof EuchreEngine)) throw new Error('Not a Euchre game');
    room.engine.callTrump(seatIndex, suit);
    await this.persist(gameId);
  }

  async getVisibleState(gameId: string, seatIndex: number): Promise<VisibleGameState> {
    const room = await this.ensureLoaded(gameId);
    if (!room) throw new Error('Game not found');
    return room.engine.getVisibleState(seatIndex);
  }

  async getPhase(gameId: string): Promise<GamePhase> {
    const room = await this.ensureLoaded(gameId);
    if (!room) throw new Error('Game not found');
    return room.engine.getState().phase;
  }

  async getCurrentSeat(gameId: string): Promise<number> {
    const room = await this.ensureLoaded(gameId);
    if (!room) throw new Error('Game not found');
    return room.engine.getState().currentPlayerSeat;
  }

  async getSeatForSocket(gameId: string, socketId: string): Promise<number | undefined> {
    const room = await this.ensureLoaded(gameId);
    if (!room) return undefined;
    return room.socketSeats.get(socketId);
  }

  handlePlayerDisconnect(gameId: string, socketId: string): number {
    const room = this.games.get(gameId);
    if (!room) return -1;
    const seat = room.socketSeats.get(socketId);
    if (seat === undefined) return -1;
    room.engine.getState().players[seat].isConnected = false;
    this.persist(gameId).catch(() => {});
    return seat;
  }

  async replaceWithAI(gameId: string, seatIndex: number): Promise<void> {
    const room = await this.ensureLoaded(gameId);
    if (!room) return;

    const player = room.engine.getState().players[seatIndex];
    const ai = createAIPlayer(AIDifficulty.Intermediate, player.displayName + ' (AI)');
    room.aiPlayers.set(seatIndex, ai);
    room.engine.setPlayer(seatIndex, null, ai.displayName, true);

    const oldSocketId = room.playerSockets.get(seatIndex);
    if (oldSocketId) room.socketSeats.delete(oldSocketId);
    room.playerSockets.delete(seatIndex);

    await this.persist(gameId);
  }

  findGameBySocket(socketId: string): { gameId: string; seat: number } | null {
    for (const [gameId, room] of this.games) {
      const seat = room.socketSeats.get(socketId);
      if (seat !== undefined) return { gameId, seat };
    }
    return null;
  }

  getConnectedHumanCount(gameId: string): number {
    const room = this.games.get(gameId);
    if (!room) return 0;
    return room.playerSockets.size;
  }

  /** Execute AI turns with persistence after each action. */
  async executeAITurns(
    gameId: string,
    onCardPlayed?: (seatIndex: number, card: Card) => void,
  ): Promise<void> {
    const room = await this.ensureLoaded(gameId);
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
      await this.persist(gameId);
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
      await this.persist(gameId);
      return;
    }

    // ── Seven-Six: AI bidding ──
    if (state.phase === GamePhase.Bidding && room.engine instanceof SevenSixEngine) {
      let currentSeat = state.currentPlayerSeat;
      let ai = room.aiPlayers.get(currentSeat);

      while (ai && room.engine.getState().phase === GamePhase.Bidding) {
        const ssEngine = room.engine as SevenSixEngine;
        const hand = ssEngine.getState().players[currentSeat].hand;
        const trumpSuit = ssEngine.getState().trumpSuit!;
        const legalBids = ssEngine.getLegalBids(currentSeat);
        const bid = sevenSixBid(hand, trumpSuit, legalBids);
        await this.delay(500);
        ssEngine.placeBid(currentSeat, bid);

        const newState = ssEngine.getState();
        if (newState.phase !== GamePhase.Bidding) break;
        currentSeat = newState.currentPlayerSeat;
        ai = room.aiPlayers.get(currentSeat);
      }
      await this.persist(gameId);
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
          if (shouldCallTrump(hand, turnedUp.suit)) {
            room.engine.callTrump(currentSeat, turnedUp.suit);
          } else {
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
      await this.persist(gameId);
      return;
    }

    // ── Rummy: AI draw/meld/discard ──
    if (state.phase === GamePhase.Playing && room.engine instanceof RummyEngine) {
      let currentSeat = state.currentPlayerSeat;
      let ai = room.aiPlayers.get(currentSeat);

      while (ai && room.engine.getState().phase === GamePhase.Playing) {
        const rummyEngine = room.engine as RummyEngine;
        const visibleState = rummyEngine.getVisibleState(currentSeat);

        // Draw
        if (rummyEngine.getRummyPhase() === 'draw') {
          const source = chooseDrawSource(visibleState);
          await this.delay(800);
          rummyEngine.drawCard(currentSeat, source);
          await this.persist(gameId);
        }

        // Check if round ended (shouldn't happen after draw, but just in case)
        if (rummyEngine.getState().phase !== GamePhase.Playing) break;

        // Lay melds
        const hand = rummyEngine.getState().players[currentSeat].hand;
        const melds = findMelds(hand);
        for (const meld of melds) {
          try {
            await this.delay(500);
            rummyEngine.layMeld(currentSeat, meld);
            await this.persist(gameId);
            if (rummyEngine.getState().phase !== GamePhase.Playing) break;
          } catch {
            // Meld may fail if cards overlap between melds — skip
          }
        }

        if (rummyEngine.getState().phase !== GamePhase.Playing) break;

        // Discard (if hand is not empty — could be empty if last meld cleared it)
        if (rummyEngine.getState().players[currentSeat].hand.length > 0) {
          const updatedState = rummyEngine.getVisibleState(currentSeat);
          const discard = ai.chooseCard(updatedState);
          await this.delay(1000);
          rummyEngine.discardCard(currentSeat, discard);
          await this.persist(gameId);
        }

        if (rummyEngine.getState().phase !== GamePhase.Playing) break;

        currentSeat = rummyEngine.getState().currentPlayerSeat;
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

      await this.delay(1500 + Math.random() * 1000);
      room.engine.playCard(currentSeat, card);
      await this.persist(gameId);

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

  async removeGame(gameId: string): Promise<void> {
    this.games.delete(gameId);
    await this.store.remove(gameId);
  }
}
