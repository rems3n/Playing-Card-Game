import type { Card, VisibleGameState } from '@card-game/shared-types';
import { AIDifficulty, GameType, Suit, Rank } from '@card-game/shared-types';
import type { AIPlayer } from '../AIPlayer.js';
import { chooseFortyFivesBid, chooseFortyFivesCard, chooseFortyFivesTrump, DEFAULT_PLAYOUTS } from '../playout/fortyFives.js';
import { chooseSevenSixBid, chooseSevenSixCard } from '../playout/sevenSix.js';
import { chooseDiscard as rummyChooseDiscard } from '../games/RummyAI.js';

const SIMULATIONS = 200;
const ALL_SUITS = [Suit.Clubs, Suit.Diamonds, Suit.Hearts, Suit.Spades];

/**
 * Monte Carlo AI — Expert difficulty.
 * For each legal move, simulates random playouts of the remaining game
 * and picks the move with the best average outcome.
 */
export class MonteCarloStrategy implements AIPlayer {
  readonly difficulty = AIDifficulty.Expert;
  readonly displayName: string;
  /** Imagined deals per decision for the family games. */
  private readonly playouts: number;

  constructor(displayName: string, playouts = DEFAULT_PLAYOUTS) {
    this.displayName = displayName;
    this.playouts = playouts;
  }

  chooseCard(state: VisibleGameState): Card {
    const moves = state.legalMoves;
    if (moves.length <= 1) return moves[0];

    // The family games are played out to the end of the hand on the real
    // engine, with the ranking, reneging, trump and scoring the table uses.
    // The trick-at-a-time estimate below knows none of that.
    if (state.gameType === GameType.FortyFives)
      return chooseFortyFivesCard(state, this.playouts);
    if (state.gameType === GameType.SevenSix)
      return chooseSevenSixCard(state, this.playouts);
    // A Rummy discard is not a trick; the trick estimator below would throw
    // away the highest card every turn and never build a meld.
    if (state.gameType === GameType.Rummy) return rummyChooseDiscard(state);

    // For each legal move, run simulations
    const scores = new Map<string, { total: number; count: number }>();

    for (const move of moves) {
      const key = `${move.suit}${move.rank}`;
      scores.set(key, { total: 0, count: 0 });
    }

    for (let sim = 0; sim < SIMULATIONS; sim++) {
      // Randomly assign unknown cards to opponents
      const unknownCards = this.getUnknownCards(state);
      const shuffled = this.shuffle(unknownCards);

      for (const move of moves) {
        const key = `${move.suit}${move.rank}`;
        const outcome = this.simulatePlayout(state, move, shuffled);
        const entry = scores.get(key)!;
        entry.total += outcome;
        entry.count++;
      }
    }

    // Pick the move with the best average score
    let bestMove = moves[0];
    let bestAvg = -Infinity;

    // For Hearts: lower score is better (negate)
    const invert = state.gameType === GameType.Hearts ? -1 : 1;

    for (const move of moves) {
      const key = `${move.suit}${move.rank}`;
      const entry = scores.get(key)!;
      const avg = (entry.total / entry.count) * invert;
      if (avg > bestAvg) {
        bestAvg = avg;
        bestMove = move;
      }
    }

    return bestMove;
  }

  choosePassCards(state: VisibleGameState, count: number): Card[] {
    // Pass the highest-risk cards (hearts, high spades)
    const hand = [...state.myHand];
    hand.sort((a, b) => this.cardDanger(b) - this.cardDanger(a));
    return hand.slice(0, count);
  }

  chooseBid(state: VisibleGameState): number | 'pass' {
    if (state.gameType === GameType.SevenSix)
      return chooseSevenSixBid(state, this.playouts);
    if (state.gameType === GameType.FortyFives)
      return chooseFortyFivesBid(state, Math.max(12, Math.round(this.playouts / 2)));
    // Count strong cards as likely winners
    let winners = 0;
    for (const card of state.myHand) {
      if (card.rank >= Rank.Queen) winners++;
      if (card.suit === Suit.Spades && card.rank >= Rank.Ten) winners += 0.5;
    }
    return Math.max(1, Math.round(winners));
  }

