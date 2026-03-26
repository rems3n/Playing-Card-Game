import {
  type Card,
  type GameConfig,
  type GameState,
  type PlayedCard,
  type PlayerState,
  type TrickResult,
  GamePhase,
  GameEventType,
  GameType,
  PassDirection,
  Suit,
  Rank,
} from '@card-game/shared-types';
import { GameEngine } from '../../core/GameEngine.js';
import { StateMachine, type PhaseTransition } from '../../core/StateMachine.js';
import { cardEquals, cardInArray, removeCard, sortCards } from '../../core/Card.js';
import { createStandardDeck, shuffleDeck, dealCards } from '../../core/Deck.js';

const NUM_PLAYERS = 4;
const TARGET_SCORE = 100;
const QUEEN_OF_SPADES: Card = { suit: Suit.Spades, rank: Rank.Queen };
const TWO_OF_CLUBS: Card = { suit: Suit.Clubs, rank: Rank.Two };

const PASS_DIRECTIONS: PassDirection[] = [
  PassDirection.Left,
  PassDirection.Right,
  PassDirection.Across,
  PassDirection.Keep,
];

export class HeartsEngine extends GameEngine {
  private pendingPasses: Map<number, Card[]> = new Map();

  constructor(gameId: string, config?: Partial<GameConfig>) {
    super(gameId, {
      gameType: GameType.Hearts,
      maxPlayers: NUM_PLAYERS,
      targetScore: config?.targetScore ?? TARGET_SCORE,
      ...config,
    });
  }

  protected createInitialState(gameId: string, config: GameConfig): GameState {
    const players: PlayerState[] = [];
    for (let i = 0; i < NUM_PLAYERS; i++) {
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
      gameType: GameType.Hearts,
      phase: GamePhase.Waiting,
      config,
      players,
      currentTrick: [],
      currentPlayerSeat: 0,
      leadSeat: 0,
      roundNumber: 0,
      trickNumber: 0,
      heartsBroken: false,
      passDirection: PassDirection.Left,
      scores: [0, 0, 0, 0],
      roundScores: [0, 0, 0, 0],
    };
  }

