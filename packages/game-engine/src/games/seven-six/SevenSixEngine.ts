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
  Suit,
  Rank,
} from '@card-game/shared-types';
import { GameEngine } from '../../core/GameEngine.js';
import { StateMachine, type PhaseTransition } from '../../core/StateMachine.js';
import { cardEquals, cardInArray, sortCards } from '../../core/Card.js';
import { createStandardDeck, shuffleDeck, dealCards } from '../../core/Deck.js';

/** Suit hierarchy for tiebreaking: Spades > Hearts > Clubs > Diamonds */
const SUIT_RANK: Record<Suit, number> = {
  [Suit.Spades]: 4,
  [Suit.Hearts]: 3,
  [Suit.Clubs]: 2,
  [Suit.Diamonds]: 1,
};

/**
 * Seven-Six — A trick-taking bidding game for 2-7+ players.
 *
 * Rounds go: M, M-1, ..., 2, 1, 2, ..., M-1, M
 * where M = max hand size for the player count.
 *
 * Each round: deal, flip trump card, bid (clockwise from dealer),
 * play tricks, score (exact bid = bid+10, else 0).
 */
export class SevenSixEngine extends GameEngine {
  /** The face-up card determining trump suit */
  private trumpCard: Card | null = null;
  /** Whether trump has been played on a previous trick */
  private trumpBroken = false;
  /** Current dealer seat */
  private dealerSeat = 0;
  /** The round sequence of hand sizes */
  private roundSequence: number[] = [];

  constructor(gameId: string, config?: Partial<GameConfig>) {
    const numPlayers = config?.maxPlayers ?? 4;
    super(gameId, {
      gameType: GameType.SevenSix,
      maxPlayers: numPlayers,
      targetScore: 0, // not used — game ends after all rounds
      ...config,
    });
    this.roundSequence = SevenSixEngine.buildRoundSequence(numPlayers);
  }

  /** Build the symmetric round sequence: M, M-1, ..., 1, ..., M-1, M */
  static buildRoundSequence(numPlayers: number): number[] {
    const maxHand = Math.floor(52 / numPlayers);
    const seq: number[] = [];
    for (let h = maxHand; h >= 1; h--) seq.push(h);
    for (let h = 2; h <= maxHand; h++) seq.push(h);
    return seq;
  }

  /** Hand size for the current round. */
  private getHandSize(): number {
    return this.roundSequence[this.state.roundNumber] ?? 1;
  }

