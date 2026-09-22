import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { Server } from "socket.io";
import { io as connect, type Socket } from "socket.io-client";
import { describe, expect, it, vi } from "vitest";
import {
  GamePhase,
  GameType,
  type VisibleGameState,
} from "@card-game/shared-types";
import { GameService } from "../services/GameService.js";
import { RoomService } from "../services/RoomService.js";
import { setupGameHandlers } from "../socket/gameRoom.js";
import { issueSession, socketAuth } from "../middleware/auth.js";
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
function event(socket: Socket, name: string) {
  return new Promise<any>((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.off(name, receive);
      reject(new Error(`Timed out waiting for ${name}`));
    }, 12000);
    function receive(data: any) {
      clearTimeout(timeout);
      resolve(data);
    }
    socket.once(name, receive);
  });
}
describe("real authenticated Socket.IO gameplay", () => {
  it.each([GameType.SevenSix, GameType.FortyFives])(
    "plays a full mixed human/bot %s game through the real socket handlers",
    async (type) => {
      const http = createServer();
      const io = new Server(http);
      const records = new Map<string, any>();
      const service = new GameService(
        {
          save: async (id, data) => {
            records.set(id, structuredClone(data));
          },
          load: async (id) => records.get(id),
          remove: async (id) => {
            records.delete(id);
          },
        },
        async () => {
          await new Promise((r) => setTimeout(r, 2));
        },
      );
      const rooms = new RoomService({
        get: async (key) => records.get(key) ?? null,
        set: async (key: string, value: string) => {
          records.set(key, value);
          return "OK";
        },
      } as any);
      io.use(socketAuth);
      setupGameHandlers(io, service, rooms);
      await new Promise<void>((resolve) =>
        http.listen(0, "127.0.0.1", resolve),
      );
      const address = http.address() as { port: number };
      const sockets: Socket[] = [];
      async function client(token?: string) {
        const socket = connect(`http://127.0.0.1:${address.port}`, {
          auth: { token },
          transports: ["websocket"],
          reconnection: false,
          autoConnect: false,
        });
        sockets.push(socket);
        const ready = event(socket, token ? "connect" : "connect_error");
        socket.connect();
        await ready;
        return socket;
      }
      try {
        const unsigned = await client();
        expect(unsigned.connected).toBe(false);
        const tokens = await Promise.all(
          [0, 1, 2].map(
            async () =>
              (
                await issueSession({
                  id: randomUUID(),
                  name: "Same name",
                  user: null,
                })
              ).token,
          ),
        );
        const host = await client(tokens[0]),
          guest = await client(tokens[1]),
          outsider = await client(tokens[2]);
        let next = event(host, "room:created");
        host.emit("room:create", {
          gameType: type,
          config: {
            maxPlayers: 4,
            targetScore: type === GameType.FortyFives ? 2 : 0,
          },
        });
        const { roomId } = await next;
        next = event(guest, "room:update");
        guest.emit("room:join", { roomId });
        await next;
        next = event(guest, "room:error");
        guest.emit("room:start", { roomId });
        expect((await next).message).toContain("host");
        for (const player of [host, guest]) {
          const acknowledged = event(player, "room:update");
          player.emit("room:set_ready", { roomId, ready: true });
          await acknowledged;
        }
        const started = event(host, "room:started");
        host.emit("room:start", { roomId });
        const { gameId } = await started;
        next = event(outsider, "game:error");
        outsider.emit("game:join", { gameId });
        expect((await next).code).toBe("JOIN_FAILED");
        next = event(guest, "game:error");
        guest.emit("game:bid", { gameId, bid: "3" });
        expect((await next).message).toContain("whole-number");
        // Reconnect the same signed guest before driving the full game.
        guest.disconnect();
        const rejoined = await client(tokens[1]);
        next = event(rejoined, "game:state");
        rejoined.emit("game:join", { gameId });
        expect((await next).mySeat).toBe(1);
        const errors: string[] = [],
          reviews: VisibleGameState[] = [];
        const finished = event(host, "game:over");
        for (const socket of [host, rejoined]) {
          const actions = new Set<string>();
          socket.on("game:error", (error) => errors.push(error.message));
          socket.on("game:state", (state: VisibleGameState) => {
            expect(state.players.some((p) => "hand" in p)).toBe(false);
            if (state.phase === GamePhase.TrickResolution) {
              reviews.push(state);
              expect(state.currentTrick).toHaveLength(4);
              expect(state.currentTrick).toEqual(state.lastTrick?.cards);
              expect(state.legalMoves).toEqual([]);
              return;
            }
            if (state.phase === GamePhase.RoundScoring) {
              const action = `deal:${state.roundNumber}`;
              if (state.mySeat === 0 && !actions.has(action)) {
                actions.add(action);
                socket.emit("game:deal_next", { gameId, roundNumber: state.roundNumber });
              }
              return;
            }
            if (
              state.currentPlayerSeat !== state.mySeat ||
              state.phase === GamePhase.GameOver
            )
              return;
            const fingerprint = JSON.stringify([
              state.roundNumber,
              state.phase,
              state.currentTrick,
              state.bids,
              state.myHand,
              state.declarerSeat,
            ]);
            if (actions.has(fingerprint)) return;
            actions.add(fingerprint);
            if (state.phase === GamePhase.Bidding) {
              if (type === GameType.FortyFives) {
                // 45s runs an auction first, and only its winner names trump.
                const calls = state.legalTrumpCalls ?? [];
                if (calls.length)
                  socket.emit("game:call_trump", { gameId, suit: calls[0] });
                else
                  socket.emit("game:bid", {
                    gameId,
                    bid: state.legalBids![0],
                  });
              } else {
                const forbidden =
                  state.dealerSeat === state.mySeat
                    ? state.handSize! -
                      state.bids!.reduce<number>((n, b) => n + (b ?? 0), 0)
                    : -1;
                socket.emit("game:bid", {
                  gameId,
                  bid: forbidden === 0 ? 1 : 0,
                });
              }
            } else if (state.phase === GamePhase.Playing)
              socket.emit("game:play_card", {
                gameId,
                card: state.legalMoves[0],
              });
          });
        }
        host.emit("game:join", { gameId });
        rejoined.emit("game:join", { gameId });
        const result = await finished;
        expect(errors).toEqual([]);
        expect(result.saved).toBe(true);
        expect(reviews.length).toBeGreaterThan(0);
        expect(new Set(reviews.map((s) => s.lastTrick!.sequence)).size).toBe(
          (await service.getRoom(gameId))!.engine
            .getEvents()
            .filter((e) => e.type === "trick_completed").length,
        );
      } finally {
        for (const socket of sockets) socket.disconnect();
        await new Promise<void>((resolve) => io.close(() => resolve()));
      }
    },
    20000,
  );
});
