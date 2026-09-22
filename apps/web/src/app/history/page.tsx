"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { apiFetch } from "@/lib/game-session";
import { useConnection } from "@/components/ConnectionProvider";
interface Result {
  id: string;
  gameType: string;
  myScore: number;
  mySeat: number;
  finalScores: number[];
  completedAt: string;
  players: {
    seatPosition: number;
    displayName: string;
    finalScore: number;
    isAi: boolean;
  }[];
}
export default function HistoryPage() {
  const [games, setGames] = useState<Result[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(0);
  const [retry, setRetry] = useState(0);
  const { connected } = useConnection();
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    apiFetch(
      `${process.env.NEXT_PUBLIC_SERVER_URL ?? "http://localhost:3001"}/api/games/history?limit=20&offset=${page * 20}`,
    )
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok || !data.success)
          throw new Error(data.error || "Could not load your games");
        if (!cancelled) setGames(data.games);
      })
      .catch((err) => {
        if (!cancelled) setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [page, retry, connected]);
  return (
    <div className="history-page">
      <p className="eyebrow">GAME HISTORY</p>
      <h1>Your games</h1>
      <p className="history-description">
        Completed games and the final scores. Guest history belongs to this
        browser’s player session; sign in before playing to keep future games
        with your account.
      </p>
      {error && (
        <div className="notice error" role="alert">
          {error}{" "}
          <button onClick={() => setRetry((n) => n + 1)}>Try again</button>
        </div>
      )}
      {loading ? (
        <p role="status">Loading your games…</p>
      ) : !games.length && !error ? (
        <section className="panel empty-history">
          <h2>No games yet</h2>
          <p>Finish a game and the final score will appear here.</p>
          <Link className="button primary" href="/">
            Let’s play →
          </Link>
        </section>
      ) : (
        <div className="history-list">
          {games.map((game) => {
            const best = ["hearts", "rummy"].includes(game.gameType)
              ? Math.min(...game.finalScores)
              : Math.max(...game.finalScores);
            const won = game.myScore === best;
            return (
              <details className="panel history-game" key={game.id}>
                <summary>
                  <span>
                    <strong>
                      {game.gameType === "seven-six"
                        ? "Seven-Six"
                        : game.gameType === "euchre"
                          ? "45s / Euchre"
                          : game.gameType}
                    </strong>
                    <small>
                      {new Date(game.completedAt).toLocaleDateString(
                        undefined,
                        { month: "short", day: "numeric", year: "numeric" },
                      )}
                    </small>
                  </span>
                  <span className={won ? "won-badge" : "score-badge"}>
                    {won ? "Won" : "Finished"} · {game.myScore} points
                  </span>
                  <span aria-hidden>⌄</span>
                </summary>
                <div className="history-scores">
                  {[...game.players]
                    .sort((a, b) => a.seatPosition - b.seatPosition)
                    .map((p) => (
                      <div key={p.seatPosition}>
                        <span>
                          {p.displayName}
                          {p.seatPosition === game.mySeat ? " (you)" : ""}
                          {p.isAi ? " · Bot" : ""}
                          {game.gameType === "euchre"
                            ? ` · Team ${(p.seatPosition % 2) + 1}`
                            : ""}
                        </span>
                        <strong>{p.finalScore}</strong>
                      </div>
                    ))}
                </div>
              </details>
            );
          })}
        </div>
      )}
      <div className="history-pagination">
        <button
          className="button secondary"
          disabled={!page || loading}
          onClick={() => setPage((p) => p - 1)}
        >
          Previous
        </button>
        <span>Page {page + 1}</span>
        <button
          className="button secondary"
          disabled={games.length < 20 || loading}
          onClick={() => setPage((p) => p + 1)}
        >
          Next
        </button>
      </div>
    </div>
  );
}
