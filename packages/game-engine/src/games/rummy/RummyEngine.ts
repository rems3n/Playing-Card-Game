import {
  type Card,
  type GameConfig,
  type GameState,
  type PlayerState,
  type TrickResult,
  type VisibleGameState,
  type VisiblePlayerState,
  GamePhase,
  GameEventType,
  GameType,
  Rank,
} from '@card-game/shared-types';
import { GameEngine } from '../../core/GameEngine.js';
import { StateMachine, type PhaseTransition } from '../../core/StateMachine.js';
import { cardInArray, removeCard, sortCards } from '../../core/Card.js';
import { createStandardDeck, shuffleDeck } from '../../core/Deck.js';

const DEFAULT_TARGET = 100;

function cardsPerPlayer(numPlayers: number): number {
  if (numPlayers <= 2) return 10;
  if (numPlayers <= 4) return 7;
  return 6;
}

function cardPoints(card: Card): number {
  if (card.rank >= Rank.Jack) return 10; // J, Q, K
  if (card.rank === Rank.Ace) return 1;
  return card.rank; // 2-10
}

export class RummyEngine extends GameEngine {
  private drawPile: Card[] = [];
  private discardPile: Card[] = [];
  private playerMelds: Card[][][] = [];
  private rummyPhase: 'draw' | 'discard' = 'draw';
  private numPlayers: number;

  constructor(gameId: string, config?: Partial<GameConfig>) {
    const maxPlayers = config?.maxPlayers ?? 4;
    super(gameId, {
      gameType: GameType.Rummy,
      maxPlayers,
      targetScore: config?.targetScore ?? DEFAULT_TARGET,
      ...config,
    });
    this.numPlayers = maxPlayers;
    this.playerMelds = Array.from({ length: maxPlayers }, () => []);
  }

  protected createInitialState(gameId: string, config: GameConfig): GameState {
    const players: PlayerState[] = [];
    for (let i = 0; i < config.maxPlayers; i++) {
      players.push({
        seatIndex: i,
        userId: null,
        displayName: `Player ${i + 1}`,
        hand: [],
        tricksWon: 0,
        score: 0,
        isAI: true,
        isConnected: true,
      });
    }

    return {
      gameId,
      gameType: GameType.Rummy,
      phase: GamePhase.Waiting,
      config,
      players,
      currentTrick: [],
      currentPlayerSeat: 0,
      leadSeat: 0,
      roundNumber: 0,
      trickNumber: 0,
      heartsBroken: false,
      scores: new Array(config.maxPlayers).fill(0),
      roundScores: new Array(config.maxPlayers).fill(0),
      drawPile: [],
      discardPile: [],
      melds: Array.from({ length: config.maxPlayers }, () => []),
      rummyPhase: 'draw',
    };
  }

  protected createStateMachine(): StateMachine {
    const transitions: PhaseTransition[] = [
      { from: GamePhase.Waiting, to: GamePhase.Dealing },
      { from: GamePhase.Dealing, to: GamePhase.Playing },
      { from: GamePhase.Playing, to: GamePhase.RoundScoring },
      { from: GamePhase.RoundScoring, to: GamePhase.Dealing },
      { from: GamePhase.RoundScoring, to: GamePhase.GameOver },
    ];
    return new StateMachine(GamePhase.Waiting, transitions);
  }

  // ── Setup ──

  setPlayer(seatIndex: number, userId: string | null, displayName: string, isAI: boolean): void {
    const player = this.state.players[seatIndex];
    player.userId = userId;
    player.displayName = displayName;
    player.isAI = isAI;
  }

  startGame(): void {
    this.deal();
  }

  deal(): void {
    this.setPhase(GamePhase.Dealing);
    this.state.roundScores = new Array(this.numPlayers).fill(0);

    const deck = shuffleDeck(createStandardDeck());
    const perPlayer = cardsPerPlayer(this.numPlayers);

    // Deal cards to each player
    let idx = 0;
    for (let i = 0; i < this.numPlayers; i++) {
      this.state.players[i].hand = sortCards(deck.slice(idx, idx + perPlayer));
      this.state.players[i].tricksWon = 0;
      idx += perPlayer;
    }

    // Remaining cards form the draw pile
    this.drawPile = deck.slice(idx);

    // Flip top card to start discard pile
    this.discardPile = [this.drawPile.pop()!];

    // Reset melds
    this.playerMelds = Array.from({ length: this.numPlayers }, () => []);

    // Sync to state
    this.syncRummyState();

    // Dealer rotates; player after dealer goes first
    const dealer = this.state.roundNumber % this.numPlayers;
    this.state.currentPlayerSeat = (dealer + 1) % this.numPlayers;
    this.state.leadSeat = this.state.currentPlayerSeat;
    this.rummyPhase = 'draw';

    this.addEvent(GameEventType.CardsDealt, undefined, {});
    this.setPhase(GamePhase.Playing);
  }

