import type { Card, AIDifficulty, VisibleGameState } from '@card-game/shared-types';

export interface AIPlayer {
  readonly difficulty: AIDifficulty;
  readonly displayName: string;

  /** Choose a card to play from the legal moves available. */
  chooseCard(state: VisibleGameState): Card;

  /** Choose cards to pass (Hearts). */
  choosePassCards(state: VisibleGameState, count: number): Card[];

  /** Choose a bid (Spades, Seven-Six, Forty-Fives). */
  chooseBid(state: VisibleGameState): number | 'pass';
}
