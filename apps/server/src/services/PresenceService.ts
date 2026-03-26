import { redis } from '../config/redis.js';

const PRESENCE_TTL = 120; // seconds — refreshed on heartbeat
const PREFIX = 'presence';

export class PresenceService {
  /** Mark a user as online and map their socket ID. */
  async setOnline(userId: string, socketId: string): Promise<void> {
    await redis.pipeline()
      .set(`${PREFIX}:user:${userId}`, socketId, 'EX', PRESENCE_TTL)
      .set(`${PREFIX}:socket:${socketId}`, userId, 'EX', PRESENCE_TTL)
      .sadd(`${PREFIX}:online`, userId)
      .exec();
  }

  /** Refresh presence TTL (called on heartbeat). */
  async refresh(userId: string, socketId: string): Promise<void> {
    await redis.pipeline()
      .expire(`${PREFIX}:user:${userId}`, PRESENCE_TTL)
      .expire(`${PREFIX}:socket:${socketId}`, PRESENCE_TTL)
      .exec();
  }

  /** Mark a user as offline. */
  async setOffline(socketId: string): Promise<string | null> {
    const userId = await redis.get(`${PREFIX}:socket:${socketId}`);
    if (!userId) return null;

    await redis.pipeline()
      .del(`${PREFIX}:user:${userId}`)
      .del(`${PREFIX}:socket:${socketId}`)
      .srem(`${PREFIX}:online`, userId)
      .exec();

    return userId;
  }

  /** Check if a user is online. */
  async isOnline(userId: string): Promise<boolean> {
    return (await redis.exists(`${PREFIX}:user:${userId}`)) === 1;
  }

  /** Get the socket ID for a user. */
  async getSocketId(userId: string): Promise<string | null> {
    return redis.get(`${PREFIX}:user:${userId}`);
  }

  /** Get the user ID for a socket. */
  async getUserId(socketId: string): Promise<string | null> {
    return redis.get(`${PREFIX}:socket:${socketId}`);
  }

  /** Get all online user IDs. */
  async getOnlineUsers(): Promise<string[]> {
    return redis.smembers(`${PREFIX}:online`);
  }

  /** Get online status for a list of user IDs. */
  async getOnlineStatuses(userIds: string[]): Promise<Record<string, boolean>> {
    if (userIds.length === 0) return {};

    const pipeline = redis.pipeline();
    for (const id of userIds) {
      pipeline.exists(`${PREFIX}:user:${id}`);
    }
    const results = await pipeline.exec();

    const statuses: Record<string, boolean> = {};
    userIds.forEach((id, i) => {
      statuses[id] = results?.[i]?.[1] === 1;
    });
    return statuses;
  }
}