  // ── Rummy Actions ──

  drawCard(seatIndex: number, source: 'stock' | 'discard'): void {
    if (this.state.phase !== GamePhase.Playing) {
      throw new Error('Not in playing phase');
    }
    if (seatIndex !== this.state.currentPlayerSeat) {
      throw new Error('Not your turn');
    }
    if (this.rummyPhase !== 'draw') {
      throw new Error('Already drew this turn');
    }

    let card: Card;
    if (source === 'discard') {
      if (this.discardPile.length === 0) {
        throw new Error('Discard pile is empty');
      }
      card = this.discardPile.pop()!;
    } else {
      if (this.drawPile.length === 0) {
        this.reshuffleDiscardPile();
      }
      if (this.drawPile.length === 0) {
        throw new Error('No cards to draw');
      }
      card = this.drawPile.pop()!;
    }

    this.state.players[seatIndex].hand.push(card);
    this.state.players[seatIndex].hand = sortCards(this.state.players[seatIndex].hand);
    this.rummyPhase = 'discard';
    this.syncRummyState();
  }

  layMeld(seatIndex: number, cards: Card[]): void {
    if (this.state.phase !== GamePhase.Playing) {
      throw new Error('Not in playing phase');
    }
    if (seatIndex !== this.state.currentPlayerSeat) {
      throw new Error('Not your turn');
    }
    if (this.rummyPhase !== 'discard') {
      throw new Error('Must draw before laying melds');
    }
    if (cards.length < 3) {
      throw new Error('A meld must have at least 3 cards');
    }

    // Verify all cards are in hand
    const hand = this.state.players[seatIndex].hand;
    for (const card of cards) {
      if (!cardInArray(card, hand)) {
        throw new Error('Card not in hand');
      }
    }

    if (!this.isValidMeld(cards)) {
      throw new Error('Invalid meld — must be a set (same rank) or run (consecutive same suit)');
    }

    // Remove cards from hand
    let newHand = [...hand];
    for (const card of cards) {
      newHand = removeCard(card, newHand);
    }
    this.state.players[seatIndex].hand = newHand;

    // Add meld
    this.playerMelds[seatIndex].push(sortCards([...cards]));
    this.syncRummyState();

    // Check if player went out (hand empty — no discard needed)
    if (newHand.length === 0) {
      this.endRound();
    }
  }

  discardCard(seatIndex: number, card: Card): void {
    if (this.state.phase !== GamePhase.Playing) {
      throw new Error('Not in playing phase');
    }
    if (seatIndex !== this.state.currentPlayerSeat) {
      throw new Error('Not your turn');
    }
    if (this.rummyPhase !== 'discard') {
      throw new Error('Must draw before discarding');
    }

    const hand = this.state.players[seatIndex].hand;
    if (!cardInArray(card, hand)) {
      throw new Error('Card not in hand');
    }

    // Remove from hand, add to discard pile
    this.state.players[seatIndex].hand = removeCard(card, hand);
    this.discardPile.push(card);
    this.syncRummyState();

    // Check if player went out
    if (this.state.players[seatIndex].hand.length === 0) {
      this.endRound();
      return;
    }

    // Next player's turn
    this.state.currentPlayerSeat = (seatIndex + 1) % this.numPlayers;
    this.rummyPhase = 'draw';
    this.syncRummyState();
  }

  // ── Meld Validation ──

  isValidMeld(cards: Card[]): boolean {
    if (cards.length < 3) return false;
    return this.isValidSet(cards) || this.isValidRun(cards);
  }

  private isValidSet(cards: Card[]): boolean {
    if (cards.length < 3 || cards.length > 4) return false;
    const rank = cards[0].rank;
    if (!cards.every((c) => c.rank === rank)) return false;
    // All suits must be different
    const suits = new Set(cards.map((c) => c.suit));
    return suits.size === cards.length;
  }

  private isValidRun(cards: Card[]): boolean {
    if (cards.length < 3) return false;
    const suit = cards[0].suit;
    if (!cards.every((c) => c.suit === suit)) return false;

    // Sort by rank and check consecutive
    const ranks = cards.map((c) => c.rank).sort((a, b) => a - b);

    // Check for Ace-low run (A-2-3...)
    // Ace is rank 14, so check if we have Ace + low cards
    const hasAce = ranks.includes(Rank.Ace);
    if (hasAce && ranks[0] === Rank.Two) {
      // Try ace-low: replace Ace(14) with 1
      const lowRanks = ranks.map((r) => (r === Rank.Ace ? 1 : r)).sort((a, b) => a - b);
      let consecutive = true;
      for (let i = 1; i < lowRanks.length; i++) {
        if (lowRanks[i] !== lowRanks[i - 1] + 1) {
          consecutive = false;
          break;
        }
      }
      if (consecutive) return true;
    }

    // Standard consecutive check
    for (let i = 1; i < ranks.length; i++) {
      if (ranks[i] !== ranks[i - 1] + 1) return false;
    }
    return true;
  }

