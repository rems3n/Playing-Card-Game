import { v4 as uuidv4 } from "uuid";
import {
  type Card,
  type CompletedTrick,
  GameEventType,
  type GameConfig,
  type VisibleGameState,
  AIDifficulty,
  GamePhase,
  GameType,
  Suit,
} from "@card-game/shared-types";
import {
  HeartsEngine,
  SpadesEngine,
  EuchreEngine,
  RummyEngine,
  SevenSixEngine,
} from "@card-game/game-engine";
import {
  createAIPlayer,
  type AIPlayer,
  shouldCallTrump,
  chooseTrumpSuit,
  findMelds,
  chooseDrawSource,
  sevenSixBid,
} from "@card-game/ai";
import {
  GameStateStore,
  type SerializedGame,
  type TrickReview,
} from "./GameStateStore.js";

type AnyEngine =
  HeartsEngine | SpadesEngine | EuchreEngine | RummyEngine | SevenSixEngine;

export const TRICK_REVIEW_MS = 3500;

export interface GameRoom {
  trickReview?: TrickReview;
  engine: AnyEngine;
  gameType: GameType;
  aiPlayers: Map<number, AIPlayer>;
  playerSockets: Map<number, string>;
  socketSeats: Map<string, number>;
  participants: Map<number, string>;
}

export class GameService {
  private games = new Map<string, GameRoom>(); // in-memory cache
  private aiRuns = new Map<string, Promise<void>>();
  private loads = new Map<string, Promise<GameRoom | undefined>>();

  constructor(
    private store: Pick<
      GameStateStore,
      "save" | "load" | "remove"
    > = new GameStateStore(),
    private delay: (ms: number) => Promise<void> = (ms) =>
      new Promise((resolve) => setTimeout(resolve, ms)),
  ) {}

  // ── Persistence helpers ──

  /** Save current game state to Redis. */
  private async persist(gameId: string): Promise<void> {
    const room = this.games.get(gameId);
    if (!room) return;

    const data: SerializedGame = {
      gameId,
      gameType: room.gameType,
      engineData: room.engine.serialize(),
      trickReview: room.trickReview,
      aiSeats: Array.from(room.aiPlayers.entries()).map(([seat, ai]) => ({
        seat,
        difficulty: ai.difficulty,
        displayName: ai.displayName,
      })),
      participants: [...room.participants],
      playerMappings: Array.from(room.playerSockets.entries()).map(
        ([seat, socketId]) => {
          const state = room.engine.getState();
          const player = state.players[seat];
          return {
            seat,
            socketId,
            userId: player?.userId ?? null,
            displayName: player?.displayName ?? "Player",
            participantId: room.participants.get(seat),
          };
        },
      ),
    };

    await this.store.save(gameId, data);
  }

  /** Load a game from Redis into memory if not already cached. */
  private async ensureLoaded(gameId: string): Promise<GameRoom | undefined> {
    // Check memory cache first
    const cached = this.games.get(gameId);
    if (cached) return cached;

    // Reconnecting clients must share one restored engine instance.
    const existingLoad = this.loads.get(gameId);
    if (existingLoad) return existingLoad;
    const pending = this.store
      .load(gameId)
      .then((data) => (data ? this.restoreFromData(data) : undefined));
    this.loads.set(gameId, pending);
    try {
      return await pending;
    } finally {
      this.loads.delete(gameId);
    }
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
      engine.getState().players[mapping.seat].isConnected = false;
      playerSockets.set(mapping.seat, mapping.socketId);
      socketSeats.set(mapping.socketId, mapping.seat);
    }

