import { Rank, Suit, type Card, type VisibleGameState } from "@card-game/shared-types";

const SUITS = [Suit.Clubs, Suit.Diamonds, Suit.Hearts, Suit.Spades];

const key = (card: Card) => `${card.suit}${card.rank}`;

/**
 * The cards this seat has not seen: the deck less its own hand, the trick on
 * the table, everything played earlier this hand, and anything else the game
 * shows face up. What a careful player would know is out.
 */
export function unseenCards(state: VisibleGameState, alsoSeen: Card[] = []): Card[] {
  const seen = new Set<string>();
  for (const card of state.myHand) seen.add(key(card));
  for (const play of state.currentTrick) seen.add(key(play.card));
  for (const play of state.playedCards ?? []) seen.add(key(play.card));
  for (const card of alsoSeen) seen.add(key(card));
  const out: Card[] = [];
  for (const suit of SUITS)
    for (let rank = Rank.Two; rank <= Rank.Ace; rank++)
      if (!seen.has(`${suit}${rank}`)) out.push({ suit, rank });
  return out;
}

/**
 * One possible world: every other seat dealt a random hand of the size it is
 * known to hold, from the cards this seat cannot see. Averaging decisions over
 * many such worlds is how the bot reasons about cards it has not seen.
 */
export function determinize(
  state: VisibleGameState,
  alsoSeen: Card[] = [],
  /**
   * A world the table has ruled out — a seat that bid 25 holding nothing,
   * say — is redrawn, a few times, before being accepted anyway.
   */
  plausible: (hands: Card[][]) => boolean = () => true,
  tries = 8,
): Card[][] {
  const pool = unseenCards(state, alsoSeen);
  let hands: Card[][] = [];
  for (let attempt = 0; attempt < tries; attempt++) {
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    hands = state.players.map(() => []);
    hands[state.mySeat] = [...state.myHand];
    let next = 0;
    for (const player of state.players) {
      if (player.seatIndex === state.mySeat) continue;
      hands[player.seatIndex] = pool.slice(next, next + player.cardCount);
      next += player.cardCount;
    }
    if (plausible(hands)) break;
  }
  return hands;
}
