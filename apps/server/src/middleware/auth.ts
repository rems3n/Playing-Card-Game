import { jwtVerify } from 'jose';
import type { FastifyRequest, FastifyReply } from 'fastify';
import type { Socket } from 'socket.io';
import { env } from '../config/env.js';

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  image?: string;
}

const secret = new TextEncoder().encode(env.JWT_SECRET);

/** Decode a NextAuth JWT token. Returns the user payload or null. */
async function verifyToken(token: string): Promise<AuthUser | null> {
  try {
    const { payload } = await jwtVerify(token, secret);
    if (!payload.sub) return null;
    return {
      id: payload.sub,
      name: (payload.name as string) ?? 'Player',
      email: (payload.email as string) ?? '',
      image: payload.picture as string | undefined,
    };
  } catch {
    return null;
  }
}

/** Fastify route-level auth hook. Attaches user to request or returns 401. */
export async function requireAuth(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const authHeader = request.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    reply.status(401).send({ error: 'Missing authorization header' });
    return;
  }

  const token = authHeader.slice(7);
  const user = await verifyToken(token);
  if (!user) {
    reply.status(401).send({ error: 'Invalid token' });
    return;
  }

  (request as any).user = user;
}

/**
 * Socket.io auth middleware.
 * Extracts token from handshake auth, verifies it, and attaches user to socket.data.
 * If no token is provided, allows connection as guest (for Phase 1 compatibility).
 */
export async function socketAuth(
  socket: Socket,
  next: (err?: Error) => void,
): Promise<void> {
  const token = socket.handshake.auth?.token;

  // Check for display name passed directly (before full JWT flow is wired)
  const directName = socket.handshake.auth?.displayName;
  const directEmail = socket.handshake.auth?.email;

  if (!token) {
    socket.data.user = directEmail ? { id: directEmail, email: directEmail } : null;
    socket.data.displayName = directName || 'Guest';
    next();
    return;
  }

  const user = await verifyToken(token);
  if (!user) {
    next(new Error('Authentication failed'));
    return;
  }

  socket.data.user = user;
  socket.data.displayName = user.name;
  next();
}
