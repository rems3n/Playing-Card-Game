'use client';

import type { PlayedCard as PlayedCardType } from '@card-game/shared-types';
import { PlayingCard } from './PlayingCard';

interface TrickAreaProps {
  currentTrick: PlayedCardType[];
  mySeat: number;
  numPlayers: number;
  scale?: number;
}

/**
 * Compute (x%, y%) position for a player's card in the trick area.
 * Player 0 (me) is at the bottom, others distributed clockwise.
 * Returns CSS top/left percentages for absolute positioning.
 */
function getCardPosition(relativeIndex: number, numPlayers: number): { top: string; left: string } {
  // Angle: start at bottom (270°/3π/2) and go clockwise
  const angleStep = (2 * Math.PI) / numPlayers;
  const angle = (3 * Math.PI) / 2 + relativeIndex * angleStep;

  // Elliptical radius — wider than tall to match the table shape
  const rx = 38; // horizontal radius %
  const ry = 36; // vertical radius %

  const left = 50 + rx * Math.cos(angle);
  const top = 50 + ry * Math.sin(angle);

  return { top: `${top}%`, left: `${left}%` };
}

/** Pick the closest directional animation based on angle. */
function getAnimClass(relativeIndex: number, numPlayers: number): string {
  const angleStep = (2 * Math.PI) / numPlayers;
  const angle = (3 * Math.PI) / 2 + relativeIndex * angleStep;
  // Normalize to [0, 2π)
  const norm = ((angle % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);

  // Map to closest cardinal direction
  if (norm >= (7 * Math.PI) / 4 || norm < Math.PI / 4) return 'animate-card-from-right';
  if (norm >= Math.PI / 4 && norm < (3 * Math.PI) / 4) return 'animate-card-from-bottom';
  if (norm >= (3 * Math.PI) / 4 && norm < (5 * Math.PI) / 4) return 'animate-card-from-left';
  return 'animate-card-from-top';
}

export function TrickArea({ currentTrick, mySeat, numPlayers, scale = 1 }: TrickAreaProps) {
  const areaSize = 240 * scale;

  return (
    <div className="relative shrink-0" style={{ width: areaSize, height: areaSize }}>
      {currentTrick.map(({ seatIndex, card }) => {
        const relative = (seatIndex - mySeat + numPlayers) % numPlayers;
        const pos = getCardPosition(relative, numPlayers);
        const anim = getAnimClass(relative, numPlayers);
        return (
          <div
            key={`${card.suit}${card.rank}`}
            className={`absolute -translate-x-1/2 -translate-y-1/2 ${anim}`}
            style={{ top: pos.top, left: pos.left }}
          >
            <PlayingCard card={card} scale={scale} />
          </div>
        );
      })}
    </div>
  );
}
