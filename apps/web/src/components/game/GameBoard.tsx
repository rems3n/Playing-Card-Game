"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  GamePhase,
  GameType,
  type Card,
  type PlayedCard,
  type VisiblePlayerState,
} from "@card-game/shared-types";
import { useSocket } from "@/hooks/useSocket";
import { useGameStore } from "@card-game/shared-store";
import { useConnection } from "../ConnectionProvider";
import { BiddingPanel } from "./BiddingPanel";
import { RulesModal } from "../RulesModal";
import { ChatPanel } from "./ChatPanel";
import { Dialog } from "../Dialog";
import { RummyBoard } from "./RummyBoard";
const symbols: Record<string, string> = { H: "♥", D: "♦", S: "♠", C: "♣" };
const suits: Record<string, string> = {
  H: "hearts",
  D: "diamonds",
  S: "spades",
  C: "clubs",
};
const ranks: Record<number, string> = { 11: "J", 12: "Q", 13: "K", 14: "A" };
const label = (c: Card) => `${ranks[c.rank] ?? c.rank} of ${suits[c.suit]}`;
const key = (c: Card) => `${c.rank}${c.suit}`;
function Face({ card }: { card: Card }) {
  return (
    <>
      <span className="card-corner">
        {ranks[card.rank] ?? card.rank}
        <small>{symbols[card.suit]}</small>
      </span>
      <span className="card-suit">{symbols[card.suit]}</span>
      <span className="card-bottom">
        {ranks[card.rank] ?? card.rank}
        {symbols[card.suit]}
      </span>
    </>
  );
}
function TrickCards({
  cards,
  players,
  mySeat,
  winningSeat,
}: {
  cards: PlayedCard[];
  players: VisiblePlayerState[];
  mySeat: number;
  winningSeat?: number;
}) {
  return (
    <div
      className="trick-cards"
      role="group"
      aria-label="Cards played in this trick"
    >
      {cards.map((play) => (
        <div
          className={`trick-play ${play.seatIndex === winningSeat ? "trick-winner" : ""}`}
          key={play.seatIndex}
        >
          <div
            className={`face-card ${["H", "D"].includes(play.card.suit) ? "red" : ""}`}
            role="img"
            aria-label={`${label(play.card)}${play.seatIndex === winningSeat ? ", winning card" : ""}`}
          >
            <Face card={play.card} />
          </div>
          <span>
            {play.seatIndex === mySeat
              ? "You"
              : players[play.seatIndex]?.displayName}
          </span>
          {play.seatIndex === winningSeat && (
            <strong className="winner-tag">Winner</strong>
          )}
        </div>
      ))}
    </div>
  );
}

