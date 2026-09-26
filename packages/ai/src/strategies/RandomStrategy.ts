import type { Card, VisibleGameState } from '@card-game/shared-types';
import { AIDifficulty, Suit } from '@card-game/shared-types';
import type { AIPlayer } from '../AIPlayer.js';

export class RandomStrategy implements AIPlayer {
  readonly difficulty = AIDifficulty.Beginner;
  readonly displayName: string;

  constructor(displayName: string) {
    this.displayName = displayName;
  }

  chooseCard(state: VisibleGameState): Card {
    const moves = state.legalMoves;
    if (moves.length === 0) {
      throw new Error('No legal moves available');
    }
    return moves[Math.floor(Math.random() * moves.length)];
  }

  choosePassCards(state: VisibleGameState, count: number): Card[] {
    // Randomly select cards to pass
    const hand = [...state.myHand];
    const selected: Card[] = [];
    for (let i = 0; i < count; i++) {
      const idx = Math.floor(Math.random() * hand.length);
      selected.push(hand.splice(idx, 1)[0]);
    }
    return selected;
  }

  chooseBid(state: VisibleGameState): number | 'pass' {
    // A beginner guesses, but only among the bids the table allows. In 45s
    // that includes passing (-1), which a guess lands on as readily as a bid.
    const legal = state.legalBids ?? [];
    if (legal.length) {
      const pick = legal[Math.floor(Math.random() * legal.length)];
      return pick < 0 ? 'pass' : pick;
    }
    return Math.floor(Math.random() * 4) + 1;
  }

  chooseTrump(state: VisibleGameState): Suit {
    const suits = (state.legalTrumpCalls ?? []).filter(
      (call): call is Suit => call !== 'pass',
    );
    return suits[Math.floor(Math.random() * suits.length)] ?? Suit.Hearts;
  }
}
