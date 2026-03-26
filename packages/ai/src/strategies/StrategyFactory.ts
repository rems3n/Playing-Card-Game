import { AIDifficulty } from '@card-game/shared-types';
import type { AIPlayer } from '../AIPlayer.js';
import { RandomStrategy } from './RandomStrategy.js';
import { HeuristicStrategy } from './HeuristicStrategy.js';
import { MonteCarloStrategy } from './MonteCarloStrategy.js';

interface BotPersonality {
  name: string;
  difficulty: AIDifficulty;
}

const BOT_PERSONALITIES: BotPersonality[] = [
  { name: 'Dealer Danny', difficulty: AIDifficulty.Beginner },
  { name: 'Lucky Lucy', difficulty: AIDifficulty.Beginner },
  { name: 'Card Shark Sally', difficulty: AIDifficulty.Intermediate },
  { name: 'Steady Steve', difficulty: AIDifficulty.Intermediate },
  { name: 'Professor Pip', difficulty: AIDifficulty.Advanced },
  { name: 'The Oracle', difficulty: AIDifficulty.Expert },
];

export function createAIPlayer(
  difficulty: AIDifficulty,
  nameOverride?: string,
): AIPlayer {
  const personality =
    BOT_PERSONALITIES.find((p) => p.difficulty === difficulty) ??
    BOT_PERSONALITIES[0];
  const name = nameOverride ?? personality.name;

  switch (difficulty) {
    case AIDifficulty.Beginner:
      return new RandomStrategy(name);
    case AIDifficulty.Intermediate:
    case AIDifficulty.Advanced:
      return new HeuristicStrategy(name);
    case AIDifficulty.Expert:
      return new MonteCarloStrategy(name);
  }
}

export function getAvailableBots(): BotPersonality[] {
  return [...BOT_PERSONALITIES];
}
