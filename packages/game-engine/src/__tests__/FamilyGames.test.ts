import { describe, expect, it } from 'vitest';
import { GameEventType, GamePhase, Suit } from '@card-game/shared-types';
import { SevenSixEngine } from '../games/seven-six/SevenSixEngine.js';

describe('Seven-Six regressions', () => {
  it.each([NaN, Infinity, -1, 0.5, 8])('rejects invalid bid %s without changing state', (bid) => {
    const engine = new SevenSixEngine('bid');
    engine.startGame();
    const before = JSON.stringify(engine.serialize());
    expect(() => engine.placeBid(engine.getState().currentPlayerSeat, bid)).toThrow();
    expect(JSON.stringify(engine.serialize())).toBe(before);
  });

  it.each([0, 1, 8, 2.5, NaN])('rejects unsupported player count %s', (maxPlayers) => {
    expect(() => new SevenSixEngine('count', { maxPlayers })).toThrow('2-7 players');
  });

  it.each([2, 4, 7])('completes all 13 rounds with %s players and preserves exact-bid scoring', (maxPlayers) => {
    const engine = new SevenSixEngine('complete', { maxPlayers });
    engine.startGame();
    let steps = 0;
    while (engine.getState().phase !== GamePhase.GameOver && steps++ < 2000) {
      const state = engine.getState();
      const seat = state.currentPlayerSeat;
      if (state.phase === GamePhase.Bidding) {
        expect(state.trumpCard).toBeDefined();
        engine.placeBid(seat, engine.getLegalBids(seat)[0]);
      } else {
        const beforeRound = state.roundNumber;
        const bids = [...state.bids!];
        const scores = [...state.scores];
        engine.playCard(seat, engine.getLegalMoves(seat)[0]);
        if (state.roundNumber !== beforeRound || state.phase === GamePhase.GameOver) {
          const ended = engine.getEvents().filter((e) => e.type === GameEventType.RoundEnded).at(-1)!;
          const delta = ended.payload.roundScores as number[];
          expect(delta.every((score, i) => score === 0 || score === 10 + bids[i]!)).toBe(true);
          expect(state.scores).toEqual(scores.map((score, i) => score + delta[i]));
        }
      }
    }
    expect(engine.getState().phase).toBe(GamePhase.GameOver);
    expect(engine.getEvents().filter((e) => e.type === GameEventType.RoundEnded)).toHaveLength(13);
  });
});
