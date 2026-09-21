import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  GamePhase,
  GameType,
  Suit,
  type VisibleGameState,
} from "@card-game/shared-types";
import { BiddingPanel } from "../components/game/BiddingPanel";
const state = {
  gameType: GameType.SevenSix,
  phase: GamePhase.Bidding,
  mySeat: 0,
  currentPlayerSeat: 0,
  handSize: 7,
  roundNumber: 0,
  totalRounds: 13,
  dealerSeat: 3,
  trumpSuit: Suit.Diamonds,
  myHand: [],
  bids: [null, null, null, null],
  players: [0, 1, 2, 3].map((seatIndex) => ({
    seatIndex,
    displayName: `Player ${seatIndex}`,
  })),
} as unknown as VisibleGameState;
function setup(overrides: Partial<VisibleGameState> = {}) {
  const onBid = vi.fn();
  const props = {
    gameState: { ...state, ...overrides },
    onBid,
    onCallTrump: vi.fn(),
  };
  return { onBid, props, ...render(<BiddingPanel {...props} />) };
}
describe("Seven-Six bidding controls", () => {
  it("submits the value chosen with + and − without clicking a number box", async () => {
    const { onBid } = setup();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Increase bid" }));
    await user.click(screen.getByRole("button", { name: "Increase bid" }));
    await user.click(screen.getByRole("button", { name: "Decrease bid" }));
    expect(onBid).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Submit bid: 2" }));
    expect(onBid).toHaveBeenCalledExactlyOnceWith(2);
  });
  it("number buttons select a bid; Enter on Submit confirms it", async () => {
    const { onBid } = setup();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Select bid 5" }));
    expect(onBid).not.toHaveBeenCalled();
    const submit = screen.getByRole("button", { name: "Submit bid: 5" });
    submit.focus();
    await user.keyboard("{Enter}");
    expect(onBid).toHaveBeenCalledExactlyOnceWith(5);
  });
  it("skips a dealer-restricted bid and disables out-of-range controls", async () => {
    const { onBid } = setup({ dealerSeat: 0, bids: [null, 1, 2, 2] });
    const user = userEvent.setup();
    expect(
      (
        screen.getByRole("button", {
          name: "Select bid 2",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    await user.click(screen.getByRole("button", { name: "Increase bid" }));
    await user.click(screen.getByRole("button", { name: "Submit bid: 3" }));
    expect(onBid).toHaveBeenCalledExactlyOnceWith(3);
    await user.click(screen.getByRole("button", { name: "Select bid 0" }));
    expect(
      (
        screen.getByRole("button", {
          name: "Decrease bid",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    await user.click(screen.getByRole("button", { name: "Select bid 7" }));
    expect(
      (
        screen.getByRole("button", {
          name: "Increase bid",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });
  it("does not submit again while a bid is pending", () => {
    const { onBid, props, rerender } = setup();
    rerender(<BiddingPanel {...props} pending />);
    fireEvent.submit(
      screen.getByRole("button", { name: "Submitting…" }).closest("form")!,
    );
    expect(onBid).not.toHaveBeenCalled();
  });
  it("hides submission controls on another player’s turn", () => {
    setup({ currentPlayerSeat: 1 });
    expect(screen.queryByRole("button", { name: /Submit bid/ })).toBeNull();
    expect(screen.getByRole("status").textContent).toContain("Player 1");
  });
});
