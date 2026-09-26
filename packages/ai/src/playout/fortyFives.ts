import {
  GamePhase,
  type Card,
  type GameState,
  type VisibleGameState,
} from "@card-game/shared-types";
import { Suit } from "@card-game/shared-types";
import { FortyFivesEngine, isTrump, strength } from "@card-game/game-engine";
import { determinize } from "./determinize.js";
import { bestTrump, fortyFivesPlayCard, handStrength } from "../games/FortyFivesAI.js";

/**
 * Imagined deals per decision. Each costs well under a millisecond, and the
 * bot has a second and a half before it plays anyway. At a dozen the choice
 * was mostly noise and the Expert lost to the heuristic it was built on.
 */
export const DEFAULT_PLAYOUTS = 120;

const teamOf = (seat: number, seats: number) => (seats === 2 ? seat : seat % 2);

/**
 * Whether an imagined deal squares with the auction. A seat that passed is
 * not holding a hand the simple bidder would have bid on; a seat that bid is
 * holding roughly what that bid needs. The slack is generous, because the
 * point is to rule out the absurd, not to read minds.
 */
function squaresWithBids(state: VisibleGameState): (hands: Card[][]) => boolean {
  const bids = state.bids ?? [];
  return (hands) => {
    for (let seat = 0; seat < hands.length; seat++) {
      if (seat === state.mySeat) continue;
      const bid = bids[seat];
      if (typeof bid !== "number") continue;
      const trump = state.trumpSuit;
      const points = trump && seat === state.declarerSeat
        ? handStrength(hands[seat], trump)
        : bestTrump(hands[seat]).points;
      if (bid < 0 && points > 18) return false;
      if (bid > 0 && points < bid - 6) return false;
    }
    return true;
  };
}

/**
 * The real engine, restored into one imagined deal, so a playout follows the
 * ranking, reneging and scoring exactly as the table does. Nothing here
 * re-implements a rule.
 */
export function imagine(state: VisibleGameState, hands: Card[][]): FortyFivesEngine {
  const engine = new FortyFivesEngine(state.gameId, state.config);
  const blank = engine.getState();
  const full: GameState = {
    ...blank,
    phase: GamePhase.Playing,
    players: blank.players.map((player, seat) => ({
      ...player,
      displayName: state.players[seat].displayName,
      hand: hands[seat],
      tricksWon: state.players[seat].tricksWon,
    })),
    currentTrick: state.currentTrick.map((play) => ({ ...play })),
    currentPlayerSeat: state.currentPlayerSeat,
    leadSeat: state.leadSeat,
    roundNumber: state.roundNumber,
    trickNumber: state.trickNumber,
    heartsBroken: state.heartsBroken,
    scores: [...state.scores],
    roundScores: [...state.roundScores],
    trumpSuit: state.trumpSuit,
    bids: state.bids ? [...state.bids] : undefined,
    playedCards: (state.playedCards ?? []).map((play) => ({ ...play })),
  };
  // The high-trump bonus goes to whoever has played the strongest trump so
  // far this hand, which the record of played cards says.
  let highSeat = -1;
  let high = -1;
  const trump = state.trumpSuit!;
  for (const play of [...(state.playedCards ?? []), ...state.currentTrick])
    if (isTrump(play.card, trump) && strength(play.card, trump) > high) {
      high = strength(play.card, trump);
      highSeat = play.seatIndex;
    }
  engine.restore({
    state: full,
    events: [],
    sequenceCounter: 0,
    dealerSeat: state.dealerSeat ?? 0,
    declarer: state.declarerSeat ?? -1,
    contract: state.contract ?? 0,
    highTrumpSeat: highSeat,
    highTrumpStrength: high,
  });
  engine.setRoundPause(true);
  return engine;
}

/** Everyone plays the sound, simple line to the end of the hand. */
export function playOut(engine: FortyFivesEngine): number[] {
  let guard = 0;
  while (engine.getState().phase === GamePhase.Playing && guard++ < 64) {
    const seat = engine.getState().currentPlayerSeat;
    engine.playCard(seat, fortyFivesPlayCard(engine.getVisibleState(seat)));
  }
  return engine.getState().roundScores;
}

/** My side's points less the other side's, for the hand as scored. */
export function margin(scores: number[], mySeat: number): number {
  const seats = scores.length;
  const mine = teamOf(mySeat, seats);
  const other = scores.findIndex((_, seat) => teamOf(seat, seats) !== mine);
  return scores[mySeat] - (other >= 0 ? scores[other] : 0);
}

/**
 * The card whose average outcome, over many imagined deals of the cards this
 * seat cannot see, leaves its side furthest ahead at the end of the hand.
 */
