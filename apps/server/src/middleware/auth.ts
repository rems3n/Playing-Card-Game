import { SignJWT, jwtVerify } from "jose";
import type { FastifyRequest, FastifyReply } from "fastify";
import type { Socket } from "socket.io";
import { env } from "../config/env.js";

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  image?: string;
}
export interface Participant {
  id: string;
  name: string;
  user: AuthUser | null;
}
const secret = new TextEncoder().encode(env.JWT_SECRET);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function issueSession(participant: Participant) {
  const token = await new SignJWT({
    name: participant.name,
    user: participant.user,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(participant.id)
    .setIssuer("cardarena-server")
    .setAudience("cardarena-player")
    .setIssuedAt()
    .setExpirationTime(participant.user ? "2h" : "30d")
    .sign(secret);
  return {
    token,
    participantId: participant.id,
    displayName: participant.name,
    userId: participant.user?.id ?? null,
  };
}

export async function verifySession(
  token: unknown,
): Promise<Participant | null> {
  if (typeof token !== "string") return null;
  try {
    const { payload } = await jwtVerify(token, secret, {
      algorithms: ["HS256"],
      issuer: "cardarena-server",
      audience: "cardarena-player",
      requiredClaims: ["exp", "iat", "sub"],
    });
    if (
      !payload.sub ||
      !uuid.test(payload.sub) ||
      typeof payload.name !== "string"
    )
      return null;
    const user = payload.user as AuthUser | null;
    if (
      user !== null &&
      (!user ||
        user.id !== payload.sub ||
        !uuid.test(user.id) ||
        typeof user.email !== "string")
    )
      return null;
    return { id: payload.sub, name: payload.name, user };
  } catch {
    return null;
  }
}

declare module "fastify" {
  interface FastifyRequest {
    user: AuthUser;
    participant: Participant;
  }
}

export async function requireAuth(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const participant = await verifySession(
    request.headers.authorization?.replace(/^Bearer /, ""),
  );
  if (!participant?.user) {
    reply.code(401).send({ success: false, error: "Sign in to continue" });
    return;
  }
  request.user = participant.user;
}

export async function socketAuth(
  socket: Socket,
  next: (err?: Error) => void,
): Promise<void> {
  const participant = await verifySession(socket.handshake.auth?.token);
  if (!participant) {
    next(new Error("Your session expired. Reconnect to continue."));
    return;
  }
  socket.data.participantId = participant.id;
  socket.data.user = participant.user;
  socket.data.displayName = participant.name;
  next();
}

export async function requireParticipant(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const participant = await verifySession(
    request.headers.authorization?.replace(/^Bearer /, ""),
  );
  if (!participant) {
    reply.code(401).send({ error: "Reconnect to continue" });
    return;
  }
  request.participant = participant;
}
