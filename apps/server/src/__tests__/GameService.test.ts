import { describe, expect, it, vi } from "vitest";
import {
  AIDifficulty,
  GameEventType,
  GamePhase,
  GameType,
} from "@card-game/shared-types";
import { GameService } from "../services/GameService.js";
import type { SerializedGame } from "../services/GameStateStore.js";

function memoryStore() {
  const data = new Map<string, SerializedGame>();
  return {
    save: vi.fn(async (id: string, value: SerializedGame) => {
      data.set(id, structuredClone(value));
    }),
    load: vi.fn(async (id: string) => structuredClone(data.get(id) ?? null)),
    remove: vi.fn(async (id: string) => {
      data.delete(id);
    }),
  };
}

describe("GameService bot scheduler", () => {
  it.each([GameType.FortyFives, GameType.SevenSix])(
    "finishes an all-bot %s game across round and bidding boundaries",
    async (gameType) => {
      const store = memoryStore();
      const service = new GameService(store, async () => {});
      const id = service.createGame(gameType);
      await service.fillWithAI(id, AIDifficulty.Beginner);
      await service.startGame(id);
      const run = service.executeAITurns(id);
      expect(service.executeAITurns(id)).toBe(run);
      await run;
      const room = (await service.getRoom(id))!;
      expect(room.engine.getState().phase).toBe(GamePhase.GameOver);
      const events = room.engine.getEvents();
      expect(
        events.filter((e) => e.type === GameEventType.GameEnded),
      ).toHaveLength(1);
      expect(new Set(events.map((e) => e.sequenceNum)).size).toBe(
        events.length,
      );
      expect((await store.load(id))!.engineData.state).toEqual(
        room.engine.getState(),
      );
    },
  );

  it("stops at a human turn and rejects a stranger joining an active game", async () => {
    const service = new GameService(memoryStore(), async () => {});
    const id = service.createGame(GameType.FortyFives);
    await service.joinGame(id, "human", "Alex", "user-1");
    await service.fillWithAI(id, AIDifficulty.Beginner);
    await service.startGame(id);
    await service.executeAITurns(id);
    expect(await service.getCurrentSeat(id)).toBe(0);
    await expect(service.joinGame(id, "stranger", "Alex")).rejects.toThrow(
      "already started",
    );
    expect(await service.joinGame(id, "human", "Alex", "user-1")).toBe(0);
  });

  it("cancels a delayed bot action when its game is removed", async () => {
    let release!: () => void;
    let entered!: () => void;
    const waiting = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const service = new GameService(memoryStore(), () => {
      entered();
      return new Promise<void>((resolve) => {
        release = resolve;
      });
    });
    const id = service.createGame(GameType.FortyFives);
    await service.fillWithAI(id, AIDifficulty.Beginner);
    await service.startGame(id);
    const room = (await service.getRoom(id))!;
    const count = room.engine.getEvents().length;
    const run = service.executeAITurns(id);
    await waiting;
    await service.removeGame(id);
    release();
    await run;
    expect(room.engine.getEvents()).toHaveLength(count);
  });

  it("restores one shared engine for simultaneous requests", async () => {
    const store = memoryStore();
    const first = new GameService(store);
    const id = first.createGame(GameType.FortyFives);
    await first.joinGame(id, "before", "Alex", "user-1");
    const restored = new GameService(store);
    const [one, two] = await Promise.all([
      restored.getRoom(id),
      restored.getRoom(id),
    ]);
    expect(one).toBe(two);
    expect(store.load).toHaveBeenCalledTimes(1);
    await restored.joinGame(id, "after", "Alex", "user-1");
    expect(one!.socketSeats.has("before")).toBe(false);
    expect(one!.socketSeats.get("after")).toBe(0);
  });

  it("restores signed guest identity and rejects commands from the previous connection", async () => {
    const store = memoryStore();
    const service = new GameService(store);
    const id = service.createGame(GameType.SevenSix, { maxPlayers: 2 });
    await service.joinGame(id, "before", "Alex", undefined, "signed-guest");
    service.handlePlayerDisconnect(id, "before");
    expect(await service.getSeatForSocket(id, "before")).toBeUndefined();
    const restored = new GameService(store);
    expect(
      await restored.joinGame(id, "after", "Alex", undefined, "signed-guest"),
    ).toBe(0);
    expect(await restored.getSeatForSocket(id, "before")).toBeUndefined();
    expect(await restored.getSeatForSocket(id, "after")).toBe(0);
  });

  it("only replaces a valid disconnected player and counts connected humans", async () => {
    const service = new GameService(memoryStore());
    const id = service.createGame(GameType.FortyFives);
    await service.joinGame(id, "human", "Alex");
    await expect(service.replaceWithAI(id, 9)).rejects.toThrow("Invalid seat");
    await expect(service.replaceWithAI(id, 0)).rejects.toThrow(
      "still connected",
    );
    expect(service.getConnectedHumanCount(id)).toBe(1);
    service.handlePlayerDisconnect(id, "human");
    expect(service.getConnectedHumanCount(id)).toBe(0);
    await service.replaceWithAI(id, 0);
    expect((await service.getRoom(id))!.aiPlayers.has(0)).toBe(true);
  });
});
