import {
  GameEventType,
  GamePhase,
  GameType,
  Rank,
  Suit,
  type Card,
  type GameConfig,
  type GameState,
  type PlayerState,
  type TrickResult,
  type VisibleGameState,
} from "@card-game/shared-types";
import { GameEngine } from "../../core/GameEngine.js";
import { StateMachine, type PhaseTransition } from "../../core/StateMachine.js";
import { cardInArray, sortCards } from "../../core/Card.js";
import { createStandardDeck, dealCards, shuffleDeck } from "../../core/Deck.js";
import {
  effectiveSuit,
  isTopTrump,
  isTrump,
  strength,
} from "./ranking.js";

/** A pass, stored in the bids array where a number would otherwise go. */
export const PASS = -1;
export const LEGAL_BIDS = [15, 20, 25, 30] as const;
export const HAND_SIZE = 5;
export const TRICK_POINTS = 5;
/** To whoever played the highest trump in the hand. */
export const HIGH_TRUMP_BONUS = 5;
export const TARGET_SCORE = 45;
/** Two, four or six people. Four and six play in two teams. */
export const SEATS = [2, 4, 6] as const;

/**
 * Auction Forty-Fives.
 *
 * Deal five each, bid in fives from 15 to 30, and the highest bidder names
 * trump and leads. Each trick is worth 5 and the highest trump played is worth
 * another 5, so 30 points are on the table. A side that bid and fell short
 * loses its bid instead of scoring. First to 45 wins.
 *
 * docs/FORTY-FIVES.md records the ranking and the variants this does not play.
 */
export class FortyFivesEngine extends GameEngine {
  private dealerSeat = 0;
  /** Seat that won the auction; -1 until the bidding ends. */
  private declarer = -1;
  private contract = 0;
  /** Seat that played the highest trump so far this hand, or -1. */
  private highTrumpSeat = -1;
  private highTrumpStrength = -1;

  constructor(gameId: string, config?: Partial<GameConfig>) {
    const seats = config?.maxPlayers ?? 4;
    if (!SEATS.includes(seats as (typeof SEATS)[number]))
      throw new Error("Forty-Fives is played by 2, 4 or 6 people");
    super(gameId, {
      ...config,
      gameType: GameType.FortyFives,
      // A caller may choose the target, never the table size validated above.
      maxPlayers: seats,
      targetScore: config?.targetScore ?? TARGET_SCORE,
    });
  }

