import { randomUUID } from "node:crypto";
import { jwtVerify } from "jose";
import type { FastifyInstance } from "fastify";
import { db } from "../config/database.js";
import { env } from "../config/env.js";
import { users } from "../db/schema.js";
import { issueSession, verifySession } from "../middleware/auth.js";

export async function authRoutes(app: FastifyInstance) {
  app.post(
    "/api/auth/guest",
    {
      schema: {
        body: {
          type: "object",
          properties: {
            token: { type: "string", maxLength: 4096 },
            displayName: { type: "string", minLength: 1, maxLength: 50 },
          },
          additionalProperties: false,
        },
      },
    },
    async (request, reply) => {
      const body = request.body as { token?: string; displayName?: string };
      const old = body.token ? await verifySession(body.token) : null;
      if (body.token && (!old || old.user))
        return reply
          .code(401)
          .send({ error: "Guest session expired. Start a new session." });
      return issueSession({
        id: old?.id ?? randomUUID(),
        name: body.displayName?.trim() || old?.name || "Guest",
        user: null,
      });
    },
  );

  app.post("/api/auth/session", async (request, reply) => {
    const token = request.headers.authorization?.replace(/^Bearer /, "");
    if (!token)
      return reply.code(401).send({ error: "Missing session assertion" });
    let claims;
    try {
      const result = await jwtVerify(
        token,
        new TextEncoder().encode(env.SESSION_EXCHANGE_SECRET),
        {
          algorithms: ["HS256"],
          issuer: "cardarena-web",
          audience: "cardarena-session",
          maxTokenAge: "90s",
          requiredClaims: ["iat", "exp", "sub"],
        },
      );
      claims = result.payload;
      if (
        claims.provider !== "google" ||
        claims.emailVerified !== true ||
        typeof claims.email !== "string" ||
        typeof claims.name !== "string" ||
        !claims.sub
      )
        throw new Error("Invalid identity");
    } catch {
      return reply.code(401).send({ error: "Invalid session assertion" });
    }
    // Never replace another provider identity on an email conflict.
    const [user] = await db
      .insert(users)
      .values({
        email: claims.email as string,
        displayName: (claims.name as string).slice(0, 50),
        authProvider: "google",
        authProviderId: claims.sub!,
      })
      .onConflictDoUpdate({
        target: [users.authProvider, users.authProviderId],
        set: { lastSeenAt: new Date() },
      })
      .returning();
    return issueSession({
      id: user.id,
      name: user.displayName,
      user: { id: user.id, name: user.displayName, email: user.email },
    });
  });
}
