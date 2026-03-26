import { describe, it, expect } from 'vitest';
import { Suit, Rank } from '@card-game/shared-types';
import {
  createCard,
  cardEquals,
  cardInArray,
  removeCard,
  sortCards,
  cardToString,
} from '../core/Card.js';

describe('Card utilities', () => {
  const aceOfSpades = createCard(Suit.Spades, Rank.Ace);
  const queenOfHearts = createCard(Suit.Hearts, Rank.Queen);
  const twoOfClubs = createCard(Suit.Clubs, Rank.Two);

  it('creates cards with correct suit and rank', () => {
    expect(aceOfSpades).toEqual({ suit: Suit.Spades, rank: Rank.Ace });
  });

  it('compares cards for equality', () => {
    expect(cardEquals(aceOfSpades, { suit: Suit.Spades, rank: Rank.Ace })).toBe(true);
    expect(cardEquals(aceOfSpades, queenOfHearts)).toBe(false);
  });

  it('checks if card is in array', () => {
    const cards = [aceOfSpades, queenOfHearts, twoOfClubs];
    expect(cardInArray(aceOfSpades, cards)).toBe(true);
    expect(cardInArray(createCard(Suit.Diamonds, Rank.King), cards)).toBe(false);
  });

  it('removes a card from array', () => {
    const cards = [aceOfSpades, queenOfHearts, twoOfClubs];
    const result = removeCard(queenOfHearts, cards);
    expect(result).toHaveLength(2);
    expect(cardInArray(queenOfHearts, result)).toBe(false);
    expect(cardInArray(aceOfSpades, result)).toBe(true);
  });

  it('returns original array when removing non-existent card', () => {
    const cards = [aceOfSpades];
    const result = removeCard(queenOfHearts, cards);
    expect(result).toHaveLength(1);
  });

  it('sorts cards by suit then rank', () => {
    const cards = [queenOfHearts, twoOfClubs, aceOfSpades];
    const sorted = sortCards(cards);
    expect(sorted[0]).toEqual(twoOfClubs); // clubs first
    expect(sorted[1]).toEqual(aceOfSpades); // spades second
    expect(sorted[2]).toEqual(queenOfHearts); // hearts last
  });

  it('converts card to string', () => {
    expect(cardToString(aceOfSpades)).toBe('A♠');
    expect(cardToString(queenOfHearts)).toBe('Q♥');
    expect(cardToString(twoOfClubs)).toBe('2♣');
  });
});
