import { describe, expect, it } from 'vitest';
import { GameEventType, GamePhase, Suit } from '@card-game/shared-types';
import { EuchreEngine } from '../games/euchre/EuchreEngine.js';
import { SevenSixEngine } from '../games/seven-six/SevenSixEngine.js';

describe('Euchre regressions', () => {
  it('counts exactly one trick per four played cards', () => {
    const engine = new EuchreEngine('tricks');
    engine.startGame();
    engine.callTrump(engine.getState().currentPlayerSeat, engine.getTurnedUpCard()!.suit);
    for (let n = 0; n < 16; n++) {
      const seat = engine.getState().currentPlayerSeat;
      engine.playCard(seat, engine.getLegalMoves(seat)[0]);
      expect(engine.getState().players.reduce((sum, p) => sum + p.tricksWon, 0)).toBe(Math.floor((n + 1) / 4));
    }
  });

  it('exposes legal calls for both rounds and forces the dealer to choose', () => {
    const engine = new EuchreEngine('calls');
    engine.startGame();
    const turned = engine.getTurnedUpCard()!.suit;
    expect(engine.getVisibleState(1).legalTrumpCalls).toEqual([turned, 'pass']);
    expect(engine.getVisibleState(0).legalTrumpCalls).toEqual([]);
    for (let n = 0; n < 4; n++) engine.callTrump(engine.getState().currentPlayerSeat, 'pass');
    expect(engine.getVisibleState(1).trumpCallRound).toBe(2);
    expect(engine.getLegalTrumpCalls(1)).not.toContain(turned);
    for (let n = 0; n < 3; n++) engine.callTrump(engine.getState().currentPlayerSeat, 'pass');
    const before = JSON.stringify(engine.serialize());
    expect(engine.getState().currentPlayerSeat).toBe(0);
    expect(engine.getLegalTrumpCalls(0)).not.toContain('pass');
    expect(() => engine.callTrump(0, 'pass')).toThrow('Dealer must choose');
    expect(() => engine.callTrump(0, 'invalid' as Suit)).toThrow('Invalid trump suit');
    expect(JSON.stringify(engine.serialize())).toBe(before);
    engine.callTrump(0, engine.getLegalTrumpCalls(0)[0]);
    expect(engine.getState().phase).toBe(GamePhase.Playing);
  });

  it('restores bidding options without exposing opponents hands', () => {
    const engine = new EuchreEngine('restore');
    engine.startGame();
    for (let n = 0; n < 4; n++) engine.callTrump(engine.getState().currentPlayerSeat, 'pass');
    const restored = new EuchreEngine('restore');
    restored.restore(JSON.parse(JSON.stringify(engine.serialize())));
    expect(restored.getVisibleState(1)).toEqual(engine.getVisibleState(1));
    expect(restored.getVisibleState(1).players.every((p) => !('hand' in p))).toBe(true);
  });

  it('finishes a lone hand when seat zero is the inactive partner', () => {
    const engine = new EuchreEngine('alone');
    engine.startGame();
    engine.callTrump(1, 'pass');
    engine.callTrump(2, engine.getTurnedUpCard()!.suit);
    engine.goAlone(2);
    for (let n = 0; n < 15; n++) {
      const seat = engine.getState().currentPlayerSeat;
      expect(seat).not.toBe(0);
      engine.playCard(seat, engine.getLegalMoves(seat)[0]);
    }
    expect(engine.getEvents().filter((e) => e.type === GameEventType.TrickCompleted)).toHaveLength(5);
    expect(engine.getEvents().filter((e) => e.type === GameEventType.RoundEnded)).toHaveLength(1);
    expect(engine.getState().phase).toBe(GamePhase.Bidding);
  });

  it('skips a lone maker partner who would otherwise lead and rejects late declarations', () => {
    const engine = new EuchreEngine('lead');
    engine.startGame();
    engine.callTrump(1, 'pass');
    engine.callTrump(2, 'pass');
    engine.callTrump(3, engine.getTurnedUpCard()!.suit);
    engine.goAlone(3);
    expect(engine.getState().currentPlayerSeat).toBe(2);
    engine.playCard(2, engine.getLegalMoves(2)[0]);
    expect(() => engine.goAlone(3)).toThrow('before the first card');
  });
});

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
