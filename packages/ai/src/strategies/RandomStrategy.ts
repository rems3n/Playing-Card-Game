import type { Card, VisibleGameState } from '@card-game/shared-types';
import { AIDifficulty } from '@card-game/shared-types';
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

  chooseBid(_state: VisibleGameState): number {
    // Random bid between 1 and 4
    return Math.floor(Math.random() * 4) + 1;
  }
}
