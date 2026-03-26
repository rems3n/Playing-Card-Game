import type { FastifyInstance } from 'fastify';
import { eq, and, desc } from 'drizzle-orm';
import { db } from '../config/database.js';
import { games, gamePlayers, gameEvents } from '../db/schema.js';
import { requireAuth, type AuthUser } from '../middleware/auth.js';

export async function gameRoutes(fastify: FastifyInstance): Promise<void> {
  /**
   * GET /api/games/history
   * Get the current user's game history.
   */
  fastify.get('/api/games/history', {
    preHandler: requireAuth,
  }, async (request) => {
    const authUser = (request as any).user as AuthUser;
    const query = request.query as { limit?: string; offset?: string };
    const limit = Math.min(parseInt(query.limit ?? '20', 10), 50);
    const offset = parseInt(query.offset ?? '0', 10);

    // Find games this user participated in
    const playerGames = await db
      .select({
        gameId: gamePlayers.gameId,
        seatPosition: gamePlayers.seatPosition,
        finalScore: gamePlayers.finalScore,
        game: {
          id: games.id,
          gameType: games.gameType,
          status: games.status,
          config: games.config,
          finalScores: games.finalScores,
          winnerSeat: games.winnerSeat,
          winnerId: games.winnerId,
          createdAt: games.createdAt,
          completedAt: games.completedAt,
        },
      })
      .from(gamePlayers)
      .innerJoin(games, eq(gamePlayers.gameId, games.id))
      .where(
        and(
          eq(gamePlayers.userId, authUser.id),
          eq(games.status, 'completed'),
        ),
      )
      .orderBy(desc(games.completedAt))
      .limit(limit)
      .offset(offset);

    // For each game, get all players
    const gameIds = playerGames.map((pg) => pg.gameId);
    const allPlayers = gameIds.length > 0
      ? await db.query.gamePlayers.findMany({
          where: (gp, { inArray }) => inArray(gp.gameId, gameIds),
        })
      : [];

    const history = playerGames.map((pg) => ({
      ...pg.game,
      myScore: pg.finalScore,
      mySeat: pg.seatPosition,
      players: allPlayers
        .filter((p) => p.gameId === pg.gameId)
        .map((p) => ({
          seatPosition: p.seatPosition,
          isAi: p.isAi,
          aiPersona: p.aiPersona,
          finalScore: p.finalScore,
        })),
    }));

    return { success: true, games: history };
  });

  /**
   * GET /api/games/:id/events
   * Get game events for replay.
   */
  fastify.get('/api/games/:id/events', async (request) => {
    const { id } = request.params as { id: string };

    const events = await db.query.gameEvents.findMany({
      where: eq(gameEvents.gameId, id),
      orderBy: (ge, { asc }) => [asc(ge.sequenceNum)],
    });

    return { success: true, events };
  });
}
