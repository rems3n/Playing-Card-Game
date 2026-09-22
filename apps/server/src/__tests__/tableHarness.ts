import { createServer, type Server as HttpServer } from "node:http";
import { randomUUID } from "node:crypto";
import { Server } from "socket.io";
import { io as connect, type Socket } from "socket.io-client";
import { GamePhase } from "@card-game/shared-types";
import type { GameType, VisibleGameState } from "@card-game/shared-types";
import { GameService } from "../services/GameService.js";
import { RoomService } from "../services/RoomService.js";
import { setupGameHandlers } from "../socket/gameRoom.js";
import type { MediaService } from "../services/MediaService.js";
import { issueSession, socketAuth } from "../middleware/auth.js";

/** Resolve on the next occurrence of `name`, or reject after `ms`. */
export function event<T = any>(socket: Socket, name: string, ms = 12000) {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(name, receive);
      reject(new Error(`Timed out waiting for ${name}`));
    }, ms);
    function receive(data: T) {
      clearTimeout(timer);
      resolve(data);
    }
    socket.once(name, receive);
  });
}

/** Resolve on the first `game:state` that satisfies `predicate`. */
export function stateWhere(
  socket: Socket,
  predicate: (state: VisibleGameState) => boolean,
  ms = 12000,
) {
  return new Promise<VisibleGameState>((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off("game:state", receive);
      reject(new Error("Timed out waiting for a matching game:state"));
    }, ms);
    function receive(state: VisibleGameState) {
      if (!predicate(state)) return;
      clearTimeout(timer);
      socket.off("game:state", receive);
      resolve(state);
    }
    socket.on("game:state", receive);
  });
}

export interface Table {
  service: GameService;
  gameId: string;
  /** Connected, authenticated human clients in seat order. */
  clients: Socket[];
  /** The most recent state each client received, kept from the first one. */
  latest: Map<Socket, VisibleGameState>;
  /** Resolves once the server has no work left in flight. */
  settle(ms?: number): Promise<void>;
  /** Connect another authenticated client; it is closed with the table. */
  client(token?: string): Promise<Socket>;
  tokens: string[];
  close(): Promise<void>;
}

/**
 * A real Socket.IO server with in-memory storage, a private room started by the
 * host, `humans` signed guest clients seated first and bots in the rest.
 */
