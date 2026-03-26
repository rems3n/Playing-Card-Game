'use client';

import { useEffect, useRef } from 'react';

interface RulesModalProps {
  gameType: 'hearts' | 'spades' | 'euchre';
  open: boolean;
  onClose: () => void;
}

const HEARTS_RULES = {
  title: 'Hearts',
  overview: 'A trick-taking game where the goal is to avoid taking hearts and the Queen of Spades. The player with the lowest score at the end wins.',
  players: '4 players',
  deck: 'Standard 52-card deck',
  goal: 'Have the fewest points when any player reaches 100.',
  sections: [
    {
      heading: 'Dealing & Passing',
      items: [
        'Each player is dealt 13 cards.',
        'Before each round, pass 3 cards to another player: left, right, across, then no pass (repeating).',
      ],
    },
    {
      heading: 'Playing Tricks',
      items: [
        'The player with the 2 of Clubs leads the first trick.',
        'Players must follow the lead suit if possible. If not, they may play any card.',
        'The highest card of the lead suit wins the trick.',
        'The trick winner leads the next trick.',
      ],
    },
    {
      heading: 'Restrictions',
      items: [
        'Hearts cannot be led until a heart has been played on a previous trick ("breaking hearts").',
        'No points may be played on the first trick (no hearts or Queen of Spades).',
      ],
    },
    {
      heading: 'Scoring',
      items: [
        'Each heart taken = 1 point.',
        'Queen of Spades = 13 points.',
        'Shooting the Moon: If one player takes ALL hearts and the Queen of Spades, they score 0 and everyone else gets 26 points.',
        'Game ends when a player reaches 100 points. Lowest score wins.',
      ],
    },
  ],
};

const SPADES_RULES = {
  title: 'Spades',
  overview: 'A partnership trick-taking game where spades are always trump. Bid the number of tricks you think your team will take, then try to hit your bid.',
  players: '4 players (2 teams of 2, partners sit across)',
  deck: 'Standard 52-card deck',
  goal: 'First team to reach 500 points wins.',
  sections: [
    {
      heading: 'Dealing & Bidding',
      items: [
        'Each player is dealt 13 cards.',
        'Starting left of the dealer, each player bids the number of tricks they expect to take (1–13).',
        'Partners\' bids are added together as the team\'s contract.',
        'Nil bid: Bid 0 tricks for a bonus — but if you take any trick, it\'s a penalty.',
      ],
    },
    {
      heading: 'Playing Tricks',
      items: [
        'The player left of the dealer leads the first trick.',
        'Players must follow the lead suit if possible.',
        'If you can\'t follow suit, you may play any card (including a spade to trump).',
        'Spades beat all other suits. Highest card of the lead suit wins unless trumped.',
      ],
    },
    {
      heading: 'Restrictions',
      items: [
        'Spades cannot be led until a spade has been used to trump another suit ("breaking spades").',
      ],
    },
    {
      heading: 'Scoring',
      items: [
        'Making your bid: team scores 10 × bid. Each overtrick (bag) = 1 point.',
        'Failing your bid: team loses 10 × bid.',
        'Nil bonus: +100 for success, −100 for failure.',
        'Sandbagging: Every 10 accumulated bags = −100 point penalty.',
        'First team to 500 wins. If both reach 500 on the same round, highest score wins.',
      ],
    },
  ],
};

