import { describe, expect, it, vi } from "vitest";
import { GameType, MEDIA_ERROR_CODES } from "@card-game/shared-types";
import {
  MediaAuthorizationError,
  MediaService,
  mediaRoomName,
} from "../services/MediaService.js";
import {
  createMediaProvider,
  DisabledMediaProvider,
  LiveKitProvider,
  type MediaTokenRequest,
} from "../services/media/index.js";
import { GameService } from "../services/GameService.js";
import type { SerializedGame } from "../services/GameStateStore.js";
import { currentHuman, event, openTable } from "./tableHarness.js";

vi.mock("../services/PersistenceService.js", () => ({
  PersistenceService: class {
    async saveCompletedGame() {}
  },
}));
vi.mock("../services/PresenceService.js", () => ({
  PresenceService: class {},
}));
vi.mock("../services/MatchmakingService.js", () => ({
  MatchmakingService: class {
    async leaveAllQueues() {}
  },
}));

/** Records what the service asked for without contacting any provider. */
function recordingProvider() {
  const requests: MediaTokenRequest[] = [];
  return {
    requests,
    provider: {
      name: "test",
      enabled: true,
      async issueToken(request: MediaTokenRequest) {
        requests.push(request);
        return {
          token: `token-for-${request.identity}`,
          url: "wss://media.example",
          expiresAt: Date.now() + request.ttlSeconds * 1000,
        };
      },
    },
  };
}

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

/** A two-seat table with one seated human and a known participant id. */
async function seatedGame() {
  const games = new GameService(storage(), async () => {});
  const gameId = games.createGame(GameType.SevenSix, { maxPlayers: 2 });
  await games.joinGame(gameId, "socket-a", "Ada", undefined, "participant-a");
  await games.startGame(gameId);
  return { games, gameId };
}

describe("choosing a media provider", () => {
  it("is off unless a provider is named", () => {
    for (const env of [{}, { MEDIA_PROVIDER: "none" }, { MEDIA_PROVIDER: "" }]) {
      const provider = createMediaProvider(env);
      expect(provider.enabled).toBe(false);
      expect(provider.name).toBe("none");
    }
  });

  it("refuses an unknown provider by name instead of failing silently", () => {
    expect(() => createMediaProvider({ MEDIA_PROVIDER: "zoom" })).toThrow(
      /Unknown MEDIA_PROVIDER "zoom"/,
    );
  });

  it("requires all three LiveKit settings", () => {
    expect(() =>
      createMediaProvider({ MEDIA_PROVIDER: "livekit", LIVEKIT_URL: "wss://x" }),
    ).toThrow(/LIVEKIT_URL, LIVEKIT_API_KEY and LIVEKIT_API_SECRET/);
    expect(
      createMediaProvider({
        MEDIA_PROVIDER: "LiveKit",
        LIVEKIT_URL: "wss://x",
        LIVEKIT_API_KEY: "key",
        LIVEKIT_API_SECRET: "secret-secret-secret-secret-1234",
      }),
    ).toBeInstanceOf(LiveKitProvider);
  });

  it("reports itself as unavailable and issues nothing when disabled", async () => {
    const provider = new DisabledMediaProvider();
    await expect(provider.issueToken()).rejects.toThrow(/not configured/);
    expect(new MediaService(provider).config()).toEqual({
      enabled: false,
      provider: "none",
    });
  });
});

