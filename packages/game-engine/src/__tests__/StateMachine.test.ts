import { describe, it, expect } from 'vitest';
import { GamePhase } from '@card-game/shared-types';
import { StateMachine } from '../core/StateMachine.js';

describe('StateMachine', () => {
  it('starts in the initial phase', () => {
    const sm = new StateMachine(GamePhase.Waiting, []);
    expect(sm.getPhase()).toBe(GamePhase.Waiting);
  });

  it('transitions to valid phases', () => {
    const sm = new StateMachine(GamePhase.Waiting, [
      { from: GamePhase.Waiting, to: GamePhase.Dealing },
    ]);
    sm.transitionTo(GamePhase.Dealing);
    expect(sm.getPhase()).toBe(GamePhase.Dealing);
  });

  it('rejects invalid transitions', () => {
    const sm = new StateMachine(GamePhase.Waiting, [
      { from: GamePhase.Waiting, to: GamePhase.Dealing },
    ]);
    expect(() => sm.transitionTo(GamePhase.Playing)).toThrow(
      'Invalid phase transition',
    );
  });

  it('reports whether a transition is valid', () => {
    const sm = new StateMachine(GamePhase.Waiting, [
      { from: GamePhase.Waiting, to: GamePhase.Dealing },
    ]);
    expect(sm.canTransitionTo(GamePhase.Dealing)).toBe(true);
    expect(sm.canTransitionTo(GamePhase.Playing)).toBe(false);
  });
});