const EUCHRE_RULES = {
  title: 'Euchre',
  overview: 'A fast-paced partnership trick-taking game with a small deck. The team that calls trump must win at least 3 of 5 tricks to score.',
  players: '4 players (2 teams of 2, partners sit across)',
  deck: '24 cards: 9, 10, J, Q, K, A in each suit',
  goal: 'First team to reach 10 points wins.',
  sections: [
    {
      heading: 'Card Ranking (Trump Suit)',
      items: [
        'Right Bower: Jack of the trump suit (highest card in the game).',
        'Left Bower: Jack of the same-color suit (second highest).',
        'Then: A, K, Q, 10, 9 of trump.',
        'Non-trump suits rank: A, K, Q, J, 10, 9 (the Left Bower leaves its original suit).',
      ],
    },
    {
      heading: 'Dealing & Trump Selection',
      items: [
        'Each player is dealt 5 cards. One card is turned face-up.',
        'Round 1: Starting left of dealer, each player may tell the dealer to "pick it up" (that suit becomes trump) or pass.',
        'If the dealer picks it up, they swap the face-up card for a discard.',
        'Round 2: If all pass, each player (except the turned-up suit) may name a different suit as trump, or pass.',
        'If all pass again, the dealer is forced to choose (stick the dealer).',
      ],
    },
    {
      heading: 'Playing Tricks',
      items: [
        'The player left of the dealer leads the first trick.',
        'Players must follow the lead suit if possible (the Left Bower belongs to the trump suit, not its printed suit).',
        'Highest trump wins, or highest card of the lead suit if no trump played.',
        '5 tricks are played per round.',
      ],
    },
    {
      heading: 'Scoring',
      items: [
        'Calling team wins 3–4 tricks = 1 point.',
        'Calling team wins all 5 tricks (march) = 2 points.',
        'Defending team wins 3+ tricks (euchre) = 2 points to defenders.',
        'First team to 10 points wins.',
      ],
    },
  ],
};

const RULES: Record<string, typeof HEARTS_RULES> = {
  hearts: HEARTS_RULES,
  spades: SPADES_RULES,
  euchre: EUCHRE_RULES,
};

export function RulesModal({ gameType, open, onClose }: RulesModalProps) {
  const overlayRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [open, onClose]);

  if (!open) return null;

  const rules = RULES[gameType];
  if (!rules) return null;

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={(e) => { if (e.target === overlayRef.current) onClose(); }}
    >
      <div className="bg-[var(--bg-secondary)] border border-[var(--border-subtle)] rounded-xl shadow-2xl w-full max-w-lg max-h-[80vh] flex flex-col mx-4">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-[var(--border-subtle)] shrink-0">
          <h2 className="text-base font-bold">{rules.title} — How to Play</h2>
          <button
            onClick={onClose}
            className="p-1 rounded-md hover:bg-white/[0.08] transition-colors text-[var(--text-secondary)] hover:text-white"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto px-5 py-4 space-y-4">
          <p className="text-[13px] text-[var(--text-secondary)] leading-relaxed">{rules.overview}</p>

          <div className="flex gap-4 text-[12px]">
            <div className="flex items-center gap-1.5">
              <span className="text-[var(--text-muted)]">Players:</span>
              <span className="text-[var(--text-primary)]">{rules.players}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-[var(--text-muted)]">Deck:</span>
              <span className="text-[var(--text-primary)]">{rules.deck}</span>
            </div>
          </div>

          <div className="px-3 py-2 rounded-lg bg-[var(--accent-gold)]/8 border border-[var(--accent-gold)]/15">
            <span className="text-[12px] font-semibold text-[var(--accent-gold)]">Goal: </span>
            <span className="text-[12px] text-[var(--text-secondary)]">{rules.goal}</span>
          </div>

          {rules.sections.map((section) => (
            <div key={section.heading}>
              <h3 className="text-[13px] font-semibold mb-1.5">{section.heading}</h3>
              <ul className="space-y-1">
                {section.items.map((item, i) => (
                  <li key={i} className="flex gap-2 text-[12px] text-[var(--text-secondary)] leading-relaxed">
                    <span className="text-[var(--text-muted)] shrink-0 mt-0.5">•</span>
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-[var(--border-subtle)] shrink-0">
          <button
            onClick={onClose}
            className="w-full py-2 text-[13px] font-medium bg-[var(--accent-green)] text-white rounded-lg hover:brightness-110 transition-all"
          >
            Got it
          </button>
        </div>
      </div>
    </div>
  );
}