describe("issuing call credentials", () => {
  it("names the room after the game and the identity after the seat", async () => {
    const { games, gameId } = await seatedGame();
    const { provider, requests } = recordingProvider();
    const media = new MediaService(provider, 120);

    const credentials = await media.issueCredentials(
      games,
      gameId,
      "participant-a",
    );
    expect(credentials.roomName).toBe(mediaRoomName(gameId));
    expect(credentials.roomName).toContain(gameId);
    expect(credentials.identity).toBe("seat-0");
    expect(credentials.seatIndex).toBe(0);
    expect(credentials.displayName).toBe("Ada");
    expect(credentials.provider).toBe("test");
    expect(credentials.url).toBe("wss://media.example");
    expect(requests).toHaveLength(1);
    expect(requests[0].ttlSeconds).toBe(120);
    // The identity carries no account or participant information.
    expect(credentials.identity).not.toContain("participant-a");
    expect(credentials.identity).not.toContain(gameId);
  });

  it("keeps the credential short lived", async () => {
    const { games, gameId } = await seatedGame();
    const { provider } = recordingProvider();
    const media = new MediaService(provider, 300);
    const credentials = await media.issueCredentials(
      games,
      gameId,
      "participant-a",
    );
    const lifetime = credentials.expiresAt - Date.now();
    expect(lifetime).toBeGreaterThan(0);
    expect(lifetime).toBeLessThanOrEqual(300_000);
  });

  it("refuses anyone without a seat, whatever game id they send", async () => {
    const { games, gameId } = await seatedGame();
    const { provider, requests } = recordingProvider();
    const media = new MediaService(provider);
    for (const attempt of [
      ["an outsider at a real table", gameId, "participant-b"],
      ["a game that does not exist", "00000000-0000-0000-0000-000000000000", "participant-a"],
      ["an empty game id", "", "participant-a"],
      ["a non-string game id", 42 as unknown as string, "participant-a"],
    ] as const) {
      const [, id, participant] = attempt;
      const failure = await media
        .issueCredentials(games, id, participant)
        .catch((error) => error);
      expect(failure, attempt[0]).toBeInstanceOf(MediaAuthorizationError);
      expect(failure.code).toBe(MEDIA_ERROR_CODES.notSeated);
      expect(failure.message).toBe("You are not at this table");
    }
    expect(requests).toEqual([]);
  });

  it("refuses a bot seat", async () => {
    const games = new GameService(storage(), async () => {});
    const gameId = games.createGame(GameType.SevenSix, { maxPlayers: 2 });
    await games.joinGame(gameId, "socket-a", "Ada", undefined, "bot-seat");
    await games.startGame(gameId);
    const room = (await games.getRoom(gameId))!;
    room.engine.getState().players[0].isAI = true;
    const { provider } = recordingProvider();
    await expect(
      new MediaService(provider).issueCredentials(games, gameId, "bot-seat"),
    ).rejects.toThrow("You are not at this table");
  });

  it("says media is unavailable rather than pretending it failed", async () => {
    const { games, gameId } = await seatedGame();
    const media = new MediaService(new DisabledMediaProvider());
    const failure = await media
      .issueCredentials(games, gameId, "participant-a")
      .catch((error) => error);
    expect(failure.code).toBe(MEDIA_ERROR_CODES.disabled);
    expect(media.config().enabled).toBe(false);
  });

  it("reports a provider outage without leaking the provider's internals", async () => {
    const { games, gameId } = await seatedGame();
    const media = new MediaService({
      name: "test",
      enabled: true,
      async issueToken() {
        throw new Error("upstream 503");
      },
    });
    const failure = await media
      .issueCredentials(games, gameId, "participant-a")
      .catch((error) => error);
    expect(failure).toBeInstanceOf(MediaAuthorizationError);
    expect(failure.code).toBe(MEDIA_ERROR_CODES.failed);
  });
});

