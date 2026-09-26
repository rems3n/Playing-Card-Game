import { randomBytes } from "node:crypto";
import { redis } from "../config/redis.js";
import { AIDifficulty, GameType, type GameConfig } from "@card-game/shared-types";

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
    // Each game has its own table sizes: Forty-Fives is played by two, four
    // or six, Seven-Six by two to seven, Hearts and Spades by four exactly,
    // Rummy by two to six.
    const seats: Partial<Record<GameType, number[]>> = {
      [GameType.SevenSix]: [2, 3, 4, 5, 6, 7],
      [GameType.FortyFives]: [2, 4, 6],
      [GameType.Hearts]: [4],
      [GameType.Spades]: [4],
      [GameType.Rummy]: [2, 3, 4, 5, 6],
    };
    const allowed = seats[gameType];
    if (!allowed) throw new Error("Choose a game from the list");
    const maxPlayers = config.maxPlayers ?? (allowed.includes(4) ? 4 : allowed[0]);
    if (!Number.isInteger(maxPlayers) || !allowed.includes(maxPlayers))
      throw new Error("Invalid player count");
    // The score a game ends at, where it ends on a score at all.
    const defaults: Partial<Record<GameType, number>> = {
      [GameType.FortyFives]: 45,
      [GameType.Hearts]: 100,
      [GameType.Spades]: 500,
      [GameType.Rummy]: 100,
    };
    const fortyFives = gameType === GameType.FortyFives;
    const targetScore =
      gameType === GameType.SevenSix ? 0 : (config.targetScore ?? defaults[gameType] ?? 0);
    if (
      !Number.isInteger(targetScore) ||
      targetScore < 0 ||
      targetScore > 1000 ||
      (fortyFives && (targetScore < 1 || targetScore > 200))
    )
      throw new Error("Invalid target score");
    // Empty seats are filled with bots at the level the host chose.
    const aiDifficulty = config.aiDifficulty ?? AIDifficulty.Intermediate;
    if (!Object.values(AIDifficulty).includes(aiDifficulty))
      throw new Error("Invalid bot difficulty");
    const room: FamilyRoom = {
      id: randomBytes(4).toString("hex"),
      gameType,
      hostId: player.id,
      players: [player],
      maxPlayers,
      config: { gameType, maxPlayers, targetScore, aiDifficulty },
    };
    await this.save(room);
    return room;
  }
}
