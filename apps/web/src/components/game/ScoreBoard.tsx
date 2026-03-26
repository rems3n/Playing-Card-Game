'use client';

import type { VisiblePlayerState } from '@card-game/shared-types';

interface ScoreBoardProps {
  players: VisiblePlayerState[];
  scores: number[];
  roundScores: number[];
  mySeat: number;
}

export function ScoreBoard({ players, scores, roundScores, mySeat }: ScoreBoardProps) {
  return (
    <div className="bg-[var(--bg-secondary)] rounded-lg border border-[var(--border-subtle)] overflow-hidden">
      <div className="px-3 py-2 border-b border-[var(--border-subtle)]">
        <span className="text-[11px] font-semibold text-[var(--text-secondary)] uppercase tracking-wider">
          Scoreboard
        </span>
      </div>
      <div className="p-2 space-y-1">
        {players.map((player, i) => {
          const isMe = player.seatIndex === mySeat;
          return (
            <div
              key={player.seatIndex}
              className={`
                flex items-center gap-1.5 px-2 py-1 rounded text-[12px]
                ${isMe ? 'bg-[var(--accent-gold)]/8' : ''}
              `}
            >
              <span className="shrink-0 w-4 text-center">{player.isAI ? '🤖' : '👤'}</span>
              <span className={`flex-1 truncate min-w-0 ${isMe ? 'text-[var(--accent-gold)] font-semibold' : ''}`}>
                {player.displayName}
              </span>
              {roundScores[i] > 0 && (
                <span className="text-[10px] text-[var(--accent-red)] shrink-0">+{roundScores[i]}</span>
              )}
              <span className={`font-bold tabular-nums shrink-0 w-6 text-right ${isMe ? 'text-[var(--accent-gold)]' : ''}`}>
                {scores[i]}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
