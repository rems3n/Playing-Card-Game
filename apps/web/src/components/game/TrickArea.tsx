'use client';

import type { PlayedCard as PlayedCardType } from '@card-game/shared-types';
import { PlayingCard } from './PlayingCard';

interface TrickAreaProps {
  currentTrick: PlayedCardType[];
  mySeat: number;
  numPlayers: number;
}

const POSITIONS: Record<number, string> = {
  0: 'bottom-3 left-1/2 -translate-x-1/2',
  1: 'left-3 top-1/2 -translate-y-1/2',
  2: 'top-3 left-1/2 -translate-x-1/2',
  3: 'right-3 top-1/2 -translate-y-1/2',
};

export function TrickArea({ currentTrick, mySeat, numPlayers }: TrickAreaProps) {
  return (
    <div className="relative w-44 h-44 shrink-0">
      {currentTrick.map(({ seatIndex, card }) => {
        const relative = (seatIndex - mySeat + numPlayers) % numPlayers;
        return (
          <div
            key={`${card.suit}${card.rank}`}
            className={`absolute ${POSITIONS[relative] ?? ''} transition-all duration-300 ease-out animate-card-play`}
          >
            <PlayingCard card={card} small disabled />
          </div>
        );
      })}
    </div>
  );
}
