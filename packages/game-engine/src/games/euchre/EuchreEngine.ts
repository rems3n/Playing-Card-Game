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
import { createEuchreDeck, shuffleDeck, dealCards } from '../../core/Deck.js';

const NUM_PLAYERS = 4;
const TARGET_SCORE = 10;

const SAME_COLOR_SUIT: Record<string, Suit> = {
  [Suit.Hearts]: Suit.Diamonds,
  [Suit.Diamonds]: Suit.Hearts,
  [Suit.Clubs]: Suit.Spades,
  [Suit.Spades]: Suit.Clubs,
};

/**
 * Euchre — 4-player partnership trick-taking game with trump.
 * 24-card deck (9-A), 5 cards per player.
 * Partnerships: Seat 0+2 vs Seat 1+3
 */
export class EuchreEngine extends GameEngine {
  private maker: number = 0; // seat that called trump
  private goingAlone: boolean = false;
  private alonePlayer: number = -1;
  private trumpCallRound: number = 0; // 1 = first round, 2 = second round
  private turnedUpCard: Card | null = null;

  constructor(gameId: string, config?: Partial<GameConfig>) {
    super(gameId, {
      gameType: GameType.Euchre,
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
      gameType: GameType.Euchre,
      phase: GamePhase.Waiting,
      config,
      players,
      currentTrick: [],
      currentPlayerSeat: 0,
      leadSeat: 0,
      roundNumber: 0,
      trickNumber: 0,
      heartsBroken: false,
      scores: [0, 0, 0, 0],
      roundScores: [0, 0, 0, 0],
      trumpSuit: undefined,
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
    this.state.roundScores = [0, 0, 0, 0];
    this.state.trumpSuit = undefined;
    this.state.bids = [null, null, null, null];
    this.goingAlone = false;
    this.alonePlayer = -1;
    this.trumpCallRound = 1;

    const deck = shuffleDeck(createEuchreDeck());
    const hands = dealCards(deck, NUM_PLAYERS, 5);

    for (let i = 0; i < NUM_PLAYERS; i++) {
      this.state.players[i].hand = sortCards(hands[i]);
      this.state.players[i].tricksWon = 0;
    }

    // Turn up a card (the 21st card, index 20)
    this.turnedUpCard = deck[20];

    const dealer = this.state.roundNumber % NUM_PLAYERS;
    this.state.currentPlayerSeat = (dealer + 1) % NUM_PLAYERS;

    this.addEvent(GameEventType.CardsDealt, undefined, {
      turnedUpCard: this.turnedUpCard,
    });
    this.setPhase(GamePhase.Bidding);
  }

  // ── Trump calling ──

  /**
   * Call trump or pass.
   * Round 1: players can order up the turned card's suit or pass.
   * Round 2: players can name any other suit or pass.
   * If all pass round 2, dealer is "stuck" (must call).
   */
  callTrump(seatIndex: number, suit: Suit | 'pass'): void {
    if (this.state.phase !== GamePhase.Bidding) {
      throw new Error('Not in bidding phase');
    }
    if (seatIndex !== this.state.currentPlayerSeat) {
      throw new Error('Not your turn');
    }

    const dealer = this.state.roundNumber % NUM_PLAYERS;

    if (suit === 'pass') {
      this.state.bids![seatIndex] = -1; // pass marker
      this.addEvent(GameEventType.BidPlaced, seatIndex, { bid: 'pass' });

      const nextSeat = (seatIndex + 1) % NUM_PLAYERS;

      if (this.trumpCallRound === 1 && nextSeat === (dealer + 1) % NUM_PLAYERS) {
        // Everyone passed round 1, start round 2
        this.trumpCallRound = 2;
        this.state.bids = [null, null, null, null];
        this.state.currentPlayerSeat = (dealer + 1) % NUM_PLAYERS;
      } else if (this.trumpCallRound === 2 && nextSeat === dealer) {
        // Dealer is stuck — must call (screw the dealer)
        // Force dealer to pick a suit that's not the turned-up card's suit
        this.state.currentPlayerSeat = dealer;
        // Dealer must call, handled by the next callTrump invocation
      } else {
        this.state.currentPlayerSeat = nextSeat;
      }
      return;
    }

    // Validate suit choice
    if (this.trumpCallRound === 1 && suit !== this.turnedUpCard!.suit) {
      throw new Error('In round 1, you can only order up the turned card suit or pass');
    }
    if (this.trumpCallRound === 2 && suit === this.turnedUpCard!.suit) {
      throw new Error('In round 2, you must name a different suit');
    }

    // Trump is called
    this.state.trumpSuit = suit;
    this.maker = seatIndex;
    this.addEvent(GameEventType.BidPlaced, seatIndex, { bid: suit });

    // In round 1, dealer picks up turned card and discards
    if (this.trumpCallRound === 1) {
      const dealerHand = this.state.players[dealer].hand;
      dealerHand.push(this.turnedUpCard!);
      // Auto-discard the lowest non-trump card
      const nonTrump = dealerHand.filter((c) => !this.isTrump(c));
      const discard = nonTrump.length > 0
        ? nonTrump.reduce((low, c) => this.getCardStrength(c) < this.getCardStrength(low) ? c : low)
        : dealerHand.reduce((low, c) => this.getCardStrength(c) < this.getCardStrength(low) ? c : low);

      const idx = dealerHand.findIndex((c) => cardEquals(c, discard));
      if (idx !== -1) dealerHand.splice(idx, 1);
      this.state.players[dealer].hand = sortCards(dealerHand);
    }

    this.beginPlaying();
  }

  /**
   * Declare going alone (partner sits out).
   * Must be called after callTrump, before play begins.
   */
  goAlone(seatIndex: number): void {
    if (seatIndex !== this.maker) {
      throw new Error('Only the maker can go alone');
    }
    this.goingAlone = true;
    this.alonePlayer = seatIndex;
  }

  private beginPlaying(): void {
    const dealer = this.state.roundNumber % NUM_PLAYERS;
    this.state.currentPlayerSeat = (dealer + 1) % NUM_PLAYERS;

    // Skip partner if going alone
    if (this.goingAlone && this.state.currentPlayerSeat === this.getPartner(this.alonePlayer)) {
      this.state.currentPlayerSeat = (this.state.currentPlayerSeat + 1) % NUM_PLAYERS;
    }

    this.state.leadSeat = this.state.currentPlayerSeat;
    this.state.trickNumber = 0;
    this.state.currentTrick = [];
    this.setPhase(GamePhase.Playing);
  }

  // ── Trump helpers ──

  private isTrump(card: Card): boolean {
    if (!this.state.trumpSuit) return false;
    if (card.suit === this.state.trumpSuit) return true;
    // Left bower: jack of same-color suit
    if (card.rank === Rank.Jack && card.suit === SAME_COLOR_SUIT[this.state.trumpSuit]) return true;
    return false;
  }

  private getCardStrength(card: Card): number {
    const trump = this.state.trumpSuit;
    if (!trump) return card.rank;

    // Right bower (jack of trump suit) = highest
    if (card.rank === Rank.Jack && card.suit === trump) return 100;
    // Left bower (jack of same-color suit) = second highest
    if (card.rank === Rank.Jack && card.suit === SAME_COLOR_SUIT[trump]) return 99;
    // Other trump cards
    if (card.suit === trump) return 50 + card.rank;
    // Non-trump
    return card.rank;
  }

  // ── Move validation ──

  isLegalMove(seatIndex: number, card: Card): boolean {
    const hand = this.state.players[seatIndex].hand;
    if (!cardInArray(card, hand)) return false;

    const trick = this.state.currentTrick;
    if (trick.length === 0) return true; // Can lead anything

    // Must follow the effective lead suit
    const leadCard = trick[0].card;
    const leadSuit = this.getEffectiveSuit(leadCard);
    const hasLeadSuit = hand.some((c) => this.getEffectiveSuit(c) === leadSuit);

    if (hasLeadSuit) {
      return this.getEffectiveSuit(card) === leadSuit;
    }

    return true; // Can play anything if void
  }

  private getEffectiveSuit(card: Card): Suit {
    // Left bower belongs to trump suit
    if (
      this.state.trumpSuit &&
      card.rank === Rank.Jack &&
      card.suit === SAME_COLOR_SUIT[this.state.trumpSuit]
    ) {
      return this.state.trumpSuit;
    }
    return card.suit;
  }

  getLegalMoves(seatIndex: number): Card[] {
    if (this.state.phase !== GamePhase.Playing) return [];
    if (seatIndex !== this.state.currentPlayerSeat) return [];

    return this.state.players[seatIndex].hand.filter((card) =>
      this.isLegalMove(seatIndex, card),
    );
  }

  // ── Override to skip partner when going alone ──

  protected advanceToNextPlayer(): void {
    let next = (this.state.currentPlayerSeat + 1) % NUM_PLAYERS;

    // Skip the alone player's partner
    if (this.goingAlone && next === this.getPartner(this.alonePlayer)) {
      next = (next + 1) % NUM_PLAYERS;
    }

    this.state.currentPlayerSeat = next;
  }

  protected getActivePlayers(): PlayerState[] {
    if (this.goingAlone) {
      const partnerSeat = this.getPartner(this.alonePlayer);
      return this.state.players.filter((p) => p.seatIndex !== partnerSeat);
    }
    return this.state.players;
  }

  // ── Trick resolution ──

  resolveTrick(): TrickResult {
    const trick = this.state.currentTrick;
    const leadSuit = this.getEffectiveSuit(trick[0].card);

    let winnerIdx = 0;
    let highestStrength = this.getCardStrength(trick[0].card);

    for (let i = 1; i < trick.length; i++) {
      const card = trick[i].card;
      const strength = this.getCardStrength(card);
      const effectiveSuit = this.getEffectiveSuit(card);

      const currentWinnerSuit = this.getEffectiveSuit(trick[winnerIdx].card);
      const currentIsTrump = currentWinnerSuit === this.state.trumpSuit;
      const challengerIsTrump = effectiveSuit === this.state.trumpSuit;

      if (challengerIsTrump && !currentIsTrump) {
        winnerIdx = i;
        highestStrength = strength;
      } else if (challengerIsTrump && currentIsTrump && strength > highestStrength) {
        winnerIdx = i;
        highestStrength = strength;
      } else if (!challengerIsTrump && !currentIsTrump && effectiveSuit === leadSuit && strength > highestStrength) {
        winnerIdx = i;
        highestStrength = strength;
      }
    }

    const winningSeat = trick[winnerIdx].seatIndex;
    this.state.players[winningSeat].tricksWon++;
    // Don't add to roundScores here — handled in completeTrick via parent

    return {
      winningSeat,
      cards: [...trick],
      points: 1,
    };
  }

  // ── Scoring ──

  calculateRoundScores(): number[] {
    const tricks = this.state.players.map((p) => p.tricksWon);
    const scores = [0, 0, 0, 0];

    // Team tricks
    const makerTeamTricks = tricks[this.maker] + tricks[this.getPartner(this.maker)];
    const defenderTeamTricks = 5 - makerTeamTricks;

    const makerTeam = [this.maker, this.getPartner(this.maker)];
    const defenderTeam = [0, 1, 2, 3].filter((s) => !makerTeam.includes(s));

    if (makerTeamTricks >= 3) {
      let points: number;
      if (makerTeamTricks === 5) {
        points = this.goingAlone ? 4 : 2; // March
      } else {
        points = 1;
      }
      for (const seat of makerTeam) scores[seat] = points;
    } else {
      // Euchred — defenders get 2 points
      for (const seat of defenderTeam) scores[seat] = 2;
    }

    return scores;
  }

  isGameOver(): boolean {
    return this.state.scores.some((s) => s >= this.state.config.targetScore);
  }

  getWinnerSeat(): number {
    // Team with higher score wins
    const team1 = this.state.scores[0]; // 0+2
    const team2 = this.state.scores[1]; // 1+3
    return team1 > team2 ? 0 : 1;
  }

  getPartner(seat: number): number {
    return (seat + 2) % NUM_PLAYERS;
  }

  getTurnedUpCard(): Card | null {
    return this.turnedUpCard;
  }

  getMaker(): number {
    return this.maker;
  }

  isGoingAlone(): boolean {
    return this.goingAlone;
  }

  override serialize(): Record<string, unknown> {
    return {
      ...super.serialize(),
      maker: this.maker,
      goingAlone: this.goingAlone,
      alonePlayer: this.alonePlayer,
      trumpCallRound: this.trumpCallRound,
      turnedUpCard: this.turnedUpCard,
    };
  }

  override restore(data: Record<string, unknown>): void {
    super.restore(data);
    this.maker = (data.maker as number) ?? 0;
    this.goingAlone = (data.goingAlone as boolean) ?? false;
    this.alonePlayer = (data.alonePlayer as number) ?? -1;
    this.trumpCallRound = (data.trumpCallRound as number) ?? 1;
    this.turnedUpCard = (data.turnedUpCard as Card) ?? null;
  }
}
