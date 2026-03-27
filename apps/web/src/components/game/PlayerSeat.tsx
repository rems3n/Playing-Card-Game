'use client';

import type { VisiblePlayerState } from '@card-game/shared-types';
import { useSettingsStore } from '@card-game/shared-store';
import { CardBack } from './PlayingCard';

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
  'Dealer Danny': '😎', 'Lucky Lucy': '🤩', 'Card Shark Sally': '🦊',
  'Steady Steve': '🧐', 'Professor Pip': '🎩', 'The Oracle': '🔮',
};

function getBotFace(name: string): string {
  return BOT_FACES[name] ?? '🤖';
}

function FannedCards({ count, scale, position }: { count: number; scale: number; position: string }) {
  const { cardBack } = useSettingsStore();
  const shown = Math.min(count, 7);
  if (shown === 0) return null;

  // Fan angle: spread cards slightly
  const totalSpread = Math.min(shown * 6, 40); // degrees
  const startAngle = -totalSpread / 2;

  const isVertical = position === 'top' || position === 'bottom';

  return (
    <div
      className="relative flex items-end justify-center"
      style={{
        height: isVertical ? 30 * scale : 35 * scale,
        width: isVertical ? shown * 12 * scale + 30 * scale : 40 * scale,
        marginTop: isVertical ? 4 * scale : 0,
        marginLeft: !isVertical ? 4 * scale : 0,
      }}
    >
      {Array.from({ length: shown }).map((_, i) => {
        const angle = startAngle + (i / Math.max(shown - 1, 1)) * totalSpread;
        const offsetX = isVertical ? (i - shown / 2) * 8 * scale : 0;
        const offsetY = !isVertical ? (i - shown / 2) * 6 * scale : 0;

        return (
          <div
            key={i}
            className="absolute"
            style={{
              transform: `translate(${offsetX}px, ${offsetY}px) rotate(${isVertical ? angle : angle * 0.5}deg)`,
              left: isVertical ? '50%' : undefined,
              top: !isVertical ? '50%' : undefined,
              zIndex: i,
            }}
          >
            <CardBack small scale={scale * 0.55} design={cardBack} />
          </div>
        );
      })}
    </div>
  );
}

export function PlayerSeat({ player, isCurrentTurn, position, isMe, scale = 1 }: PlayerSeatProps) {
  const avatarBg = isMe ? 'var(--accent-gold)' : nameToColor(player.displayName);
  const s = scale;
  const showCards = !isMe && player.cardCount > 0;

  return (
    <div className="flex flex-col items-center" style={{ gap: 2 * s }}>
      {/* Badge */}
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

      {/* Fanned face-down cards */}
      {showCards && (
        <FannedCards count={player.cardCount} scale={s} position={position} />
      )}
    </div>
  );
}
