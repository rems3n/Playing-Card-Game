import type { FastifyInstance } from 'fastify';
import { eq, and, desc } from 'drizzle-orm';
import { db } from '../config/database.js';
import { users, ratingHistory } from '../db/schema.js';

export async function ratingHistoryRoutes(fastify: FastifyInstance): Promise<void> {
  /**
   * GET /api/ratings/history?email=...&gameType=hearts&days=30
   * Get rating history for charting.
   */
  fastify.get('/api/ratings/history', async (request, reply) => {
    const { email, gameType, days } = request.query as {
      email?: string;
      gameType?: string;
      days?: string;
    };

    if (!email) {
      reply.status(400);
      return { error: 'Email required' };
    }

    const user = await db.query.users.findFirst({
      where: eq(users.email, email),
    });
    if (!user) return { success: true, history: [] };

    const limit = Math.min(parseInt(days ?? '30', 10), 365);

    const rows = await db.query.ratingHistory.findMany({
      where: and(
        eq(ratingHistory.userId, user.id),
        eq(ratingHistory.gameType, gameType ?? 'hearts'),
      ),
      orderBy: [desc(ratingHistory.recordedAt)],
      limit,
    });

    return {
      success: true,
      history: rows.reverse().map((r) => ({
        date: r.recordedAt,
        rating: Math.round(r.rating),
      })),
    };
  });
}
