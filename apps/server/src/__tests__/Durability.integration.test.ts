import { afterAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import Fastify from "fastify";
import { AIDifficulty, GameType } from "@card-game/shared-types";
import { GameService } from "../services/GameService.js";
import { RoomService } from "../services/RoomService.js";
import { GameStateStore } from "../services/GameStateStore.js";
import { PersistenceService } from "../services/PersistenceService.js";
import { db } from "../config/database.js";
import { redis } from "../config/redis.js";
import { games, gamePlayers, gameEvents } from "../db/schema.js";
import { issueSession } from "../middleware/auth.js";
import { gameRoutes } from "../routes/games.js";

// Run only against an isolated, migrated test database and Redis instance.
// CI enables this suite with disposable service containers.
describe.skipIf(process.env.RUN_DURABILITY_TESTS !== "1")(
  "Postgres and Redis durability",
  () => {
    const gameIds: string[] = [];
    const roomKeys: string[] = [];
    const app = Fastify();
    app.register(gameRoutes);
    afterAll(async () => {
      for (const id of gameIds) {
        await db.delete(games).where(eq(games.id, id));
        await new GameStateStore().remove(id);
      }
      for (const key of roomKeys) await redis.del(key);
      await app.close();
      await redis.quit();
      await db.$client.end();
    });
    it("restores a waiting room and the same guest game seat from Redis in a fresh service", async () => {
      const guest = randomUUID();
      const waiting = await new RoomService().create(
        GameType.SevenSix,
        { maxPlayers: 2 },
        {
          id: guest,
          socketId: "old",
          userId: null,
          displayName: "Alex",
          connected: true,
        },
      );
      roomKeys.push(`family-room:${waiting.id}`);
      expect((await new RoomService().load(waiting.id))?.hostId).toBe(guest);
      const first = new GameService();
      const id = first.createGame(GameType.SevenSix, { maxPlayers: 2 });
      gameIds.push(id);
      await first.joinGame(id, "old", "Alex", undefined, guest);
      const restored = new GameService();
      expect(await restored.joinGame(id, "new", "Alex", undefined, guest)).toBe(
        0,
      );
      expect(await restored.getSeatForSocket(id, "old")).toBeUndefined();
    });
    it("rolls back a failed result, then saves once under concurrent retries and restricts history", async () => {
      const service = new GameService(new GameStateStore(), async () => {});
      const id = service.createGame(GameType.Euchre, { targetScore: 1 });
      gameIds.push(id);
      await service.fillWithAI(id, AIDifficulty.Beginner);
      await service.startGame(id);
      await service.executeAITurns(id);
      const room = (await service.getRoom(id))!;
      const guest = randomUUID();
      room.participants.set(0, guest);
      const state = room.engine.getState();
      const invalidSeat = (room.engine.getWinnerSeat() + 1) % state.players.length;
      // Keep the winner valid so the game insert succeeds before the player FK fails.
      state.players[invalidSeat].userId = randomUUID();
      const persistence = new PersistenceService();
      await expect(
        persistence.saveCompletedGame(id, room, room.engine.getWinnerSeat()),
      ).rejects.toThrow();
      expect(
        await db.query.games.findFirst({ where: eq(games.id, id) }),
      ).toBeUndefined();
      state.players[invalidSeat].userId = null;
      await Promise.all([
        persistence.saveCompletedGame(id, room, room.engine.getWinnerSeat()),
        persistence.saveCompletedGame(id, room, room.engine.getWinnerSeat()),
      ]);
      expect(
        await db.select().from(gamePlayers).where(eq(gamePlayers.gameId, id)),
      ).toHaveLength(4);
      expect(
        await db.select().from(gameEvents).where(eq(gameEvents.gameId, id)),
      ).toHaveLength(room.engine.getEvents().length);
      const token = (
        await issueSession({ id: guest, name: "Alex", user: null })
      ).token;
      const history = await app.inject({
        url: "/api/games/history",
        headers: { authorization: `Bearer ${token}` },
      });
      expect(
        history.json().games.map((game: { id: string }) => game.id),
      ).toContain(id);
      const outsider = (
        await issueSession({ id: randomUUID(), name: "Alex", user: null })
      ).token;
      const hidden = await app.inject({
        url: `/api/games/${id}/events`,
        headers: { authorization: `Bearer ${outsider}` },
      });
      expect(hidden.statusCode).toBe(403);
    });
  },
);
