"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { AIDifficulty, GameType } from "@card-game/shared-types";
import { useSocket } from "@/hooks/useSocket";
import { connectPlayer, useConnection } from "@/components/ConnectionProvider";

export default function Home() {
  const router = useRouter();
  const socket = useSocket();
  const { data: session } = useSession();
  const connection = useConnection();
  const [game, setGame] = useState(GameType.SevenSix);
  const [name, setName] = useState("");
  const [count, setCount] = useState(4);
  const [difficulty, setDifficulty] = useState(AIDifficulty.Beginner);
  const [mode, setMode] = useState<"friends" | "practice">("friends");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [resume, setResume] = useState<string | null>(null);
  useEffect(() => {
    setName(localStorage.getItem("cardarena-name") ?? "");
    setResume(localStorage.getItem("cardarena-last-game"));
  }, []);
  useEffect(() => {
    const room = ({ roomId }: { roomId: string }) =>
      router.push(`/room/${roomId}`);
    const created = ({ gameId }: { gameId: string }) =>
      router.push(`/game/${gameId}`);
    const failed = ({ message }: { message: string }) => {
      setBusy(false);
      setError(message);
    };
    socket.on("room:created", room);
    socket.on("lobby:game_created", created);
    socket.on("room:error", failed);
    socket.on("game:error", failed);
    return () => {
      socket.off("room:created", room);
      socket.off("lobby:game_created", created);
      socket.off("room:error", failed);
      socket.off("game:error", failed);
    };
  }, [socket, router]);
  useEffect(() => {
    if (!busy) return;
    const timer = setTimeout(() => {
      setBusy(false);
      setError("The request took too long. Please try again.");
    }, 15000);
    return () => clearTimeout(timer);
  }, [busy]);
  async function start(join = false) {
    if (!session?.user && !name.trim()) {
      setError("Enter your name so everyone knows who is playing.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await connectPlayer(name.trim() || undefined);
      if (join) {
        if (!/^[a-z0-9]{8}$/i.test(code.trim()))
          throw new Error("Enter the 8-character room code.");
        router.push(`/room/${code.trim().toLowerCase()}`);
        return;
      }
      const config = {
        maxPlayers: game === GameType.Euchre ? 4 : count,
        targetScore: game === GameType.Euchre ? 10 : 0,
      };
      if (mode === "friends")
        socket.emit("room:create", { gameType: game, config });
      else
        socket.emit("lobby:create_game", {
          gameType: game,
          config,
          fillWithAI: true,
          aiDifficulty: difficulty,
        });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not connect");
      setBusy(false);
    }
  }
  return (
    <div className="home-page">
      <section className="hero">
        <div>
          <p className="eyebrow">CARD GAMES ONLINE</p>
          <h1>
            Seven-Six
            <br />
            and 45s.
          </h1>
          <p className="hero-copy">
            Trick-taking card games for 2 to 7 players.
            <br className="desktop-only" /> Play with friends in a private room,
            or against bots. No account needed.
          </p>
          <a href="#new-game" className="text-link">
            Start a game <span aria-hidden>↘</span>
          </a>
        </div>
        <div className="hero-cards" aria-hidden>
          <div className="hero-card red">
            <span>
              7<br />♥
            </span>
            <strong>♥</strong>
          </div>
          <div className="hero-card black">
            <span>
              A<br />♠
            </span>
            <strong>♠</strong>
          </div>
          <span className="hero-caption">Seven of hearts, ace of spades.</span>
        </div>
      </section>
      <div className="home-grid">
        <section id="new-game" className="panel setup-panel">
          <div className="section-heading">
            <div>
              <p className="eyebrow">NEW GAME</p>
              <h2>Start a game</h2>
            </div>
            <span className="small-note">No account needed</span>
          </div>
          <div className="game-choices" role="group" aria-label="Choose a game">
            {[
              {
                type: GameType.SevenSix,
                name: "Seven-Six",
                symbol: "7 / 6",
                meta: "2–7 players",
                copy: "Bid the tricks you expect to win. Make it exactly for a bonus.",
              },
              {
                type: GameType.Euchre,
                name: "45s / Euchre",
                symbol: "♠",
                meta: "4 players · Teams",
                copy: "Partners sit opposite each other. First team to 10 points wins.",
              },
            ].map((g) => (
              <button
                key={g.type}
                className={`game-choice ${game === g.type ? "selected" : ""}`}
                aria-pressed={game === g.type}
                onClick={() => setGame(g.type)}
              >
                <span className="game-symbol" aria-hidden>
                  {g.symbol}
                </span>
                <span className="choice-check" aria-hidden>
                  {game === g.type ? "✓" : ""}
                </span>
                <strong>{g.name}</strong>
                <small>{g.meta}</small>
                <p>{g.copy}</p>
              </button>
            ))}
          </div>
          <div className="mode-switch" role="group" aria-label="Play mode">
            <button
              aria-pressed={mode === "friends"}
              onClick={() => setMode("friends")}
            >
              With friends
            </button>
            <button
              aria-pressed={mode === "practice"}
              onClick={() => setMode("practice")}
            >
              Practice with bots
            </button>
          </div>
          <div className="setup-fields">
            <label>
              Your name
              <input
                value={session?.user?.name ?? name}
                disabled={!!session?.user}
                onChange={(e) => setName(e.target.value)}
                maxLength={50}
                autoComplete="nickname"
                placeholder="Your name"
              />
            </label>
            <label>
              Seats at the table
              <select
                value={game === GameType.Euchre ? 4 : count}
                disabled={game === GameType.Euchre}
                onChange={(e) => setCount(Number(e.target.value))}
              >
                {[2, 3, 4, 5, 6, 7].map((n) => (
                  <option key={n} value={n}>
                    {n} players
                  </option>
                ))}
              </select>
            </label>
          </div>
          {mode === "practice" && (
            <label className="difficulty-field">
              Bot difficulty
              <select
                value={difficulty}
                onChange={(e) => setDifficulty(e.target.value as AIDifficulty)}
              >
                <option value={AIDifficulty.Beginner}>
                  Beginner — learn the game
                </option>
                <option value={AIDifficulty.Intermediate}>
                  Casual — basic strategy
                </option>
              </select>
            </label>
          )}
          <p className="setup-note">
            {mode === "friends"
              ? "Create a private table and share the invite. Bots can fill empty seats."
              : "Play at your own pace with computer opponents."}{" "}
            {game === GameType.Euchre &&
              "Uses the existing Euchre rules; first team to 10."}
          </p>
          {error && (
            <p role="alert" className="notice error">
              {error}
            </p>
          )}
          <button
            className="button primary full"
            disabled={busy}
            onClick={() => start()}
          >
            {busy
              ? "Getting your table ready…"
              : mode === "friends"
                ? "Create a private table"
                : "Start practice"}
            <span aria-hidden>→</span>
          </button>
        </section>
        <aside className="home-aside">
          <section className="panel join-panel">
            <span className="round-icon" aria-hidden>
              ↗
            </span>
            <h2>Join a game</h2>
            <p>Enter the 8-character room code you were sent.</p>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void start(true);
              }}
            >
              <label>
                Room code
                <input
                  placeholder="e.g. a1b2c3d4"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  maxLength={8}
                  autoCapitalize="none"
                  spellCheck={false}
                />
              </label>
              <button
                className="button secondary full"
                disabled={busy || !code.trim()}
              >
                Join a table
              </button>
            </form>
          </section>
          <section className="learn-panel">
            <span className="eyebrow">RULES</span>
            <h2>How to play</h2>
            <p>
              Bidding, trick-taking and scoring, for both games.
            </p>
            <Link className="text-link" href="/rules">
              Read the rules <span aria-hidden>→</span>
            </Link>
          </section>
          {resume && (
            <Link className="resume-link" href={`/game/${resume}`}>
              Return to your last game →
            </Link>
          )}
        </aside>
      </div>
      {!connection.connected && (
        <div className="connection-notice" role="status">
          {connection.message || "Connecting to the table…"}{" "}
          <button onClick={connection.retry}>Retry</button>
        </div>
      )}
      <footer className="home-footer">
        <span>♣ &nbsp; Made for the games you grew up with.</span>
        <Link href="/rules">Seven-Six &amp; 45s / Euchre</Link>
      </footer>
    </div>
  );
}
