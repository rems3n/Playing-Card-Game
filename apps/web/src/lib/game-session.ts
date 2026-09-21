"use client";

export interface PlayerSession {
  token: string;
  participantId: string;
  displayName: string;
  userId: string | null;
}
let cached: PlayerSession | null = null;
let pending: Promise<PlayerSession> | null = null;
let validUntil = 0;
let generation = 0;
export function clearPlayerSession() {
  generation++;
  cached = null;
  pending = null;
  validUntil = 0;
}
export function getPlayerSession(name?: string): Promise<PlayerSession> {
  if (
    cached &&
    Date.now() < validUntil &&
    (!name || name === cached.displayName || cached.userId)
  )
    return Promise.resolve(cached);
  if (pending)
    return pending.then((result) =>
      name && name !== result.displayName && !result.userId
        ? getPlayerSession(name)
        : result,
    );
  const current = generation;
  pending = (async () => {
    const response = await fetch("/api/game-session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        token: localStorage.getItem("cardarena-guest-token") ?? undefined,
        displayName: name ?? localStorage.getItem("cardarena-name") ?? "Guest",
      }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error ?? "Unable to connect");
    if (current !== generation)
      throw new Error("Player session changed. Please try again.");
    if (!result.userId)
      localStorage.setItem("cardarena-guest-token", result.token);
    localStorage.setItem("cardarena-name", result.displayName);
    cached = result;
    validUntil = Date.now() + 60_000;
    return result as PlayerSession;
  })().finally(() => {
    if (current === generation) pending = null;
  });
  return pending;
}

export async function apiFetch(url: string, init: RequestInit = {}) {
  const server = process.env.NEXT_PUBLIC_SERVER_URL ?? "http://localhost:3001";
  if (new URL(url, server).origin !== new URL(server).origin)
    throw new Error("Unexpected API origin");
  const session = await getPlayerSession();
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${session.token}`);
  return fetch(url, { ...init, headers });
}
