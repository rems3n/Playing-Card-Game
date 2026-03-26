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
}

export function PlayingCard({ card, onClick, selected, disabled, small }: PlayingCardProps) {
  const isRed = card.suit === Suit.Hearts || card.suit === Suit.Diamonds;

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`
        relative flex flex-col items-center justify-between select-none
        rounded-md border transition-all duration-150 ease-out
        ${small
          ? 'w-[42px] h-[58px] p-[3px] text-[10px]'
          : 'w-[56px] h-[80px] p-1 text-xs'
        }
        ${selected
          ? 'border-[var(--accent-gold)] -translate-y-4 bg-white shadow-[0_4px_16px_rgba(232,166,58,0.3)]'
          : 'border-[#c8c5c1] bg-[#f7f6f5] shadow-[var(--shadow-card)]'
        }
        ${disabled
          ? 'opacity-40 cursor-default'
          : 'cursor-pointer hover:-translate-y-1.5 hover:shadow-[0_4px_12px_rgba(0,0,0,0.3)]'
        }
        ${!disabled && !selected ? 'active:translate-y-0 active:shadow-sm' : ''}
      `}
    >
      <div className={`self-start leading-none font-bold ${isRed ? 'text-[#c33]' : 'text-[#1a1a1a]'}`}>
        <div>{RANK_DISPLAY[card.rank]}</div>
        <div className="mt-[-1px]">{SUIT_SYMBOL[card.suit]}</div>
      </div>
      <div className={`${small ? 'text-base' : 'text-xl'} leading-none ${isRed ? 'text-[#c33]' : 'text-[#1a1a1a]'}`}>
        {SUIT_SYMBOL[card.suit]}
      </div>
    </button>
  );
}

export function CardBack({ small }: { small?: boolean }) {
  return (
    <div
      className={`
        flex items-center justify-center rounded-md border border-[#2a4a7f]
        bg-gradient-to-br from-[#2d5fa1] to-[#1e3f6f] shadow-[var(--shadow-card)]
        ${small ? 'w-[42px] h-[58px]' : 'w-[56px] h-[80px]'}
      `}
    >
      <div className="w-[60%] h-[60%] rounded-sm border border-[#4a7abf]/40 bg-[#3a6aaf]/20" />
    </div>
  );
}
