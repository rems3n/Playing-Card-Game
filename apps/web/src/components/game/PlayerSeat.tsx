'use client';

import type { VisiblePlayerState } from '@card-game/shared-types';

interface PlayerSeatProps {
  player: VisiblePlayerState;
  isCurrentTurn: boolean;
  position: 'top' | 'left' | 'right' | 'bottom';
  isMe?: boolean;
}

// Deterministic avatar colors based on name hash
const AVATAR_COLORS = ['#e06060', '#e09040', '#50a060', '#5090d0', '#9070c0', '#d06090'];

function nameToColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = ((hash << 5) - hash + name.charCodeAt(i)) | 0;
  }
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

// Bot face emojis — each bot gets a unique face
const BOT_FACES: Record<string, string> = {
  'Dealer Danny': '😎',
  'Lucky Lucy': '🤩',
  'Card Shark Sally': '🦊',
  'Steady Steve': '🧐',
  'Professor Pip': '🎩',
  'The Oracle': '🔮',
};

function getBotFace(name: string): string {
  return BOT_FACES[name] ?? '🤖';
}

export function PlayerSeat({ player, isCurrentTurn, position, isMe }: PlayerSeatProps) {
  const avatarBg = isMe ? 'var(--accent-gold)' : nameToColor(player.displayName);

  return (
    <div
      className={`
        flex items-center gap-2 px-3 py-1.5 rounded-md max-w-[220px]
        transition-all duration-200
        ${isCurrentTurn
          ? 'bg-[var(--accent-green)]/12 outline outline-2 outline-[var(--accent-green)]/60'
          : 'bg-black/25'
        }
        ${!player.isConnected ? 'opacity-40' : ''}
      `}
    >
      {/* Avatar */}
      <div
        className="w-8 h-8 rounded-full flex items-center justify-center text-sm shrink-0 shadow-sm"
        style={{ backgroundColor: avatarBg }}
      >
        {player.isAI ? (
          <span className="text-base leading-none">{getBotFace(player.displayName)}</span>
        ) : (
          <span className="font-bold text-[#1a1a1a] text-[12px]">
            {player.displayName[0]?.toUpperCase() ?? '?'}
          </span>
        )}
      </div>

      {/* Info */}
      <div className="min-w-0 overflow-hidden">
        <div className="text-[13px] font-semibold leading-tight truncate text-white">
          {player.displayName}
          {isMe && <span className="text-[var(--accent-gold)] text-[11px] font-normal ml-1">(You)</span>}
        </div>
        <div className="flex items-center gap-2 text-[11px] text-[var(--text-secondary)] leading-tight mt-0.5">
          <span>{player.tricksWon}T</span>
          <span className="text-[var(--text-muted)]">/</span>
          <span>{player.score}pts</span>
          {(position !== 'bottom') && (
            <>
              <span className="text-[var(--text-muted)]">/</span>
              <span>{player.cardCount}c</span>
            </>
          )}
        </div>
      </div>

      {/* Turn dot */}
      {isCurrentTurn && (
        <div className="w-1.5 h-1.5 rounded-full bg-[var(--accent-green)] animate-pulse shrink-0 ml-auto" />
      )}
    </div>
  );
}
