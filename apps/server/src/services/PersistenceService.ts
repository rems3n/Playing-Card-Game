import { db } from '../config/database.js';
import { games, gamePlayers, gameEvents } from '../db/schema.js';
import { GameType } from '@card-game/shared-types';
import type { GameRoom } from './GameService.js';
import { RatingService } from './RatingService.js';

const ratingService = new RatingService();

export class PersistenceService {
  /**
   * Save a completed game to the database and update ratings.
   */
  async saveCompletedGame(
    gameId: string,
    room: GameRoom,
    winnerSeat: number,
  ): Promise<Array<{ userId: string; before: number; after: number; change: number }>> {
    const state = room.engine.getState();
    const events = room.engine.getEvents();

    const winnerPlayer = state.players[winnerSeat];
    const winnerId = winnerPlayer.userId;

    try {
      // Insert game record
      await db.insert(games).values({
        id: gameId,
        gameType: state.gameType,
        status: 'completed',
        config: state.config as unknown as Record<string, unknown>,
        finalScores: state.scores as unknown as Record<string, unknown>,
        winnerSeat,
        winnerId,
        completedAt: new Date(),
      });

      // Insert player records
      const playerValues = state.players.map((player) => ({
        gameId,
        userId: player.userId,
        seatPosition: player.seatIndex,
        isAi: player.isAI,
        aiDifficulty: player.aiDifficulty ?? null,
        aiPersona: player.isAI ? player.displayName : null,
        finalScore: state.scores[player.seatIndex],
      }));

      await db.insert(gamePlayers).values(playerValues);

      // Insert game events in batches
      if (events.length > 0) {
        const eventValues = events.map((event) => ({
          gameId,
          eventType: event.type,
          playerSeat: event.seatIndex ?? null,
          payload: event.payload as unknown as Record<string, unknown>,
          sequenceNum: event.sequenceNum,
        }));

        for (let i = 0; i < eventValues.length; i += 100) {
          await db.insert(gameEvents).values(eventValues.slice(i, i + 100));
        }
      }

      // ── Update ratings ──
      const placements = this.computePlacements(state.gameType, state.scores, state.players);
      const ratingChanges = await ratingService.updateRatings(state.gameType, placements);

      // Record rating snapshots for charts
      for (const change of ratingChanges) {
        await ratingService.recordSnapshot(change.userId, state.gameType);
      }

      console.log(
        `Game ${gameId} saved: winner seat ${winnerSeat}, ${events.length} events, ${ratingChanges.length} rating updates`,
      );

      return ratingChanges;
    } catch (err) {
      console.error(`Failed to save game ${gameId}:`, err);
      return [];
    }
  }

  /**
   * Compute placements from scores based on game type.
   * For Hearts: lower score = better placement.
   * For Spades/Euchre: partnerships share placement (team result).
   */
  private computePlacements(
    gameType: string,
    scores: number[],
    players: Array<{ seatIndex: number; userId: string | null; isAI: boolean }>,
  ) {
    if (gameType === GameType.Hearts) {
      // FFA — rank by score (lower is better in Hearts)
      const indexed = scores.map((score, i) => ({ score, index: i }));
      indexed.sort((a, b) => a.score - b.score);

      let placement = 1;
      return indexed.map((entry, i) => {
        if (i > 0 && entry.score > indexed[i - 1].score) {
          placement = i + 1;
        }
        const player = players[entry.index];
        return {
          userId: player.userId,
          seatIndex: entry.index,
          isAI: player.isAI,
          placement,
        };
      });
    }

    // Partnership games (Spades, Euchre): teams 0+2 vs 1+3
    const team1Score = scores[0]; // shared between 0 and 2
    const team2Score = scores[1]; // shared between 1 and 3

    const team1Placement = team1Score >= team2Score ? 1 : 2;
    const team2Placement = team1Score >= team2Score ? 2 : 1;

    return players.map((player) => ({
      userId: player.userId,
      seatIndex: player.seatIndex,
      isAI: player.isAI,
      placement: (player.seatIndex === 0 || player.seatIndex === 2)
        ? team1Placement
        : team2Placement,
    }));
  }

  async saveAbandonedGame(gameId: string, room: GameRoom): Promise<void> {
    const state = room.engine.getState();

    try {
      await db.insert(games).values({
        id: gameId,
        gameType: state.gameType,
        status: 'abandoned',
        config: state.config as unknown as Record<string, unknown>,
        finalScores: state.scores as unknown as Record<string, unknown>,
      });
    } catch (err) {
      console.error(`Failed to save abandoned game ${gameId}:`, err);
    }
  }
}