export function GameBoard() {
  const type = useGameStore((s) => s.gameState?.gameType);
  return type === GameType.Rummy ? <RummyBoard /> : <FamilyTable />;
}
function FamilyTable() {
  const router = useRouter();
  const socket = useSocket();
  const connection = useConnection();
  const {
    gameId,
    gameState: state,
    gameOver,
    error,
    setGameState,
    setGameOver,
    setError,
  } = useGameStore();
  const [selected, setSelected] = useState<Card | null>(null);
  const [rules, setRules] = useState(false);
  const [leave, setLeave] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [saveStatus, setSaveStatus] = useState<boolean | undefined>();
  const [disconnected, setDisconnected] = useState<{
    seatIndex: number;
    timeoutSeconds: number;
  } | null>(null);
  useEffect(() => {
    setSaveStatus(undefined);
    setSelected(null);
    setReviewOpen(false);
  }, [gameId]);
  useEffect(() => {
    const update = (next: NonNullable<typeof state>) => {
      if (next.gameId !== gameId) return;
      setGameState(next);
      setSelected(null);
      setPending(false);
      setError(null);
    };
    const over = (
      result: NonNullable<typeof gameOver> & {
        saved?: boolean;
        gameId?: string;
      },
    ) => {
      if (result.gameId && result.gameId !== gameId) return;
      setGameOver(result);
      setSaveStatus(result.saved);
      setPending(false);
    };
    const failed = ({ message }: { message: string }) => {
      setError(message);
      setPending(false);
    };
    const lost = (data: { seatIndex: number; timeoutSeconds: number }) =>
      setDisconnected(data);
    const returned = ({ seatIndex }: { seatIndex: number }) =>
      setDisconnected((current) =>
        current?.seatIndex === seatIndex ? null : current,
      );
    socket.on("game:state", update);
    socket.on("game:over", over);
    socket.on("game:error", failed);
    socket.on("game:player_disconnected", lost);
    socket.on("game:player_reconnected", returned);
    return () => {
      socket.off("game:state", update);
      socket.off("game:over", over);
      socket.off("game:error", failed);
      socket.off("game:player_disconnected", lost);
      socket.off("game:player_reconnected", returned);
    };
  }, [socket, gameId, setGameState, setGameOver, setError]);
  useEffect(() => {
    if (!pending) return;
    const timer = setTimeout(() => {
      setPending(false);
      setError("The move was not confirmed. Reconnect before trying again.");
    }, 10000);
    return () => clearTimeout(timer);
  }, [pending, setError]);
  if (!state || state.gameId !== gameId)
    return (
      <div className="empty-state">
        <h1>Taking your seat…</h1>
        <p role="status">
          {error || connection.message || "Loading the table."}
        </p>
        <Link href="/" className="button secondary">
          Back to games
        </Link>
      </div>
    );
  const reviewing = state.phase === GamePhase.TrickResolution;
  const roundOver = state.phase === GamePhase.RoundScoring;
  const familyGame = [GameType.SevenSix, GameType.Euchre].includes(state.gameType);
  const trumpCard = state.gameType === GameType.SevenSix ? state.trumpCard : state.turnedUpCard;
  const completed = reviewing ? state.lastTrick : undefined;
  const winnerName =
    completed?.winningSeat === state.mySeat
      ? "You"
      : state.players[completed?.winningSeat ?? -1]?.displayName;
  const done = !!gameOver || state.phase === GamePhase.GameOver;
  const myTurn =
    !done &&
    !reviewing &&
    !roundOver &&
    connection.connected &&
    state.currentPlayerSeat === state.mySeat;
  const playing = state.phase === GamePhase.Playing;
  const current = state.players.find(
    (p) => p.seatIndex === state.currentPlayerSeat,
  );
  const me = state.players.find((p) => p.seatIndex === state.mySeat);
  const name =
    state.gameType === GameType.SevenSix
      ? "Seven-Six"
      : state.gameType === GameType.Euchre
        ? "45s / Euchre"
        : state.gameType;
  const legal = (c: Card) => state.legalMoves.some((m) => key(m) === key(c));
  const scores = gameOver?.finalScores ?? state.scores;
  const abandoned = gameOver?.winnerSeat === -1;
  const best = [GameType.Hearts, GameType.Rummy].includes(state.gameType)
    ? Math.min(...scores)
    : Math.max(...scores);
  const winners = state.players.filter((p) => scores[p.seatIndex] === best);
  const handBest = Math.max(...state.roundScores);
  const handWinners = state.players.filter((p) => state.roundScores[p.seatIndex] === handBest);
  function play() {
    if (!selected || !gameId || !myTurn || pending || !legal(selected)) return;
    setPending(true);
    socket.emit("game:play_card", { gameId, card: selected });
  }
  return (
    <div
      className="game-page"
      data-phase={state.phase}
      data-round={state.roundNumber}
    >
      <div className="game-heading">
        <div>
          <p className="eyebrow">THE FAMILY TABLE</p>
          <h1>{name}</h1>
        </div>
        <div className="game-heading-actions">
          <button
            className="button secondary"
            disabled={!state.lastTrick}
            onClick={() => setReviewOpen(true)}
          >
            Last trick
          </button>
          <button className="button secondary" onClick={() => setRules(true)}>
            Rules
          </button>
          <button className="button secondary" onClick={() => setLeave(true)}>
            Leave table
          </button>
        </div>
      </div>
      {!connection.connected && (
        <div className="notice" role="status">
          {connection.message || "Reconnecting…"} Your moves are paused.{" "}
          <button onClick={connection.retry}>Retry connection</button>
        </div>
      )}
      {error && (
        <div className="notice error" role="alert">
          {error}
        </div>
      )}
      {done && (
        <section className="result-panel panel" aria-live="polite">
          <p className="eyebrow">
            {abandoned ? "TABLE CLOSED" : "FINAL SCORE"}
          </p>
          <h2>
            {abandoned
              ? "Game ended early"
              : `${winners.map((p) => (p.seatIndex === state.mySeat ? "You" : p.displayName)).join(" & ")} ${winners.length > 1 || winners[0]?.seatIndex === state.mySeat ? "win" : "wins"}!`}
          </h2>
          <p>
            {saveStatus === true
              ? "The result has been saved."
              : saveStatus === false
                ? "The result could not be saved yet. Keep this table open and retry."
                : abandoned
                  ? "This game has no winner."
                  : "Saving the result…"}
          </p>
          {saveStatus === false && (
            <button
              className="button secondary"
              onClick={() => socket.emit("game:join", { gameId: gameId! })}
            >
              Retry saving
            </button>
          )}
          <Link className="button primary" href="/">
            Choose another game
          </Link>
        </section>
      )}
      {disconnected && !done && (
        <div className="notice">
          {state.players[disconnected.seatIndex]?.displayName} is disconnected.{" "}
          {disconnected.timeoutSeconds ? (
            "Their seat is reserved while they reconnect."
          ) : (
            <button
              className="button secondary"
              onClick={() => {
                socket.emit("game:replace_with_ai", {
                  gameId: gameId!,
                  seatIndex: disconnected.seatIndex,
                });
                setDisconnected(null);
              }}
            >
              Continue with a bot
            </button>
          )}
        </div>
      )}
      <div className="table-layout">
        <section className="table-main">
          <div className="table-status">
            <span role="status">
              {reviewing
                ? `${winnerName} ${completed?.winningSeat === state.mySeat ? "win" : "wins"} the trick`
                : roundOver
                  ? "Hand complete"
                : done
                  ? "Thanks for playing"
                  : myTurn
                    ? state.phase === GamePhase.Bidding
                      ? "Your turn to bid"
                      : "Your turn to play"
                    : `Waiting for ${current?.displayName ?? "players"}`}
            </span>
            <span>
              Round {state.roundNumber + 1}
              {state.totalRounds ? ` / ${state.totalRounds}` : ""} &nbsp; ·
              &nbsp;{" "}
              {state.trumpSuit
                ? `Trump ${symbols[state.trumpSuit]}`
                : "Choosing trump"}
            </span>
          </div>
          {familyGame && (trumpCard || state.trumpSuit) && (
            <section className="trump-panel" aria-label="Trump for this hand">
              {trumpCard && (
                <div className={`face-card ${["H", "D"].includes(trumpCard.suit) ? "red" : ""}`}
                  role="img" aria-label={`${state.gameType === GameType.SevenSix ? "Trump card" : "Turned-up card"}: ${label(trumpCard)}`}>
                  <Face card={trumpCard} />
                </div>
              )}
              <div>
                <p className="eyebrow">{state.trumpSuit ? "TRUMP" : "TURNED-UP CARD"}</p>
                <h2>{state.trumpSuit ? `${symbols[state.trumpSuit]} ${suits[state.trumpSuit]}` : trumpCard ? label(trumpCard) : "Choosing trump"}</h2>
                <p>{state.gameType === GameType.SevenSix
                  ? `${trumpCard ? label(trumpCard) + " · " : ""}Set aside for this hand. No player can hold it.`
                  : state.phase === GamePhase.Bidding
                    ? "The turned-up card is picked up by the dealer if its suit is ordered."
                    : state.trumpCallRound === 1
                      ? "The dealer picked up the turned-up card and discarded one card."
                      : "The turned-up card was passed. Trump was chosen in the second bidding round."}</p>
              </div>
            </section>
          )}
          {roundOver && (
            <section className="panel round-result" aria-label="Hand results">
              <p className="eyebrow">HAND {state.roundNumber + 1} COMPLETE</p>
              <h2>{handBest === 0 ? "No player made their bid" : state.gameType === GameType.Euchre
                ? `Team ${(handWinners[0].seatIndex % 2) + 1} wins the hand`
                : `${handWinners.map(p => p.seatIndex === state.mySeat ? "You" : p.displayName).join(" & ")} ${handWinners.length > 1 || handWinners[0]?.seatIndex === state.mySeat ? "earn" : "earns"} the most points`}</h2>
              <ul className="round-points">
                {state.players.map(p => <li key={p.seatIndex}><span>{p.seatIndex === state.mySeat ? "You" : p.displayName}</span><strong>+{state.roundScores[p.seatIndex]} points</strong></li>)}
              </ul>
              <p>{state.autoDeal ? "The next hand will be dealt automatically after 5 seconds. Turn off auto-deal below to pause." : "Review the scores, then deal when everyone is ready."}</p>
              <button className="button primary" disabled={pending || !connection.connected} onClick={() => {
                if (pending || !connection.connected) return;
                setPending(true);
                socket.emit("game:deal_next", { gameId: gameId!, roundNumber: state.roundNumber });
              }}>{pending ? "Dealing…" : "Deal next hand"}</button>
            </section>
          )}
          {familyGame && !done && (
            <label className="auto-deal-control">
              <input type="checkbox" checked={state.autoDeal ?? false} disabled={pending || !connection.connected}
                onChange={(event) => {
                  setPending(true);
                  socket.emit("game:set_auto_deal", { gameId: gameId!, enabled: event.target.checked });
                }} />
              <span>Automatically deal the next hand <small>Applies to this table for the rest of this game. Turn off anytime.</small></span>
            </label>
          )}
          <div className="felt-table">
            <div className="opponents">
              {state.players
                .filter((p) => p.seatIndex !== state.mySeat)
                .map((p) => (
                  <div
                    key={p.seatIndex}
                    className={`opponent ${state.currentPlayerSeat === p.seatIndex && !done && !reviewing && !roundOver ? "active" : ""} ${completed?.winningSeat === p.seatIndex ? "won-trick" : ""}`}
                  >
                    <span className="avatar">{p.displayName[0]}</span>
                    <div>
                      <strong>{p.displayName}</strong>
                      <small>
                        {p.isAI
                          ? "Bot"
                          : p.isConnected
                            ? "Connected"
                            : "Reconnecting"}{" "}
                        ·{" "}
                        {p.seatIndex === state.dealerSeat
                          ? "Dealer"
                          : `${p.cardCount} cards`}
                      </small>
                    </div>
                    <span
                      className="opponent-score"
                      aria-label={`${p.displayName}: ${p.tricksWon} tricks, ${scores[p.seatIndex]} points`}
                    >
                      <strong>
                        {p.tricksWon} <small>tricks</small>
                      </strong>
                      <small>{scores[p.seatIndex]} pts</small>
                    </span>
                  </div>
                ))}
            </div>
            <div className="trick-space">
              {state.phase === GamePhase.Bidding && !done ? (
                <div className="bid-surface">
                  <BiddingPanel
                    key={`${state.roundNumber}:${state.currentPlayerSeat}:${state.trumpCallRound}`}
                    gameState={state}
                    pending={pending || !connection.connected}
                    onBid={(bid) => {
                      if (pending || !connection.connected) return;
                      setPending(true);
                      socket.emit("game:bid", { gameId: gameId!, bid });
                    }}
                    onCallTrump={(suit) => {
                      if (pending || !connection.connected) return;
                      setPending(true);
                      socket.emit("game:call_trump", { gameId: gameId!, suit });
                    }}
                  />
                </div>
              ) : state.currentTrick.length ? (
                <div
                  className="trick-display"
                  key={`${state.roundNumber}:${state.trickNumber}`}
                >
                  {completed && (
                    <p className="trick-announcement" role="status">
                      {winnerName}{" "}
                      {completed.winningSeat === state.mySeat ? "win" : "wins"}{" "}
                      this trick
                      <small>Review all cards before play continues</small>
                    </p>
                  )}
                  <TrickCards
                    cards={state.currentTrick}
                    players={state.players}
                    mySeat={state.mySeat}
                    winningSeat={completed?.winningSeat}
                  />
                </div>
              ) : (
                <div className="table-watermark">
                  <span aria-hidden>♣</span>
                  <p>
                    {done
                      ? "A good game. Good company."
                      : "The next trick starts here."}
                  </p>
                </div>
              )}
            </div>
            <div
              className={`my-seat ${completed?.winningSeat === state.mySeat ? "won-trick" : ""}`}
            >
              <span className="avatar">{me?.displayName[0] ?? "Y"}</span>
              <strong>
                {me?.displayName} <small>(you)</small>
              </strong>
              {state.mySeat === state.dealerSeat && (
                <span className="dealer-tag">DEALER</span>
              )}
              <span className="my-score">
                {me?.tricksWon ?? 0} tricks · {scores[state.mySeat]} points
              </span>
            </div>
          </div>
          {!roundOver && !done && <div className="hand-panel">
            <div className="hand-heading">
              <strong>
                Your hand <span>· {state.myHand.length} cards</span>
              </strong>
              <small>
                {myTurn && playing
                  ? "Select a card, then play"
                  : "Your cards stay visible while you wait"}
              </small>
            </div>
            <div className="hand-cards" role="group" aria-label="Your cards">
              {state.myHand.map((card) => (
                <button
                  key={key(card)}
                  className={`face-card ${["H", "D"].includes(card.suit) ? "red" : ""} ${selected && key(selected) === key(card) ? "chosen" : ""} ${myTurn && playing && !legal(card) ? "illegal" : ""}`}
                  aria-label={`${label(card)}${myTurn && playing && !legal(card) ? ", cannot play this card" : ""}`}
                  aria-pressed={!!selected && key(selected) === key(card)}
                  disabled={!myTurn || !playing || !legal(card) || pending}
                  onClick={() => setSelected(card)}
                >
                  <Face card={card} />
                </button>
              ))}
            </div>
            <div className="hand-action">
              <p>
                {selected
                  ? label(selected)
                  : myTurn && playing
                    ? "Highlighted cards are legal moves."
                    : state.phase === GamePhase.Bidding
                      ? "Use your hand to decide your bid."
                      : "Waiting for your turn."}
              </p>
              <button
                className="button primary"
                disabled={!selected || !myTurn || !playing || pending}
                onClick={play}
              >
                {pending ? "Sending…" : "Play card"} <span aria-hidden>↑</span>
              </button>
            </div>
          </div>}
        </section>
        <aside className="table-aside">
          <section className="panel score-panel">
            <div className="score-heading">
              <h2>Scoreboard</h2>
              <span>
                {state.gameType === GameType.Euchre
                  ? `First to ${state.config.targetScore}`
                  : "Exact bid: 10 + tricks"}
              </span>
            </div>
            <table>
              <thead>
                <tr>
                  <th>Player</th>
                  <th>Bid</th>
                  <th>Tricks</th>
                  <th>Score</th>
                </tr>
              </thead>
              <tbody>
                {state.players.map((p) => (
                  <tr
                    key={p.seatIndex}
                    className={p.seatIndex === state.mySeat ? "my-row" : ""}
                  >
                    <th>
                      {p.displayName}
                      {p.seatIndex === state.mySeat && <small> You</small>}
                      {state.gameType === GameType.Euchre && (
                        <small> · Team {(p.seatIndex % 2) + 1}</small>
                      )}
                    </th>
                    <td>
                      {state.bids?.[p.seatIndex] === -1
                        ? "Pass"
                        : (state.bids?.[p.seatIndex] ?? "—")}
                    </td>
                    <td>{p.tricksWon}</td>
                    <td>
                      <strong>{scores[p.seatIndex]}</strong>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
          <details className="panel chat-details">
            <summary>Table chat</summary>
            <ChatPanel />
          </details>
          <p className="table-tip">
            {state.gameType === GameType.SevenSix
              ? "Make your bid exactly to earn a bonus. The dealer cannot make the total bids equal the number of tricks."
              : "Partners sit opposite each other. Remember: the jack of the same color as trump is also a trump."}
          </p>
        </aside>
      </div>
      <Dialog
        open={reviewOpen}
        onClose={() => setReviewOpen(false)}
        titleId="last-trick-title"
      >
        <section className="panel last-trick-dialog">
          <h2 id="last-trick-title">Last trick</h2>
          {state.lastTrick && (
            <>
              <p>
                Round {state.lastTrick.roundNumber + 1} · Trick{" "}
                {state.lastTrick.trickNumber + 1}
              </p>
              <TrickCards
                cards={state.lastTrick.cards}
                players={state.players}
                mySeat={state.mySeat}
                winningSeat={state.lastTrick.winningSeat}
              />
            </>
          )}
          <button
            className="button primary"
            autoFocus
            onClick={() => setReviewOpen(false)}
          >
            Back to game
          </button>
        </section>
      </Dialog>
      <RulesModal
        gameType={state.gameType as "seven-six" | "euchre"}
        open={rules}
        onClose={() => setRules(false)}
      />
      <Dialog
        open={leave}
        onClose={() => setLeave(false)}
        titleId="leave-title"
      >
        <section className="panel leave-dialog">
          <h2 id="leave-title">Leave this table?</h2>
          <p>
            {done
              ? "You can return to the games page."
              : "Your seat will be reserved until the group replaces you with a bot. You can return from the home page."}
          </p>
          <div>
            <button
              autoFocus
              className="button secondary"
              onClick={() => setLeave(false)}
            >
              Stay
            </button>
            <button
              className="button primary"
              onClick={() => {
                socket.emit("game:leave", { gameId: gameId! });
                router.push("/");
              }}
            >
              Leave table
            </button>
          </div>
        </section>
      </Dialog>
    </div>
  );
}
