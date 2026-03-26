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
  Suit,
  Rank,
} from '@card-game/shared-types';
import { GameEngine } from '../../core/GameEngine.js';
import { StateMachine, type PhaseTransition } from '../../core/StateMachine.js';
import { cardEquals, cardInArray, sortCards } from '../../core/Card.js';
import { createStandardDeck, shuffleDeck, dealCards } from '../../core/Deck.js';

const NUM_PLAYERS = 4;
const TARGET_SCORE = 500;

/**
 * Spades — 4-player partnership trick-taking game.
 * Partnerships: Seat 0+2 vs Seat 1+3
 * Spades are always trump.
 */
export class SpadesEngine extends GameEngine {
  constructor(gameId: string, config?: Partial<GameConfig>) {
    super(gameId, {
      gameType: GameType.Spades,
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
      gameType: GameType.Spades,
      phase: GamePhase.Waiting,
      config,
      players,
      currentTrick: [],
      currentPlayerSeat: 0,
      leadSeat: 0,
      roundNumber: 0,
      trickNumber: 0,
      heartsBroken: false, // reused as "spadesBroken"
      scores: [0, 0, 0, 0],
      roundScores: [0, 0, 0, 0],
      bids: [null, null, null, null],
    };
  }

  protected createStateMachine(): StateMachine {
    const transitions: PhaseTransition[] = [
      { from: GamePhase.Waiting, to: GamePhase.Dealing },
      { from: GamePhase.Dealing, to: GamePhase.Bidding },
      { from: GamePhase.Bidding, to: GamePhase.Playing },
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
    this.state.heartsBroken = false; // spades broken
    this.state.roundScores = [0, 0, 0, 0];
    this.state.bids = [null, null, null, null];

    const deck = shuffleDeck(createStandardDeck());
    const hands = dealCards(deck, NUM_PLAYERS);

    for (let i = 0; i < NUM_PLAYERS; i++) {
      this.state.players[i].hand = sortCards(hands[i]);
      this.state.players[i].tricksWon = 0;
    }

    // Dealer rotates; player after dealer bids first
    const dealer = this.state.roundNumber % NUM_PLAYERS;
    this.state.currentPlayerSeat = (dealer + 1) % NUM_PLAYERS;

    this.addEvent(GameEventType.CardsDealt, undefined, {});
    this.setPhase(GamePhase.Bidding);
  }

  // ── Bidding ──

  placeBid(seatIndex: number, bid: number): void {
    if (this.state.phase !== GamePhase.Bidding) {
      throw new Error('Not in bidding phase');
    }
    if (seatIndex !== this.state.currentPlayerSeat) {
      throw new Error('Not your turn to bid');
    }
    if (bid < 0 || bid > 13) {
      throw new Error('Bid must be 0-13');
    }

    this.state.bids![seatIndex] = bid;
    this.addEvent(GameEventType.BidPlaced, seatIndex, { bid });

    // Check if all players have bid
    if (this.state.bids!.every((b) => b !== null)) {
      this.beginPlaying();
    } else {
      this.state.currentPlayerSeat = (seatIndex + 1) % NUM_PLAYERS;
    }
  }

  private beginPlaying(): void {
    // Player after dealer leads first trick
    const dealer = this.state.roundNumber % NUM_PLAYERS;
    this.state.currentPlayerSeat = (dealer + 1) % NUM_PLAYERS;
    this.state.leadSeat = this.state.currentPlayerSeat;
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

    if (isLeading) {
      // Can't lead spades unless broken or hand is all spades
      if (card.suit === Suit.Spades && !this.state.heartsBroken) {
        return hand.every((c) => c.suit === Suit.Spades);
      }
      return true;
    }

    // Must follow suit
    const leadSuit = trick[0].card.suit;
    const hasSuit = hand.some((c) => c.suit === leadSuit);

    if (hasSuit) {
      return card.suit === leadSuit;
    }

    // Can play any card (including spades to trump)
    return true;
  }

  getLegalMoves(seatIndex: number): Card[] {
    if (this.state.phase !== GamePhase.Playing) return [];
    if (seatIndex !== this.state.currentPlayerSeat) return [];

    return this.state.players[seatIndex].hand.filter((card) =>
      this.isLegalMove(seatIndex, card),
    );
  }

  // ── Override playCard to track spades broken ──

  playCard(seatIndex: number, card: Card): void {
    // Track if spades are being played (broken)
    if (card.suit === Suit.Spades && !this.state.heartsBroken) {
      // Will be set after the card is played
    }
    super.playCard(seatIndex, card);
  }

  // ── Trick resolution ──

  resolveTrick(): TrickResult {
    const trick = this.state.currentTrick;
    const leadSuit = trick[0].card.suit;

    // Check for spades broken
    if (!this.state.heartsBroken) {
      for (const { card } of trick) {
        if (card.suit === Suit.Spades) {
          this.state.heartsBroken = true;
          break;
        }
      }
    }

    // Highest spade wins, otherwise highest card of lead suit
    let winnerIdx = 0;
    for (let i = 1; i < trick.length; i++) {
      const current = trick[winnerIdx].card;
      const challenger = trick[i].card;

      if (challenger.suit === Suit.Spades && current.suit !== Suit.Spades) {
        winnerIdx = i;
      } else if (challenger.suit === Suit.Spades && current.suit === Suit.Spades) {
        if (challenger.rank > current.rank) winnerIdx = i;
      } else if (challenger.suit === leadSuit && current.suit === leadSuit) {
        if (challenger.rank > current.rank) winnerIdx = i;
      }
      // If challenger is not spades and not lead suit, they can't win
    }

    const winningSeat = trick[winnerIdx].seatIndex;
    this.state.roundScores[winningSeat]++;

    return {
      winningSeat,
      cards: [...trick],
      points: 1, // Each trick is worth 1
    };
  }

  // ── Scoring ──

  calculateRoundScores(): number[] {
    const bids = this.state.bids!;
    const tricks = this.state.players.map((p) => p.tricksWon);
    const scores = [0, 0, 0, 0];

    // Score partnerships: 0+2 and 1+3
    for (const [a, b] of [[0, 2], [1, 3]]) {
      const teamBid = (bids[a] ?? 0) + (bids[b] ?? 0);
      const teamTricks = tricks[a] + tricks[b];

      // Handle nil bids individually
      let nilBonus = 0;
      for (const seat of [a, b]) {
        if (bids[seat] === 0) {
          if (tricks[seat] === 0) {
            nilBonus += 100; // Successful nil
          } else {
            nilBonus -= 100; // Failed nil
          }
        }
      }

      // Team scoring (excluding nil bidders)
      const nonNilBid = (bids[a] === 0 ? 0 : bids[a]!) + (bids[b] === 0 ? 0 : bids[b]!);
      const nonNilTricks = (bids[a] === 0 ? 0 : tricks[a]) + (bids[b] === 0 ? 0 : tricks[b]);

      let teamScore = 0;
      if (nonNilBid > 0) {
        if (nonNilTricks >= nonNilBid) {
          teamScore = nonNilBid * 10;
          const overtricks = nonNilTricks - nonNilBid;
          teamScore += overtricks; // Bags
        } else {
          teamScore = -nonNilBid * 10; // Set
        }
      }

      teamScore += nilBonus;

      // Split evenly between partners
      scores[a] = teamScore;
      scores[b] = teamScore;
    }

    return scores;
  }

  isGameOver(): boolean {
    // Check if either team has reached target score
    const team1 = this.state.scores[0]; // seats 0+2 share score
    const team2 = this.state.scores[1]; // seats 1+3 share score
    return team1 >= this.state.config.targetScore || team2 >= this.state.config.targetScore;
  }

  getWinnerSeat(): number {
    // Return a seat from the winning team
    const team1 = this.state.scores[0];
    const team2 = this.state.scores[1];
    return team1 > team2 ? 0 : 1;
  }

  // ── Helpers ──

  getPartner(seat: number): number {
    return (seat + 2) % NUM_PLAYERS;
  }

  getBids(): (number | null)[] {
    return [...(this.state.bids ?? [])];
  }
}