    const room: GameRoom = {
      engine,
      gameType: data.gameType,
      trickReview: data.trickReview,
      aiPlayers,
      playerSockets,
      socketSeats,
      participants: new Map(
        data.participants ??
          data.playerMappings.map((mapping) => [
            mapping.seat,
            mapping.participantId ?? `legacy:${mapping.socketId}`,
          ]),
      ),
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
      participants: new Map(),
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
    participantId = userId ?? socketId,
  ): Promise<number> {
    const room = await this.ensureLoaded(gameId);
    if (!room) throw new Error("Game not found");

    // Check if this socket is already in the game
    const existingSeat = room.socketSeats.get(socketId);
    if (existingSeat !== undefined) {
      room.engine.getState().players[existingSeat].isConnected = true;
      return existingSeat;
    }

    // Check if this user is already in the game (reconnecting with new socket)
    if (participantId) {
      for (const [seat] of room.playerSockets) {
        const state = room.engine.getState();
        if (room.participants.get(seat) === participantId) {
          const oldSid = room.playerSockets.get(seat);
          if (oldSid) room.socketSeats.delete(oldSid);
          room.playerSockets.set(seat, socketId);
          room.socketSeats.set(socketId, seat);
          state.players[seat].isConnected = true;
          await this.persist(gameId);
          return seat;
        }
      }
    }

    if (room.engine.getState().phase !== GamePhase.Waiting) {
      throw new Error(
        "This game has already started; only existing players can rejoin",
      );
    }

    // Find first seat not occupied by a human or bot.
    const maxSeats = room.engine.getState().config.maxPlayers;
    let seat = -1;
    for (let i = 0; i < maxSeats; i++) {
      if (!room.playerSockets.has(i) && !room.aiPlayers.has(i)) {
        seat = i;
        break;
      }
    }
    if (seat === -1) throw new Error("Game is full");

    room.engine.setPlayer(seat, userId ?? null, displayName, false);
    room.playerSockets.set(seat, socketId);
    room.socketSeats.set(socketId, seat);
    room.participants.set(seat, participantId);

    await this.persist(gameId);
    return seat;
  }

  async fillWithAI(gameId: string, difficulty: AIDifficulty): Promise<void> {
    const room = await this.ensureLoaded(gameId);
    if (!room) throw new Error("Game not found");

    const botNames = [
      "Dealer Danny",
      "Lucky Lucy",
      "Card Shark Sally",
      "Steady Steve",
      "Professor Pip",
      "The Oracle",
    ];
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
    if (!room) throw new Error("Game not found");
    room.engine.startGame();
    await this.persist(gameId);
  }

  private assertNotReviewing(room: GameRoom): void {
    if (room.trickReview && room.trickReview.until > Date.now())
      throw new Error(
        "Please wait for the completed trick to finish displaying.",
      );
  }

  async playCard(
    gameId: string,
    seatIndex: number,
    card: Card,
  ): Promise<CompletedTrick | undefined> {
    const room = await this.ensureLoaded(gameId);
    if (!room) throw new Error("Game not found");
    this.assertNotReviewing(room);
    // Engines resolve and deal synchronously. Preserve the final public table
    // before that transition, including the last card and round's trick totals.
    const views = room.engine
      .getState()
      .players.map((_, seat) =>
        structuredClone(room.engine.getVisibleState(seat)),
      );
    const eventCount = room.engine.getEvents().length;
    room.engine.playCard(seatIndex, card);
    const event = room.engine
      .getEvents()
      .slice(eventCount)
      .find((event) => event.type === GameEventType.TrickCompleted);
    let trick: CompletedTrick | undefined;
    if (event) {
      trick = {
        sequence: event.sequenceNum,
        roundNumber: views[0].roundNumber,
        trickNumber: views[0].trickNumber,
        winningSeat: event.seatIndex!,
        cards: structuredClone(event.payload.cards) as CompletedTrick["cards"],
        points: event.payload.points as number,
      };
      for (const view of views) {
        view.phase = GamePhase.TrickResolution;
        view.currentTrick = trick.cards;
        view.currentPlayerSeat = trick.winningSeat;
        view.legalMoves = [];
        view.lastTrick = trick;
        view.players[seatIndex].cardCount--;
        view.players[trick.winningSeat].tricksWon++;
        if (view.mySeat === seatIndex)
          view.myHand = view.myHand.filter(
            (c) => c.rank !== card.rank || c.suit !== card.suit,
          );
      }
      room.trickReview = { until: Date.now() + TRICK_REVIEW_MS, trick, views };
    }
    await this.persist(gameId);
    return trick;
  }

  /** The same hold applies to human/bot last cards, new rounds, and game over. */
  async waitForTrickReview(gameId: string): Promise<boolean> {
    const room = await this.ensureLoaded(gameId);
    const review = room?.trickReview;
    if (!room || !review || review.until <= Date.now()) return false;
    await this.delay(Math.max(0, review.until - Date.now()));
    if (this.games.get(gameId) !== room || room.trickReview !== review)
      return false;
    review.until = 0;
    await this.persist(gameId);
    return true;
  }