  protected createInitialState(gameId: string, config: GameConfig): GameState {
    const players: PlayerState[] = [];
    for (let i = 0; i < config.maxPlayers; i++)
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
    return {
      gameId,
      gameType: GameType.FortyFives,
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
      bids: new Array(config.maxPlayers).fill(null),
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

  // ── Teams ──

  /** Seat 0,2,4 against 1,3,5. Two players are simply on their own. */
  teamOf(seatIndex: number): number {
    return this.state.players.length === 2 ? seatIndex : seatIndex % 2;
  }
  private teamSeats(team: number): number[] {
    return this.state.players
      .map((p) => p.seatIndex)
      .filter((seat) => this.teamOf(seat) === team);
  }
  private teams(): number[] {
    return this.state.players.length === 2 ? [0, 1] : [0, 1];
  }

  setPlayer(
    seatIndex: number,
    userId: string | null,
    displayName: string,
    isAI: boolean,
  ): void {
    const player = this.state.players[seatIndex];
    if (!player) throw new Error("No such seat");
    Object.assign(player, { userId, displayName, isAI });
  }

  startGame(): void {
    this.dealerSeat = Math.floor(Math.random() * this.state.players.length);
    this.deal();
  }

  // ── Dealing ──

  deal(): void {
    this.setPhase(GamePhase.Dealing);
    const seats = this.state.players.length;
    this.state.roundScores = new Array(seats).fill(0);
    this.state.bids = new Array(seats).fill(null);
    this.state.trumpSuit = undefined;
    this.declarer = -1;
    this.contract = 0;
    this.highTrumpSeat = -1;
    this.highTrumpStrength = -1;
    this.state.dealerSeat = this.dealerSeat;

    const hands = dealCards(shuffleDeck(createStandardDeck()), seats, HAND_SIZE);
    for (let i = 0; i < seats; i++) {
      this.state.players[i].hand = sortCards(hands[i]);
      this.state.players[i].tricksWon = 0;
    }
    this.state.currentPlayerSeat = (this.dealerSeat + 1) % seats;
    this.addEvent(GameEventType.CardsDealt, undefined, { handSize: HAND_SIZE });
    this.setPhase(GamePhase.Bidding);
  }

  // ── The auction ──

  private highestBid(): number {
    return (this.state.bids ?? []).reduce<number>(
      (best, bid) => (typeof bid === "number" && bid > best ? bid : best),
      0,
    );
  }
  private everyoneElsePassed(): boolean {
    return (this.state.bids ?? []).every(
      (bid, seat) => seat === this.dealerSeat || bid !== null,
    );
  }

  /**
   * What this seat may bid now. A bid must beat the standing one, except that
   * the dealer may hold it at the same level, and if it comes round to the
   * dealer with nobody having bid, the dealer must take the minimum.
   */
  getLegalBids(seatIndex: number): number[] {
    if (this.state.phase !== GamePhase.Bidding) return [];
    // Once the auction is won there is nothing left to bid; the winner names
    // trump next. Without this the dealer could keep bidding after holding.
    if (this.declarer >= 0) return [];
    if (seatIndex !== this.state.currentPlayerSeat) return [];
    const standing = this.highestBid();
    const isDealer = seatIndex === this.dealerSeat;
    const bids = LEGAL_BIDS.filter((bid) =>
      isDealer ? bid >= standing : bid > standing,
    );
    // The dealer cannot pass a hand out; everyone else may pass.
    const stuck = isDealer && standing === 0 && this.everyoneElsePassed();
    return stuck ? [...bids] : [...bids, PASS];
  }

  placeBid(seatIndex: number, bid: number): void {
    if (this.state.phase !== GamePhase.Bidding)
      throw new Error("Not in bidding phase");
    if (this.declarer >= 0) throw new Error("The auction is over");
    if (seatIndex !== this.state.currentPlayerSeat)
      throw new Error("Not your turn to bid");
    if (!Number.isInteger(bid) || !this.getLegalBids(seatIndex).includes(bid))
      throw new Error(
        `Bid ${LEGAL_BIDS.filter((b) => b > this.highestBid()).join(", ")} or pass`,
      );
    this.state.bids![seatIndex] = bid;
    this.addEvent(GameEventType.BidPlaced, seatIndex, { bid });

    const seats = this.state.players.length;
    // The auction closes once the dealer has spoken.
    if (seatIndex === this.dealerSeat) {
      this.closeAuction();
      return;
    }
    this.state.currentPlayerSeat = (seatIndex + 1) % seats;
  }

  private closeAuction(): void {
    const bids = this.state.bids!;
    let best = -1;
    for (let seat = 0; seat < bids.length; seat++) {
      const bid = bids[seat];
      if (typeof bid !== "number" || bid === PASS) continue;
      const standing = best < 0 ? -1 : (bids[best] as number);
      // Only the dealer may match a standing bid, so a tie means they held it.
      if (bid > standing || (bid === standing && seat === this.dealerSeat))
        best = seat;
    }
    this.declarer = best;
    this.contract = bids[best] as number;
    // The auction is over; the declarer names trump before anyone leads.
    this.state.currentPlayerSeat = this.declarer;
  }

  /** Suits the declarer may name. Only they may name one, and they must. */
  getLegalTrumpCalls(seatIndex: number): Array<Suit | "pass"> {
    if (this.state.phase !== GamePhase.Bidding) return [];
    if (this.declarer < 0 || seatIndex !== this.declarer) return [];
    if (this.state.trumpSuit) return [];
    return [Suit.Hearts, Suit.Diamonds, Suit.Clubs, Suit.Spades];
  }

  callTrump(seatIndex: number, suit: Suit | "pass"): void {
    if (this.state.phase !== GamePhase.Bidding)
      throw new Error("Not in bidding phase");
    if (this.declarer < 0) throw new Error("The auction is not over");
    if (seatIndex !== this.declarer)
      throw new Error("Only the winning bidder names trump");
    if (!this.getLegalTrumpCalls(seatIndex).includes(suit))
      throw new Error("Name a suit for trump");
    this.state.trumpSuit = suit as Suit;
    this.addEvent(GameEventType.BidPlaced, seatIndex, { trump: suit });
    this.beginPlaying();
  }

  private beginPlaying(): void {
    this.state.currentPlayerSeat = this.declarer;
    this.state.leadSeat = this.declarer;
    this.state.trickNumber = 0;
    this.state.currentTrick = [];
    this.setPhase(GamePhase.Playing);
  }

  // ── Move validation ──

  /**
   * Follow the led suit when you hold it, with the reneging exception: when a
   * trump is led you may hold back one of the top three trumps, but only if it
   * outranks the card led. Anything you may not hold back must be played.
   */
  isLegalMove(seatIndex: number, card: Card): boolean {
    const hand = this.state.players[seatIndex].hand;
    if (!cardInArray(card, hand)) return false;
    const trick = this.state.currentTrick;
    if (trick.length === 0) return true;
    const trump = this.state.trumpSuit;
    if (!trump) return true;

    const led = trick[0].card;
    const ledSuit = effectiveSuit(led, trump);
    const followers = hand.filter((c) => effectiveSuit(c, trump) === ledSuit);
    if (!followers.length) return true;
    if (effectiveSuit(card, trump) === ledSuit) return true;

    // Playing off-suit while holding the led suit is only allowed when every
    // card of that suit still in hand is a top trump the player may renege.
    if (ledSuit !== trump) return false;
    const ledStrength = strength(led, trump);
    return followers.every(
      (c) => isTopTrump(c, trump) && strength(c, trump) > ledStrength,
    );
  }

  getLegalMoves(seatIndex: number): Card[] {
    if (this.state.phase !== GamePhase.Playing) return [];
    if (seatIndex !== this.state.currentPlayerSeat) return [];
    return this.state.players[seatIndex].hand.filter((card) =>
      this.isLegalMove(seatIndex, card),
    );
  }

  // ── Tricks ──

  resolveTrick(): TrickResult {
    const trick = this.state.currentTrick;
    const trump = this.state.trumpSuit!;
    const ledSuit = effectiveSuit(trick[0].card, trump);
    let winner = trick[0];
    for (const play of trick) {
      const suit = effectiveSuit(play.card, trump);
      // Only trump and the led suit can win; trump always beats the led suit.
      if (suit !== trump && suit !== ledSuit) continue;
      const bestSuit = effectiveSuit(winner.card, trump);
      if (suit === trump && bestSuit !== trump) {
        winner = play;
        continue;
      }
      if (suit === bestSuit && strength(play.card, trump) > strength(winner.card, trump))
        winner = play;
    }
    // The highest trump played all hand is worth five at the end of it.
    for (const play of trick) {
      if (!isTrump(play.card, trump)) continue;
      const power = strength(play.card, trump);
      if (power > this.highTrumpStrength) {
        this.highTrumpStrength = power;
        this.highTrumpSeat = play.seatIndex;
      }
    }
    return { winningSeat: winner.seatIndex, cards: [...trick], points: TRICK_POINTS };
  }

  // ── Scoring ──

  calculateRoundScores(): number[] {
    const seats = this.state.players.length;
    const scores = new Array(seats).fill(0);
    const taken = new Array(2).fill(0);
    for (const player of this.state.players)
      taken[this.teamOf(player.seatIndex)] += player.tricksWon * TRICK_POINTS;
    if (this.highTrumpSeat >= 0)
      taken[this.teamOf(this.highTrumpSeat)] += HIGH_TRUMP_BONUS;

    const declaringTeam = this.teamOf(this.declarer);
    for (const team of this.teams()) {
      const made = taken[team];
      // A side that bid and fell short loses its bid instead of scoring.
      const points =
        team === declaringTeam && made < this.contract ? -this.contract : made;
      for (const seat of this.teamSeats(team)) scores[seat] = points;
    }
    return scores;
  }

  isGameOver(): boolean {
    return this.state.scores.some((score) => score >= this.state.config.targetScore);
  }

  getWinnerSeat(): number {
    const target = this.state.config.targetScore;
    const declaringTeam = this.declarer >= 0 ? this.teamOf(this.declarer) : 0;
    const reached = this.teams().filter((team) =>
      this.teamSeats(team).some((seat) => this.state.scores[seat] >= target),
    );
    // Both sides can cross together; the side that bid is counted out first.
    const team =
      reached.length > 1
        ? reached.includes(declaringTeam)
          ? declaringTeam
          : reached[0]
        : (reached[0] ??
          this.teams().reduce((best, t) =>
            this.state.scores[this.teamSeats(t)[0]] >
            this.state.scores[this.teamSeats(best)[0]]
              ? t
              : best,
          ));
    return this.teamSeats(team)[0];
  }

  startNextRound(): void {
    if (this.state.phase !== GamePhase.RoundScoring)
      throw new Error("The hand is not ready for another deal");
    this.dealerSeat = (this.dealerSeat + 1) % this.state.players.length;
    super.startNextRound();
  }

  // ── Visible state ──

  getVisibleState(seatIndex: number): VisibleGameState {
    const base = super.getVisibleState(seatIndex);
    return {
      ...base,
      dealerSeat: this.dealerSeat,
      handSize: HAND_SIZE,
      legalBids: this.getLegalBids(seatIndex),
      legalTrumpCalls: this.getLegalTrumpCalls(seatIndex),
      declarerSeat: this.declarer >= 0 ? this.declarer : undefined,
      contract: this.contract || undefined,
    };
  }

  // ── Persistence ──

  serialize(): Record<string, unknown> {
    return {
      ...super.serialize(),
      dealerSeat: this.dealerSeat,
      declarer: this.declarer,
      contract: this.contract,
      highTrumpSeat: this.highTrumpSeat,
      highTrumpStrength: this.highTrumpStrength,
    };
  }

  restore(data: Record<string, unknown>): void {
    super.restore(data);
    this.dealerSeat = (data.dealerSeat as number) ?? 0;
    this.declarer = (data.declarer as number) ?? -1;
    this.contract = (data.contract as number) ?? 0;
    this.highTrumpSeat = (data.highTrumpSeat as number) ?? -1;
    this.highTrumpStrength = (data.highTrumpStrength as number) ?? -1;
  }

  getDealerSeat(): number {
    return this.dealerSeat;
  }
  getDeclarerSeat(): number {
    return this.declarer;
  }
  getContract(): number {
    return this.contract;
  }
  getHighTrumpSeat(): number {
    return this.highTrumpSeat;
  }
}