  chooseTrump(state: VisibleGameState): Suit {
    return chooseFortyFivesTrump(state, Math.max(12, Math.round(this.playouts / 2)));
  }

  // ── Helpers ──

  private getUnknownCards(state: VisibleGameState): Card[] {
    // Cards not in my hand and not already played
    const known = new Set<string>();

    for (const card of state.myHand) {
      known.add(`${card.suit}${card.rank}`);
    }
    for (const { card } of state.currentTrick) {
      known.add(`${card.suit}${card.rank}`);
    }

    const allCards: Card[] = [];
    const minRank = Rank.Two;

    for (const suit of ALL_SUITS) {
      for (let rank = minRank; rank <= Rank.Ace; rank++) {
        const key = `${suit}${rank}`;
        if (!known.has(key)) {
          allCards.push({ suit, rank });
        }
      }
    }

    return allCards;
  }

  private simulatePlayout(
    state: VisibleGameState,
    myMove: Card,
    opponentCards: Card[],
  ): number {
    // Simplified simulation: estimate points from the current trick
    const trick = [...state.currentTrick, { seatIndex: state.mySeat, card: myMove }];

    if (state.gameType === GameType.Hearts) {
      return this.simulateHeartsTrick(trick, state);
    }

    if (state.gameType === GameType.Spades) {
      return this.simulateSpadesTrick(trick, state);
    }

    // Default: prefer winning tricks
    return this.simulateGenericTrick(trick, state);
  }

  private simulateHeartsTrick(
    trick: Array<{ seatIndex: number; card: Card }>,
    state: VisibleGameState,
  ): number {
    // Count points in trick
    let points = 0;
    for (const { card } of trick) {
      if (card.suit === Suit.Hearts) points++;
      if (card.suit === Suit.Spades && card.rank === Rank.Queen) points += 13;
    }

    // Would I win this trick?
    if (trick.length >= 2) {
      const leadSuit = trick[0].card.suit;
      let winnerIdx = 0;
      for (let i = 1; i < trick.length; i++) {
        if (trick[i].card.suit === leadSuit && trick[i].card.rank > trick[winnerIdx].card.rank) {
          winnerIdx = i;
        }
      }
      const iWin = trick[winnerIdx].seatIndex === state.mySeat;
      return iWin ? -points : 0; // Negative because we don't want points in Hearts
    }

    return -points;
  }

  private simulateSpadesTrick(
    trick: Array<{ seatIndex: number; card: Card }>,
    state: VisibleGameState,
  ): number {
    if (trick.length < 2) return 0;

    const leadSuit = trick[0].card.suit;
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
    }

    const iWin = trick[winnerIdx].seatIndex === state.mySeat;
    const partnerWins = trick[winnerIdx].seatIndex === (state.mySeat + 2) % 4;

    return iWin ? 1 : partnerWins ? 0.5 : -0.5;
  }

  private simulateGenericTrick(
    trick: Array<{ seatIndex: number; card: Card }>,
    state: VisibleGameState,
  ): number {
    if (trick.length < 2) return 0;
    const leadSuit = trick[0].card.suit;
    let winnerIdx = 0;
    for (let i = 1; i < trick.length; i++) {
      if (trick[i].card.suit === leadSuit && trick[i].card.rank > trick[winnerIdx].card.rank) {
        winnerIdx = i;
      }
    }
    return trick[winnerIdx].seatIndex === state.mySeat ? 1 : 0;
  }

  private cardDanger(card: Card): number {
    if (card.suit === Suit.Spades && card.rank === Rank.Queen) return 100;
    if (card.suit === Suit.Hearts) return 50 + card.rank;
    if (card.suit === Suit.Spades && card.rank >= Rank.King) return 40 + card.rank;
    return card.rank;
  }

  private shuffle<T>(arr: T[]): T[] {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }
}
