import type { Card, VisibleGameState } from '@card-game/shared-types';
import { Suit, Rank } from '@card-game/shared-types';

/**
 * Heuristic bid for Seven-Six.
 * Count likely winners based on trump count and high cards.
 * Returns a bid that respects the legal bids list.
 */
export function sevenSixBid(
  hand: Card[],
  trumpSuit: Suit,
  legalBids: number[],
): number {
  let winners = 0;

  const trumpCards = hand.filter((c) => c.suit === trumpSuit);
  const nonTrump = hand.filter((c) => c.suit !== trumpSuit);

  // Count high trump as likely winners
  for (const card of trumpCards) {
    if (card.rank >= Rank.Jack) winners++;
  }
  // Extra winner for trump length
  if (trumpCards.length >= 3) winners += 0.5;

  // Count aces of non-trump suits
  for (const card of nonTrump) {
    if (card.rank === Rank.Ace) winners++;
  }

  // Count kings with protection (2+ cards in suit)
  const suitCounts: Record<string, number> = {};
  for (const card of nonTrump) {
    suitCounts[card.suit] = (suitCounts[card.suit] ?? 0) + 1;
  }
  for (const card of nonTrump) {
    if (card.rank === Rank.King && (suitCounts[card.suit] ?? 0) >= 2) {
      winners += 0.5;
    }
  }

  const rawBid = Math.round(winners);
  // Clamp to hand size
  const clampedBid = Math.min(rawBid, hand.length);

  // Pick closest legal bid
  if (legalBids.includes(clampedBid)) return clampedBid;

  // Find nearest legal bid
  let best = legalBids[0];
  let bestDist = Math.abs(best - clampedBid);
  for (const b of legalBids) {
    const dist = Math.abs(b - clampedBid);
    if (dist < bestDist) {
      best = b;
      bestDist = dist;
    }
  }
  return best;
}

/** Choose a card to play in Seven-Six using heuristics. */
export function sevenSixPlayCard(
  state: VisibleGameState,
  moves: Card[],
): Card {
  if (moves.length === 1) return moves[0];

  const trick = state.currentTrick;
  const isLeading = trick.length === 0;
  const trumpSuit = state.trumpSuit!;
  const myBid = state.bids?.[state.mySeat] ?? 0;
  const myTricks = state.players[state.mySeat]?.tricksWon ?? 0;
  const needMore = myTricks < myBid;
  const atBid = myTricks === myBid;

  if (isLeading) {
    if (needMore) {
      // Lead high to try to win tricks
      const nonTrump = moves.filter((c) => c.suit !== trumpSuit);
      const candidates = nonTrump.length > 0 ? nonTrump : moves;
      return candidates.reduce((best, c) => (c.rank > best.rank ? c : best));
    }
    // At bid or over — lead low to avoid winning
    const nonTrump = moves.filter((c) => c.suit !== trumpSuit);
    const candidates = nonTrump.length > 0 ? nonTrump : moves;
    return candidates.reduce((low, c) => (c.rank < low.rank ? c : low));
  }

  // Following
  const leadSuit = trick[0].card.suit;
  const following = moves.filter((c) => c.suit === leadSuit);
  const trumpMoves = moves.filter((c) => c.suit === trumpSuit);

  if (needMore) {
    // Try to win
    if (following.length > 0) {
      const highestPlayed = trick
        .filter((t) => t.card.suit === leadSuit)
        .reduce((h, t) => (t.card.rank > h ? t.card.rank : h), 0);
      const canWin = following.filter((c) => c.rank > highestPlayed);
      if (canWin.length > 0) {
        return canWin.reduce((low, c) => (c.rank < low.rank ? c : low)); // Win cheaply
      }
    }
    // Trump if we can and no one else has trumped higher
    if (following.length === 0 || trumpMoves.length > 0) {
      const trumpPlayed = trick.filter((t) => t.card.suit === trumpSuit);
      const highestTrump = trumpPlayed.length > 0
        ? trumpPlayed.reduce((h, t) => (t.card.rank > h ? t.card.rank : h), 0)
        : 0;
      const winningTrumps = trumpMoves.filter((c) => c.rank > highestTrump);
      if (winningTrumps.length > 0) {
        return winningTrumps.reduce((low, c) => (c.rank < low.rank ? c : low));
      }
    }
  }

  if (atBid) {
    // Try to lose — play lowest cards
    if (following.length > 0) {
      return following.reduce((low, c) => (c.rank < low.rank ? c : low));
    }
    // Play lowest non-trump to avoid winning
    const nonTrump = moves.filter((c) => c.suit !== trumpSuit);
    if (nonTrump.length > 0) {
      return nonTrump.reduce((low, c) => (c.rank < low.rank ? c : low));
    }
  }

  // Default: play lowest available
  if (following.length > 0) {
    return following.reduce((low, c) => (c.rank < low.rank ? c : low));
  }
  return moves.reduce((low, c) => (c.rank < low.rank ? c : low));
}
