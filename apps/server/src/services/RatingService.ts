import { eq, and } from 'drizzle-orm';
import { db } from '../config/database.js';
import { ratings, ratingHistory } from '../db/schema.js';

// ── Glicko-2 constants ──
const TAU = 0.5; // System constant (controls volatility change rate)
const CONVERGENCE_TOLERANCE = 0.000001;
const GLICKO2_SCALE = 173.7178; // Convert between Glicko and Glicko-2 scale

interface PlayerRating {
  rating: number;
  rd: number; // rating deviation
  vol: number; // volatility
}

interface MatchResult {
  opponentRating: number;
  opponentRd: number;
  score: number; // 1 = win, 0.5 = draw, 0 = loss
}

// ── Glicko-2 math ──

function g(rd: number): number {
  return 1 / Math.sqrt(1 + (3 * rd * rd) / (Math.PI * Math.PI));
}

function E(mu: number, muj: number, rdj: number): number {
  return 1 / (1 + Math.exp(-g(rdj) * (mu - muj)));
}

function computeVariance(mu: number, matches: MatchResult[]): number {
  let sum = 0;
  for (const match of matches) {
    const muj = (match.opponentRating - 1500) / GLICKO2_SCALE;
    const rdj = match.opponentRd / GLICKO2_SCALE;
    const gRd = g(rdj);
    const e = E(mu, muj, rdj);
    sum += gRd * gRd * e * (1 - e);
  }
  return 1 / sum;
}

function computeDelta(mu: number, v: number, matches: MatchResult[]): number {
  let sum = 0;
  for (const match of matches) {
    const muj = (match.opponentRating - 1500) / GLICKO2_SCALE;
    const rdj = match.opponentRd / GLICKO2_SCALE;
    sum += g(rdj) * (match.score - E(mu, muj, rdj));
  }
  return v * sum;
}

function computeNewVolatility(
  sigma: number,
  phi: number,
  v: number,
  delta: number,
): number {
  const a = Math.log(sigma * sigma);
  const phi2 = phi * phi;
  const delta2 = delta * delta;

  function f(x: number): number {
    const ex = Math.exp(x);
    const d = phi2 + v + ex;
    return (
      (ex * (delta2 - phi2 - v - ex)) / (2 * d * d) -
      (x - a) / (TAU * TAU)
    );
  }

  // Illinois algorithm to find the root
  let A = a;
  let B: number;
  if (delta2 > phi2 + v) {
    B = Math.log(delta2 - phi2 - v);
  } else {
    let k = 1;
    while (f(a - k * TAU) < 0) k++;
    B = a - k * TAU;
  }

  let fA = f(A);
  let fB = f(B);

  while (Math.abs(B - A) > CONVERGENCE_TOLERANCE) {
    const C = A + ((A - B) * fA) / (fB - fA);
    const fC = f(C);

    if (fC * fB <= 0) {
      A = B;
      fA = fB;
    } else {
      fA = fA / 2;
    }
    B = C;
    fB = fC;
  }

  return Math.exp(A / 2);
}

function updateGlicko2(player: PlayerRating, matches: MatchResult[]): PlayerRating {
  if (matches.length === 0) {
    // No matches — increase RD over time
    const phi = player.rd / GLICKO2_SCALE;
    const newPhi = Math.sqrt(phi * phi + player.vol * player.vol);
    return {
      rating: player.rating,
      rd: Math.min(newPhi * GLICKO2_SCALE, 350),
      vol: player.vol,
    };
  }

  const mu = (player.rating - 1500) / GLICKO2_SCALE;
  const phi = player.rd / GLICKO2_SCALE;

  const v = computeVariance(mu, matches);
  const delta = computeDelta(mu, v, matches);

  const newSigma = computeNewVolatility(player.vol, phi, v, delta);
  const phiStar = Math.sqrt(phi * phi + newSigma * newSigma);
  const newPhi = 1 / Math.sqrt(1 / (phiStar * phiStar) + 1 / v);

  let sum = 0;
  for (const match of matches) {
    const muj = (match.opponentRating - 1500) / GLICKO2_SCALE;
    const rdj = match.opponentRd / GLICKO2_SCALE;
    sum += g(rdj) * (match.score - E(mu, muj, rdj));
  }
  const newMu = mu + newPhi * newPhi * sum;

  return {
    rating: newMu * GLICKO2_SCALE + 1500,
    rd: Math.min(newPhi * GLICKO2_SCALE, 350),
    vol: newSigma,
  };
}

