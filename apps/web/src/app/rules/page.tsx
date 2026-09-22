"use client";

import { useState } from "react";
import { RulesModal } from "@/components/RulesModal";

const GAMES = [
  {
    type: "euchre" as const,
    title: "45s / Euchre",
    tagline: "Partners, five tricks a hand, and a trump you call",
    players: "4 players",
    difficulty: "Partnership game",
    color: "var(--accent-green)",
    icon: "♠",
    summary:
      "Uses the existing Euchre rules: a 24-card deck, five tricks per hand, bowers, and a target of 10 points. Seats opposite each other are partners.",
  },
  {
    type: "seven-six" as const,
    title: "Seven-Six",
    tagline: "Bid the tricks you expect, then take exactly that many",
    players: "2-7 players",
    difficulty: "Easy to learn",
    color: "var(--accent-gold)",
    icon: "7",
    summary:
      "A trick-taking bidding game where hand sizes shrink then grow. Bid exactly how many tricks you'll take — hit your bid to score bid + 10, miss and you get zero. Trump is revealed each round by flipping a card.",
  },
];

export default function RulesPage() {
  const [activeGame, setActiveGame] = useState<"seven-six" | "euchre" | null>(
    null,
  );

  return (
    <div className="max-w-3xl mx-auto px-6 py-12">
      <div className="mb-6">
        <h1 className="font-serif text-4xl mb-3">Games & Rules</h1>
        <p className="text-[13px] text-[var(--text-secondary)]">
          Learn how to play. Click the game to see the full rules.
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
                style={{
                  backgroundColor: `color-mix(in srgb, ${game.color} 15%, transparent)`,
                }}
              >
                <span style={{ color: game.color }}>{game.icon}</span>
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex flex-wrap items-center gap-2.5 mb-0.5">
                  <h2 className="text-base font-bold">{game.title}</h2>
                  <span className="text-[11px] px-2 py-0.5 rounded-full bg-white/[0.06] text-[var(--text-muted)]">
                    {game.players}
                  </span>
                  <span className="text-[11px] px-2 py-0.5 rounded-full bg-white/[0.06] text-[var(--text-muted)]">
                    {game.difficulty}
                  </span>
                </div>
                <p className="text-[12px] text-[var(--accent-gold)] font-medium mb-1.5">
                  {game.tagline}
                </p>
                <p className="text-[13px] text-[var(--text-secondary)] leading-relaxed">
                  {game.summary}
                </p>
              </div>
              <div className="shrink-0 mt-1 text-[var(--text-muted)] group-hover:text-[var(--text-secondary)] transition-colors">
                <svg
                  className="w-5 h-5"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M9 5l7 7-7 7"
                  />
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
