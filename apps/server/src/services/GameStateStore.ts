import { redis } from '../config/redis.js';
import { GameType, AIDifficulty } from '@card-game/shared-types';

const PREFIX = 'game';
const TTL = 3600 * 4; // 4 hours — games expire after this

/** Serialized game data stored in Redis. */
export interface SerializedGame {
  gameId: string;
  gameType: GameType;
  engineData: Record<string, unknown>;
  aiSeats: Array<{ seat: number; difficulty: AIDifficulty; displayName: string }>;
  playerMappings: Array<{ seat: number; socketId: string; userId: string | null; displayName: string }>;
}

export class GameStateStore {
  /** Save a game to Redis. */
  async save(gameId: string, data: SerializedGame): Promise<void> {
    await redis.set(
      `${PREFIX}:${gameId}`,
      JSON.stringify(data),
      'EX',
      TTL,
    );
    // Also track active game IDs
    await redis.sadd(`${PREFIX}:active`, gameId);
  }

  /** Load a game from Redis. */
  async load(gameId: string): Promise<SerializedGame | null> {
    const raw = await redis.get(`${PREFIX}:${gameId}`);
    if (!raw) return null;
    return JSON.parse(raw) as SerializedGame;
  }

  /** Remove a game from Redis. */
  async remove(gameId: string): Promise<void> {
    await redis.del(`${PREFIX}:${gameId}`);
    await redis.srem(`${PREFIX}:active`, gameId);
  }

  /** Get all active game IDs. */
  async getActiveGameIds(): Promise<string[]> {
    return redis.smembers(`${PREFIX}:active`);
  }

  /** Update just the player socket mappings (for reconnections). */
  async updatePlayerMapping(
    gameId: string,
    seat: number,
    socketId: string,
  ): Promise<void> {
    const data = await this.load(gameId);
    if (!data) return;

    const mapping = data.playerMappings.find((m) => m.seat === seat);
    if (mapping) {
      mapping.socketId = socketId;
    }
    await this.save(gameId, data);
  }
}