describe("the LiveKit token", () => {
  it("grants one room, publish and subscribe, and nothing else", async () => {
    const provider = new LiveKitProvider({
      url: "wss://media.example",
      apiKey: "APIkey",
      apiSecret: "a-secret-long-enough-for-hs256-signing",
    });
    const { token, url, expiresAt } = await provider.issueToken({
      roomName: "table-abc",
      identity: "seat-2",
      displayName: "Ada",
      ttlSeconds: 60,
    });
    expect(url).toBe("wss://media.example");
    expect(expiresAt).toBeGreaterThan(Date.now());
    const claims = JSON.parse(
      Buffer.from(token.split(".")[1], "base64url").toString(),
    );
    expect(claims.sub).toBe("seat-2");
    expect(claims.name).toBe("Ada");
    expect(claims.video).toMatchObject({
      room: "table-abc",
      roomJoin: true,
      canPublish: true,
      canSubscribe: true,
    });
    // Nothing that would let a player record, administer or reach other rooms.
    for (const withheld of [
      "roomCreate",
      "roomList",
      "roomRecord",
      "roomAdmin",
      "canPublishData",
      "canUpdateOwnMetadata",
    ])
      expect(claims.video[withheld]).toBeFalsy();
    expect(claims.iss).toBe("APIkey");
    expect(claims.exp - claims.nbf).toBeLessThanOrEqual(60);
    expect(claims.exp * 1000).toBeLessThanOrEqual(Date.now() + 60_000 + 1000);
  });
});

describe("media over the game socket", () => {
  it("issues credentials to a seated client and refuses an outsider", async () => {
    const { provider } = recordingProvider();
    const table = await openTable(GameType.SevenSix, {
      seats: 4,
      humans: 2,
      media: new MediaService(provider, 90),
    });
    try {
      const seated = await currentHuman(table);
      const seat = table.latest.get(seated)!.mySeat;
      const issued = event(seated, "media:credentials");
      seated.emit("media:token", { gameId: table.gameId });
      const credentials = await issued;
      expect(credentials.identity).toBe(`seat-${seat}`);
      expect(credentials.seatIndex).toBe(seat);
      expect(credentials.roomName).toBe(mediaRoomName(table.gameId));

      const { randomUUID } = await import("node:crypto");
      const { issueSession } = await import("../middleware/auth.js");
      const { token } = await issueSession({
        id: randomUUID(),
        name: "Outsider",
        user: null,
      });
      const outsider = await table.client(token);
      const refused = event(outsider, "media:error");
      outsider.emit("media:token", { gameId: table.gameId });
      const error = await refused;
      expect(error.code).toBe(MEDIA_ERROR_CODES.notSeated);
    } finally {
      await table.close();
    }
  }, 30000);

  it("refuses a burst of ticket requests from one socket", async () => {
    const { provider, requests } = recordingProvider();
    const table = await openTable(GameType.SevenSix, {
      seats: 4,
      humans: 2,
      media: new MediaService(provider, 90),
    });
    try {
      const seated = await currentHuman(table);
      const first = event(seated, "media:credentials");
      seated.emit("media:token", { gameId: table.gameId });
      await first;
      const refused = event(seated, "media:error");
      seated.emit("media:token", { gameId: table.gameId });
      expect((await refused).message).toContain("Wait a moment");
      expect(requests).toHaveLength(1);
      // A different seat is unaffected by someone else's burst.
      const other = table.clients.find((c) => c !== seated)!;
      const issued = event(other, "media:credentials");
      other.emit("media:token", { gameId: table.gameId });
      await issued;
      expect(requests).toHaveLength(2);
    } finally {
      await table.close();
    }
  }, 30000);

  it("reports that media is off without disturbing the game", async () => {
    const table = await openTable(GameType.SevenSix, {
      seats: 4,
      humans: 2,
      media: new MediaService(new DisabledMediaProvider()),
    });
    try {
      const seated = await currentHuman(table);
      const before = table.latest.get(seated)!;
      const refused = event(seated, "media:error");
      seated.emit("media:token", { gameId: table.gameId });
      expect((await refused).code).toBe(MEDIA_ERROR_CODES.disabled);
      // The table is exactly where it was.
      const after = await table.service.getVisibleState(
        table.gameId,
        before.mySeat,
      );
      expect(after.phase).toBe(before.phase);
      expect(after.currentPlayerSeat).toBe(before.currentPlayerSeat);
      expect(after.bids).toEqual(before.bids);
    } finally {
      await table.close();
    }
  }, 30000);
});
