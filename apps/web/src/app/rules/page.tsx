'use client';

import { useState } from 'react';
import { RulesModal } from '@/components/RulesModal';

const GAMES = [
  {
    type: 'hearts' as const,
    title: 'Hearts',
    tagline: 'Avoid the Queen and dodge those hearts',
    players: '4 players',
    difficulty: 'Easy to learn',
    color: 'var(--accent-red)',
    icon: '\u2665',
    summary: 'A classic trick-avoidance game. Every heart is worth 1 point and the Queen of Spades is worth 13 — you want the lowest score. Unless you shoot the moon.',
  },
  {
    type: 'spades' as const,
    title: 'Spades',
    tagline: 'Bid smart, play bold, trust your partner',
    players: '4 players (2v2)',
    difficulty: 'Moderate',
    color: 'var(--accent-blue)',
    icon: '\u2660',
    summary: 'A partnership bidding game where spades are always trump. Bid the number of tricks your team will take, then work together to make your contract.',
  },
  {
    type: 'euchre' as const,
    title: 'Euchre',
    tagline: 'Fast tricks, big bowers, bold calls',
    players: '4 players (2v2)',
    difficulty: 'Moderate',
    color: 'var(--accent-gold)',
    icon: '\u265A',
    summary: 'A quick partnership game with just 24 cards. Call trump, watch out for the bowers, and try to take at least 3 of 5 tricks to score.',
  },
];

export default function RulesPage() {
  const [activeGame, setActiveGame] = useState<'hearts' | 'spades' | 'euchre' | null>(null);

  return (
    <div className="max-w-3xl mx-auto p-6">
      <div className="mb-6">
        <h1 className="text-lg font-bold mb-1">Games & Rules</h1>
        <p className="text-[13px] text-[var(--text-secondary)]">
          Learn how to play each card game. Click any game to see the full rules.
        </p>
      </div>

      <div className="space-y-3">
        {GAMES.map((game) => (
          <button
            key={game.type}
            onClick={() => setActiveGame(game.type)}
            className="w-full text-left bg-[var(--bg-secondary)] rounded-xl border border-[var(--border-subtle)] p-5 hover:border-[var(--border-medium)] hover:bg-[var(--bg-tertiary)] transition-all group"
          >
            <div className="flex items-start gap-4">
              <div
                className="w-12 h-12 rounded-lg flex items-center justify-center text-2xl shrink-0"
                style={{ backgroundColor: `color-mix(in srgb, ${game.color} 15%, transparent)` }}
              >
                <span style={{ color: game.color }}>{game.icon}</span>
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2.5 mb-0.5">
                  <h2 className="text-base font-bold">{game.title}</h2>
                  <span className="text-[11px] px-2 py-0.5 rounded-full bg-white/[0.06] text-[var(--text-muted)]">{game.players}</span>
                  <span className="text-[11px] px-2 py-0.5 rounded-full bg-white/[0.06] text-[var(--text-muted)]">{game.difficulty}</span>
                </div>
                <p className="text-[12px] text-[var(--accent-gold)] font-medium mb-1.5">{game.tagline}</p>
                <p className="text-[13px] text-[var(--text-secondary)] leading-relaxed">{game.summary}</p>
              </div>
              <div className="shrink-0 mt-1 text-[var(--text-muted)] group-hover:text-[var(--text-secondary)] transition-colors">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                </svg>
              </div>
            </div>
          </button>
        ))}
      </div>

      {activeGame && (
        <RulesModal
          gameType={activeGame}
          open={true}
          onClose={() => setActiveGame(null)}
        />
      )}
    </div>
  );
}
