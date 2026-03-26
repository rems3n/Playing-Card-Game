import type { FastifyInstance } from 'fastify';
import { eq, and, ne } from 'drizzle-orm';
import { db } from '../config/database.js';
import { users, ratings, games, gamePlayers } from '../db/schema.js';

const USERNAME_REGEX = /^[a-zA-Z0-9_]{3,30}$/;

export async function userRoutes(fastify: FastifyInstance): Promise<void> {
  /**
   * POST /api/users/sync
   * Called after OAuth login to upsert the user in our database.
   * Body: { email, displayName, avatarUrl, provider, providerId }
   */
  fastify.post('/api/users/sync', async (request) => {
    const body = request.body as {
      email: string;
      displayName: string;
      avatarUrl?: string;
      provider: string;
      providerId: string;
    };

    const result = await db
      .insert(users)
      .values({
        email: body.email,
        displayName: body.displayName,
        avatarUrl: body.avatarUrl ?? null,
        authProvider: body.provider,
        authProviderId: body.providerId,
      })
      .onConflictDoUpdate({
        target: [users.authProvider, users.authProviderId],
        set: {
          lastSeenAt: new Date(),
        },
      })
      .returning();

    const user = result[0];

    // Ensure rating rows exist for all game types
    for (const gameType of ['hearts', 'spades', 'euchre']) {
      await db
        .insert(ratings)
        .values({ userId: user.id, gameType })
        .onConflictDoNothing();
    }

    return { success: true, user };
  });

  /**
   * GET /api/users/me?email=...
   * Get the current user's profile with ratings and stats.
   */
  fastify.get('/api/users/me', async (request, reply) => {
    const { email } = request.query as { email?: string };
    if (!email) {
      reply.status(400);
      return { success: false, error: 'Email required' };
    }

    const user = await db.query.users.findFirst({
      where: eq(users.email, email),
    });

    if (!user) {
      return { success: false, error: 'User not found' };
    }

    const userRatings = await db.query.ratings.findMany({
      where: eq(ratings.userId, user.id),
    });

    const playerRows = await db
      .select({
        gameType: games.gameType,
        finalScore: gamePlayers.finalScore,
        winnerId: games.winnerId,
      })
      .from(gamePlayers)
      .innerJoin(games, eq(gamePlayers.gameId, games.id))
      .where(
        and(
          eq(gamePlayers.userId, user.id),
          eq(games.status, 'completed'),
        ),
      );

    const gameStats: Record<string, { played: number; wins: number }> = {};
    for (const row of playerRows) {
      const gt = row.gameType;
      if (!gameStats[gt]) gameStats[gt] = { played: 0, wins: 0 };
      gameStats[gt].played++;
      if (row.winnerId === user.id) gameStats[gt].wins++;
    }

    return {
      success: true,
      profile: {
        ...user,
        ratings: userRatings,
        gameStats,
      },
    };
  });

  /**
   * PATCH /api/users/me
   * Update the current user's profile (displayName, username, avatarUrl).
   * Body: { email, displayName?, username?, avatarUrl? }
   */
  fastify.patch('/api/users/me', async (request, reply) => {
    const body = request.body as {
      email: string;
      displayName?: string;
      username?: string;
      avatarUrl?: string;
    };

    if (!body.email) {
      reply.status(400);
      return { success: false, error: 'Email required' };
    }

    const user = await db.query.users.findFirst({
      where: eq(users.email, body.email),
    });

    if (!user) {
      reply.status(404);
      return { success: false, error: 'User not found' };
    }

    const updates: Record<string, unknown> = {};

    if (body.displayName !== undefined) {
      const name = body.displayName.trim();
      if (name.length < 1 || name.length > 50) {
        reply.status(400);
        return { success: false, error: 'Display name must be 1-50 characters' };
      }
      updates.displayName = name;
    }

    if (body.username !== undefined) {
      const username = body.username.trim().toLowerCase();
      if (username.length === 0) {
        updates.username = null;
      } else {
        if (!USERNAME_REGEX.test(username)) {
          reply.status(400);
          return {
            success: false,
            error: 'Username must be 3-30 characters, letters, numbers, and underscores only',
          };
        }

        const existing = await db.query.users.findFirst({
          where: and(
            eq(users.username, username),
            ne(users.id, user.id),
          ),
        });
        if (existing) {
          reply.status(409);
          return { success: false, error: 'Username is already taken' };
        }
        updates.username = username;
      }
    }

    if (body.avatarUrl !== undefined) {
      updates.avatarUrl = body.avatarUrl;
    }

    if (Object.keys(updates).length === 0) {
      return { success: true, profile: user };
    }

    const result = await db
      .update(users)
      .set(updates)
      .where(eq(users.id, user.id))
      .returning();

    return { success: true, profile: result[0] };
  });

  /**
   * GET /api/users/check-username/:username
   * Check if a username is available.
   */
  fastify.get('/api/users/check-username/:username', async (request, reply) => {
    const { username } = request.params as { username: string };
    const lower = username.trim().toLowerCase();

    if (!USERNAME_REGEX.test(lower)) {
      reply.status(400);
      return {
        available: false,
        error: 'Username must be 3-30 characters, letters, numbers, and underscores only',
      };
    }

    const existing = await db.query.users.findFirst({
      where: eq(users.username, lower),
    });

    return { available: !existing };
  });

  /**
   * GET /api/users/:id
   * Get a public user profile.
   */
  fastify.get('/api/users/:id', async (request) => {
    const { id } = request.params as { id: string };

    const user = await db.query.users.findFirst({
      where: eq(users.id, id),
    });

    if (!user) {
      return { success: false, error: 'User not found' };
    }

    const userRatings = await db.query.ratings.findMany({
      where: eq(ratings.userId, user.id),
    });

    return {
      success: true,
      profile: {
        id: user.id,
        username: user.username,
        displayName: user.displayName,
        avatarUrl: user.avatarUrl,
        createdAt: user.createdAt,
        ratings: userRatings,
      },
    };
  });
}