  async passCards(
    gameId: string,
    seatIndex: number,
    cards: Card[],
  ): Promise<void> {
    const room = await this.ensureLoaded(gameId);
    if (!room) throw new Error("Game not found");
    if (!(room.engine instanceof HeartsEngine))
      throw new Error("Not a Hearts game");
    room.engine.passCards(seatIndex, cards);
    await this.persist(gameId);
  }

  async placeBid(
    gameId: string,
    seatIndex: number,
    bid: number,
  ): Promise<void> {
    const room = await this.ensureLoaded(gameId);
    if (!room) throw new Error("Game not found");
    if (!(room.engine instanceof SpadesEngine))
      throw new Error("Not a Spades game");
    this.assertNotReviewing(room);
    room.engine.placeBid(seatIndex, bid);
    await this.persist(gameId);
  }

  async rummyDraw(
    gameId: string,
    seatIndex: number,
    source: "stock" | "discard",
  ): Promise<void> {
    const room = await this.ensureLoaded(gameId);
    if (!room) throw new Error("Game not found");
    if (!(room.engine instanceof RummyEngine))
      throw new Error("Not a Rummy game");
    room.engine.drawCard(seatIndex, source);
    await this.persist(gameId);
  }

  async rummyLayMeld(
    gameId: string,
    seatIndex: number,
    cards: Card[],
  ): Promise<void> {
    const room = await this.ensureLoaded(gameId);
    if (!room) throw new Error("Game not found");
    if (!(room.engine instanceof RummyEngine))
      throw new Error("Not a Rummy game");
    room.engine.layMeld(seatIndex, cards);
    await this.persist(gameId);
  }

  async rummyDiscard(
    gameId: string,
    seatIndex: number,
    card: Card,
  ): Promise<void> {
    const room = await this.ensureLoaded(gameId);
    if (!room) throw new Error("Game not found");
    if (!(room.engine instanceof RummyEngine))
      throw new Error("Not a Rummy game");
    room.engine.discardCard(seatIndex, card);
    await this.persist(gameId);
  }

  async sevenSixPlaceBid(
    gameId: string,
    seatIndex: number,
    bid: number,
  ): Promise<void> {
    const room = await this.ensureLoaded(gameId);
    if (!room) throw new Error("Game not found");
    if (!(room.engine instanceof SevenSixEngine))
      throw new Error("Not a Seven-Six game");
    this.assertNotReviewing(room);
    room.engine.placeBid(seatIndex, bid);
    await this.persist(gameId);
  }

  async callTrump(
    gameId: string,
    seatIndex: number,
    suit: Suit | "pass",
  ): Promise<void> {
    const room = await this.ensureLoaded(gameId);
    if (!room) throw new Error("Game not found");
    if (!(room.engine instanceof EuchreEngine))
      throw new Error("Not a Euchre game");
    this.assertNotReviewing(room);
    room.engine.callTrump(seatIndex, suit);
    await this.persist(gameId);
  }

  async getVisibleState(
    gameId: string,
    seatIndex: number,
  ): Promise<VisibleGameState> {
    const room = await this.ensureLoaded(gameId);
    if (!room) throw new Error("Game not found");
    const live = room.engine.getVisibleState(seatIndex);
    const review = room.trickReview;
    if (review && review.until > Date.now()) {
      const view = structuredClone(review.views[seatIndex]);
      view.players.forEach((player, seat) => {
        player.isConnected = live.players[seat].isConnected;
        player.isAI = live.players[seat].isAI;
        player.displayName = live.players[seat].displayName;
      });
      return view;
    }
    return { ...live, lastTrick: review?.trick };
  }

  async getPhase(gameId: string): Promise<GamePhase> {
    const room = await this.ensureLoaded(gameId);
    if (!room) throw new Error("Game not found");
    return room.engine.getState().phase;
  }

  async getCurrentSeat(gameId: string): Promise<number> {
    const room = await this.ensureLoaded(gameId);
    if (!room) throw new Error("Game not found");
    return room.engine.getState().currentPlayerSeat;
  }

