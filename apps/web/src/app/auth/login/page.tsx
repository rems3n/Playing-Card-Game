"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { getProviders, signIn } from "next-auth/react";

export default function LoginPage() {
  const [googleAvailable, setGoogleAvailable] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    getProviders()
      .then((providers) => {
        if (!cancelled) setGoogleAvailable(!!providers?.google);
      })
      .catch(() => {
        if (!cancelled)
          setError(
            "Sign-in is unavailable right now. You can still play as a guest.",
          );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <section className="panel empty-state">
      <p className="eyebrow">YOUR PLAYER ACCOUNT</p>
      <h1>Sign in to CardArena</h1>
      <p>No account is needed to play with friends or practice with bots.</p>
      {loading ? (
        <p role="status">Checking sign-in options…</p>
      ) : error ? (
        <p role="alert">{error}</p>
      ) : googleAvailable ? (
        <>
          <p>
            Sign in before playing to keep future game results with your
            account.
          </p>
          <button
            className="button primary"
            onClick={() => signIn("google", { callbackUrl: "/" })}
          >
            Continue with Google
          </button>
        </>
      ) : (
        <p>
          Account sign-in is not enabled for this preview. Your guest results
          stay with this browser.
        </p>
      )}
      <p>
        <Link className="button secondary" href="/">
          Play as guest
        </Link>
      </p>
    </section>
  );
}