  // ── Helpers ──

  private reshuffleDiscardPile(): void {
    if (this.discardPile.length <= 1) return;
    const topCard = this.discardPile.pop()!;
    this.drawPile = shuffleDeck([...this.discardPile]);
    this.discardPile = [topCard];
  }

  private syncRummyState(): void {
    this.state.drawPile = this.drawPile;
    this.state.discardPile = this.discardPile;
    this.state.melds = this.playerMelds;
    this.state.rummyPhase = this.rummyPhase;
  }

  getRummyPhase(): 'draw' | 'discard' {
    return this.rummyPhase;
  }

  getDiscardTop(): Card | null {
    return this.discardPile.length > 0 ? this.discardPile[this.discardPile.length - 1] : null;
  }

  getMelds(): Card[][][] {
    return this.playerMelds;
  }

  // ── Abstract implementations ──

  // Not used for Rummy — override playCard to throw
  playCard(): void {
    throw new Error('Use drawCard/layMeld/discardCard for Rummy');
  }

  isLegalMove(seatIndex: number, card: Card): boolean {
    if (this.state.phase !== GamePhase.Playing) return false;
    if (seatIndex !== this.state.currentPlayerSeat) return false;
    if (this.rummyPhase !== 'discard') return false;
    return cardInArray(card, this.state.players[seatIndex].hand);
  }

  getLegalMoves(seatIndex: number): Card[] {
    if (this.state.phase !== GamePhase.Playing) return [];
    if (seatIndex !== this.state.currentPlayerSeat) return [];
    if (this.rummyPhase !== 'discard') return [];
    return [...this.state.players[seatIndex].hand];
  }

  resolveTrick(): TrickResult {
    // Never called for Rummy
    return { winningSeat: 0, cards: [], points: 0 };
  }

  calculateRoundScores(): number[] {
    // Deadwood scoring: count unmelded cards in each player's hand
    const scores = new Array(this.numPlayers).fill(0);
    for (let i = 0; i < this.numPlayers; i++) {
      for (const card of this.state.players[i].hand) {
        scores[i] += cardPoints(card);
      }
    }
    return scores;
  }

  isGameOver(): boolean {
    return this.state.scores.some((s) => s >= this.state.config.targetScore);
  }

  getWinnerSeat(): number {
    // Lowest score wins (like Hearts)
    let minScore = Infinity;
    let winner = 0;
    for (let i = 0; i < this.numPlayers; i++) {
      if (this.state.scores[i] < minScore) {
        minScore = this.state.scores[i];
        winner = i;
      }
    }
    return winner;
  }

  // ── Override getVisibleState for Rummy-specific fields ──

  override getVisibleState(seatIndex: number): VisibleGameState {
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
      currentTrick: [],
      currentPlayerSeat: this.state.currentPlayerSeat,
      leadSeat: this.state.leadSeat,
      roundNumber: this.state.roundNumber,
      trickNumber: 0,
      heartsBroken: false,
      scores: [...this.state.scores],
      roundScores: [...this.state.roundScores],
      myHand: [...this.state.players[seatIndex].hand],
      mySeat: seatIndex,
      legalMoves: this.getLegalMoves(seatIndex),
      // Rummy-specific
      drawPileCount: this.drawPile.length,
      discardTop: this.getDiscardTop(),
      melds: this.playerMelds.map((pm) => pm.map((m) => [...m])),
      rummyPhase: this.rummyPhase,
    };
  }

  // ── Serialization ──

  override serialize(): Record<string, unknown> {
    return {
      ...super.serialize(),
      drawPile: this.drawPile,
      discardPile: this.discardPile,
      playerMelds: this.playerMelds,
      rummyPhase: this.rummyPhase,
      numPlayers: this.numPlayers,
    };
  }

  override restore(data: Record<string, unknown>): void {
    super.restore(data);
    this.drawPile = (data.drawPile as Card[]) ?? [];
    this.discardPile = (data.discardPile as Card[]) ?? [];
    this.playerMelds = (data.playerMelds as Card[][][]) ?? [];
    this.rummyPhase = (data.rummyPhase as 'draw' | 'discard') ?? 'draw';
    this.numPlayers = (data.numPlayers as number) ?? this.state.config.maxPlayers;
  }
}