  protected createStateMachine(): StateMachine {
    const transitions: PhaseTransition[] = [
      { from: GamePhase.Waiting, to: GamePhase.Dealing },
      { from: GamePhase.Dealing, to: GamePhase.Passing },
      { from: GamePhase.Dealing, to: GamePhase.Playing }, // "keep" round
      { from: GamePhase.Passing, to: GamePhase.Playing },
      { from: GamePhase.Playing, to: GamePhase.TrickResolution },
      { from: GamePhase.TrickResolution, to: GamePhase.Playing },
      { from: GamePhase.TrickResolution, to: GamePhase.RoundScoring },
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
    this.state.heartsBroken = false;
    this.state.roundScores = [0, 0, 0, 0];

    const deck = shuffleDeck(createStandardDeck());
    const hands = dealCards(deck, NUM_PLAYERS);

    for (let i = 0; i < NUM_PLAYERS; i++) {
      this.state.players[i].hand = sortCards(hands[i]);
      this.state.players[i].tricksWon = 0;
    }

    // Determine pass direction
    const dirIdx = this.state.roundNumber % PASS_DIRECTIONS.length;
    this.state.passDirection = PASS_DIRECTIONS[dirIdx];

    this.addEvent(GameEventType.CardsDealt, undefined, {
      passDirection: this.state.passDirection,
    });

    if (this.state.passDirection === PassDirection.Keep) {
      // Skip passing, go straight to playing
      this.beginPlaying();
    } else {
      this.setPhase(GamePhase.Passing);
      this.pendingPasses.clear();
    }
  }

  // ── Passing ──

  passCards(seatIndex: number, cards: Card[]): void {
    if (this.state.phase !== GamePhase.Passing) {
      throw new Error('Not in passing phase');
    }
    if (cards.length !== 3) {
      throw new Error('Must pass exactly 3 cards');
    }

    const hand = this.state.players[seatIndex].hand;
    for (const card of cards) {
      if (!cardInArray(card, hand)) {
        throw new Error('Card not in hand');
      }
    }

    this.pendingPasses.set(seatIndex, cards);
    this.addEvent(GameEventType.PassCards, seatIndex, { cards });

    // Check if all players have passed
    if (this.pendingPasses.size === NUM_PLAYERS) {
      this.resolvePassing();
    }
  }

  hasPlayerPassed(seatIndex: number): boolean {
    return this.pendingPasses.has(seatIndex);
  }

  private resolvePassing(): void {
    const direction = this.state.passDirection!;

    for (let seat = 0; seat < NUM_PLAYERS; seat++) {
      const passedCards = this.pendingPasses.get(seat)!;
      const targetSeat = this.getPassTarget(seat, direction);

      // Remove passed cards from source
      let hand = this.state.players[seat].hand;
      for (const card of passedCards) {
        hand = removeCard(card, hand);
      }
      this.state.players[seat].hand = hand;

      // Add passed cards to target
      this.state.players[targetSeat].hand.push(...passedCards);
    }

    // Sort all hands after passing
    for (const player of this.state.players) {
      player.hand = sortCards(player.hand);
    }

    this.pendingPasses.clear();
    this.beginPlaying();
  }

  private getPassTarget(seat: number, direction: PassDirection): number {
    switch (direction) {
      case PassDirection.Left:
        return (seat + 1) % NUM_PLAYERS;
      case PassDirection.Right:
        return (seat + 3) % NUM_PLAYERS;
      case PassDirection.Across:
        return (seat + 2) % NUM_PLAYERS;
      default:
        return seat;
    }
  }

  private beginPlaying(): void {
    // Find player with 2 of clubs — they lead first trick
    const starter = this.state.players.findIndex((p) =>
      cardInArray(TWO_OF_CLUBS, p.hand),
    );
    this.state.currentPlayerSeat = starter;
    this.state.leadSeat = starter;
    this.state.trickNumber = 0;
    this.state.currentTrick = [];
    this.setPhase(GamePhase.Playing);
  }

  // ── Move validation ──

  isLegalMove(seatIndex: number, card: Card): boolean {
    const hand = this.state.players[seatIndex].hand;
    if (!cardInArray(card, hand)) return false;

    const trick = this.state.currentTrick;
    const isLeading = trick.length === 0;
    const isFirstTrick = this.state.trickNumber === 0;

    // First trick, first card: must play 2 of clubs
    if (isFirstTrick && isLeading) {
      return cardEquals(card, TWO_OF_CLUBS);
    }

    // Leading a trick
    if (isLeading) {
      // Can't lead hearts unless broken (or hand is all hearts)
      if (card.suit === Suit.Hearts && !this.state.heartsBroken) {
        return hand.every((c) => c.suit === Suit.Hearts);
      }
      return true;
    }

    // Following a trick — must follow suit if possible
    const leadSuit = trick[0].card.suit;
    const hasSuit = hand.some((c) => c.suit === leadSuit);

    if (hasSuit) {
      return card.suit === leadSuit;
    }

    // Can't play hearts or queen of spades on first trick (if have other cards)
    if (isFirstTrick) {
      const isPointCard =
        card.suit === Suit.Hearts || cardEquals(card, QUEEN_OF_SPADES);
      if (isPointCard) {
        // Check if player has any non-point cards
        const hasNonPoint = hand.some(
          (c) => c.suit !== Suit.Hearts && !cardEquals(c, QUEEN_OF_SPADES),
        );
        return !hasNonPoint;
      }
    }

    return true;
  }

  getLegalMoves(seatIndex: number): Card[] {
    if (this.state.phase !== GamePhase.Playing) return [];
    if (seatIndex !== this.state.currentPlayerSeat) return [];

    return this.state.players[seatIndex].hand.filter((card) =>
      this.isLegalMove(seatIndex, card),
    );
  }

  // ── Trick resolution ──

  resolveTrick(): TrickResult {
    const trick = this.state.currentTrick;
    const leadSuit = trick[0].card.suit;

    // Highest card of the lead suit wins
    let winnerIdx = 0;
    for (let i = 1; i < trick.length; i++) {
      if (
        trick[i].card.suit === leadSuit &&
        trick[i].card.rank > trick[winnerIdx].card.rank
      ) {
        winnerIdx = i;
      }
    }

    // Calculate points in trick
    let points = 0;
    for (const { card } of trick) {
      if (card.suit === Suit.Hearts) points++;
      if (cardEquals(card, QUEEN_OF_SPADES)) points += 13;
    }

    // Check if hearts broken
    if (!this.state.heartsBroken) {
      for (const { card } of trick) {
        if (card.suit === Suit.Hearts) {
          this.state.heartsBroken = true;
          break;
        }
      }
    }

    // Track points per seat for round scoring
    const winningSeat = trick[winnerIdx].seatIndex;
    this.state.roundScores[winningSeat] += points;

    return {
      winningSeat,
      cards: [...trick],
      points,
    };
  }

  // ── Scoring ──

  calculateRoundScores(): number[] {
    const scores = [...this.state.roundScores];

    // Check for shoot the moon (one player got all 26 points)
    const moonShooter = scores.findIndex((s) => s === 26);
    if (moonShooter !== -1) {
      // Moon shooter gets 0, everyone else gets 26
      for (let i = 0; i < NUM_PLAYERS; i++) {
        scores[i] = i === moonShooter ? 0 : 26;
      }
    }

    return scores;
  }

  isGameOver(): boolean {
    return this.state.scores.some((s) => s >= this.state.config.targetScore);
  }

  getWinnerSeat(): number {
    // In Hearts, lowest score wins
    let minScore = Infinity;
    let winner = 0;
    for (let i = 0; i < NUM_PLAYERS; i++) {
      if (this.state.scores[i] < minScore) {
        minScore = this.state.scores[i];
        winner = i;
      }
    }
    return winner;
  }

  // ── Override playCard to handle trick winner leading correctly ──

  playCard(seatIndex: number, card: Card): void {
    super.playCard(seatIndex, card);
  }
}
