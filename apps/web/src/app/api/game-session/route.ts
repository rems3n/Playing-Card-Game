import { SignJWT } from "jose";
import { auth } from "@/lib/auth";

export async function POST(request: Request) {
  if (request.headers.get("sec-fetch-site") === "cross-site")
    return Response.json({ error: "Invalid origin" }, { status: 403 });
  const session = await auth();
  const body = await request.json().catch(() => ({}));
  const base =
    process.env.SERVER_INTERNAL_URL ??
    process.env.NEXT_PUBLIC_SERVER_URL ??
    "http://localhost:3001";
  try {
    let response: Response;
    if (session?.user?.email) {
      const user = session.user as typeof session.user & {
        providerId?: string;
        emailVerified?: boolean;
      };
      if (!user.providerId || !user.emailVerified)
        return Response.json(
          { error: "Sign out and sign in again to verify your account." },
          { status: 401 },
        );
      const secret =
        process.env.SESSION_EXCHANGE_SECRET ??
        (process.env.NODE_ENV !== "production"
          ? "local-session-exchange-only"
          : "");
      if (secret.length < 24)
        throw new Error("Session service is not configured");
      const assertion = await new SignJWT({
        provider: "google",
        email: user.email,
        name: user.name ?? "Player",
        emailVerified: true,
      })
        .setProtectedHeader({ alg: "HS256" })
        .setSubject(user.providerId)
        .setIssuer("cardarena-web")
        .setAudience("cardarena-session")
        .setIssuedAt()
        .setExpirationTime("60s")
        .sign(new TextEncoder().encode(secret));
      response = await fetch(`${base}/api/auth/session`, {
        method: "POST",
        headers: { Authorization: `Bearer ${assertion}` },
        signal: AbortSignal.timeout(10000),
        cache: "no-store",
      });
    } else {
      response = await fetch(`${base}/api/auth/guest`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token: body.token,
          displayName: body.displayName,
        }),
        signal: AbortSignal.timeout(10000),
        cache: "no-store",
      });
    }
    const result = await response.json();
    return Response.json(
      response.ok
        ? result
        : { error: result.error ?? "Unable to start a player session" },
      { status: response.status, headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return Response.json(
      { error: "Cannot reach the game server. Please try again." },
      { status: 503 },
    );
  }
}
