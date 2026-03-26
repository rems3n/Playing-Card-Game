import { GamePhase } from '@card-game/shared-types';

export type PhaseTransition = {
  from: GamePhase;
  to: GamePhase;
};

export class StateMachine {
  private currentPhase: GamePhase;
  private validTransitions: Map<GamePhase, GamePhase[]>;

  constructor(
    initialPhase: GamePhase,
    transitions: PhaseTransition[],
  ) {
    this.currentPhase = initialPhase;
    this.validTransitions = new Map();

    for (const { from, to } of transitions) {
      const existing = this.validTransitions.get(from) ?? [];
      existing.push(to);
      this.validTransitions.set(from, existing);
    }
  }

  getPhase(): GamePhase {
    return this.currentPhase;
  }

  canTransitionTo(phase: GamePhase): boolean {
    const valid = this.validTransitions.get(this.currentPhase);
    return valid?.includes(phase) ?? false;
  }

  transitionTo(phase: GamePhase): void {
    if (!this.canTransitionTo(phase)) {
      throw new Error(
        `Invalid phase transition: ${this.currentPhase} → ${phase}`,
      );
    }
    this.currentPhase = phase;
  }
}
