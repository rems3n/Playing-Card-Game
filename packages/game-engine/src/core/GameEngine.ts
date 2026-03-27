import {
  type Card,
  type GameConfig,
  type GameEvent,
  type GameState,
  type PlayedCard,
  type PlayerState,
  type TrickResult,
  type VisibleGameState,
  type VisiblePlayerState,
  GamePhase,
  GameEventType,
} from '@card-game/shared-types';
import { StateMachine } from './StateMachine.js';

export abstract class GameEngine {
  protected state: GameState;
  protected events: GameEvent[] = [];
  protected stateMachine: StateMachine;
  private sequenceCounter = 0;

  constructor(gameId: string, config: GameConfig) {
    this.state = this.createInitialState(gameId, config);
    this.stateMachine = this.createStateMachine();
  }

  protected abstract createInitialState(
    gameId: string,
    config: GameConfig,
  ): GameState;
  protected abstract createStateMachine(): StateMachine;

  // ── Core game operations ──

  abstract deal(): void;
  abstract isLegalMove(seatIndex: number, card: Card): boolean;
  abstract getLegalMoves(seatIndex: number): Card[];
  abstract resolveTrick(): TrickResult;
  abstract calculateRoundScores(): number[];
  abstract isGameOver(): boolean;
  abstract getWinnerSeat(): number;

  // ── Common operations ──

  playCard(seatIndex: number, card: Card): void {
    if (this.state.phase !== GamePhase.Playing) {
      throw new Error(`Cannot play card during ${this.state.phase} phase`);
    }
    if (seatIndex !== this.state.currentPlayerSeat) {
      throw new Error(
        `Not seat ${seatIndex}'s turn (current: ${this.state.currentPlayerSeat})`,
      );
    }
    if (!this.isLegalMove(seatIndex, card)) {
      throw new Error(`Illegal move: cannot play that card`);
    }

    // Remove card from player's hand
    const player = this.state.players[seatIndex];
    player.hand = player.hand.filter(
      (c) => !(c.suit === card.suit && c.rank === card.rank),
    );

    // Add to current trick
    this.state.currentTrick.push({ seatIndex, card });

    this.addEvent(GameEventType.CardPlayed, seatIndex, { card });

    // Check if trick is complete
    if (this.state.currentTrick.length === this.getActivePlayers().length) {
      this.completeTrick();
    } else {
      this.advanceToNextPlayer();
    }
  }

  protected completeTrick(): void {
    this.setPhase(GamePhase.TrickResolution);
    const result = this.resolveTrick();

    this.state.players[result.winningSeat].tricksWon++;
    this.addEvent(GameEventType.TrickCompleted, result.winningSeat, {
      cards: result.cards,
      points: result.points,
    });

    // Check if round is over (all cards played)
    if (this.state.players[0].hand.length === 0) {
      this.endRound();
    } else {
      // Next trick — winner leads
      this.state.currentTrick = [];
      this.state.trickNumber++;
      this.state.leadSeat = result.winningSeat;
      this.state.currentPlayerSeat = result.winningSeat;
      this.setPhase(GamePhase.Playing);
    }
  }

  protected endRound(): void {
    this.setPhase(GamePhase.RoundScoring);
    const roundScores = this.calculateRoundScores();

    for (let i = 0; i < roundScores.length; i++) {
      this.state.scores[i] += roundScores[i];
      this.state.roundScores[i] = roundScores[i];
    }

    this.addEvent(GameEventType.RoundEnded, undefined, {
      roundScores,
      totalScores: [...this.state.scores],
    });

    if (this.isGameOver()) {
      this.setPhase(GamePhase.GameOver);
      this.addEvent(GameEventType.GameEnded, this.getWinnerSeat(), {
        finalScores: [...this.state.scores],
      });
    } else {
      // Start a new round
      this.state.roundNumber++;
      this.state.trickNumber = 0;
      this.state.currentTrick = [];
      for (const p of this.state.players) {
        p.tricksWon = 0;
      }
      this.deal();
    }
  }

  protected advanceToNextPlayer(): void {
    const activePlayers = this.getActivePlayers();
    const currentIdx = activePlayers.findIndex(
      (p) => p.seatIndex === this.state.currentPlayerSeat,
    );
    const nextIdx = (currentIdx + 1) % activePlayers.length;
    this.state.currentPlayerSeat = activePlayers[nextIdx].seatIndex;
  }

  protected getActivePlayers(): PlayerState[] {
    return this.state.players.filter((p) => p.seatIndex >= 0);
  }

  protected setPhase(phase: GamePhase): void {
    this.stateMachine.transitionTo(phase);
    this.state.phase = phase;
  }

  protected addEvent(
    type: GameEventType,
    seatIndex: number | undefined,
    payload: Record<string, unknown>,
  ): void {
    this.events.push({
      type,
      seatIndex,
      payload,
      timestamp: Date.now(),
      sequenceNum: this.sequenceCounter++,
    });
  }

  // ── Accessors ──

  getState(): GameState {
    return this.state;
  }

  getEvents(): GameEvent[] {
    return this.events;
  }

  /** Serialize engine state for storage (Redis). Override for extra fields. */
  serialize(): Record<string, unknown> {
    return {
      state: this.state,
      events: this.events,
      sequenceCounter: this.sequenceCounter,
    };
  }

  /** Restore engine state from serialized data. Override for extra fields. */
  restore(data: Record<string, unknown>): void {
    this.state = data.state as GameState;
    this.events = (data.events as GameEvent[]) ?? [];
    this.sequenceCounter = (data.sequenceCounter as number) ?? this.events.length;
    // Rebuild state machine to current phase
    this.stateMachine = this.createStateMachine();
    // Fast-forward state machine to current phase
    this.forcePhase(this.state.phase);
  }

  /** Force state machine to a specific phase (for restoration). */
  private forcePhase(phase: GamePhase): void {
    this.stateMachine = this.createStateMachine();
    this.stateMachine.forcePhase(phase);
  }

  getVisibleState(seatIndex: number): VisibleGameState {
    const players: VisiblePlayerState[] = this.state.players.map((p) => ({
      seatIndex: p.seatIndex,
      displayName: p.displayName,
      cardCount: p.hand.length,
      tricksWon: p.tricksWon,
      score: this.state.scores[p.seatIndex],
      isAI: p.isAI,
      isConnected: p.isConnected,
    }));

    return {
      gameId: this.state.gameId,
      gameType: this.state.gameType,
      phase: this.state.phase,
      config: this.state.config,
      players,
      currentTrick: this.state.currentTrick,
      currentPlayerSeat: this.state.currentPlayerSeat,
      leadSeat: this.state.leadSeat,
      roundNumber: this.state.roundNumber,
      trickNumber: this.state.trickNumber,
      heartsBroken: this.state.heartsBroken,
      passDirection: this.state.passDirection,
      scores: [...this.state.scores],
      roundScores: [...this.state.roundScores],
      trumpSuit: this.state.trumpSuit,
      bids: this.state.bids ? [...this.state.bids] : undefined,
      myHand: [...this.state.players[seatIndex].hand],
      mySeat: seatIndex,
      legalMoves: this.getLegalMoves(seatIndex),
    };
  }
}
