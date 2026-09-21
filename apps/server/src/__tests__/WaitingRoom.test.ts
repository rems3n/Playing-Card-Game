import { describe, expect, it, vi } from "vitest";
import { GameType, type WaitingRoomState } from "@card-game/shared-types";
import { RoomService } from "../services/RoomService.js";
import { GameService } from "../services/GameService.js";
import { setupGameHandlers } from "../socket/gameRoom.js";

vi.mock("../services/PersistenceService.js", () => ({
  PersistenceService: class {},
}));
vi.mock("../services/PresenceService.js", () => ({
  PresenceService: class {},
}));
vi.mock("../services/MatchmakingService.js", () => ({
  MatchmakingService: class {
    async leaveAllQueues() {}
  },
}));

// Exercise the real registered handlers; only the network transport and storage
// are in memory. Distinct clients intentionally have the same display name.
function fixture() {
  type Handler = (data: any) => unknown;
  const clients = new Map<string, ReturnType<typeof connect>>();
  let onConnection: Handler;
  const io = {
    on: (_: string, handler: Handler) => {
      onConnection = handler;
    },
    sockets: { sockets: clients },
    to: (room: string) => ({
      emit: (event: string, data: any) => {
        for (const client of clients.values())
          if (client.id === room || client.rooms.has(room))
            client.emit(event, data);
      },
    }),
  };
  const service = new GameService(
    { save: async () => {}, load: async () => null, remove: async () => {} },
    async () => {},
  );
  vi.spyOn(service, "executeAITurns").mockResolvedValue();
  const create = vi.spyOn(service, "createGame");
  const records = new Map<string, string>();
  const rooms = new RoomService({
    get: async (key: string) => records.get(key) ?? null,
    set: async (key: string, value: string) => {
      records.set(key, value);
      return "OK";
    },
  } as any);
  setupGameHandlers(
    io as unknown as Parameters<typeof setupGameHandlers>[0],
    service,
    rooms,
  );
  function connect(id: string, participantId = id) {
    const handlers = new Map<string, Handler>();
    const sent: Array<{ event: string; data: any }> = [];
    const client = {
      id,
      data: { displayName: "Alex", participantId },
      rooms: new Set<string>(),
      sent,
      on: (event: string, handler: Handler) => {
        handlers.set(event, handler);
      },
      emit: (event: string, data: any) => {
        sent.push({ event, data });
      },
      join: async (room: string) => {
        client.rooms.add(room);
      },
      leave: (room: string) => {
        client.rooms.delete(room);
      },
      send: async (event: string, data: any) => {
        await handlers.get(event)!(data);
      },
      last: (event: string) =>
        sent.filter((entry) => entry.event === event).at(-1)?.data,
    };
    clients.set(id, client);
    onConnection(client);
    return client;
  }
  return { connect, service, create, rooms };
}

