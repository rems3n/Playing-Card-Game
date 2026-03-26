import type { FastifyInstance } from 'fastify';
import { eq, desc, and, gt } from 'drizzle-orm';
import { db } from '../config/database.js';
import { users, ratings } from '../db/schema.js';

export async function leaderboardRoutes(fastify: FastifyInstance): Promise<void> {
  /**
   * GET /api/leaderboard?gameType=hearts&limit=50&offset=0
   * Get ranked players by rating for a specific game type.
   */
  fastify.get('/api/leaderboard', async (request) => {
    const query = request.query as {
      gameType?: string;
      limit?: string;
      offset?: string;
    };

    const gameType = query.gameType ?? 'hearts';
    const limit = Math.min(parseInt(query.limit ?? '50', 10), 100);
    const offset = parseInt(query.offset ?? '0', 10);

    const rows = await db
      .select({
        userId: ratings.userId,
        rating: ratings.rating,
        ratingDeviation: ratings.ratingDeviation,
        gamesPlayed: ratings.gamesPlayed,
        displayName: users.displayName,
        username: users.username,
        avatarUrl: users.avatarUrl,
      })
      .from(ratings)
      .innerJoin(users, eq(ratings.userId, users.id))
      .where(
        and(
          eq(ratings.gameType, gameType),
          gt(ratings.gamesPlayed, 0),
        ),
      )
      .orderBy(desc(ratings.rating))
      .limit(limit)
      .offset(offset);

    const entries = rows.map((row, i) => ({
      rank: offset + i + 1,
      userId: row.userId,
      displayName: row.displayName,
      username: row.username,
      avatarUrl: row.avatarUrl,
      rating: Math.round(row.rating),
      ratingDeviation: Math.round(row.ratingDeviation),
      gamesPlayed: row.gamesPlayed,
      provisional: row.ratingDeviation > 100,
    }));

    return { success: true, entries, gameType };
  });

  /**
   * GET /api/leaderboard/rank?gameType=hearts&email=...
   * Get a specific user's rank.
   */
  fastify.get('/api/leaderboard/rank', async (request, reply) => {
    const { gameType, email } = request.query as {
      gameType?: string;
      email?: string;
    };

    if (!email) {
      reply.status(400);
      return { error: 'Email required' };
    }

    const user = await db.query.users.findFirst({
      where: eq(users.email, email),
    });
    if (!user) return { success: true, rank: null };

    const userRating = await db.query.ratings.findFirst({
      where: and(
        eq(ratings.userId, user.id),
        eq(ratings.gameType, gameType ?? 'hearts'),
      ),
    });
    if (!userRating || userRating.gamesPlayed === 0) {
      return { success: true, rank: null };
    }

    // Count players with higher rating
    const higherCount = await db
      .select({ userId: ratings.userId })
      .from(ratings)
      .where(
        and(
          eq(ratings.gameType, gameType ?? 'hearts'),
          gt(ratings.gamesPlayed, 0),
          gt(ratings.rating, userRating.rating),
        ),
      );

    return {
      success: true,
      rank: higherCount.length + 1,
      rating: Math.round(userRating.rating),
    };
  });
}
