import { describe, expect, it } from "vitest";
import { AIDifficulty, GamePhase, GameType } from "@card-game/shared-types";
import { HeartsEngine, SpadesEngine } from "@card-game/game-engine";
import { GameService } from "../services/GameService.js";
import { RoomService } from "../services/RoomService.js";
import type { SerializedGame } from "../services/GameStateStore.js";

/**
 * Hearts, Spades and Rummy through the same service the table uses, with
 * bots at the strongest level in every other seat. Each game runs to the end:
 * a passing phase nobody could finish, a bid the server refuses, or a bot
 * that cannot take its turn would leave the phase stuck and fail here.
 */
function storage() {
  const saved = new Map<string, SerializedGame>();
  return {
    save: async (id: string, data: SerializedGame) => {
      saved.set(id, structuredClone(data));
    },
    load: async (id: string) => structuredClone(saved.get(id) ?? null),
    remove: async (id: string) => {
      saved.delete(id);
    },
  };
}

/** Plays seat 0 like a person who always does the first legal thing. */
async function driveHuman(service: GameService, id: string, maxSteps = 4000) {
  const room = (await service.getRoom(id))!;
  let steps = 0;
  while (room.engine.getState().phase !== GamePhase.GameOver && steps++ < maxSteps) {
    await service.executeAITurns(id);
    const state = room.engine.getState();
    if (state.phase === GamePhase.GameOver) break;
    if (state.phase === GamePhase.Passing && room.engine instanceof HeartsEngine) {
      if (!room.engine.hasPlayerPassed(0))
        await service.passCards(id, 0, room.engine.getState().players[0].hand.slice(0, 3));
      continue;
    }
    if (state.currentPlayerSeat !== 0) {
      // Bots move on their own; a phase where nobody can act is a defect.
      const before = room.engine.getEvents().length;
      await service.executeAITurns(id);
      if (room.engine.getEvents().length === before && room.engine.getState().phase === state.phase)
        throw new Error(`Nobody can act in ${state.phase} at seat ${state.currentPlayerSeat}`);
      continue;
    }
    if (state.phase === GamePhase.Bidding && room.engine instanceof SpadesEngine) {
      await service.placeBid(id, 0, 3);
      continue;
    }
    if (state.phase === GamePhase.Playing) {
      const moves = room.engine.getLegalMoves(0);
      await service.playCard(id, 0, moves[0]);
      await service.waitForTrickReview(id);
      continue;
    }
    if (state.phase === GamePhase.RoundScoring) {
      await service.dealNextRound(id, state.roundNumber).catch(() => {});
      continue;
    }
    throw new Error(`Unhandled phase ${state.phase}`);
  }
  expect(room.engine.getState().phase).toBe(GamePhase.GameOver);
  return room.engine.getState();
}

describe("the other games run end to end against Expert bots", () => {
  it("Hearts: a person passes and plays, three bots do the rest", async () => {
    const service = new GameService(storage(), async () => {});
    const id = service.createGame(GameType.Hearts, { targetScore: 30 }, AIDifficulty.Expert);
    await service.joinGame(id, "human", "You");
    await service.fillWithAI(id, AIDifficulty.Expert);
    await service.startGame(id);
    const state = await driveHuman(service, id);
    expect(Math.max(...state.scores)).toBeGreaterThanOrEqual(30);
    expect(state.players).toHaveLength(4);
  }, 60_000);

  it("Spades: a person bids and plays, the pairs score to the target", async () => {
    const service = new GameService(storage(), async () => {});
    const id = service.createGame(GameType.Spades, { targetScore: 60 }, AIDifficulty.Expert);
    await service.joinGame(id, "human", "You");
    await service.fillWithAI(id, AIDifficulty.Expert);
    await service.startGame(id);
    const state = await driveHuman(service, id);
    expect(Math.max(...state.scores)).toBeGreaterThanOrEqual(60);
  }, 60_000);

  it("Rummy: four bots draw, meld and discard to a finish", async () => {
    const service = new GameService(storage(), async () => {});
    const id = service.createGame(GameType.Rummy, { maxPlayers: 4, targetScore: 30 }, AIDifficulty.Expert);
    await service.fillWithAI(id, AIDifficulty.Expert);
    await service.startGame(id);
    await service.executeAITurns(id);
    const room = (await service.getRoom(id))!;
    expect(room.engine.getState().phase).toBe(GamePhase.GameOver);
  }, 60_000);
});

describe("rooms for the other games", () => {
  const rooms = () =>
    new RoomService({
      get: async () => null,
      set: async () => "OK",
    } as never);
  const host = { id: "h", socketId: "s", displayName: "Host", connected: true };

  it("seats four at Hearts and Spades, two to six at Rummy, and refuses the rest", async () => {
    await expect(rooms().create(GameType.Hearts, { maxPlayers: 4 }, host)).resolves.toMatchObject({ maxPlayers: 4, config: { targetScore: 100 } });
    await expect(rooms().create(GameType.Hearts, { maxPlayers: 3 }, host)).rejects.toThrow("Invalid player count");
    await expect(rooms().create(GameType.Spades, {}, host)).resolves.toMatchObject({ maxPlayers: 4, config: { targetScore: 500 } });
    await expect(rooms().create(GameType.Rummy, { maxPlayers: 6 }, host)).resolves.toMatchObject({ maxPlayers: 6 });
    await expect(rooms().create(GameType.Rummy, { maxPlayers: 7 }, host)).rejects.toThrow("Invalid player count");
    await expect(rooms().create(GameType.FortyFives, { maxPlayers: 3 }, host)).rejects.toThrow("Invalid player count");
  });

  it("keeps the bot level the host chose, and rejects one that is not a level", async () => {
    await expect(rooms().create(GameType.Hearts, { aiDifficulty: AIDifficulty.Expert }, host)).resolves.toMatchObject({ config: { aiDifficulty: "expert" } });
    await expect(rooms().create(GameType.Hearts, { aiDifficulty: "wizard" as AIDifficulty }, host)).rejects.toThrow("Invalid bot difficulty");
  });
});
