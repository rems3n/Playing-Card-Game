import type { Card, VisibleGameState } from '@card-game/shared-types';
import { Rank } from '@card-game/shared-types';

/**
 * Find all valid melds in a hand.
 * Returns array of card groups that form valid sets or runs.
 * Greedy approach — finds the most obvious melds first.
 */
export function findMelds(hand: Card[]): Card[][] {
  const melds: Card[][] = [];
  const used = new Set<string>();
  const key = (c: Card) => `${c.suit}${c.rank}`;

  // Find sets (3+ cards of same rank)
  const byRank = new Map<number, Card[]>();
  for (const c of hand) {
    const arr = byRank.get(c.rank) ?? [];
    arr.push(c);
    byRank.set(c.rank, arr);
  }
  for (const [, cards] of byRank) {
    if (cards.length >= 3) {
      // Use all cards in the set (3 or 4)
      melds.push([...cards]);
      for (const c of cards) used.add(key(c));
    }
  }

  // Find runs (3+ consecutive same suit) from remaining cards
  const remaining = hand.filter((c) => !used.has(key(c)));
  const bySuit = new Map<string, Card[]>();
  for (const c of remaining) {
    const arr = bySuit.get(c.suit) ?? [];
    arr.push(c);
    bySuit.set(c.suit, arr);
  }

  for (const [, cards] of bySuit) {
    const sorted = [...cards].sort((a, b) => a.rank - b.rank);
    let run: Card[] = [sorted[0]];

    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i].rank === sorted[i - 1].rank + 1) {
        run.push(sorted[i]);
      } else {
        if (run.length >= 3) melds.push([...run]);
        run = [sorted[i]];
      }
    }
    if (run.length >= 3) melds.push([...run]);
  }

  return melds;
}

/** Choose which card to discard. Prefers high-value isolated cards. */
export function chooseDiscard(state: VisibleGameState): Card {
  const hand = state.myHand;
  if (hand.length === 1) return hand[0];

  // Score each card: higher = more desirable to discard
  // Isolated high-value cards are best to discard
  const scored = hand.map((card) => {
    let score = cardValue(card);

    // Cards that are part of potential melds are less desirable to discard
    const sameRank = hand.filter((c) => c.rank === card.rank).length;
    if (sameRank >= 2) score -= 15; // part of potential set

    const sameSuit = hand
      .filter((c) => c.suit === card.suit)
      .sort((a, b) => a.rank - b.rank);
    const idx = sameSuit.findIndex((c) => c.rank === card.rank);
    const hasNeighbor =
      (idx > 0 && sameSuit[idx - 1].rank === card.rank - 1) ||
      (idx < sameSuit.length - 1 && sameSuit[idx + 1].rank === card.rank + 1);
    if (hasNeighbor) score -= 10; // part of potential run

    return { card, score };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored[0].card;
}

/** Choose draw source. Prefer discard if it completes a potential meld. */
export function chooseDrawSource(state: VisibleGameState): 'stock' | 'discard' {
  const discardTop = state.discardTop;
  if (!discardTop) return 'stock';

  const hand = state.myHand;

  // Check if discard card would help form a set
  const sameRank = hand.filter((c) => c.rank === discardTop.rank).length;
  if (sameRank >= 2) return 'discard'; // would complete a set

  // Check if discard card extends a run
  const sameSuit = hand
    .filter((c) => c.suit === discardTop.suit)
    .sort((a, b) => a.rank - b.rank);
  for (const c of sameSuit) {
    if (Math.abs(c.rank - discardTop.rank) === 1) {
      // Adjacent — check if we have a pair for a run
      const neighbors = sameSuit.filter(
        (n) => Math.abs(n.rank - discardTop.rank) <= 2 && n.rank !== discardTop.rank,
      );
      if (neighbors.length >= 2) return 'discard';
    }
  }

  return 'stock';
}

function cardValue(card: Card): number {
  if (card.rank >= Rank.Jack) return 10;
  if (card.rank === Rank.Ace) return 1;
  return card.rank;
}
