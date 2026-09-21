import { db } from "../config/database.js";
import { games, gamePlayers, gameEvents } from "../db/schema.js";
import type { GameRoom } from "./GameService.js";

export class PersistenceService {
  // The game row is the idempotency key. A failed player/event insert rolls back
  // the entire result, so reconnect can safely retry the same completed game.
  async saveCompletedGame(
    gameId: string,
    room: GameRoom,
    winnerSeat: number,
  ): Promise<
    Array<{ userId: string; before: number; after: number; change: number }>
  > {
    const state = room.engine.getState();
    const events = room.engine.getEvents();
    await db.transaction(async (tx) => {
      const inserted = await tx
        .insert(games)
        .values({
          id: gameId,
          gameType: state.gameType,
          status: "completed",
          config: state.config as unknown as Record<string, unknown>,
          finalScores: state.scores as unknown as Record<string, unknown>,
          winnerSeat,
          winnerId: state.players[winnerSeat]?.userId ?? null,
          completedAt: new Date(),
        })
        .onConflictDoNothing({ target: games.id })
        .returning({ id: games.id });
      if (!inserted.length) return;
      await tx.insert(gamePlayers).values(
        state.players.map((player) => ({
          gameId,
          userId: player.userId,
          participantId: room.participants.get(player.seatIndex) ?? null,
          displayName: player.displayName,
          seatPosition: player.seatIndex,
          isAi: player.isAI,
          aiDifficulty: player.aiDifficulty ?? null,
          aiPersona: player.isAI ? player.displayName : null,
          finalScore: state.scores[player.seatIndex],
        })),
      );
      for (let i = 0; i < events.length; i += 100) {
        await tx.insert(gameEvents).values(
          events.slice(i, i + 100).map((event) => ({
            gameId,
            eventType: event.type,
            playerSeat: event.seatIndex ?? null,
            payload: event.payload as Record<string, unknown>,
            sequenceNum: event.sequenceNum,
          })),
        );
      }
    });
    // Family and practice games are casual. Ranked ratings need a separate,
    // transactional policy before they can be updated by these results.
    return [];
  }
  async saveAbandonedGame(gameId: string, room: GameRoom): Promise<void> {
    const state = room.engine.getState();
    await db
      .insert(games)
      .values({
        id: gameId,
        gameType: state.gameType,
        status: "abandoned",
        config: state.config as unknown as Record<string, unknown>,
        finalScores: state.scores as unknown as Record<string, unknown>,
      })
      .onConflictDoNothing({ target: games.id });
  }
}
