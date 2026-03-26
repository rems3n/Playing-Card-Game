import { describe, it, expect } from 'vitest';
import { createStandardDeck, createEuchreDeck, shuffleDeck, dealCards } from '../core/Deck.js';

describe('Deck', () => {
  it('creates a standard 52-card deck', () => {
    const deck = createStandardDeck();
    expect(deck).toHaveLength(52);

    // Check no duplicates
    const strings = deck.map((c) => `${c.suit}${c.rank}`);
    expect(new Set(strings).size).toBe(52);
  });

  it('creates a euchre 24-card deck (9 through Ace)', () => {
    const deck = createEuchreDeck();
    expect(deck).toHaveLength(24);
    // All ranks should be >= 9
    expect(deck.every((c) => c.rank >= 9)).toBe(true);
  });

  it('shuffles deterministically with a seed', () => {
    const deck = createStandardDeck();
    const shuffled1 = shuffleDeck(deck, 42);
    const shuffled2 = shuffleDeck(deck, 42);
    expect(shuffled1).toEqual(shuffled2);
  });

  it('shuffles differently with different seeds', () => {
    const deck = createStandardDeck();
    const shuffled1 = shuffleDeck(deck, 42);
    const shuffled2 = shuffleDeck(deck, 99);
    expect(shuffled1).not.toEqual(shuffled2);
  });

  it('deals cards evenly to players', () => {
    const deck = createStandardDeck();
    const hands = dealCards(deck, 4);
    expect(hands).toHaveLength(4);
    expect(hands[0]).toHaveLength(13);
    expect(hands[1]).toHaveLength(13);
    expect(hands[2]).toHaveLength(13);
    expect(hands[3]).toHaveLength(13);
  });

  it('deals specified number of cards per player', () => {
    const deck = createStandardDeck();
    const hands = dealCards(deck, 4, 5);
    expect(hands[0]).toHaveLength(5);
  });
});