describe("waiting room regressions", () => {
  it("identifies the host per client even when names match; repeated joins to a full room work", async () => {
    const { connect } = fixture();
    const host = connect("host");
    const guest = connect("guest");
    await host.send("room:create", {
      gameType: GameType.SevenSix,
      config: { maxPlayers: 2 },
    });
    const { roomId } = host.last("room:created");
    await guest.send("room:join", { roomId });
    await host.send("room:join", { roomId });
    const hostState = host.last("room:update") as WaitingRoomState;
    const guestState = guest.last("room:update") as WaitingRoomState;
    expect(hostState.players[hostState.mySeat!].isHost).toBe(true);
    expect(guestState.players[guestState.mySeat!].isHost).toBe(false);
    expect(host.last("room:error")).toBeUndefined();
    await guest.send("room:start", { roomId });
    expect(guest.last("room:error").message).toContain("Only the host");
    await host.send("room:leave", { roomId });
    expect(guest.last("room:update").players[0].isHost).toBe(true);
    expect(guest.last("room:update").mySeat).toBe(0);
  });

  it("creates only one game for overlapping start requests", async () => {
    const { connect, create } = fixture();
    const host = connect("host");
    const guest = connect("guest");
    await host.send("room:create", { gameType: GameType.Euchre });
    const { roomId } = host.last("room:created");
    await guest.send("room:join", { roomId });
    await Promise.all([
      host.send("room:start", { roomId }),
      host.send("room:start", { roomId }),
    ]);
    expect(create).toHaveBeenCalledTimes(1);
    expect(
      host.sent.filter((entry) => entry.event === "room:started"),
    ).toHaveLength(1);
    expect(guest.last("room:started")).toEqual(host.last("room:started"));
  });

  it("reports start failures and allows retry", async () => {
    const { connect, service } = fixture();
    const host = connect("host");
    const guest = connect("guest");
    await host.send("room:create", { gameType: GameType.Euchre });
    const { roomId } = host.last("room:created");
    await guest.send("room:join", { roomId });
    vi.spyOn(service, "startGame").mockRejectedValueOnce(
      new Error("Storage unavailable"),
    );
    await host.send("room:start", { roomId });
    expect(host.last("room:error").message).toBe("Storage unavailable");
    await host.send("room:start", { roomId });
    expect(host.last("room:started").gameId).toBeDefined();
  });

  it("restores the same guest seat after refresh and refuses duplicate seats", async () => {
    const { connect } = fixture();
    const host = connect("host", "stable-host");
    const guest = connect("guest", "stable-guest");
    await host.send("room:create", {
      gameType: GameType.SevenSix,
      config: { maxPlayers: 2 },
    });
    const { roomId } = host.last("room:created");
    await guest.send("room:join", { roomId });
    const refreshed = connect("new-tab", "stable-host");
    await refreshed.send("room:join", { roomId });
    expect(refreshed.last("room:update").players).toHaveLength(2);
    expect(refreshed.last("room:update").mySeat).toBe(0);
    await host.send("room:start", { roomId });
    expect(host.last("room:error").message).toContain("Only the host");
    await refreshed.send("room:start", { roomId });
    expect(refreshed.last("room:started").gameId).toBeDefined();
    await refreshed.send("room:join", { roomId });
    expect(refreshed.last("room:started").gameId).toBeDefined();
  });

  it("holds a disconnected host for 90 seconds, then transfers ownership", async () => {
    const { connect, rooms } = fixture();
    const host = connect("host");
    const guest = connect("guest");
    await host.send("room:create", { gameType: GameType.Euchre });
    const { roomId } = host.last("room:created");
    await guest.send("room:join", { roomId });
    const room = (await rooms.load(roomId))!;
    rooms.reconcile(room, (id) => id === "guest", 1000);
    expect(room.hostId).toBe("host");
    rooms.reconcile(room, (id) => id === "guest", 91000);
    expect(room.hostId).toBe("guest");
    expect(room.players).toHaveLength(1);
  });

  it("rejects destructive commands from sockets outside the game", async () => {
    const { connect, service } = fixture();
    const stranger = connect("stranger");
    const gameId = service.createGame(GameType.Euchre);
    await stranger.send("game:end", { gameId });
    expect(stranger.last("game:error").code).toBe("NOT_IN_GAME");
    expect(await service.getRoom(gameId)).toBeDefined();
    await stranger.send("game:replace_with_ai", { gameId, seatIndex: 0 });
    expect(stranger.last("game:error").code).toBe("NOT_IN_GAME");
    expect((await service.getRoom(gameId))!.aiPlayers.size).toBe(0);
    await stranger.send("game:deal_next", { gameId, roundNumber: 0 });
    expect(stranger.last("game:error").message).toBe("You are not in this game");
    await stranger.send("game:set_auto_deal", { gameId, enabled: true });
    expect(stranger.last("game:error").message).toBe("You are not in this game");
    expect((await service.getRoom(gameId))!.autoDeal).toBe(false);
  });
});
