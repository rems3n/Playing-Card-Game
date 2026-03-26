import { type Card, Suit, Rank } from '@card-game/shared-types';
import { createCard } from './Card.js';

export function createStandardDeck(): Card[] {
  const cards: Card[] = [];
  for (const suit of [Suit.Clubs, Suit.Diamonds, Suit.Hearts, Suit.Spades]) {
    for (let rank = Rank.Two; rank <= Rank.Ace; rank++) {
      cards.push(createCard(suit, rank));
    }
  }
  return cards;
}

export function createEuchreDeck(): Card[] {
  const cards: Card[] = [];
  for (const suit of [Suit.Clubs, Suit.Diamonds, Suit.Hearts, Suit.Spades]) {
    for (let rank = Rank.Nine; rank <= Rank.Ace; rank++) {
      cards.push(createCard(suit, rank));
    }
  }
  return cards;
}

/** Fisher-Yates shuffle. Optionally pass a seed for deterministic shuffling. */
export function shuffleDeck(cards: Card[], seed?: number): Card[] {
  const shuffled = [...cards];
  let random: () => number;

  if (seed !== undefined) {
    // Simple seeded PRNG (mulberry32)
    let s = seed;
    random = () => {
      s |= 0;
      s = (s + 0x6d2b79f5) | 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  } else {
    random = Math.random;
  }

  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

export function dealCards(
  deck: Card[],
  numPlayers: number,
  cardsPerPlayer?: number,
): Card[][] {
  const perPlayer = cardsPerPlayer ?? Math.floor(deck.length / numPlayers);
  const hands: Card[][] = [];
  for (let i = 0; i < numPlayers; i++) {
    hands.push(deck.slice(i * perPlayer, (i + 1) * perPlayer));
  }
  return hands;
}
