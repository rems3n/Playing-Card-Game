import type { Card, VisibleGameState } from '@card-game/shared-types';
import { AIDifficulty, Suit, Rank, GameType } from '@card-game/shared-types';
import type { AIPlayer } from '../AIPlayer.js';
import { spadesPlayCard, spadesBid } from '../games/SpadesAI.js';
import { euchrePlayCard, shouldCallTrump, chooseTrumpSuit } from '../games/EuchreAI.js';

export class HeuristicStrategy implements AIPlayer {
  readonly difficulty = AIDifficulty.Intermediate;
  readonly displayName: string;

  constructor(displayName: string) {
    this.displayName = displayName;
  }

  chooseCard(state: VisibleGameState): Card {
    const moves = state.legalMoves;
    if (moves.length === 1) return moves[0];

    switch (state.gameType) {
      case GameType.Hearts:
        return this.chooseHeartsCard(state, moves);
      case GameType.Spades:
        return spadesPlayCard(state, moves);
      case GameType.Euchre:
        return euchrePlayCard(state, moves);
      default:
        return moves.reduce((lowest, card) =>
          card.rank < lowest.rank ? card : lowest,
        );
    }
  }

  private chooseHeartsCard(state: VisibleGameState, moves: Card[]): Card {
    const isLeading = state.currentTrick.length === 0;

    if (isLeading) {
      const nonHearts = moves.filter((c) => c.suit !== Suit.Hearts);
      const candidates = nonHearts.length > 0 ? nonHearts : moves;
      return candidates.reduce((lowest, card) =>
        card.rank < lowest.rank ? card : lowest,
      );
    }

    const leadSuit = state.currentTrick[0].card.suit;
    const followingCards = moves.filter((c) => c.suit === leadSuit);

    if (followingCards.length > 0) {
      return followingCards.reduce((lowest, card) =>
        card.rank < lowest.rank ? card : lowest,
      );
    }

    // Can't follow — dump queen of spades or high hearts
    const qos = moves.find(
      (c) => c.suit === Suit.Spades && c.rank === Rank.Queen,
    );
    if (qos) return qos;

    const hearts = moves.filter((c) => c.suit === Suit.Hearts);
    if (hearts.length > 0) {
      return hearts.reduce((highest, card) =>
        card.rank > highest.rank ? card : highest,
      );
    }

    return moves.reduce((highest, card) =>
      card.rank > highest.rank ? card : highest,
    );
  }

  choosePassCards(state: VisibleGameState, count: number): Card[] {
    const hand = [...state.myHand];
    const dangerous = hand
      .filter(
        (c) =>
          c.suit === Suit.Hearts ||
          (c.suit === Suit.Spades && c.rank >= Rank.Queen),
      )
      .sort((a, b) => b.rank - a.rank);

    const selected: Card[] = [];
    for (const card of dangerous) {
      if (selected.length >= count) break;
      selected.push(card);
    }

    if (selected.length < count) {
      const remaining = hand
        .filter(
          (c) => !selected.some((s) => s.suit === c.suit && s.rank === c.rank),
        )
        .sort((a, b) => b.rank - a.rank);
      for (const card of remaining) {
        if (selected.length >= count) break;
        selected.push(card);
      }
    }

    return selected;
  }

  chooseBid(state: VisibleGameState): number | 'pass' {
    if (state.gameType === GameType.Spades) {
      return spadesBid(state.myHand);
    }
    // Euchre bidding is handled via callTrump, not this method
    return Math.max(1, Math.min(Math.floor(state.myHand.length / 3), 5));
  }
}
