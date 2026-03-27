'use client';

import type { Card } from '@card-game/shared-types';
import { Suit, Rank } from '@card-game/shared-types';

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
      }}
      className={`
        relative flex flex-col items-center justify-between select-none
        border transition-all duration-150 ease-out
        ${selected
          ? 'border-[var(--accent-gold)] bg-white shadow-[0_4px_16px_rgba(232,166,58,0.3)]'
          : 'border-[#c8c5c1] bg-[#f7f6f5] shadow-[var(--shadow-card)]'
        }
        ${disabled
          ? 'opacity-40 cursor-default'
          : 'cursor-pointer hover:shadow-[0_4px_12px_rgba(0,0,0,0.3)]'
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

export function CardBack({ small, scale = 1 }: { small?: boolean; scale?: number }) {
  return (
    <div
      style={{
        width: small ? 42 * scale : 56 * scale,
        height: small ? 58 * scale : 80 * scale,
        borderRadius: 6 * scale,
      }}
      className="flex items-center justify-center border border-[#2a4a7f] bg-gradient-to-br from-[#2d5fa1] to-[#1e3f6f] shadow-[var(--shadow-card)]"
    >
      <div className="w-[60%] h-[60%] rounded-sm border border-[#4a7abf]/40 bg-[#3a6aaf]/20" />
    </div>
  );
}