export async function openTable(
  gameType: GameType,
  {
    seats = 4,
    humans = 2,
    targetScore = 0,
    media,
  }: {
    seats?: number;
    humans?: number;
    targetScore?: number;
    media?: MediaService;
  } = {},
): Promise<Table> {
  const http: HttpServer = createServer();
  const io = new Server(http);
  const records = new Map<string, any>();
  const service = new GameService(
    {
      save: async (id, data) => {
        records.set(id, structuredClone(data));
      },
      load: async (id) => structuredClone(records.get(id) ?? null),
      remove: async (id) => {
        records.delete(id);
      },
    },
    // No real delay between bot turns: the tests drive their own timing.
    async () => {},
  );
  const rooms = new RoomService({
    get: async (key: string) => records.get(key) ?? null,
    set: async (key: string, value: string) => {
      records.set(key, value);
      return "OK";
    },
  } as any);
  io.use(socketAuth);
  setupGameHandlers(io, service, rooms, media);
  await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve));
  const { port } = http.address() as { port: number };

  const sockets: Socket[] = [];
  async function client(token?: string) {
    const socket = connect(`http://127.0.0.1:${port}`, {
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

  const tokens = await Promise.all(
    Array.from(
      { length: humans },
      async (_, i) =>
        (
          await issueSession({
            id: randomUUID(),
            name: `Player ${i + 1}`,
            user: null,
          })
        ).token,
    ),
  );
  const clients = await Promise.all(tokens.map((t) => client(t)));
  // Keep every client's latest state from the very first broadcast, so a
  // driver attached later never has to re-join to discover where the table is.
  const latest = new Map<Socket, VisibleGameState>();
  for (const socket of clients)
    socket.on("game:state", (state: VisibleGameState) =>
      latest.set(socket, state),
    );

  const created = event(clients[0], "room:created");
  clients[0].emit("room:create", {
    gameType,
    config: { maxPlayers: seats, targetScore },
  });
  const { roomId } = await created;
  for (const guest of clients.slice(1)) {
    const joined = event(guest, "room:update");
    guest.emit("room:join", { roomId });
    await joined;
  }
  // Everyone says they are ready; the host cannot start until they have.
  for (const player of clients) {
    const acknowledged = event(player, "room:update");
    player.emit("room:set_ready", { roomId, ready: true });
    await acknowledged;
  }
  const started = event(clients[0], "room:started");
  clients[0].emit("room:start", { roomId });
  const { gameId } = await started;
  // Every client joins the game channel and receives its first state.
  await Promise.all(
    clients.map(async (socket) => {
      const first = event(socket, "game:state");
      socket.emit("game:join", { gameId });
      await first;
    }),
  );

  return {
    service,
    gameId,
    clients,
    client,
    tokens,
    latest,
    /** Let queued bot turns and broadcasts finish before asserting. */
    async settle(ms = 120) {
      await new Promise((resolve) => setTimeout(resolve, ms));
    },
    async close() {
      for (const socket of sockets) socket.disconnect();
      await new Promise<void>((resolve) => io.close(() => resolve()));
      await new Promise<void>((resolve) => http.close(() => resolve()));
    },
  };
}

/** The human client whose turn it is, once the bots have had theirs. */
export async function currentHuman(table: Table, ms = 10000): Promise<Socket> {
  const deadline = Date.now() + ms;
  for (;;) {
    for (const socket of table.clients) {
      const state = table.latest.get(socket);
      if (state && state.currentPlayerSeat === state.mySeat) return socket;
    }
    if (Date.now() > deadline)
      throw new Error("No human seat has the turn at this table");
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

/**
 * Makes each human client answer its own turns with the first legal bid or
 * card, so a hand progresses through the real socket handlers. Stopped drivers
 * leave the table exactly where it is, which is how the interruption tests get
 * a game paused mid-bid, mid-trick or in round scoring.
 */
export class Driver {
  private acted = new Set<string>();
  private running = false;
  private listeners: Array<[Socket, (s: VisibleGameState) => void]> = [];
  readonly errors: string[] = [];
  readonly states = new Map<Socket, VisibleGameState>();

  constructor(
    private table: Table,
    private options: { dealNext?: boolean } = {},
  ) {
    for (const [socket, state] of table.latest) this.states.set(socket, state);
    for (const socket of table.clients) {
      const onState = (state: VisibleGameState) => {
        this.states.set(socket, state);
        if (this.running) this.act(socket, state);
      };
      socket.on("game:state", onState);
      socket.on("game:error", (e: { message: string }) =>
        this.errors.push(e.message),
      );
      this.listeners.push([socket, onState]);
    }
  }

  private act(socket: Socket, state: VisibleGameState) {
    const gameId = this.table.gameId;
    if (state.phase === GamePhase.RoundScoring) {
      if (!this.options.dealNext || state.mySeat !== 0) return;
      const key = `deal:${state.roundNumber}`;
      if (this.acted.has(key)) return;
      this.acted.add(key);
      socket.emit("game:deal_next", { gameId, roundNumber: state.roundNumber });
      return;
    }
    if (state.currentPlayerSeat !== state.mySeat) return;
    if (state.phase !== GamePhase.Bidding && state.phase !== GamePhase.Playing)
      return;
    const key = JSON.stringify([
      state.mySeat,
      state.roundNumber,
      state.phase,
      state.trickNumber,
      state.currentTrick.length,
      state.bids,
      state.declarerSeat,
    ]);
    if (this.acted.has(key)) return;
    this.acted.add(key);
    if (state.phase === GamePhase.Playing) {
      socket.emit("game:play_card", { gameId, card: state.legalMoves[0] });
      return;
    }
    if (state.legalTrumpCalls) {
      socket.emit("game:call_trump", { gameId, suit: state.legalTrumpCalls[0] });
      return;
    }
    const placed = state.bids!.reduce<number>((n, b) => n + (b ?? 0), 0);
    const forbidden =
      state.dealerSeat === state.mySeat ? state.handSize! - placed : -1;
    socket.emit("game:bid", { gameId, bid: forbidden === 0 ? 1 : 0 });
  }

  start() {
    this.running = true;
    for (const [socket] of this.listeners) {
      const state = this.states.get(socket) ?? this.table.latest.get(socket);
      if (state) this.act(socket, state);
    }
    return this;
  }

  stop() {
    this.running = false;
    return this;
  }

  /** Stop as soon as any client reports a state matching `predicate`. */
  async runUntil(
    predicate: (state: VisibleGameState) => boolean,
    ms = 15000,
  ): Promise<VisibleGameState> {
    for (const [, state] of this.states)
      if (predicate(state)) return this.stop(), state;
    return new Promise<VisibleGameState>((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error("Timed out driving the table to the wanted state"));
      }, ms);
      const watchers: Array<[Socket, (s: VisibleGameState) => void]> = [];
      const cleanup = () => {
        clearTimeout(timer);
        for (const [socket, fn] of watchers) socket.off("game:state", fn);
      };
      for (const socket of this.table.clients) {
        const fn = (state: VisibleGameState) => {
          if (!predicate(state)) return;
          this.stop();
          cleanup();
          resolve(state);
        };
        socket.on("game:state", fn);
        watchers.push([socket, fn]);
      }
      this.start();
    });
  }

  dispose() {
    this.stop();
    for (const [socket, fn] of this.listeners) socket.off("game:state", fn);
  }
}
