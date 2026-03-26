import type { Card, VisibleGameState } from '@card-game/shared-types';
import { Suit, Rank } from '@card-game/shared-types';

const SAME_COLOR: Record<string, Suit> = {
  [Suit.Hearts]: Suit.Diamonds,
  [Suit.Diamonds]: Suit.Hearts,
  [Suit.Clubs]: Suit.Spades,
  [Suit.Spades]: Suit.Clubs,
};

function isTrump(card: Card, trumpSuit: Suit): boolean {
  if (card.suit === trumpSuit) return true;
  if (card.rank === Rank.Jack && card.suit === SAME_COLOR[trumpSuit]) return true;
  return false;
}

function trumpStrength(card: Card, trumpSuit: Suit): number {
  if (card.rank === Rank.Jack && card.suit === trumpSuit) return 100; // right bower
  if (card.rank === Rank.Jack && card.suit === SAME_COLOR[trumpSuit]) return 99; // left bower
  if (card.suit === trumpSuit) return 50 + card.rank;
  return card.rank;
}

/** Decide whether to call trump based on hand strength. */
export function shouldCallTrump(hand: Card[], suit: Suit): boolean {
  const trumpCount = hand.filter((c) => isTrump(c, suit)).length;
  const hasRightBower = hand.some((c) => c.rank === Rank.Jack && c.suit === suit);
  const hasLeftBower = hand.some((c) => c.rank === Rank.Jack && c.suit === SAME_COLOR[suit]);

  // Call with 3+ trump or 2 trump including a bower
  if (trumpCount >= 3) return true;
  if (trumpCount >= 2 && (hasRightBower || hasLeftBower)) return true;
  return false;
}

/** Choose best suit to call in round 2. */
export function chooseTrumpSuit(hand: Card[], excludeSuit: Suit): Suit | null {
  const suits = [Suit.Hearts, Suit.Diamonds, Suit.Clubs, Suit.Spades].filter(
    (s) => s !== excludeSuit,
  );

  let bestSuit: Suit | null = null;
  let bestScore = 0;

  for (const suit of suits) {
    const trumpCards = hand.filter((c) => isTrump(c, suit));
    const score = trumpCards.reduce((s, c) => s + trumpStrength(c, suit), 0);
    if (score > bestScore) {
      bestScore = score;
      bestSuit = suit;
    }
  }

  return bestScore > 100 ? bestSuit : null; // Only call if decent hand
}

/** Choose a card to play in Euchre. */
export function euchrePlayCard(
  state: VisibleGameState,
  moves: Card[],
): Card {
  if (moves.length === 1) return moves[0];

  const trump = state.trumpSuit;
  if (!trump) return moves[0];

  const trick = state.currentTrick;
  const isLeading = trick.length === 0;

  if (isLeading) {
    // Lead with highest trump if maker, otherwise lead off-suit
    const trumpCards = moves.filter((c) => isTrump(c, trump));
    const offSuit = moves.filter((c) => !isTrump(c, trump));

    if (offSuit.length > 0) {
      // Lead highest off-suit ace/king
      const high = offSuit.filter((c) => c.rank >= Rank.King);
      if (high.length > 0) return high[0];
      return offSuit.reduce((low, c) => c.rank < low.rank ? c : low);
    }
    // All trump — lead highest
    return trumpCards.reduce((h, c) => trumpStrength(c, trump) > trumpStrength(h, trump) ? c : h);
  }

  // Following
  const leadCard = trick[0].card;
  const getEffectiveSuit = (c: Card) =>
    c.rank === Rank.Jack && c.suit === SAME_COLOR[trump] ? trump : c.suit;

  const leadSuit = getEffectiveSuit(leadCard);
  const following = moves.filter((c) => getEffectiveSuit(c) === leadSuit);

  if (following.length > 0) {
    // Try to win
    return following.reduce((best, c) =>
      trumpStrength(c, trump) > trumpStrength(best, trump) ? c : best,
    );
  }

  // Void — trump if possible
  const trumpMoves = moves.filter((c) => isTrump(c, trump));
  if (trumpMoves.length > 0) {
    return trumpMoves.reduce((low, c) =>
      trumpStrength(c, trump) < trumpStrength(low, trump) ? c : low,
    );
  }

  // Dump lowest
  return moves.reduce((low, c) => c.rank < low.rank ? c : low);
}
