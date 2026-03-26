import { type Card, Suit, Rank } from '@card-game/shared-types';

export function createCard(suit: Suit, rank: Rank): Card {
  return { suit, rank };
}

export function cardEquals(a: Card, b: Card): boolean {
  return a.suit === b.suit && a.rank === b.rank;
}

export function cardInArray(card: Card, cards: Card[]): boolean {
  return cards.some((c) => cardEquals(c, card));
}

export function removeCard(card: Card, cards: Card[]): Card[] {
  const idx = cards.findIndex((c) => cardEquals(c, card));
  if (idx === -1) return cards;
  return [...cards.slice(0, idx), ...cards.slice(idx + 1)];
}

export function sortCards(cards: Card[]): Card[] {
  const suitOrder = [Suit.Clubs, Suit.Diamonds, Suit.Spades, Suit.Hearts];
  return [...cards].sort((a, b) => {
    const suitDiff = suitOrder.indexOf(a.suit) - suitOrder.indexOf(b.suit);
    if (suitDiff !== 0) return suitDiff;
    return a.rank - b.rank;
  });
}

export function cardToString(card: Card): string {
  const rankNames: Record<number, string> = {
    [Rank.Two]: '2',
    [Rank.Three]: '3',
    [Rank.Four]: '4',
    [Rank.Five]: '5',
    [Rank.Six]: '6',
    [Rank.Seven]: '7',
    [Rank.Eight]: '8',
    [Rank.Nine]: '9',
    [Rank.Ten]: '10',
    [Rank.Jack]: 'J',
    [Rank.Queen]: 'Q',
    [Rank.King]: 'K',
    [Rank.Ace]: 'A',
  };
  const suitSymbols: Record<string, string> = {
    [Suit.Clubs]: '♣',
    [Suit.Diamonds]: '♦',
    [Suit.Hearts]: '♥',
    [Suit.Spades]: '♠',
  };
  return `${rankNames[card.rank]}${suitSymbols[card.suit]}`;
}
