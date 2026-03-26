import { redis } from '../config/redis.js';

interface QueueEntry {
  socketId: string;
  userId: string | null;
  displayName: string;
  rating: number;
  joinedAt: number;
}

const QUEUE_PREFIX = 'matchmaking:queue';

export class MatchmakingService {
  /** Add a player to the matchmaking queue for a game type. */
  async joinQueue(
    gameType: string,
    entry: QueueEntry,
  ): Promise<void> {
    const key = `${QUEUE_PREFIX}:${gameType}`;
    // Store entry data in a hash
    await redis.hset(
      `${key}:data:${entry.socketId}`,
      'socketId', entry.socketId,
      'userId', entry.userId ?? '',
      'displayName', entry.displayName,
      'rating', entry.rating.toString(),
      'joinedAt', entry.joinedAt.toString(),
    );
    await redis.expire(`${key}:data:${entry.socketId}`, 300); // 5 min TTL

    // Add to sorted set (score = rating for matchmaking)
    await redis.zadd(key, entry.rating, entry.socketId);
  }

  /** Remove a player from the queue. */
  async leaveQueue(gameType: string, socketId: string): Promise<void> {
    const key = `${QUEUE_PREFIX}:${gameType}`;
    await redis.zrem(key, socketId);
    await redis.del(`${key}:data:${socketId}`);
  }

  /** Remove a player from all queues (on disconnect). */
  async leaveAllQueues(socketId: string): Promise<void> {
    for (const gameType of ['hearts', 'spades', 'euchre']) {
      await this.leaveQueue(gameType, socketId);
    }
  }

  /** Get queue size for a game type. */
  async getQueueSize(gameType: string): Promise<number> {
    return redis.zcard(`${QUEUE_PREFIX}:${gameType}`);
  }

  /**
   * Try to find a match. Returns matched socket IDs if enough players,
   * or null if not enough in queue.
   */
  async tryMatch(
    gameType: string,
    requiredPlayers: number,
  ): Promise<QueueEntry[] | null> {
    const key = `${QUEUE_PREFIX}:${gameType}`;

    const queueSize = await redis.zcard(key);
    if (queueSize < requiredPlayers) return null;

    // Get the first N players (closest ratings via sorted set)
    const socketIds = await redis.zrange(key, 0, requiredPlayers - 1);
    if (socketIds.length < requiredPlayers) return null;

    // Fetch their data
    const entries: QueueEntry[] = [];
    for (const socketId of socketIds) {
      const data = await redis.hgetall(`${key}:data:${socketId}`);
      if (!data.socketId) {
        // Stale entry — remove and bail
        await redis.zrem(key, socketId);
        return null;
      }
      entries.push({
        socketId: data.socketId,
        userId: data.userId || null,
        displayName: data.displayName,
        rating: parseFloat(data.rating),
        joinedAt: parseInt(data.joinedAt, 10),
      });
    }

    // Remove matched players from queue
    for (const entry of entries) {
      await this.leaveQueue(gameType, entry.socketId);
    }

    return entries;
  }

  /** Get a player's position in queue. */
  async getPosition(gameType: string, socketId: string): Promise<number | null> {
    const rank = await redis.zrank(`${QUEUE_PREFIX}:${gameType}`, socketId);
    return rank !== null ? rank + 1 : null;
  }
}
