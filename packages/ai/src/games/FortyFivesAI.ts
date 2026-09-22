import {
  Suit,
  type Card,
  type VisibleGameState,
} from "@card-game/shared-types";
import {
  effectiveSuit,
  isTrump,
  strength,
  trumpOrder,
} from "@card-game/game-engine";

const SUITS = [Suit.Hearts, Suit.Diamonds, Suit.Clubs, Suit.Spades];

/**
 * How good a hand looks with a given suit as trump, in points it might take.
 *
 * A trick is worth 5, so counting likely tricks in fives keeps the bid on the
 * same scale as the auction. The top three trumps are near certainties; lower
 * trumps and an outside ace are worth rather less.
 */
export function handStrength(hand: Card[], trump: Suit): number {
  const order = trumpOrder(trump);
  const rank = (card: Card) =>
    order.findIndex((other) => other.rank === card.rank && other.suit === card.suit);
  let points = 0;
  for (const card of hand) {
    const place = rank(card);
    if (place === 0 || place === 1 || place === 2) points += 5;
    else if (place >= 0 && place <= 5) points += 3.5;
    else if (place >= 0) points += 2;
    else if (card.rank === 14 || card.rank === 13) points += 1.5;
  }
  // Length in trump is worth something on its own: a fourth trump usually
  // draws the last of someone else's.
  const trumps = hand.filter((card) => isTrump(card, trump)).length;
  if (trumps >= 4) points += 3;
  return points;
}

export function bestTrump(hand: Card[]): { suit: Suit; points: number } {
  let best = { suit: SUITS[0], points: -1 };
  for (const suit of SUITS) {
    const points = handStrength(hand, suit);
    if (points > best.points) best = { suit, points };
  }
  return best;
}

/** Bid the most this hand looks worth, or pass. */
export function fortyFivesBid(state: VisibleGameState): number | "pass" {
  const legal = state.legalBids ?? [];
  const bids = legal.filter((bid) => bid > 0).sort((a, b) => a - b);
  if (!bids.length) return "pass";
  const { points } = bestTrump(state.myHand);
  // Bid only what the hand can be expected to take, and never stretch past 25
  // on a guess: 30 has to take everything.
  const affordable = bids.filter((bid) => bid <= Math.min(points, 25));
  if (!affordable.length)
    return legal.includes(-1) ? "pass" : bids[0];
  return affordable[affordable.length - 1];
}

export function fortyFivesTrump(state: VisibleGameState): Suit {
  const calls = (state.legalTrumpCalls ?? []).filter(
    (call): call is Suit => call !== "pass",
  );
  const { suit } = bestTrump(state.myHand);
  return calls.includes(suit) ? suit : (calls[0] ?? Suit.Hearts);
}

/**
 * Lead the strongest trump while any is out, take the trick when it is cheap
 * to, and otherwise throw the least useful card.
 */
export function fortyFivesPlayCard(state: VisibleGameState): Card {
  const legal = state.legalMoves;
  if (legal.length <= 1) return legal[0];
  const trump = state.trumpSuit!;
  const by = (cards: Card[], pick: "high" | "low") =>
    [...cards].sort((a, b) =>
      pick === "high"
        ? strength(b, trump) - strength(a, trump)
        : strength(a, trump) - strength(b, trump),
    )[0];

  if (!state.currentTrick.length) {
    const trumps = legal.filter((card) => isTrump(card, trump));
    if (trumps.length) return by(trumps, "high");
    return by(legal, "high");
  }

  const ledSuit = effectiveSuit(state.currentTrick[0].card, trump);
  const contenders = state.currentTrick.filter(
    (play) => effectiveSuit(play.card, trump) === ledSuit || isTrump(play.card, trump),
  );
  const best = contenders.reduce((top, play) =>
    strength(play.card, trump) > strength(top.card, trump) ? play : top,
  );
  const winners = legal.filter(
    (card) =>
      (isTrump(card, trump) && !isTrump(best.card, trump)) ||
      (effectiveSuit(card, trump) === effectiveSuit(best.card, trump) &&
        strength(card, trump) > strength(best.card, trump)),
  );
  // A partner already winning does not need to be beaten.
  const partnerLeads =
    state.players.length > 2 &&
    best.seatIndex % 2 === state.mySeat % 2 &&
    best.seatIndex !== state.mySeat;
  if (winners.length && !partnerLeads) return by(winners, "low");
  return by(legal, "low");
}
