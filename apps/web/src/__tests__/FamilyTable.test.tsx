import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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
// The table asks the server whether calls exist; in tests they do not.
const mediaEnabled = vi.hoisted(() => ({ value: false }));
vi.mock("@/hooks/useMedia", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/hooks/useMedia")>()),
  useMediaConfig: () => ({
    enabled: mediaEnabled.value,
    provider: mediaEnabled.value ? "test" : "none",
  }),
}));
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
  it("labels opponent tricks separately from points and renders a pass as a word", () => {
    const state = initial();
    state.gameType = GameType.FortyFives;
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

describe("Hearts passing", () => {
  function hearts(): VisibleGameState {
    const state = initial();
    state.gameType = GameType.Hearts;
    state.config = { gameType: GameType.Hearts, maxPlayers: 4, targetScore: 100 };
    state.phase = GamePhase.Passing;
    state.passDirection = "left" as VisibleGameState["passDirection"];
    state.trumpSuit = undefined;
    state.currentTrick = [];
    state.legalMoves = [];
    state.bids = undefined;
    state.myHand = [
      { rank: 2, suit: Suit.Clubs },
      { rank: 12, suit: Suit.Spades },
      { rank: 14, suit: Suit.Hearts },
      { rank: 10, suit: Suit.Diamonds },
    ];
    state.players.forEach((p) => (p.cardCount = 4));
    return state;
  }

  it("lets the player pick exactly three cards and pass them once", () => {
    useGameStore.getState().setGameState(hearts());
    render(<GameBoard />);
    expect(screen.getByText("Choose 3 cards to pass")).toBeTruthy();
    const pass = screen.getByRole("button", { name: "Pass these 3 cards" });
    expect((pass as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "2 of clubs" }));
    fireEvent.click(screen.getByRole("button", { name: "Q of spades" }));
    fireEvent.click(screen.getByRole("button", { name: "A of hearts" }));
    // A fourth pick is refused; the choice must be changed, not extended.
    fireEvent.click(screen.getByRole("button", { name: "10 of diamonds" }));
    expect(screen.getByText(/3 of 3 chosen/).textContent).not.toContain("10 of diamonds");
    // Tapping a chosen card un-chooses it.
    fireEvent.click(screen.getByRole("button", { name: "A of hearts" }));
    expect(screen.getByText(/2 of 3 chosen/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "10 of diamonds" }));
    expect((pass as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(pass);
    fireEvent.click(pass);
    expect(transport.emit).toHaveBeenCalledExactlyOnceWith("game:pass_cards", {
      gameId: "test-game",
      cards: [
        { rank: 2, suit: Suit.Clubs },
        { rank: 12, suit: Suit.Spades },
        { rank: 10, suit: Suit.Diamonds },
      ],
    });
  });

  it("says so once the pass is in, and keeps the hand visible", () => {
    const state = hearts();
    state.passed = true;
    useGameStore.getState().setGameState(state);
    render(<GameBoard />);
    expect(screen.getByText("Waiting for the others to pass")).toBeTruthy();
    expect(screen.getByText(/Your pass is in/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Pass these 3 cards" })).toBeNull();
    expect(screen.getAllByRole("button", { name: /of (clubs|spades|hearts|diamonds)$/ })).toHaveLength(4);
  });

  it("names the game and shows whether hearts are broken", () => {
    const state = hearts();
    state.phase = GamePhase.Playing;
    state.heartsBroken = false;
    state.legalMoves = [state.myHand[0]];
    useGameStore.getState().setGameState(state);
    render(<GameBoard />);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Hearts");
    expect(screen.getByText(/Hearts not yet broken/)).toBeTruthy();
  });
});

describe("trump and next-hand controls", () => {
  it("shows the actual trump card separately from playable cards", () => {
    const state = initial();
    state.trumpCard = { rank: 12, suit: Suit.Spades };
    useGameStore.getState().setGameState(state);
    render(<GameBoard />);
    const trump = screen.getByRole("region", { name: "Trump for this hand" });
    expect(within(trump).getByRole("img", { name: "Trump card: Q of spades" })).toBeTruthy();
    expect(trump.textContent).toContain("No player can hold it");
    expect(screen.queryByRole("button", { name: "Q of spades" })).toBeNull();
  });
  it("describes 45s trump by the auction, never by a turned-up card", () => {
    const state = initial();
    state.gameType = GameType.FortyFives;
    state.trumpSuit = Suit.Hearts;
    state.declarerSeat = 1;
    state.contract = 25;
    state.trumpCard = undefined;
    useGameStore.getState().setGameState(state);
    render(<GameBoard />);
    const trump = screen.getByRole("region", { name: "Trump for this hand" });
    expect(trump.textContent).toContain("Player 1 won the auction at 25");
    expect(trump.textContent).not.toMatch(/turned-up/i);
    expect(trump.textContent).not.toMatch(/bidding round/i);
    // No card is turned up in 45s, so nothing should be shown as one.
    expect(within(trump).queryByRole("img")).toBeNull();
  });
  it("labels the 45s header Bidding until the auction produces a declarer", () => {
    const state = initial();
    state.gameType = GameType.FortyFives;
    state.phase = GamePhase.Bidding;
    state.trumpSuit = undefined;
    state.legalBids = [15, 20, 25, 30, -1];
    useGameStore.getState().setGameState(state);
    render(<GameBoard />);
    expect(screen.getByText(/Round 1/).textContent).toContain("Bidding");
    expect(screen.getByText(/Round 1/).textContent).not.toContain(
      "Choosing trump",
    );
  });
  it("shows hand scores and requires an explicit deal without duplicate submissions", () => {
    const state = initial();
    state.phase = GamePhase.RoundScoring;
    state.roundScores = [11, 0, 10, 0];
    state.myHand = [];
    state.autoDeal = false;
    useGameStore.getState().setGameState(state);
    render(<GameBoard />);
    expect(screen.getByRole("region", { name: "Hand results" }).textContent).toContain("You earn the most points");
    expect(screen.queryByRole("button", { name: "Play card" })).toBeNull();
    expect(transport.emit).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Deal next hand" }));
    fireEvent.click(screen.getByRole("button", { name: "Dealing…" }));
    expect(transport.emit).toHaveBeenCalledExactlyOnceWith("game:deal_next", { gameId: "test-game", roundNumber: 0 });
  });
  it("can toggle auto-deal on and off during play", () => {
    render(<GameBoard />);
    fireEvent.click(screen.getByRole("checkbox", { name: /Automatically deal/ }));
    expect(transport.emit).toHaveBeenLastCalledWith("game:set_auto_deal", { gameId: "test-game", enabled: true });
    receive({ ...initial(), autoDeal: true });
    expect((screen.getByRole("checkbox") as HTMLInputElement).checked).toBe(true);
    fireEvent.click(screen.getByRole("checkbox"));
    expect(transport.emit).toHaveBeenLastCalledWith("game:set_auto_deal", { gameId: "test-game", enabled: false });
  });
});

describe("compact table menu", () => {
  it("opens scores and auto-deal settings and returns to the game", () => {
    render(<GameBoard />);
    fireEvent.click(screen.getByRole("button", { name: "Table menu: scores and settings" }));
    const dialog = screen.getByRole("dialog", { name: /^Table$/ });
    expect(within(dialog).getByRole("heading", { name: "Scoreboard" })).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("checkbox"));
    expect(transport.emit).toHaveBeenLastCalledWith("game:set_auto_deal", { gameId: "test-game", enabled: true });
    fireEvent.click(within(dialog).getByRole("button", { name: "Back to game" }));
    expect(screen.queryByRole("dialog", { name: /^Table$/ })).toBeNull();
  });
  it("offers the call from the table itself, not only from the menu", async () => {
    const user = userEvent.setup();
    mediaEnabled.value = true;
    render(<GameBoard />);
    // A phone never draws the call panel until it is opened, so the entry has
    // to be on the table or nobody finds it.
    const call = screen.getByRole("button", { name: "Join the table call" });
    expect(call.getAttribute("aria-expanded")).toBe("false");
    await user.click(call);
    const open = screen.getByRole("button", { name: "Hide the table call" });
    expect(open.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByLabelText("Table call").className).toContain("open");
    await user.click(open);
    expect(screen.getByLabelText("Table call").className).not.toContain("open");

    cleanup();
    mediaEnabled.value = false;
    render(<GameBoard />);
    expect(screen.queryByRole("button", { name: /table call/i })).toBeNull();
    mediaEnabled.value = false;
  });
  it("offers a call from the table menu only where the server has one", async () => {
    const user = userEvent.setup();
    mediaEnabled.value = false;
    render(<GameBoard />);
    await user.click(screen.getByRole("button", { name: /Table menu/i }));
    expect(screen.queryByRole("button", { name: /^Call$/ })).toBeNull();
    expect(screen.queryByLabelText("Table call")).toBeNull();

    cleanup();
    mediaEnabled.value = true;
    render(<GameBoard />);
    await user.click(screen.getByRole("button", { name: /Table menu/i }));
    // Scoped to the menu: the panel's own toggle is also called Call.
    const menu = screen.getByRole("dialog");
    expect(within(menu).getByRole("button", { name: /^Call$/ })).toBeTruthy();
    expect(screen.getByLabelText("Table call")).toBeTruthy();
    mediaEnabled.value = false;
  });
});
