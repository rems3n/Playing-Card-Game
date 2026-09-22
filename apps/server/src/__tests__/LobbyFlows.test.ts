import { describe, expect, it, vi } from "vitest";
import {
  GameType,
  INVITE_ERROR_CODES,
  type WaitingRoomState,
} from "@card-game/shared-types";
import { RoomService } from "../services/RoomService.js";
import { GameService } from "../services/GameService.js";
import { setupGameHandlers } from "../socket/gameRoom.js";
import {
  InviteError,
  InviteService,
  INVITES_PER_ROOM,
  inviteMessage,
  normaliseAddress,
} from "../services/InviteService.js";
import {
  createInviteProvider,
  DisabledInviteProvider,
  ResendProvider,
  type InviteMessage,
} from "../services/invite/index.js";

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

/** Records what was asked for without contacting any provider. */
function recordingProvider() {
  const messages: InviteMessage[] = [];
  return {
    messages,
    provider: {
      name: "test",
      channels: ["email"] as const,
      async send(message: InviteMessage) {
        messages.push(message);
      },
    },
  };
}

function fixture(options: { invites?: InviteService } = {}) {
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
    undefined,
    options.invites,
  );
  function connect(id: string, participantId = id, displayName = "Alex") {
    const handlers = new Map<string, Handler>();
    const sent: Array<{ event: string; data: any }> = [];
    const client = {
      id,
      data: { displayName, participantId },
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
  async function room(seats = 4) {
    const host = connect("host", "host-id", "Ada");
    const guest = connect("guest", "guest-id", "Bo");
    await host.send("room:create", {
      gameType: GameType.SevenSix,
      config: { maxPlayers: seats },
    });
    const { roomId } = host.last("room:created");
    await guest.send("room:join", { roomId });
    return { host, guest, roomId };
  }
  return { connect, service, rooms, room };
}

const state = (client: any) => client.last("room:update") as WaitingRoomState;

describe("being ready at a table", () => {
  it("starts nobody as ready and reports each person's own choice", async () => {
    const { room } = fixture();
    const { host, guest, roomId } = await room();
    expect(state(host).players.every((p) => p.ready === false)).toBe(true);

    await guest.send("room:set_ready", { roomId, ready: true });
    expect(state(host).players.map((p) => p.ready)).toEqual([false, true]);
    expect(state(guest).players.map((p) => p.ready)).toEqual([false, true]);

    await guest.send("room:set_ready", { roomId, ready: false });
    expect(state(host).players.map((p) => p.ready)).toEqual([false, false]);
  });

  it("refuses to start and names who is still deciding", async () => {
    const { room } = fixture();
    const { host, guest, roomId } = await room();
    await host.send("room:start", { roomId });
    expect(host.last("room:error").message).toBe(
      "Waiting for Ada and Bo to be ready",
    );
    expect(host.last("room:started")).toBeUndefined();

    await host.send("room:set_ready", { roomId, ready: true });
    await host.send("room:start", { roomId });
    expect(host.last("room:error").message).toBe("Waiting for Bo to be ready");

    await guest.send("room:set_ready", { roomId, ready: true });
    await host.send("room:start", { roomId });
    expect(host.last("room:started").gameId).toBeDefined();
  });

  it("keeps a ready flag across a refresh, and a new arrival is not ready", async () => {
    const { connect, room } = fixture();
    const { host, guest, roomId } = await room();
    await host.send("room:set_ready", { roomId, ready: true });
    await guest.send("room:set_ready", { roomId, ready: true });

    const refreshed = connect("host-tab-2", "host-id", "Ada");
    await refreshed.send("room:join", { roomId });
    expect(state(refreshed).players[0].ready).toBe(true);

    const third = connect("third", "third-id", "Cass");
    await third.send("room:join", { roomId });
    expect(state(third).players[2].ready).toBe(false);
    await refreshed.send("room:start", { roomId });
    expect(refreshed.last("room:error").message).toBe(
      "Waiting for Cass to be ready",
    );
  });

  it("refuses a ready flag from someone without a seat", async () => {
    const { connect, room } = fixture();
    const { roomId } = await room();
    const outsider = connect("outsider", "outsider-id");
    await outsider.send("room:set_ready", { roomId, ready: true });
    expect(outsider.last("room:error").message).toContain("not at this table");
  });
});

describe("host controls", () => {
  it("frees a seat, tells that person, and unblocks the start", async () => {
    const { room } = fixture();
    const { host, guest, roomId } = await room();
    await host.send("room:set_ready", { roomId, ready: true });
    await host.send("room:start", { roomId });
    expect(host.last("room:error").message).toBe("Waiting for Bo to be ready");

    await host.send("room:remove_player", { roomId, seatIndex: 1 });
    expect(guest.last("room:error").message).toBe(
      "The host freed your seat at that table.",
    );
    expect(state(host).players).toHaveLength(1);
    // One person cannot play alone, so the floor still applies.
    await host.send("room:start", { roomId });
    expect(host.last("room:error").message).toBe("Need at least 2 players");
  });

  it("lets only the host free a seat, and never their own", async () => {
    const { room } = fixture();
    const { host, guest, roomId } = await room();
    await guest.send("room:remove_player", { roomId, seatIndex: 0 });
    expect(guest.last("room:error").message).toContain("Only the host");
    expect(state(host).players).toHaveLength(2);

    await host.send("room:remove_player", { roomId, seatIndex: 0 });
    expect(host.last("room:error").message).toContain("give up your own seat");
    await host.send("room:remove_player", { roomId, seatIndex: 5 });
    expect(host.last("room:error").message).toContain("nobody in that seat");
    expect(state(host).players).toHaveLength(2);
  });
});

describe("addresses an invitation can be sent to", () => {
  it.each([
    "someone@example.com",
    "first.last+table@sub.example.co.uk",
  ])("accepts the email %s", (value) => {
    expect(normaliseAddress("email", value)).toBe(value);
  });

  it.each([
    ["+353 87 123 4567", "+353871234567"],
    ["+1 (555) 010-9999", "+15550109999"],
  ])("accepts the number %s and stores it as %s", (typed, stored) => {
    expect(normaliseAddress("sms", typed)).toBe(stored);
  });

  it.each([
    "",
    "nobody",
    "no@body",
    "two@example.com, other@example.com",
    "<script>@example.com",
  ])("refuses the email %p", (value) => {
    expect(() => normaliseAddress("email", value)).toThrow(InviteError);
  });

  it.each(["", "5550109999", "+0123", "+1-555-CALL-NOW"])(
    "refuses the number %p",
    (value) => {
      expect(() => normaliseAddress("sms", value)).toThrow(
        /country code/,
      );
    },
  );
});

describe("sending an invitation", () => {
  it("is off unless a sender is configured", () => {
    for (const env of [{}, { INVITE_PROVIDER: "none" }]) {
      const provider = createInviteProvider(env);
      expect(provider.channels).toEqual([]);
      expect(new InviteService(provider, "https://x").config()).toEqual({
        channels: [],
        provider: "none",
      });
    }
    expect(() => createInviteProvider({ INVITE_PROVIDER: "carrier-pigeon" })).toThrow(
      /Unknown INVITE_PROVIDER/,
    );
    expect(() => createInviteProvider({ INVITE_PROVIDER: "resend" })).toThrow(
      /RESEND_API_KEY and INVITE_FROM_EMAIL/,
    );
    expect(
      createInviteProvider({
        INVITE_PROVIDER: "resend",
        RESEND_API_KEY: "key",
        INVITE_FROM_EMAIL: "Table <table@example.com>",
      }),
    ).toBeInstanceOf(ResendProvider);
  });

  it("writes the message itself from the sender's seat", async () => {
    const { messages, provider } = recordingProvider();
    const invites = new InviteService(provider as never, "https://play.example/");
    const { room } = fixture({ invites });
    const { host, roomId } = await room();

    await host.send("room:send_invite", {
      roomId,
      channel: "email",
      to: " Guest@Example.com ",
    });
    expect(host.last("room:invite_sent")).toEqual({
      channel: "email",
      to: "Guest@Example.com",
    });
    expect(messages).toHaveLength(1);
    expect(messages[0].subject).toBe(
      "Ada invited you to a game of Seven-Six",
    );
    expect(messages[0].body).toContain(`https://play.example/room/${roomId}`);
    expect(messages[0].body).toContain(roomId);
    // The sender cannot choose the wording or claim another name.
    expect(messages[0].body).not.toContain("<");
  });

  it("refuses someone without a seat at that table", async () => {
    const { messages, provider } = recordingProvider();
    const invites = new InviteService(provider as never, "https://play.example");
    const { connect, room } = fixture({ invites });
    const { roomId } = await room();
    const outsider = connect("outsider", "outsider-id");
    await outsider.send("room:send_invite", {
      roomId,
      channel: "email",
      to: "guest@example.com",
    });
    expect(outsider.last("room:error").message).toBe("You are not at this table.");
    expect(messages).toEqual([]);
  });

  it("refuses a channel the server cannot send", async () => {
    const { messages, provider } = recordingProvider();
    const invites = new InviteService(provider as never, "https://play.example");
    const { room } = fixture({ invites });
    const { host, roomId } = await room();
    await host.send("room:send_invite", {
      roomId,
      channel: "sms",
      to: "+15550109999",
    });
    expect(host.last("room:error").message).toContain(
      "does not send text messages",
    );
    expect(messages).toEqual([]);
  });

  it("caps how many go out from one table", async () => {
    const { messages, provider } = recordingProvider();
    const invites = new InviteService(provider as never, "https://play.example");
    const { room } = fixture({ invites });
    const { host, roomId } = await room();
    for (let i = 0; i < INVITES_PER_ROOM; i++)
      await host.send("room:send_invite", {
        roomId,
        channel: "email",
        to: `guest${i}@example.com`,
      });
    expect(messages).toHaveLength(INVITES_PER_ROOM);
    await host.send("room:send_invite", {
      roomId,
      channel: "email",
      to: "one-too-many@example.com",
    });
    expect(host.last("room:error").message).toContain("lot of invitations");
    expect(messages).toHaveLength(INVITES_PER_ROOM);
  });

  it("does not repeat the provider's wording when delivery fails", async () => {
    const invites = new InviteService(
      {
        name: "test",
        channels: ["email"],
        async send() {
          throw new Error("account 42 suspended for billing");
        },
      },
      "https://play.example",
    );
    const { room } = fixture({ invites });
    const { host, roomId } = await room();
    await host.send("room:send_invite", {
      roomId,
      channel: "email",
      to: "guest@example.com",
    });
    const shown = host.last("room:error").message;
    expect(shown).toBe("The invitation could not be sent. Share the link instead.");
    expect(shown).not.toContain("account 42");
  });

  it("names the game a 45s table is actually playing", async () => {
    const message = inviteMessage(
      { id: "abcd1234", gameType: GameType.FortyFives } as never,
      "Bo",
      "https://play.example",
    );
    expect(message.subject).toBe("Bo invited you to a game of 45s");
  });

  it("a disabled provider never sends, whatever it is asked", async () => {
    await expect(new DisabledInviteProvider().send()).rejects.toThrow(
      /does not send invitations/,
    );
  });
});
