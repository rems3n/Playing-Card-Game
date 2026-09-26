import type { Card, AIDifficulty, Suit, VisibleGameState } from '@card-game/shared-types';

export interface AIPlayer {
  readonly difficulty: AIDifficulty;
  readonly displayName: string;

  /** Choose a card to play from the legal moves available. */
  chooseCard(state: VisibleGameState): Card;

  /** Choose cards to pass (Hearts). */
  choosePassCards(state: VisibleGameState, count: number): Card[];

  /**
   * Choose a bid (Spades, Seven-Six, Forty-Fives). Where the state carries
   * `legalBids` the answer is one of them; 'pass' where passing is offered.
   */
  chooseBid(state: VisibleGameState): number | 'pass';

  /** Name trump after winning the 45s auction, from `legalTrumpCalls`. */
  chooseTrump(state: VisibleGameState): Suit;
}