export function chooseFortyFivesCard(
  state: VisibleGameState,
  playouts = DEFAULT_PLAYOUTS,
): Card {
  const moves = state.legalMoves;
  if (moves.length <= 1) return moves[0];
  if (!state.trumpSuit) return fortyFivesPlayCard(state);
  const totals = new Map<Card, number>(moves.map((move) => [move, 0]));
  const plausible = squaresWithBids(state);
  for (let i = 0; i < playouts; i++) {
    const hands = determinize(state, [], plausible);
    for (const move of moves) {
      const engine = imagine(state, hands);
      engine.playCard(state.mySeat, move);
      totals.set(move, totals.get(move)! + margin(playOut(engine), state.mySeat));
    }
  }
  let best = moves[0];
  for (const move of moves)
    if (totals.get(move)! > totals.get(best)!) best = move;
  return best;
}

/**
 * The points this side would take with a given trump, if this seat named it
 * and led: one imagined deal played out by everyone's simple line. Scored by
 * the engine with no contract, so it is what was taken, not what was owed.
 */
function pointsWithTrump(state: VisibleGameState, hands: Card[][], trump: Suit): number {
  const engine = new FortyFivesEngine(state.gameId, state.config);
  const blank = engine.getState();
  const full: GameState = {
    ...blank,
    phase: GamePhase.Playing,
    players: blank.players.map((player, seat) => ({ ...player, hand: hands[seat], tricksWon: 0 })),
    currentTrick: [],
    currentPlayerSeat: state.mySeat,
    leadSeat: state.mySeat,
    roundNumber: state.roundNumber,
    trickNumber: 0,
    heartsBroken: false,
    scores: [...state.scores],
    roundScores: state.scores.map(() => 0),
    trumpSuit: trump,
    bids: state.bids ? [...state.bids] : undefined,
    playedCards: [],
  };
  engine.restore({
    state: full,
    events: [],
    sequenceCounter: 0,
    dealerSeat: state.dealerSeat ?? 0,
    declarer: state.mySeat,
    contract: 0,
    highTrumpSeat: -1,
    highTrumpStrength: -1,
  });
  engine.setRoundPause(true);
  return playOut(engine)[state.mySeat];
}

/** For each suit, the points this side took across many imagined deals. */
function auctionOutlook(state: VisibleGameState, playouts: number): Map<Suit, number[]> {
  const plausible = squaresWithBids(state);
  const outlook = new Map<Suit, number[]>();
  for (const suit of [Suit.Hearts, Suit.Diamonds, Suit.Clubs, Suit.Spades]) outlook.set(suit, []);
  for (let i = 0; i < playouts; i++) {
    const hands = determinize(state, [], plausible);
    for (const [suit, taken] of outlook) taken.push(pointsWithTrump(state, hands, suit));
  }
  return outlook;
}

/**
 * The highest bid this hand makes often enough to be worth the risk. A side
 * that bids and falls short loses the bid, so a bid is only worth making when
 * the imagined deals say the points are there most of the time. Passing when
 * nothing qualifies is the point; a dealer who may not pass bids the least.
 */
export function chooseFortyFivesBid(
  state: VisibleGameState,
  playouts = Math.max(12, Math.round(DEFAULT_PLAYOUTS / 2)),
  // Four contracts in five, in imagined deals, is where bidding pays: at three
  // in five the failed bids cost more than the made ones brought in.
  confidence = 0.8,
): number | "pass" {
  const legal = state.legalBids ?? [];
  const bids = legal.filter((bid) => bid > 0).sort((a, b) => a - b);
  const mayPass = legal.includes(-1);
  if (!bids.length) return mayPass ? "pass" : 0;
  const outlook = auctionOutlook(state, playouts);
  let best: number | "pass" = mayPass ? "pass" : bids[0];
  for (const bid of bids)
    for (const taken of outlook.values()) {
      const made = taken.filter((points) => points >= bid).length / taken.length;
      if (made >= confidence && (best === "pass" || bid > best)) best = bid;
    }
  return best;
}

/** The suit the imagined deals say this side takes the most with. */
export function chooseFortyFivesTrump(
  state: VisibleGameState,
  playouts = Math.max(12, Math.round(DEFAULT_PLAYOUTS / 2)),
): Suit {
  const calls = (state.legalTrumpCalls ?? []).filter((call): call is Suit => call !== "pass");
  if (calls.length <= 1) return calls[0] ?? Suit.Hearts;
  const outlook = auctionOutlook(state, playouts);
  let best = calls[0];
  let bestMean = -Infinity;
  for (const suit of calls) {
    const taken = outlook.get(suit) ?? [];
    const mean = taken.reduce((sum, points) => sum + points, 0) / Math.max(1, taken.length);
    if (mean > bestMean) {
      bestMean = mean;
      best = suit;
    }
  }
  return best;
}