  async getSeatForSocket(
    gameId: string,
    socketId: string,
  ): Promise<number | undefined> {
    const room = await this.ensureLoaded(gameId);
    if (!room) return undefined;
    const seat = room.socketSeats.get(socketId);
    return seat !== undefined &&
      room.engine.getState().players[seat].isConnected
      ? seat
      : undefined;
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
    if (!Number.isInteger(seatIndex) || !player)
      throw new Error("Invalid seat");
    if (player.isAI) return;
    if (player.isConnected) throw new Error("Player is still connected");
    const ai = createAIPlayer(
      AIDifficulty.Intermediate,
      player.displayName + " (AI)",
    );
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
    return [...room.playerSockets.keys()].filter(
      (seat) => room.engine.getState().players[seat].isConnected,
    ).length;
  }

  /** One scheduler per game, continuing across bidding and round boundaries. */
  executeAITurns(
    gameId: string,
    onCardPlayed?: (seatIndex: number, card: Card) => void | Promise<void>,
    onStateChanged?: () => void | Promise<void>,
  ): Promise<void> {
    const running = this.aiRuns.get(gameId);
    if (running) return running;
    const pending = this.runAIUntilHumanTurn(
      gameId,
      onCardPlayed,
      onStateChanged,
    ).finally(() => this.aiRuns.delete(gameId));
    this.aiRuns.set(gameId, pending);
    return pending;
  }

  private async runAIUntilHumanTurn(
    gameId: string,
    onCardPlayed?: (seatIndex: number, card: Card) => void | Promise<void>,
    onStateChanged?: () => void | Promise<void>,
  ): Promise<void> {
    const room = await this.ensureLoaded(gameId);
    if (!room) return;
    while (this.games.get(gameId) === room) {
      if (await this.waitForTrickReview(gameId)) await onStateChanged?.();
      if (this.games.get(gameId) !== room) return;
      const eventCount = room.engine.getEvents().length;
      await this.executeAIPhase(gameId, onCardPlayed, onStateChanged);
      if (
        room.engine.getEvents().length === eventCount ||
        room.engine.getState().phase === GamePhase.GameOver
      )
        return;
    }
  }

  private async pauseForAI(
    gameId: string,
    room: GameRoom,
    seat: number,
    ms: number,
  ): Promise<boolean> {
    const ai = room.aiPlayers.get(seat);
    const eventCount = room.engine.getEvents().length;
    await this.delay(ms);
    return (
      this.games.get(gameId) === room &&
      room.aiPlayers.get(seat) === ai &&
      room.engine.getEvents().length === eventCount
    );
  }

