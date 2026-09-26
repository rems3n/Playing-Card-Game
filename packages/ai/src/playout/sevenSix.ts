import {
  GamePhase,
  type Card,
  type GameState,
  type VisibleGameState,
} from "@card-game/shared-types";
import { SevenSixEngine } from "@card-game/game-engine";
import { determinize } from "./determinize.js";
import { sevenSixBid, sevenSixPlayCard } from "../games/SevenSixAI.js";

/**
 * Imagined deals per decision. Each costs well under a millisecond, and the
 * bot has a second and a half before it plays anyway. At a dozen the choice
 * was mostly noise and the Expert lost to the heuristic it was built on.
 */
export const DEFAULT_PLAYOUTS = 120;

/**
 * The real engine, restored into one imagined deal, so a playout follows suit,
 * breaks trump and scores exactly as the table does. Bids every seat has not
 * yet made are what the simple bidder would say with the imagined cards.
 */
function imagine(
  state: VisibleGameState,
  hands: Card[][],
  bids: (number | null)[],
): SevenSixEngine {
  const seats = state.players.length;
  const engine = new SevenSixEngine(state.gameId, state.config);
  const blank = engine.getState();
  const bidding = state.phase === GamePhase.Bidding;
  const first = ((state.dealerSeat ?? 0) + 1) % seats;
  const full: GameState = {
    ...blank,
    phase: GamePhase.Playing,
    players: blank.players.map((player, seat) => ({
      ...player,
      displayName: state.players[seat].displayName,
      hand: hands[seat],
      tricksWon: bidding ? 0 : state.players[seat].tricksWon,
    })),
    currentTrick: bidding ? [] : state.currentTrick.map((play) => ({ ...play })),
    currentPlayerSeat: bidding ? first : state.currentPlayerSeat,
    leadSeat: bidding ? first : state.leadSeat,
    roundNumber: state.roundNumber,
    trickNumber: bidding ? 0 : state.trickNumber,
    heartsBroken: state.heartsBroken,
    scores: [...state.scores],
    roundScores: [...state.roundScores],
    trumpSuit: state.trumpSuit,
    bids,
    playedCards: bidding ? [] : (state.playedCards ?? []).map((play) => ({ ...play })),
  };
  engine.restore({
    state: full,
    events: [],
    sequenceCounter: 0,
    trumpCard: state.trumpCard ?? null,
    trumpBroken: state.heartsBroken,
    dealerSeat: state.dealerSeat ?? 0,
  });
  engine.setRoundPause(true);
  return engine;
}

/** Everyone plays the sound, simple line to the end of the hand. */
function playOut(engine: SevenSixEngine): SevenSixEngine {
  let guard = 0;
  while (engine.getState().phase === GamePhase.Playing && guard++ < 128) {
    const seat = engine.getState().currentPlayerSeat;
    const view = engine.getVisibleState(seat);
    engine.playCard(seat, sevenSixPlayCard(view, view.legalMoves));
  }
  return engine;
}

/** What each seat would bid, given the cards it is imagined to hold. */
function imaginedBids(state: VisibleGameState, hands: Card[][]): number[] {
  const trump = state.trumpSuit!;
  return hands.map((hand, seat) => {
    const known = state.bids?.[seat];
    if (typeof known === "number") return known;
    const size = hand.length;
    return sevenSixBid(hand, trump, Array.from({ length: size + 1 }, (_, b) => b));
  });
}

/**
 * The bid this hand most often makes exactly, over many imagined deals of the
 * cards this seat cannot see. Only a legal bid is returned: where the dealer
 * may not say the number that fits best, the next most frequent one wins.
 */
export function chooseSevenSixBid(
  state: VisibleGameState,
  playouts = DEFAULT_PLAYOUTS,
): number {
  const legal = state.legalBids ?? [];
  if (!legal.length) return 0;
  if (legal.length === 1 || !state.trumpSuit) return legal[0];
  const seen = new Map<number, number>();
  for (let i = 0; i < playouts; i++) {
    const hands = determinize(state, state.trumpCard ? [state.trumpCard] : []);
    const bids = imaginedBids(state, hands);
    const engine = playOut(imagine(state, hands, bids));
    const tricks = engine.getState().players[state.mySeat].tricksWon;
    seen.set(tricks, (seen.get(tricks) ?? 0) + 1);
  }
  let best = legal[0];
  for (const bid of legal)
    if ((seen.get(bid) ?? 0) > (seen.get(best) ?? 0)) best = bid;
  return best;
}

/**
 * The card whose average outcome, over many imagined deals, scores this seat
 * the most: the bid made exactly is worth bid + 10 and anything else nothing,
 * so the whole hand is played out to find out.
 */
export function chooseSevenSixCard(
  state: VisibleGameState,
  playouts = DEFAULT_PLAYOUTS,
): Card {
  const moves = state.legalMoves;
  if (moves.length <= 1) return moves[0];
  if (!state.trumpSuit) return sevenSixPlayCard(state, moves);
  const totals = new Map<Card, number>(moves.map((move) => [move, 0]));
  for (let i = 0; i < playouts; i++) {
    const hands = determinize(state, state.trumpCard ? [state.trumpCard] : []);
    const bids = imaginedBids(state, hands);
    for (const move of moves) {
      const engine = imagine(state, hands, bids);
      engine.playCard(state.mySeat, move);
      const scores = playOut(engine).getState().roundScores;
      totals.set(move, totals.get(move)! + scores[state.mySeat]);
    }
  }
  let best = moves[0];
  for (const move of moves)
    if (totals.get(move)! > totals.get(best)!) best = move;
  return best;
}
