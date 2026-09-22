import { Rank, Suit, type Card } from "@card-game/shared-types";

/**
 * Card power in Forty-Fives.
 *
 * Two rules do all the work:
 *
 *  1. The 5 of trump, the jack of trump and the ace of hearts are the top three
 *     trumps, in that order, whatever the trump suit is. The ace of hearts is
 *     trump even when hearts are not.
 *  2. Everything else follows "highest in red, lowest in black": in a red suit
 *     the numerals run high to low as you would expect, and in a black suit
 *     they run the other way, so the 2 is the highest numeral and the 10 the
 *     lowest.
 *
 * Strength is therefore not a function of rank, nor of rank plus "is it trump".
 * It depends on the colour of the suit, so it is written out as an order.
 */
const RED = new Set<Suit>([Suit.Hearts, Suit.Diamonds]);
export const isRed = (suit: Suit) => RED.has(suit);

export const ACE_OF_HEARTS: Card = { rank: Rank.Ace, suit: Suit.Hearts };

export const isAceOfHearts = (card: Card) =>
  card.rank === Rank.Ace && card.suit === Suit.Hearts;

/** The ace of hearts belongs to trump in every hand. */
export function isTrump(card: Card, trump: Suit): boolean {
  return card.suit === trump || isAceOfHearts(card);
}

/** The suit a card counts as when following: trump absorbs the ace of hearts. */
export function effectiveSuit(card: Card, trump: Suit): Suit {
  return isTrump(card, trump) ? trump : card.suit;
}

/**
 * Trump, strongest first. Built rather than hard-coded per suit so the two
 * rules above stay visible.
 */
export function trumpOrder(trump: Suit): Card[] {
  const order: Card[] = [
    { rank: Rank.Five, suit: trump },
    { rank: Rank.Jack, suit: trump },
    ACE_OF_HEARTS,
  ];
  // The ace of trump sits below the ace of hearts, except in hearts where they
  // are the same card and it has already been counted.
  if (trump !== Suit.Hearts) order.push({ rank: Rank.Ace, suit: trump });
  order.push({ rank: Rank.King, suit: trump }, { rank: Rank.Queen, suit: trump });
  const numerals = [
    Rank.Ten,
    Rank.Nine,
    Rank.Eight,
    Rank.Seven,
    Rank.Six,
    Rank.Four,
    Rank.Three,
    Rank.Two,
  ];
  const ordered = isRed(trump) ? numerals : [...numerals].reverse();
  for (const rank of ordered) order.push({ rank, suit: trump });
  return order;
}

/** A plain suit, strongest first. Hearts has no ace here: it is always trump. */
export function plainOrder(suit: Suit): Card[] {
  const high = [Rank.King, Rank.Queen, Rank.Jack];
  const numerals = [
    Rank.Ten,
    Rank.Nine,
    Rank.Eight,
    Rank.Seven,
    Rank.Six,
    Rank.Five,
    Rank.Four,
    Rank.Three,
    Rank.Two,
  ];
  if (isRed(suit)) {
    const order: Card[] = suit === Suit.Hearts ? [] : [{ rank: Rank.Ace, suit }];
    for (const rank of high) order.push({ rank, suit });
    for (const rank of numerals) order.push({ rank, suit });
    return order;
  }
  // Black: king, queen, jack, ace, then the numerals from low to high.
  const order: Card[] = high.map((rank) => ({ rank, suit }));
  order.push({ rank: Rank.Ace, suit });
  for (const rank of [...numerals].reverse()) order.push({ rank, suit });
  return order;
}

const cardKey = (card: Card) => `${card.rank}${card.suit}`;

/**
 * How strong a card is this hand. Higher wins. Any trump beats any plain card;
 * a plain card that is not of the led suit cannot win at all, which the caller
 * decides by comparing only cards that are trump or of the led suit.
 */
export function strength(card: Card, trump: Suit): number {
  const trumps = trumpOrder(trump);
  const inTrump = trumps.findIndex((other) => cardKey(other) === cardKey(card));
  if (inTrump >= 0) return 1000 - inTrump;
  const plain = plainOrder(card.suit);
  const index = plain.findIndex((other) => cardKey(other) === cardKey(card));
  return 100 - (index < 0 ? plain.length : index);
}

/** The three trumps a player may hold back when a lower trump is led. */
export function isTopTrump(card: Card, trump: Suit): boolean {
  return (
    isAceOfHearts(card) ||
    (card.suit === trump && (card.rank === Rank.Five || card.rank === Rank.Jack))
  );
}
