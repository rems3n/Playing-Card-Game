import { afterAll, describe, expect, it } from "vitest";
import Fastify from "fastify";
import { randomUUID } from "node:crypto";
import { SignJWT } from "jose";
import { authRoutes } from "../routes/auth.js";
import {
  issueSession,
  requireAuth,
  socketAuth,
  verifySession,
} from "../middleware/auth.js";
import { env } from "../config/env.js";
const app = Fastify();
app.register(authRoutes);
app.get("/private", { preHandler: requireAuth }, (request) => ({
  id: request.user.id,
}));
afterAll(() => app.close());
describe("verified player sessions", () => {
  it("renews a guest token without changing the player identity", async () => {
    const first = await app.inject({
      method: "POST",
      url: "/api/auth/guest",
      payload: { displayName: "Alex" },
    });
    const session = first.json();
    expect(first.statusCode).toBe(200);
    const renewed = await app.inject({
      method: "POST",
      url: "/api/auth/guest",
      payload: { token: session.token, displayName: "Alex II" },
    });
    expect(renewed.json().participantId).toBe(session.participantId);
    expect(renewed.json().displayName).toBe("Alex II");
    expect((await verifySession(renewed.json().token))?.user).toBeNull();
  });
  it("rejects tampered, expired and account tokens at the guest endpoint", async () => {
    const id = randomUUID();
    const account = await issueSession({
      id,
      name: "Alex",
      user: { id, name: "Alex", email: "alex@example.test" },
    });
    const expired = await new SignJWT({ name: "Alex", user: null })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(id)
      .setIssuer("cardarena-server")
      .setAudience("cardarena-player")
      .setIssuedAt()
      .setExpirationTime(0)
      .sign(new TextEncoder().encode(env.JWT_SECRET));
    for (const token of ["invalid", expired, account.token]) {
      expect(
        (
          await app.inject({
            method: "POST",
            url: "/api/auth/guest",
            payload: { token },
          })
        ).statusCode,
      ).toBe(401);
    }
  });
  it("cannot impersonate an account with an email or an unsigned socket handshake", async () => {
    let error: Error | undefined;
    await socketAuth(
      {
        handshake: {
          auth: { email: "victim@example.test", displayName: "Victim" },
        },
        data: {},
      } as any,
      (err) => {
        error = err;
      },
    );
    expect(error).toBeInstanceOf(Error);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/auth/session",
          headers: { authorization: "Bearer forged" },
        })
      ).statusCode,
    ).toBe(401);
  });
  it("allows only verified account sessions through account-only routes", async () => {
    const guest = await issueSession({
      id: randomUUID(),
      name: "Guest",
      user: null,
    });
    expect(
      (
        await app.inject({
          url: "/private?email=victim@example.test",
          headers: { authorization: `Bearer ${guest.token}` },
        })
      ).statusCode,
    ).toBe(401);
    const id = randomUUID();
    const account = await issueSession({
      id,
      name: "Alex",
      user: { id, name: "Alex", email: "alex@example.test" },
    });
    const response = await app.inject({
      url: "/private?email=victim@example.test",
      headers: { authorization: `Bearer ${account.token}` },
    });
    expect(response.json()).toEqual({ id });
  });
});