  private async executeAIPhase(
    gameId: string,
    onCardPlayed?: (seatIndex: number, card: Card) => void | Promise<void>,
    onStateChanged?: () => void | Promise<void>,
  ): Promise<void> {
    const room = await this.ensureLoaded(gameId);
    if (!room) return;

    const state = room.engine.getState();

    // ── Hearts: AI passing ──
    if (
      state.phase === GamePhase.Passing &&
      room.engine instanceof HeartsEngine
    ) {
      for (const [seat, ai] of room.aiPlayers) {
        if (!room.engine.hasPlayerPassed(seat)) {
          const visibleState = room.engine.getVisibleState(seat);
          const cards = ai.choosePassCards(visibleState, 3);
          if (!(await this.pauseForAI(gameId, room, seat, 300))) return;
          room.engine.passCards(seat, cards);
        }
      }
      await this.persist(gameId);
      return;
    }

    // ── Spades: AI bidding ──
    if (
      state.phase === GamePhase.Bidding &&
      room.engine instanceof SpadesEngine
    ) {
      let currentSeat = state.currentPlayerSeat;
      let ai = room.aiPlayers.get(currentSeat);

      while (ai && room.engine.getState().phase === GamePhase.Bidding) {
        const visibleState = room.engine.getVisibleState(currentSeat);
        const bid = ai.chooseBid(visibleState);
        if (!(await this.pauseForAI(gameId, room, currentSeat, 500))) return;
        room.engine.placeBid(currentSeat, typeof bid === "number" ? bid : 2);
        await this.persist(gameId);
        await onStateChanged?.();

        const newState = room.engine.getState();
        if (newState.phase !== GamePhase.Bidding) break;
        currentSeat = newState.currentPlayerSeat;
        ai = room.aiPlayers.get(currentSeat);
      }
      await this.persist(gameId);
      return;
    }

    // ── Seven-Six: AI bidding ──
    if (
      state.phase === GamePhase.Bidding &&
      room.engine instanceof SevenSixEngine
    ) {
      let currentSeat = state.currentPlayerSeat;
      let ai = room.aiPlayers.get(currentSeat);

      while (ai && room.engine.getState().phase === GamePhase.Bidding) {
        const ssEngine = room.engine as SevenSixEngine;
        const hand = ssEngine.getState().players[currentSeat].hand;
        const trumpSuit = ssEngine.getState().trumpSuit!;
        const legalBids = ssEngine.getLegalBids(currentSeat);
        const bid = sevenSixBid(hand, trumpSuit, legalBids);
        if (!(await this.pauseForAI(gameId, room, currentSeat, 500))) return;
        ssEngine.placeBid(currentSeat, bid);
        await this.persist(gameId);
        await onStateChanged?.();

        const newState = ssEngine.getState();
        if (newState.phase !== GamePhase.Bidding) break;
        currentSeat = newState.currentPlayerSeat;
        ai = room.aiPlayers.get(currentSeat);
      }
      await this.persist(gameId);
      return;
    }

    // ── Euchre: AI trump calling ──
    if (
      state.phase === GamePhase.Bidding &&
      room.engine instanceof EuchreEngine
    ) {
      let currentSeat = state.currentPlayerSeat;
      let ai = room.aiPlayers.get(currentSeat);

      while (ai && room.engine.getState().phase === GamePhase.Bidding) {
        const hand = room.engine.getState().players[currentSeat].hand;
        const turnedUp = room.engine.getTurnedUpCard();
        const legalCalls = room.engine.getLegalTrumpCalls(currentSeat);
        if (!turnedUp || legalCalls.length === 0) return;
        let call: Suit | "pass" = "pass";
        if (legalCalls.includes(turnedUp.suit)) {
          if (shouldCallTrump(hand, turnedUp.suit)) call = turnedUp.suit;
        } else {
          call = chooseTrumpSuit(hand, turnedUp.suit) ?? "pass";
        }
        // A stuck dealer must choose one of the three remaining suits.
        if (!legalCalls.includes(call)) call = legalCalls[0];
        if (!(await this.pauseForAI(gameId, room, currentSeat, 500))) return;
        room.engine.callTrump(currentSeat, call);
        await this.persist(gameId);
        await onStateChanged?.();

        const newState = room.engine.getState();
        if (newState.phase !== GamePhase.Bidding) break;
        currentSeat = newState.currentPlayerSeat;
        ai = room.aiPlayers.get(currentSeat);
      }
      await this.persist(gameId);
      return;
    }

    // ── Rummy: AI draw/meld/discard ──
    if (
      state.phase === GamePhase.Playing &&
      room.engine instanceof RummyEngine
    ) {
      let currentSeat = state.currentPlayerSeat;
      let ai = room.aiPlayers.get(currentSeat);

      while (ai && room.engine.getState().phase === GamePhase.Playing) {
        const rummyEngine = room.engine as RummyEngine;
        const visibleState = rummyEngine.getVisibleState(currentSeat);

        // Draw
        if (rummyEngine.getRummyPhase() === "draw") {
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

      if (
        !(await this.pauseForAI(
          gameId,
          room,
          currentSeat,
          1500 + Math.random() * 1000,
        ))
      )
        return;
      await this.playCard(gameId, currentSeat, card);
      await onCardPlayed?.(currentSeat, card);
      if (await this.waitForTrickReview(gameId)) await onStateChanged?.();
      if (this.games.get(gameId) !== room) return;

      const newState = room.engine.getState();
      if (newState.phase !== GamePhase.Playing) break;

      currentSeat = newState.currentPlayerSeat;
      ai = room.aiPlayers.get(currentSeat);
    }
  }

  async removeGame(gameId: string): Promise<void> {
    this.games.delete(gameId);
    await this.store.remove(gameId);
  }
}
