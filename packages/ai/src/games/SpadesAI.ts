import type { Card, VisibleGameState } from '@card-game/shared-types';
import { Suit, Rank } from '@card-game/shared-types';

/** Heuristic bid for Spades: count likely winners. */
export function spadesBid(hand: Card[]): number {
  let winners = 0;

  const spades = hand.filter((c) => c.suit === Suit.Spades);
  const nonSpades = hand.filter((c) => c.suit !== Suit.Spades);

  // Count high spades as winners
  for (const card of spades) {
    if (card.rank >= Rank.Queen) winners++;
  }
  // Count an extra winner if we have 4+ spades (length)
  if (spades.length >= 4) winners++;

  // Count aces of non-spade suits
  for (const card of nonSpades) {
    if (card.rank === Rank.Ace) winners++;
  }

  // Count kings with at least one other card in the suit
  const suitCounts: Record<string, number> = {};
  for (const card of nonSpades) {
    suitCounts[card.suit] = (suitCounts[card.suit] ?? 0) + 1;
  }
  for (const card of nonSpades) {
    if (card.rank === Rank.King && (suitCounts[card.suit] ?? 0) >= 2) {
      winners += 0.5;
    }
  }

  return Math.max(1, Math.round(winners));
}

/** Choose a card to play in Spades using heuristics. */
export function spadesPlayCard(state: VisibleGameState, moves: Card[]): Card {
  if (moves.length === 1) return moves[0];

  const trick = state.currentTrick;
  const isLeading = trick.length === 0;

  if (isLeading) {
    // Lead with a high non-spade to pull cards
    const nonSpades = moves.filter((c) => c.suit !== Suit.Spades);
    if (nonSpades.length > 0) {
      return nonSpades.reduce((best, c) => c.rank > best.rank ? c : best);
    }
    // All spades — lead lowest
    return moves.reduce((low, c) => c.rank < low.rank ? c : low);
  }

  const leadSuit = trick[0].card.suit;
  const following = moves.filter((c) => c.suit === leadSuit);

  if (following.length > 0) {
    // Can we win? Play highest to win the trick
    const highestPlayed = trick
      .filter((t) => t.card.suit === leadSuit)
      .reduce((h, t) => t.card.rank > h ? t.card.rank : h, 0);

    const canWin = following.filter((c) => c.rank > highestPlayed);
    if (canWin.length > 0) {
      return canWin.reduce((low, c) => c.rank < low.rank ? c : low); // Win cheaply
    }
    // Can't win — dump lowest
    return following.reduce((low, c) => c.rank < low.rank ? c : low);
  }

  // Void in lead suit — trump with lowest spade if beneficial
  const spades = moves.filter((c) => c.suit === Suit.Spades);
  const hasTrumpInTrick = trick.some((t) => t.card.suit === Suit.Spades);

  if (spades.length > 0 && !hasTrumpInTrick) {
    return spades.reduce((low, c) => c.rank < low.rank ? c : low); // Trump cheap
  }

  // Dump lowest card
  return moves.reduce((low, c) => c.rank < low.rank ? c : low);
}
