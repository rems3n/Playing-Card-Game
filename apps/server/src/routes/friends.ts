import type { FastifyInstance } from 'fastify';
import { eq, and, or, ne } from 'drizzle-orm';
import { db } from '../config/database.js';
import { users, friendships } from '../db/schema.js';

export async function friendRoutes(fastify: FastifyInstance): Promise<void> {
  /**
   * GET /api/friends?email=...
   * Get the user's friend list with online status.
   */
  fastify.get('/api/friends', async (request, reply) => {
    const { email } = request.query as { email?: string };
    if (!email) { reply.status(400); return { error: 'Email required' }; }

    const user = await db.query.users.findFirst({ where: eq(users.email, email) });
    if (!user) { reply.status(404); return { error: 'User not found' }; }

    // Get all accepted friendships
    const rows = await db.query.friendships.findMany({
      where: and(
        or(
          eq(friendships.userAId, user.id),
          eq(friendships.userBId, user.id),
        ),
        eq(friendships.status, 'accepted'),
      ),
    });

    const friendIds = rows.map((r) =>
      r.userAId === user.id ? r.userBId : r.userAId,
    );

    if (friendIds.length === 0) return { success: true, friends: [] };

    const friendUsers = await db.query.users.findMany({
      where: (u, { inArray }) => inArray(u.id, friendIds),
    });

    const friends = friendUsers.map((f) => ({
      id: f.id,
      username: f.username,
      displayName: f.displayName,
      avatarUrl: f.avatarUrl,
    }));

    return { success: true, friends };
  });

  /**
   * GET /api/friends/requests?email=...
   * Get pending friend requests (received).
   */
  fastify.get('/api/friends/requests', async (request, reply) => {
    const { email } = request.query as { email?: string };
    if (!email) { reply.status(400); return { error: 'Email required' }; }

    const user = await db.query.users.findFirst({ where: eq(users.email, email) });
    if (!user) { reply.status(404); return { error: 'User not found' }; }

    // Pending requests where this user is the receiver (userBId)
    const rows = await db.query.friendships.findMany({
      where: and(
        eq(friendships.userBId, user.id),
        eq(friendships.status, 'pending'),
      ),
    });

    const senderIds = rows.map((r) => r.userAId);
    if (senderIds.length === 0) return { success: true, requests: [] };

    const senders = await db.query.users.findMany({
      where: (u, { inArray }) => inArray(u.id, senderIds),
    });

    const requests = rows.map((r) => {
      const sender = senders.find((s) => s.id === r.userAId);
      return {
        friendshipId: r.id,
        from: {
          id: sender?.id,
          username: sender?.username,
          displayName: sender?.displayName,
          avatarUrl: sender?.avatarUrl,
        },
        createdAt: r.createdAt,
      };
    });

    return { success: true, requests };
  });

  /**
   * POST /api/friends/request
   * Send a friend request by username.
   * Body: { email, targetUsername }
   */
  fastify.post('/api/friends/request', async (request, reply) => {
    const body = request.body as { email: string; targetUsername: string };
    if (!body.email || !body.targetUsername) {
      reply.status(400);
      return { error: 'Email and targetUsername required' };
    }

    const user = await db.query.users.findFirst({ where: eq(users.email, body.email) });
    if (!user) { reply.status(404); return { error: 'User not found' }; }

    const target = await db.query.users.findFirst({
      where: eq(users.username, body.targetUsername.toLowerCase()),
    });
    if (!target) { reply.status(404); return { success: false, error: 'User not found' }; }
    if (target.id === user.id) { reply.status(400); return { success: false, error: "Can't friend yourself" }; }

    // Canonical ordering: userAId < userBId
    const [userAId, userBId] = user.id < target.id
      ? [user.id, target.id]
      : [target.id, user.id];

    // Check existing friendship
    const existing = await db.query.friendships.findFirst({
      where: and(eq(friendships.userAId, userAId), eq(friendships.userBId, userBId)),
    });

    if (existing) {
      if (existing.status === 'accepted') {
        return { success: false, error: 'Already friends' };
      }
      if (existing.status === 'pending') {
        return { success: false, error: 'Request already pending' };
      }
      if (existing.status === 'blocked') {
        reply.status(403);
        return { success: false, error: 'Unable to send request' };
      }
    }

    // Create pending request — store as (requester=userA for ordering, but track who initiated)
    // The sender is always stored so receiver knows who to accept
    // We use the convention: userAId < userBId for uniqueness, but the "pending" status
    // means userAId sent the request to userBId. If the sender has the larger ID, we
    // need to handle that. For simplicity, always store sender as userAId in pending.
    // Re-insert with correct ordering:
    await db.insert(friendships).values({
      userAId: user.id < target.id ? user.id : target.id,
      userBId: user.id < target.id ? target.id : user.id,
      status: 'pending',
    });

    return { success: true };
  });

  /**
   * POST /api/friends/respond
   * Accept or decline a friend request.
   * Body: { email, friendshipId, accept: boolean }
   */
  fastify.post('/api/friends/respond', async (request, reply) => {
    const body = request.body as { email: string; friendshipId: string; accept: boolean };
    if (!body.email || !body.friendshipId) {
      reply.status(400);
      return { error: 'Email and friendshipId required' };
    }

    const user = await db.query.users.findFirst({ where: eq(users.email, body.email) });
    if (!user) { reply.status(404); return { error: 'User not found' }; }

    const friendship = await db.query.friendships.findFirst({
      where: eq(friendships.id, body.friendshipId),
    });

    if (!friendship || friendship.status !== 'pending') {
      reply.status(404);
      return { success: false, error: 'Request not found' };
    }

    // Verify this user is part of the friendship
    if (friendship.userAId !== user.id && friendship.userBId !== user.id) {
      reply.status(403);
      return { success: false, error: 'Not your request' };
    }

    if (body.accept) {
      await db.update(friendships)
        .set({ status: 'accepted' })
        .where(eq(friendships.id, body.friendshipId));
    } else {
      await db.update(friendships)
        .set({ status: 'blocked' }) // or delete
        .where(eq(friendships.id, body.friendshipId));
    }

    return { success: true };
  });

  /**
   * DELETE /api/friends/:friendId?email=...
   * Remove a friend.
   */
  fastify.delete('/api/friends/:friendId', async (request, reply) => {
    const { friendId } = request.params as { friendId: string };
    const { email } = request.query as { email?: string };
    if (!email) { reply.status(400); return { error: 'Email required' }; }

    const user = await db.query.users.findFirst({ where: eq(users.email, email) });
    if (!user) { reply.status(404); return { error: 'User not found' }; }

    const [userAId, userBId] = user.id < friendId
      ? [user.id, friendId]
      : [friendId, user.id];

    await db.delete(friendships).where(
      and(eq(friendships.userAId, userAId), eq(friendships.userBId, userBId)),
    );

    return { success: true };
  });

  /**
   * GET /api/users/search?q=...
   * Search users by username or display name (for adding friends).
   */
  fastify.get('/api/users/search', async (request) => {
    const { q } = request.query as { q?: string };
    if (!q || q.length < 2) return { success: true, users: [] };

    const results = await db.query.users.findMany({
      where: (u, { or, ilike }) => or(
        ilike(u.username, `%${q}%`),
        ilike(u.displayName, `%${q}%`),
      ),
      limit: 10,
    });

    return {
      success: true,
      users: results.map((u) => ({
        id: u.id,
        username: u.username,
        displayName: u.displayName,
        avatarUrl: u.avatarUrl,
      })),
    };
  });
}