// ── Rating Service ──

interface GamePlayerResult {
  userId: string | null;
  seatIndex: number;
  isAI: boolean;
  placement: number; // 1 = best, higher = worse
}

export class RatingService {
  /**
   * Update ratings after a completed game.
   * Uses pairwise decomposition: each player is compared to every other player.
   * Returns rating changes for display.
   */
  async updateRatings(
    gameType: string,
    results: GamePlayerResult[],
  ): Promise<Array<{ userId: string; before: number; after: number; change: number }>> {
    // Filter to human players only (AI doesn't have ratings)
    const humanResults = results.filter((r) => !r.isAI && r.userId);
    if (humanResults.length === 0) return [];

    // Fetch current ratings for all human players
    const playerRatings = new Map<string, PlayerRating>();
    for (const result of humanResults) {
      const row = await db.query.ratings.findFirst({
        where: and(
          eq(ratings.userId, result.userId!),
          eq(ratings.gameType, gameType),
        ),
      });

      playerRatings.set(result.userId!, {
        rating: row?.rating ?? 1500,
        rd: row?.ratingDeviation ?? 350,
        vol: row?.volatility ?? 0.06,
      });
    }

    // Build AI ratings (fixed, used as opponents but not updated)
    const aiRatings = new Map<number, PlayerRating>();
    for (const result of results) {
      if (result.isAI) {
        aiRatings.set(result.seatIndex, {
          rating: 1500,
          rd: 350,
          vol: 0.06,
        });
      }
    }

    // Compute pairwise match results for each human player
    const changes: Array<{ userId: string; before: number; after: number; change: number }> = [];

    for (const player of humanResults) {
      const currentRating = playerRatings.get(player.userId!)!;
      const matches: MatchResult[] = [];

      for (const opponent of results) {
        if (opponent.seatIndex === player.seatIndex) continue;

        // For partnership games (same placement = teammate), skip
        if (opponent.placement === player.placement) continue;

        const opponentRating = opponent.isAI
          ? aiRatings.get(opponent.seatIndex)!
          : playerRatings.get(opponent.userId!) ?? { rating: 1500, rd: 350, vol: 0.06 };

        // Score: 1 if we placed better, 0 if worse, 0.5 if tied
        let score: number;
        if (player.placement < opponent.placement) {
          score = 1;
        } else if (player.placement > opponent.placement) {
          score = 0;
        } else {
          score = 0.5;
        }

        matches.push({
          opponentRating: opponentRating.rating,
          opponentRd: opponentRating.rd,
          score,
        });
      }

      const newRating = updateGlicko2(currentRating, matches);

      // Save to database
      await db
        .update(ratings)
        .set({
          rating: newRating.rating,
          ratingDeviation: newRating.rd,
          volatility: newRating.vol,
          gamesPlayed: (await db.query.ratings.findFirst({
            where: and(
              eq(ratings.userId, player.userId!),
              eq(ratings.gameType, gameType),
            ),
          }))!.gamesPlayed + 1,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(ratings.userId, player.userId!),
            eq(ratings.gameType, gameType),
          ),
        );

      changes.push({
        userId: player.userId!,
        before: Math.round(currentRating.rating),
        after: Math.round(newRating.rating),
        change: Math.round(newRating.rating - currentRating.rating),
      });
    }

    return changes;
  }

  /**
   * Record a daily rating snapshot for charts.
   */
  async recordSnapshot(userId: string, gameType: string): Promise<void> {
    const row = await db.query.ratings.findFirst({
      where: and(
        eq(ratings.userId, userId),
        eq(ratings.gameType, gameType),
      ),
    });
    if (!row) return;

    const today = new Date().toISOString().split('T')[0];

    await db
      .insert(ratingHistory)
      .values({
        userId,
        gameType,
        rating: row.rating,
        recordedAt: today,
      })
      .onConflictDoNothing();
  }
}
