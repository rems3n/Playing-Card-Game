import { randomBytes } from "node:crypto";
import { redis } from "../config/redis.js";
import { GameType, type GameConfig } from "@card-game/shared-types";

export interface RoomPlayer {
  id: string;
  socketId: string;
  userId: string | null;
  displayName: string;
  connected: boolean;
  /** The player says when they are ready. Absent on rooms saved before this. */
  ready?: boolean;
  disconnectedAt?: number;
}
export interface FamilyRoom {
  id: string;
  gameType: GameType;
  hostId: string;
  players: RoomPlayer[];
  config: Partial<GameConfig>;
  maxPlayers: number;
  gameId?: string;
}

export class KeyedQueue {
  private pending = new Map<string, Promise<unknown>>();
  run<T>(key: string, action: () => Promise<T>): Promise<T> {
    const previous = this.pending.get(key) ?? Promise.resolve();
    const current = previous.catch(() => {}).then(action);
    this.pending.set(key, current);
    void current
      .finally(() => {
        if (this.pending.get(key) === current) this.pending.delete(key);
      })
      .catch(() => {});
    return current;
  }
}

export class RoomService {
  readonly queue = new KeyedQueue();
  constructor(private store: Pick<typeof redis, "get" | "set"> = redis) {}
  async load(id: string): Promise<FamilyRoom | null> {
    if (!/^[a-z0-9]{8}$/i.test(id)) return null;
    const data = await this.store.get(`family-room:${id.toLowerCase()}`);
    return data ? JSON.parse(data) : null;
  }
  reconcile(
    room: FamilyRoom,
    isConnected: (socketId: string) => boolean,
    now = Date.now(),
  ) {
    if (room.gameId) return;
    for (const player of room.players) {
      player.connected = isConnected(player.socketId);
      if (!player.connected) player.disconnectedAt ??= now;
      else delete player.disconnectedAt;
    }
    room.players = room.players.filter(
      (p) => p.connected || now - (p.disconnectedAt ?? now) < 90_000,
    );
    if (!room.players.some((p) => p.id === room.hostId))
      room.hostId =
        room.players.find((p) => p.connected)?.id ?? room.players[0]?.id ?? "";
  }
  async save(room: FamilyRoom) {
    await this.store.set(
      `family-room:${room.id}`,
      JSON.stringify(room),
      "EX",
      86400,
    );
  }
  async create(
    gameType: GameType,
    config: Partial<GameConfig>,
    player: RoomPlayer,
  ) {
    const maxPlayers = config.maxPlayers ?? 4;
    if (![GameType.SevenSix, GameType.FortyFives].includes(gameType))
      throw new Error("Choose Seven-Six or 45s");
    // Forty-Fives is played by two, four or six; Seven-Six by two to seven.
    const fortyFives = gameType === GameType.FortyFives;
    if (
      !Number.isInteger(maxPlayers) ||
      maxPlayers < 2 ||
      maxPlayers > 7 ||
      (fortyFives && ![2, 4, 6].includes(maxPlayers))
    )
      throw new Error("Invalid player count");
    const targetScore = fortyFives ? (config.targetScore ?? 45) : 0;
    if (
      !Number.isInteger(targetScore) ||
      targetScore < 0 ||
      targetScore > 200 ||
      (fortyFives && targetScore < 1)
    )
      throw new Error("Invalid target score");
    const room: FamilyRoom = {
      id: randomBytes(4).toString("hex"),
      gameType,
      hostId: player.id,
      players: [player],
      maxPlayers,
      config: { gameType, maxPlayers, targetScore },
    };
    await this.save(room);
    return room;
  }
}