  protected createInitialState(gameId: string, config: GameConfig): GameState {
    const numPlayers = config.maxPlayers;
    const players: PlayerState[] = [];
    for (let i = 0; i < numPlayers; i++) {
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
      gameType: GameType.SevenSix,
      phase: GamePhase.Waiting,
      config,
      players,
      currentTrick: [],
      currentPlayerSeat: 0,
      leadSeat: 0,
      roundNumber: 0,
      trickNumber: 0,
      heartsBroken: false, // reused as trumpBroken
      scores: new Array(numPlayers).fill(0),
      roundScores: new Array(numPlayers).fill(0),
      bids: new Array(numPlayers).fill(null),
      dealerSeat: 0,
      handSize: 0,
      totalRounds: SevenSixEngine.buildRoundSequence(numPlayers).length,
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
    // Select first dealer by dealing one card to each player
    this.dealerSeat = this.selectFirstDealer();
    this.state.dealerSeat = this.dealerSeat;
    this.deal();
  }

  /** Deal one card to each player; highest card (rank, then suit) is first dealer. */
  private selectFirstDealer(): number {
    const deck = shuffleDeck(createStandardDeck());
    const numPlayers = this.state.players.length;
    let bestSeat = 0;
    let bestRank = 0;
    let bestSuitRank = 0;

    for (let i = 0; i < numPlayers; i++) {
      const card = deck[i];
      const sr = SUIT_RANK[card.suit];
      if (card.rank > bestRank || (card.rank === bestRank && sr > bestSuitRank)) {
        bestSeat = i;
        bestRank = card.rank;
        bestSuitRank = sr;
      }
    }

    return bestSeat;
  }

  deal(): void {
    this.setPhase(GamePhase.Dealing);

    const numPlayers = this.state.players.length;
    const handSize = this.getHandSize();

    this.trumpBroken = false;
    this.state.heartsBroken = false;
    this.state.roundScores = new Array(numPlayers).fill(0);
    this.state.bids = new Array(numPlayers).fill(null);
    this.state.handSize = handSize;
    this.state.dealerSeat = this.dealerSeat;

    const deck = shuffleDeck(createStandardDeck());
    const hands = dealCards(deck, numPlayers, handSize);

    for (let i = 0; i < numPlayers; i++) {
      this.state.players[i].hand = sortCards(hands[i]);
      this.state.players[i].tricksWon = 0;
    }

    // Flip the top card of the remaining deck as trump
    const dealtCount = numPlayers * handSize;
    this.trumpCard = deck[dealtCount];
    this.state.trumpSuit = this.trumpCard.suit;
    this.state.trumpCard = this.trumpCard;

    // First bidder is clockwise from dealer
    this.state.currentPlayerSeat = (this.dealerSeat + 1) % numPlayers;

    this.addEvent(GameEventType.CardsDealt, undefined, { handSize });
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

    const handSize = this.getHandSize();

    if (bid < 0 || bid > handSize) {
      throw new Error(`Bid must be 0-${handSize}`);
    }

    // Check dealer restriction: total bids cannot equal hand size
    if (this.isLastBidder(seatIndex)) {
      const currentTotal = this.state.bids!
        .filter((b): b is number => b !== null)
        .reduce((sum, b) => sum + b, 0);
      if (currentTotal + bid === handSize) {
        throw new Error(
          `Dealer cannot bid ${bid} — total bids would equal hand size (${handSize})`,
        );
      }
    }

    this.state.bids![seatIndex] = bid;
    this.addEvent(GameEventType.BidPlaced, seatIndex, { bid });

    // Check if all players have bid
    if (this.state.bids!.every((b) => b !== null)) {
      this.beginPlaying();
    } else {
      this.state.currentPlayerSeat =
        (seatIndex + 1) % this.state.players.length;
    }
  }

  /** Check if a seat is the last bidder (the dealer). */
  private isLastBidder(seatIndex: number): boolean {
    return seatIndex === this.dealerSeat;
  }

  /** Get legal bids for a seat (accounts for dealer restriction). */
  getLegalBids(seatIndex: number): number[] {
    const handSize = this.getHandSize();
    const bids: number[] = [];

    for (let b = 0; b <= handSize; b++) {
      if (this.isLastBidder(seatIndex)) {
        const currentTotal = this.state.bids!
          .filter((b): b is number => b !== null)
          .reduce((sum, v) => sum + v, 0);
        if (currentTotal + b === handSize) continue;
      }
      bids.push(b);
    }

    return bids;
  }

  private beginPlaying(): void {
    const numPlayers = this.state.players.length;
    // Player clockwise from dealer leads first trick
    this.state.currentPlayerSeat = (this.dealerSeat + 1) % numPlayers;
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
    const trumpSuit = this.state.trumpSuit!;

    if (isLeading) {
      // Cannot lead trump until broken, unless hand is all trump
      if (card.suit === trumpSuit && !this.trumpBroken) {
        return hand.every((c) => c.suit === trumpSuit);
      }
      return true;
    }

    // Following
    const leadSuit = trick[0].card.suit;
    const hasLeadSuit = hand.some((c) => c.suit === leadSuit);

    if (hasLeadSuit) {
      // Must follow suit — cannot play trump or off-suit while holding the led suit
      return card.suit === leadSuit;
    }

    // Void in lead suit — can play anything
    return true;
  }

  getLegalMoves(seatIndex: number): Card[] {
    if (this.state.phase !== GamePhase.Playing) return [];
    if (seatIndex !== this.state.currentPlayerSeat) return [];

    return this.state.players[seatIndex].hand.filter((card) =>
      this.isLegalMove(seatIndex, card),
    );
  }

  // ── Override playCard to track trump broken ──

  playCard(seatIndex: number, card: Card): void {
    super.playCard(seatIndex, card);
  }

  // ── Trick resolution ──

  resolveTrick(): TrickResult {
    const trick = this.state.currentTrick;
    const leadSuit = trick[0].card.suit;
    const trumpSuit = this.state.trumpSuit!;

    // Check if trump was broken this trick
    if (!this.trumpBroken) {
      for (const { card } of trick) {
        if (card.suit === trumpSuit) {
          this.trumpBroken = true;
          this.state.heartsBroken = true;
          break;
        }
      }
    }

    // Determine winner: highest trump if any, else highest of lead suit
    let winnerIdx = 0;
    for (let i = 1; i < trick.length; i++) {
      const current = trick[winnerIdx].card;
      const challenger = trick[i].card;

      if (challenger.suit === trumpSuit && current.suit !== trumpSuit) {
        winnerIdx = i;
      } else if (challenger.suit === trumpSuit && current.suit === trumpSuit) {
        if (challenger.rank > current.rank) winnerIdx = i;
      } else if (challenger.suit === leadSuit && current.suit === leadSuit) {
        if (challenger.rank > current.rank) winnerIdx = i;
      }
      // Off-suit non-trump can never win
    }

    const winningSeat = trick[winnerIdx].seatIndex;

    return {
      winningSeat,
      cards: [...trick],
      points: 1,
    };
  }

  // ── Scoring ──

  calculateRoundScores(): number[] {
    const numPlayers = this.state.players.length;
    const scores = new Array(numPlayers).fill(0);

    for (let i = 0; i < numPlayers; i++) {
      const bid = this.state.bids![i] ?? 0;
      const tricks = this.state.players[i].tricksWon;

      if (tricks === bid) {
        scores[i] = bid + 10; // exact bid met
      } else {
        scores[i] = 0; // missed
      }
    }

    return scores;
  }

  isGameOver(): boolean {
    return this.state.roundNumber >= this.roundSequence.length - 1;
  }

  getWinnerSeat(): number {
    let maxScore = -1;
    let winner = 0;
    for (let i = 0; i < this.state.scores.length; i++) {
      if (this.state.scores[i] > maxScore) {
        maxScore = this.state.scores[i];
        winner = i;
      }
    }
    return winner;
  }

  // ── Override endRound to rotate dealer ──

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
      // Rotate dealer clockwise
      this.dealerSeat =
        (this.dealerSeat + 1) % this.state.players.length;

      this.state.roundNumber++;
      this.state.trickNumber = 0;
      this.state.currentTrick = [];
      for (const p of this.state.players) {
        p.tricksWon = 0;
      }
      this.deal();
    }
  }

  // ── Visible state override for seven-six fields ──

  getVisibleState(seatIndex: number): VisibleGameState {
    const base = super.getVisibleState(seatIndex);
    return {
      ...base,
      trumpCard: this.trumpCard ?? undefined,
      dealerSeat: this.dealerSeat,
      handSize: this.getHandSize(),
      totalRounds: this.roundSequence.length,
    };
  }

  // ── Serialization ──

  serialize(): Record<string, unknown> {
    return {
      ...super.serialize(),
      trumpCard: this.trumpCard,
      trumpBroken: this.trumpBroken,
      dealerSeat: this.dealerSeat,
      roundSequence: this.roundSequence,
    };
  }

  restore(data: Record<string, unknown>): void {
    super.restore(data);
    this.trumpCard = (data.trumpCard as Card) ?? null;
    this.trumpBroken = (data.trumpBroken as boolean) ?? false;
    this.dealerSeat = (data.dealerSeat as number) ?? 0;
    this.roundSequence =
      (data.roundSequence as number[]) ??
      SevenSixEngine.buildRoundSequence(this.state.players.length);
  }

  // ── Helpers ──

  getBids(): (number | null)[] {
    return [...(this.state.bids ?? [])];
  }

  getDealerSeat(): number {
    return this.dealerSeat;
  }

  getTrumpCard(): Card | null {
    return this.trumpCard;
  }

  getRoundSequence(): number[] {
    return [...this.roundSequence];
  }
}
