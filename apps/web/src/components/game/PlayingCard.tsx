'use client';

import type { Card } from '@card-game/shared-types';
import { Suit, Rank } from '@card-game/shared-types';
import type { CardBackDesign } from '@card-game/shared-store';

const RANK_DISPLAY: Record<number, string> = {
  [Rank.Two]: '2', [Rank.Three]: '3', [Rank.Four]: '4', [Rank.Five]: '5',
  [Rank.Six]: '6', [Rank.Seven]: '7', [Rank.Eight]: '8', [Rank.Nine]: '9',
  [Rank.Ten]: '10', [Rank.Jack]: 'J', [Rank.Queen]: 'Q', [Rank.King]: 'K',
  [Rank.Ace]: 'A',
};

const SUIT_SYMBOL: Record<string, string> = {
  [Suit.Hearts]: '\u2665', [Suit.Diamonds]: '\u2666',
  [Suit.Clubs]: '\u2663', [Suit.Spades]: '\u2660',
};

interface PlayingCardProps {
  card: Card;
  onClick?: () => void;
  selected?: boolean;
  disabled?: boolean;
  small?: boolean;
  scale?: number;
}

export function PlayingCard({ card, onClick, selected, disabled, small, scale = 1 }: PlayingCardProps) {
  const isRed = card.suit === Suit.Hearts || card.suit === Suit.Diamonds;
  const s = scale;

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        width: small ? 42 * s : 56 * s,
        height: small ? 58 * s : 80 * s,
        padding: small ? 3 * s : 4 * s,
        borderRadius: 6 * s,
        transform: selected
          ? `translateY(${-18 * s}px) scale(1.12)`
          : undefined,
        zIndex: selected ? 20 : undefined,
      }}
      className={`
        relative flex flex-col items-center justify-between select-none
        border transition-all duration-200 ease-out
        ${selected
          ? 'border-[var(--accent-gold)] border-2 bg-white shadow-[0_8px_24px_rgba(232,166,58,0.4)]'
          : 'border-[#c8c5c1] bg-[#f7f6f5] shadow-[var(--shadow-card)]'
        }
        ${disabled
          ? 'opacity-40 cursor-default'
          : 'cursor-pointer hover:-translate-y-2 hover:scale-105 hover:shadow-[0_6px_16px_rgba(0,0,0,0.35)]'
        }
      `}
    >
      <div
        className={`self-start leading-none font-bold ${isRed ? 'text-[#c33]' : 'text-[#1a1a1a]'}`}
        style={{ fontSize: small ? 10 * s : 12 * s }}
      >
        <div>{RANK_DISPLAY[card.rank]}</div>
        <div>{SUIT_SYMBOL[card.suit]}</div>
      </div>
      <div
        className={`leading-none ${isRed ? 'text-[#c33]' : 'text-[#1a1a1a]'}`}
        style={{ fontSize: small ? 16 * s : 22 * s }}
      >
        {SUIT_SYMBOL[card.suit]}
      </div>
    </button>
  );
}

interface CardBackProps {
  small?: boolean;
  scale?: number;
  design?: CardBackDesign;
  rotation?: number;
}

function BackPattern({ pattern, accent, h }: { pattern: string; accent: string; h: number }) {
  switch (pattern) {
    case 'diamond':
      return (
        <svg width={h * 0.5} height={h * 0.5} viewBox="0 0 40 40" className="opacity-60">
          <rect x="12" y="2" width="16" height="16" rx="2" transform="rotate(45 20 10)" fill="none" stroke={accent} strokeWidth="1.5" />
          <rect x="12" y="18" width="16" height="16" rx="2" transform="rotate(45 20 26)" fill="none" stroke={accent} strokeWidth="1.5" />
        </svg>
      );
    case 'stripe':
      return (
        <svg width={h * 0.55} height={h * 0.65} viewBox="0 0 30 50" className="opacity-50">
          {[0, 8, 16, 24, 32, 40].map((y) => (
            <line key={y} x1="0" y1={y} x2="30" y2={y} stroke={accent} strokeWidth="1" />
          ))}
        </svg>
      );
    case 'ornate':
      return (
        <svg width={h * 0.5} height={h * 0.6} viewBox="0 0 40 50" className="opacity-50">
          <ellipse cx="20" cy="25" rx="14" ry="18" fill="none" stroke={accent} strokeWidth="1.5" />
          <ellipse cx="20" cy="25" rx="8" ry="11" fill="none" stroke={accent} strokeWidth="1" />
          <circle cx="20" cy="25" r="3" fill={accent} opacity="0.4" />
        </svg>
      );
    case 'royal':
      return (
        <svg width={h * 0.45} height={h * 0.55} viewBox="0 0 36 44" className="opacity-60">
          <path d="M18 6L26 16H22L28 26H22L26 36H10L14 26H8L14 16H10Z" fill="none" stroke={accent} strokeWidth="1.5" />
          <circle cx="18" cy="22" r="3.5" fill={accent} opacity="0.3" />
        </svg>
      );
    case 'minimal':
      return (
        <svg width={h * 0.35} height={h * 0.35} viewBox="0 0 24 24" className="opacity-40">
          <rect x="4" y="4" width="16" height="16" rx="3" fill="none" stroke={accent} strokeWidth="1.5" />
        </svg>
      );
    default:
      return (
        <div className="rounded-sm border opacity-40" style={{ width: '55%', height: '55%', borderColor: accent, backgroundColor: `${accent}20` }} />
      );
  }
}

export function CardBack({ small, scale = 1, design, rotation = 0 }: CardBackProps) {
  const bg = design?.bg ?? 'linear-gradient(135deg, #2d5fa1, #1e3f6f)';
  const border = design?.border ?? '#2a4a7f';
  const pattern = design?.pattern ?? 'classic';
  const accent = design?.accent ?? '#4a7abf';
  const w = small ? 42 * scale : 56 * scale;
  const h = small ? 58 * scale : 80 * scale;

  return (
    <div
      style={{
        width: w,
        height: h,
        borderRadius: 6 * scale,
        background: bg,
        borderColor: border,
        transform: rotation ? `rotate(${rotation}deg)` : undefined,
        transformOrigin: 'bottom center',
      }}
      className="flex items-center justify-center border shadow-[var(--shadow-card)] shrink-0"
    >
      <BackPattern pattern={pattern} accent={accent} h={h} />
    </div>
  );
}
