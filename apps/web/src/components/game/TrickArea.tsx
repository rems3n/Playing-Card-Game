'use client';

import type { PlayedCard as PlayedCardType } from '@card-game/shared-types';
import { PlayingCard } from './PlayingCard';

interface TrickAreaProps {
  currentTrick: PlayedCardType[];
  mySeat: number;
  numPlayers: number;
  scale?: number;
}

const POSITIONS: Record<number, string> = {
  0: 'bottom-[8%] left-1/2 -translate-x-1/2',
  1: 'left-[8%] top-1/2 -translate-y-1/2',
  2: 'top-[8%] left-1/2 -translate-x-1/2',
  3: 'right-[8%] top-1/2 -translate-y-1/2',
};

export function TrickArea({ currentTrick, mySeat, numPlayers, scale = 1 }: TrickAreaProps) {
  return (
    <div className="relative shrink-0" style={{ width: 176 * scale, height: 176 * scale }}>
      {currentTrick.map(({ seatIndex, card }) => {
        const relative = (seatIndex - mySeat + numPlayers) % numPlayers;
        return (
          <div
            key={`${card.suit}${card.rank}`}
            className={`absolute ${POSITIONS[relative] ?? ''} transition-all duration-300 ease-out animate-card-play`}
          >
            <PlayingCard card={card} small disabled scale={scale} />
          </div>
        );
      })}
    </div>
  );
}
