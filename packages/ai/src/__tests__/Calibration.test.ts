import { afterEach, describe, expect, it, vi } from "vitest";
import { AIDifficulty, GamePhase, GameType } from "@card-game/shared-types";
import {
  FortyFivesEngine,
  SevenSixEngine,
  type GameEngine,
} from "@card-game/game-engine";
import { createAIPlayer } from "../strategies/StrategyFactory.js";
import type { AIPlayer } from "../AIPlayer.js";

/**
 * The tiers, played against each other.
 *
 * A difficulty setting is a promise: Expert should beat Medium, and Medium
 * should beat Beginner, often enough that a person can feel it. These games
 * are seeded, so a change that quietly makes two tiers play alike fails here
 * rather than at someone's table. The margins are deliberately below what
 * the tiers achieve, so a small engine change does not flip them.
 */
function rng(seed: number) {
  return () => {
    seed = (Math.imul(1664525, seed) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}

/** Fewer imagined deals than the table uses keeps the suite quick. */
const PLAYOUTS = 60;

function bots(tiers: AIDifficulty[]): AIPlayer[] {
  return tiers.map((tier, seat) =>
    createAIPlayer(tier, `${tier} ${seat}`, { playouts: PLAYOUTS }),
  );
}

/** Drives one whole game with the given bot at each seat. */
function play(engine: GameEngine, players: AIPlayer[], maxSteps = 5000) {
  engine.setRoundPause(false);
  (engine as FortyFivesEngine | SevenSixEngine).startGame();
  let steps = 0;
  while (engine.getState().phase !== GamePhase.GameOver && steps++ < maxSteps) {
    const state = engine.getState();
    const seat = state.currentPlayerSeat;
    const view = engine.getVisibleState(seat);
    const bot = players[seat];
    if (state.phase === GamePhase.Bidding) {
      if (engine instanceof FortyFivesEngine) {
        if (engine.getLegalTrumpCalls(seat).length)
          engine.callTrump(seat, bot.chooseTrump(view));
        else {
          const bid = bot.chooseBid(view);
          engine.placeBid(seat, bid === "pass" ? -1 : bid);
        }
      } else {
        const bid = bot.chooseBid(view);
        (engine as SevenSixEngine).placeBid(seat, bid === "pass" ? 0 : bid);
      }
    } else if (state.phase === GamePhase.Playing) {
      const card = bot.chooseCard(view);
      expect(view.legalMoves).toContainEqual(card);
      engine.playCard(seat, card);
    } else {
      throw new Error(`Stuck in ${state.phase}`);
    }
  }
  expect(engine.getState().phase).toBe(GamePhase.GameOver);
  return engine.getState().scores;
}

afterEach(() => vi.restoreAllMocks());

describe("45s: teams of one tier against teams of another", () => {
  // Seats 0 and 2 are one side, 1 and 3 the other. Each seed is played
  // both ways round: the side holding the first deal wins three games in
  // four between equal bots, so one orientation alone measures the deal
  // order, not the tiers.
  function series(a: AIDifficulty, b: AIDifficulty, seeds: number) {
    let wins = 0;
    for (let seed = 1; seed <= seeds; seed++) {
      for (const aFirst of [true, false]) {
        vi.spyOn(Math, "random").mockImplementation(rng(seed));
        const engine = new FortyFivesEngine(`cal-${seed}`, {
          maxPlayers: 4,
          targetScore: 45,
        });
        const scores = play(engine, bots(aFirst ? [a, b, a, b] : [b, a, b, a]));
        const aScore = aFirst ? scores[0] : scores[1];
        const bScore = aFirst ? scores[1] : scores[0];
        if (aScore > bScore) wins++;
        vi.restoreAllMocks();
      }
    }
    return wins / (2 * seeds);
  }

  it("Medium beats Beginner", () => {
    expect(series(AIDifficulty.Intermediate, AIDifficulty.Beginner, 12)).toBeGreaterThanOrEqual(0.7);
  });

  it("Expert beats Medium", () => {
    // Measured at 0.67 over these seeds; the bar sits below that so a small
    // engine change does not flip it, and above one half, where it would
    // mean nothing.
    expect(series(AIDifficulty.Expert, AIDifficulty.Intermediate, 12)).toBeGreaterThanOrEqual(0.55);
  }, 180_000);
});

describe("Seven-Six: one seat of a tier among three of the tier below", () => {
  /**
   * How often the stronger seat finishes with the top score, alone or
   * shared. The seat moves round the table with the seed, so the first
   * dealer's position is not what is being measured.
   */
  function series(a: AIDifficulty, b: AIDifficulty, games: number) {
    let firsts = 0;
    for (let seed = 1; seed <= games; seed++) {
      const strong = seed % 4;
      vi.spyOn(Math, "random").mockImplementation(rng(seed));
      const engine = new SevenSixEngine(`cal-${seed}`, { maxPlayers: 4 });
      const tiers = [b, b, b, b];
      tiers[strong] = a;
      const scores = play(engine, bots(tiers));
      if (scores[strong] >= Math.max(...scores)) firsts++;
      vi.restoreAllMocks();
    }
    return firsts / games;
  }

  // Four players: a seat that plays no better than the rest finishes first
  // about a quarter of the time.
  it("Medium beats Beginners", () => {
    expect(series(AIDifficulty.Intermediate, AIDifficulty.Beginner, 16)).toBeGreaterThanOrEqual(0.6);
  });

  it("Expert beats Mediums", () => {
    expect(series(AIDifficulty.Expert, AIDifficulty.Intermediate, 10)).toBeGreaterThanOrEqual(0.5);
  }, 240_000);
});

describe("every tier only ever bids and plays what is legal", () => {
  it.each([AIDifficulty.Beginner, AIDifficulty.Intermediate, AIDifficulty.Expert])(
    "%s finishes both games",
    (tier) => {
      vi.spyOn(Math, "random").mockImplementation(rng(99));
      // A short target: four Beginners bidding at random fail as often as
      // they succeed, and their scores can drift for hundreds of hands.
      play(new FortyFivesEngine("legal-45", { maxPlayers: 4, targetScore: 15 }), bots([tier, tier, tier, tier]));
      vi.restoreAllMocks();
      vi.spyOn(Math, "random").mockImplementation(rng(98));
      play(new SevenSixEngine("legal-76", { maxPlayers: 3 }), bots([tier, tier, tier]));
    },
    120_000,
  );
});

describe("the tiers are distinct strategies", () => {
  it("does not hand Advanced or Expert the Medium code path", () => {
    const medium = createAIPlayer(AIDifficulty.Intermediate);
    const expert = createAIPlayer(AIDifficulty.Expert);
    expect(expert.constructor).not.toBe(medium.constructor);
    expect(createAIPlayer(AIDifficulty.Beginner).constructor).not.toBe(medium.constructor);
  });
  it("uses the game type the state says, not the bot's own idea of it", () => {
    expect(createAIPlayer(AIDifficulty.Expert).difficulty).toBe(AIDifficulty.Expert);
    expect(createAIPlayer(AIDifficulty.Intermediate).difficulty).toBe(AIDifficulty.Intermediate);
    expect(createAIPlayer(AIDifficulty.Beginner).difficulty).toBe(AIDifficulty.Beginner);
    expect(GameType.FortyFives).toBe("forty-fives");
  });
});
