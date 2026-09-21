import type { FastifyInstance } from "fastify";
import { eq, and, desc, or } from "drizzle-orm";
import { db } from "../config/database.js";
import { games, gamePlayers, gameEvents } from "../db/schema.js";
import { requireParticipant } from "../middleware/auth.js";

export async function gameRoutes(fastify: FastifyInstance): Promise<void> {
  /**
   * GET /api/games/history
   * Get the current user's game history.
   */
  fastify.get(
    "/api/games/history",
    {
      preHandler: requireParticipant,
    },
    async (request) => {
      const participant = request.participant;
      const query = request.query as { limit?: string; offset?: string };
      const limit = Math.max(
        1,
        Math.min(Math.floor(Number(query.limit)) || 20, 50),
      );
      const offset = Math.max(0, Math.floor(Number(query.offset) || 0));

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
            or(
              eq(gamePlayers.participantId, participant.id),
              participant.user
                ? eq(gamePlayers.userId, participant.user.id)
                : undefined,
            ),
            eq(games.status, "completed"),
          ),
        )
        .orderBy(desc(games.completedAt))
        .limit(limit)
        .offset(offset);

      // For each game, get all players
      const gameIds = playerGames.map((pg) => pg.gameId);
      const allPlayers =
        gameIds.length > 0
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
            displayName: p.displayName ?? p.aiPersona ?? "Player",
            isAi: p.isAi,
            aiPersona: p.aiPersona,
            finalScore: p.finalScore,
          })),
      }));

      return { success: true, games: history };
    },
  );

  /**
   * GET /api/games/:id/events
   * Get game events for replay.
   */
  fastify.get(
    "/api/games/:id/events",
    { preHandler: requireParticipant },
    async (request, reply) => {
      const { id } = request.params as { id: string };

      const membership = await db.query.gamePlayers.findFirst({
        where: and(
          eq(gamePlayers.gameId, id),
          or(
            eq(gamePlayers.participantId, request.participant.id),
            request.participant.user
              ? eq(gamePlayers.userId, request.participant.id)
              : undefined,
          ),
        ),
      });
      if (!membership)
        return reply.code(403).send({ error: "This game is private" });
      const events = await db.query.gameEvents.findMany({
        where: eq(gameEvents.gameId, id),
        orderBy: (ge, { asc }) => [asc(ge.sequenceNum)],
      });

      return { success: true, events };
    },
  );
}
