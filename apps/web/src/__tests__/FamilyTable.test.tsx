import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, within, fireEvent } from "@testing-library/react";
import {
  GamePhase,
  GameType,
  Suit,
  type VisibleGameState,
} from "@card-game/shared-types";
import { useGameStore } from "@card-game/shared-store";
import { GameBoard } from "../components/game/GameBoard";
const transport = vi.hoisted(() => {
  const handlers = new Map<string, Set<(value: any) => void>>();
  return {
    handlers,
    emit: vi.fn(),
    on: (event: string, callback: (value: any) => void) => {
      if (!handlers.has(event)) handlers.set(event, new Set());
      handlers.get(event)!.add(callback);
    },
    off: (event: string, callback: (value: any) => void) => {
      handlers.get(event)?.delete(callback);
    },
  };
});
vi.mock("@/hooks/useSocket", () => ({ useSocket: () => transport }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("../components/ConnectionProvider", () => ({
  useConnection: () => ({ connected: true }),
}));
vi.mock("../components/game/ChatPanel", () => ({ ChatPanel: () => null }));
vi.mock("../components/game/RummyBoard", () => ({ RummyBoard: () => null }));
const card = { rank: 14, suit: Suit.Spades };
function initial(): VisibleGameState {
  return {
    gameId: "test-game",
    gameType: GameType.SevenSix,
    phase: GamePhase.Playing,
    config: { gameType: GameType.SevenSix, maxPlayers: 4, targetScore: 0 },
    mySeat: 0,
    currentPlayerSeat: 0,
    leadSeat: 1,
    roundNumber: 0,
    trickNumber: 0,
    heartsBroken: false,
    myHand: [card],
    legalMoves: [card],
    trumpSuit: Suit.Spades,
    scores: [20, 10, 10, 0],
    roundScores: [0, 0, 0, 0],
    bids: [1, 0, 0, 0],
    currentTrick: [1, 2, 3].map((seatIndex) => ({
      seatIndex,
      card: { rank: seatIndex + 2, suit: Suit.Spades },
    })),
    players: [0, 1, 2, 3].map((seatIndex) => ({
      seatIndex,
      displayName: `Player ${seatIndex}`,
      cardCount: seatIndex === 0 ? 1 : 0,
      tricksWon: 0,
      score: 0,
      isAI: seatIndex !== 0,
      isConnected: true,
    })),
  };
}
function receive(state: VisibleGameState) {
  act(() => transport.handlers.get("game:state")?.forEach((fn) => fn(state)));
}
beforeEach(() => {
  transport.handlers.clear();
  transport.emit.mockClear();
  useGameStore.getState().reset();
  useGameStore.getState().setGameId("test-game");
  useGameStore.getState().setGameState(initial());
});
describe("family table interactions", () => {
  it("selects then plays once and disables repeated submissions until confirmed", () => {
    render(<GameBoard />);
    fireEvent.click(screen.getByRole("button", { name: "A of spades" }));
    fireEvent.click(screen.getByRole("button", { name: "Play card" }));
    fireEvent.click(screen.getByRole("button", { name: "Sending…" }));
    expect(transport.emit).toHaveBeenCalledExactlyOnceWith("game:play_card", {
      gameId: "test-game",
      card,
    });
  });
  it("shows every card, winning card/player, and updated trick count; keeps last trick after the next round", () => {
    render(<GameBoard />);
    const review = initial();
    review.phase = GamePhase.TrickResolution;
    review.myHand = [];
    review.legalMoves = [];
    review.currentTrick.push({ seatIndex: 0, card });
    review.players[0].tricksWon = 1;
    review.players[0].cardCount = 0;
    review.lastTrick = {
      sequence: 10,
      roundNumber: 0,
      trickNumber: 0,
      winningSeat: 0,
      cards: review.currentTrick,
      points: 1,
    };
    receive(review);
    expect(
      screen.getByRole("group", { name: "Cards played in this trick" })
        .children,
    ).toHaveLength(4);
    expect(
      screen.getByRole("img", { name: "A of spades, winning card" }),
    ).toBeTruthy();
    expect(screen.getByText("You win this trick")).toBeTruthy();
    expect(screen.getByText("1 tricks · 20 points")).toBeTruthy();
    expect(
      (screen.getByRole("button", { name: "Play card" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    const next = initial();
    next.roundNumber = 1;
    next.lastTrick = review.lastTrick;
    next.currentTrick = [];
    receive(next);
    fireEvent.click(screen.getByRole("button", { name: "Last trick" }));
    const dialog = screen.getByRole("dialog", { name: "Last trick" });
    expect(within(dialog).getByText("Round 1 · Trick 1")).toBeTruthy();
    expect(
      within(dialog).getByLabelText("A of spades, winning card"),
    ).toBeTruthy();
    expect(within(dialog).getByRole("group").children).toHaveLength(4);
  });
  it("labels opponent tricks separately from points and renders Euchre passes as words", () => {
    const state = initial();
    state.gameType = GameType.Euchre;
    state.players[1].tricksWon = 3;
    state.bids = [null, -1, null, null];
    useGameStore.getState().setGameState(state);
    render(<GameBoard />);
    expect(
      screen.getByLabelText("Player 1: 3 tricks, 10 points").textContent,
    ).toContain("3 tricks");
    expect(screen.getByRole("cell", { name: "Pass" })).toBeTruthy();
    expect(screen.queryByText("-1")).toBeNull();
  });
  it("ignores delayed state from a different game", () => {
    render(<GameBoard />);
    receive({ ...initial(), gameId: "old-game", scores: [999, 999, 999, 999] });
    expect(screen.queryByText("999")).toBeNull();
    expect(useGameStore.getState().gameState!.gameId).toBe("test-game");
  });
});
