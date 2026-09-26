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
  // 45s seats two, four or six; the nearest allowed size is used when the
  // player switches from a Seven-Six table of three, five or seven.
  const fortyFivesSeats = [2, 4, 6].includes(count)
    ? count
    : count < 3
      ? 2
      : count < 6
        ? 4
        : 6;
  // Hearts and Spades seat four; Rummy two to six; the rest as chosen.
  const seatChoices =
    game === GameType.FortyFives
      ? [2, 4, 6]
      : game === GameType.Hearts || game === GameType.Spades
        ? [4]
        : game === GameType.Rummy
          ? [2, 3, 4, 5, 6]
          : [2, 3, 4, 5, 6, 7];
  const seats =
    game === GameType.FortyFives
      ? fortyFivesSeats
      : seatChoices.includes(count)
        ? count
        : seatChoices.includes(4)
          ? 4
          : seatChoices[seatChoices.length - 1];
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
        maxPlayers: seats,
        targetScore:
          { [GameType.FortyFives]: 45, [GameType.Hearts]: 100, [GameType.Spades]: 500, [GameType.Rummy]: 100 }[
            game as string
          ] ?? 0,
        // Bots take any seat nobody fills, in either mode, at this level.
        aiDifficulty: difficulty,
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
                type: GameType.FortyFives,
                name: "45s",
                symbol: "45",
                meta: "2, 4 or 6 players",
                copy: "Bid for the right to name trump. Five a trick, first to 45.",
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
          <p className="eyebrow other-games-heading">OTHER GAMES</p>
          <div className="game-choices other-games" role="group" aria-label="Other games">
            {[
              {
                type: GameType.Hearts,
                name: "Hearts",
                symbol: "\u2665",
                meta: "4 players",
                copy: "Avoid hearts and the queen of spades. Lowest score wins.",
              },
              {
                type: GameType.Spades,
                name: "Spades",
                symbol: "\u2660",
                meta: "4 players, in pairs",
                copy: "Bid your tricks with spades as trump. First pair to 500.",
              },
              {
                type: GameType.Rummy,
                name: "Rummy",
                symbol: "R",
                meta: "2\u20136 players",
                copy: "Draw and discard to lay down sets and runs. Go out to score.",
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
                  {game === g.type ? "\u2713" : ""}
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
                value={seats}
                disabled={seatChoices.length === 1}
                onChange={(e) => setCount(Number(e.target.value))}
              >
                {seatChoices.map((n) => (
                  <option key={n} value={n}>
                    {n} players
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label className="difficulty-field">
            {mode === "practice" ? "Bot difficulty" : "Bots in empty seats"}
            <select
              value={difficulty}
              onChange={(e) => setDifficulty(e.target.value as AIDifficulty)}
            >
              <option value={AIDifficulty.Beginner}>Beginner</option>
              <option value={AIDifficulty.Intermediate}>Medium</option>
              <option value={AIDifficulty.Expert}>Expert</option>
            </select>
            <small>
              {difficulty === AIDifficulty.Beginner
                ? "Plays any legal card and bids at random."
                : difficulty === AIDifficulty.Expert
                  ? "Counts the cards that have gone and plays each hand out before choosing."
                  : "Follows the standard lines and bids what it holds."}
            </small>
          </label>
          <p className="setup-note">
            {mode === "friends"
              ? "Create a private table and share the invite. Bots at the level above fill any empty seats when the game starts."
              : "Play at your own pace with computer opponents."}{" "}
            {game === GameType.FortyFives &&
              "Four and six play in two teams, sitting alternately."}
            {game === GameType.Spades && "Partners sit across from each other."}
            {game === GameType.Hearts && "Pass three cards each hand; the game ends at 100 points."}
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
        <Link href="/rules">Seven-Six &amp; 45s</Link>
      </footer>
    </div>
  );
}
