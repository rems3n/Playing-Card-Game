'use client';

import type { VisiblePlayerState } from '@card-game/shared-types';

interface PlayerSeatProps {
  player: VisiblePlayerState;
  isCurrentTurn: boolean;
  position: 'top' | 'left' | 'right' | 'bottom';
  isMe?: boolean;
  scale?: number;
}

const AVATAR_COLORS = ['#e06060', '#e09040', '#50a060', '#5090d0', '#9070c0', '#d06090'];

function nameToColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = ((hash << 5) - hash + name.charCodeAt(i)) | 0;
  }
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

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

export function PlayerSeat({ player, isCurrentTurn, position, isMe, scale = 1 }: PlayerSeatProps) {
  const avatarBg = isMe ? 'var(--accent-gold)' : nameToColor(player.displayName);
  const s = scale;

  return (
    <div
      style={{
        padding: `${6 * s}px ${12 * s}px`,
        borderRadius: 6 * s,
        maxWidth: 220 * s,
        gap: 8 * s,
      }}
      className={`
        flex items-center transition-all duration-200
        ${isCurrentTurn
          ? 'bg-[var(--accent-green)]/12 outline outline-2 outline-[var(--accent-green)]/60'
          : 'bg-black/25'
        }
        ${!player.isConnected ? 'opacity-40' : ''}
      `}
    >
      {/* Avatar */}
      <div
        className="rounded-full flex items-center justify-center shrink-0 shadow-sm"
        style={{ width: 32 * s, height: 32 * s, backgroundColor: avatarBg }}
      >
        {player.isAI ? (
          <span style={{ fontSize: 16 * s }} className="leading-none">{getBotFace(player.displayName)}</span>
        ) : (
          <span className="font-bold text-[#1a1a1a]" style={{ fontSize: 12 * s }}>
            {player.displayName[0]?.toUpperCase() ?? '?'}
          </span>
        )}
      </div>

      {/* Info */}
      <div className="min-w-0 overflow-hidden">
        <div className="font-semibold leading-tight truncate text-white" style={{ fontSize: 13 * s }}>
          {player.displayName}
          {isMe && <span className="text-[var(--accent-gold)] font-normal" style={{ fontSize: 11 * s, marginLeft: 4 * s }}>(You)</span>}
        </div>
        <div className="flex items-center text-[var(--text-secondary)] leading-tight" style={{ fontSize: 11 * s, gap: 6 * s, marginTop: 2 * s }}>
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
        <div
          className="rounded-full bg-[var(--accent-green)] animate-pulse shrink-0 ml-auto"
          style={{ width: 6 * s, height: 6 * s }}
        />
      )}
    </div>
  );
}
