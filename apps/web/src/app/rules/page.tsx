"use client";

import { useState } from "react";
import { RulesModal } from "@/components/RulesModal";

const GAMES = [
  {
    type: "forty-fives" as const,
    title: "45s",
    tagline: "Bid for trump, then take the tricks",
    players: "2, 4 or 6 players",
    difficulty: "Bidding and partnerships",
    color: "var(--accent-green)",
    icon: "45",
    summary:
      "Bid 15, 20, 25 or 30 for the right to name trump. Each trick is worth 5 and the highest trump another 5. The 5 of trump is the highest card, then the jack, then the ace of hearts. First side to 45 wins.",
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
  {
    type: "hearts" as const,
    title: "Hearts",
    tagline: "Avoid the hearts and the queen of spades",
    players: "4 players",
    difficulty: "Passing and avoidance",
    color: "#c33",
    icon: "\u2665",
    summary:
      "Pass three cards, then take as few penalty cards as you can: each heart is a point and the queen of spades thirteen. Take them all to shoot the moon. Lowest score when someone reaches 100 wins.",
  },
  {
    type: "spades" as const,
    title: "Spades",
    tagline: "Bid your tricks with spades always trump",
    players: "4 players, in pairs",
    difficulty: "Bidding and partnerships",
    color: "#1a1a1a",
    icon: "\u2660",
    summary:
      "Partners sit across. Each player bids the tricks they will take; a pair that makes its combined bid scores ten a trick, and bags and failed bids cost. Nil is a bid to take none. First pair to 500.",
  },
  {
    type: "rummy" as const,
    title: "Rummy",
    tagline: "Draw, discard, and lay down sets and runs",
    players: "2\u20136 players",
    difficulty: "Melding",
    color: "var(--accent-green)",
    icon: "R",
    summary:
      "Draw from the stock or the discard pile, lay down three of a kind or runs in a suit, and discard. Going out ends the hand; the cards left in other hands count against them.",
  },
];

export default function RulesPage() {
  const [activeGame, setActiveGame] = useState<"seven-six" | "forty-fives" | "hearts" | "spades" | "rummy" | null>(
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
