"use client";
import { useEffect, useState } from "react";

export const SERVER_URL =
  process.env.NEXT_PUBLIC_SERVER_URL ?? "http://localhost:3001";

/**
 * Reads a small, secret-free settings document from the game server once.
 *
 * A server that cannot answer means the feature is simply absent, never an
 * error in the player's face, so every failure resolves to `fallback`.
 */
export function useServerConfig<T>(
  path: string,
  fallback: T,
  fetcher: typeof fetch | null = null,
): T | null {
  const [config, setConfig] = useState<T | null>(null);
  useEffect(() => {
    let live = true;
    if (!fetcher && typeof fetch !== "function") return;
    // Wrapped, not passed by reference: a detached fetch throws in browsers.
    const get: typeof fetch = fetcher ?? ((...args) => fetch(...args));
    get(`${SERVER_URL}${path}`)
      .then((response) => (response.ok ? response.json() : null))
      .then((value: T | null) => live && setConfig(value ?? fallback))
      .catch(() => live && setConfig(fallback));
    return () => {
      live = false;
    };
    // `fallback` is a literal at every call site; re-reading on identity alone
    // would refetch on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, fetcher]);
  return config;
}
