import { describe, expect, it, vi } from "vitest";
import {
  GamePhase,
  GameType,
  type VisibleGameState,
} from "@card-game/shared-types";
import { randomUUID } from "node:crypto";
import { issueSession } from "../middleware/auth.js";
import {
  currentHuman,
  Driver,
  event,
  openTable,
  stateWhere,
} from "./tableHarness.js";

vi.mock("../services/PersistenceService.js", () => ({
  PersistenceService: class {
    async saveCompletedGame() {}
  },
}));
vi.mock("../services/PresenceService.js", () => ({
  PresenceService: class {},
}));
vi.mock("../services/MatchmakingService.js", () => ({
  MatchmakingService: class {
    async leaveAllQueues() {}
  },
}));

/** The public facts every seat at the table must agree on. */
function shared(state: VisibleGameState) {
  return {
    gameId: state.gameId,
    phase: state.phase,
    roundNumber: state.roundNumber,
    trickNumber: state.trickNumber,
    currentPlayerSeat: state.currentPlayerSeat,
    dealerSeat: state.dealerSeat,
    bids: state.bids,
    scores: state.scores,
    roundScores: state.roundScores,
    trumpSuit: state.trumpSuit,
    trumpCard: state.trumpCard,
    currentTrick: state.currentTrick,
    autoDeal: state.autoDeal,
    tricks: state.players.map((p) => p.tricksWon),
    cardCounts: state.players.map((p) => p.cardCount),
  };
}
const cardKey = (c: { rank: number; suit: string }) => `${c.rank}${c.suit}`;

describe("a player leaving a Seven-Six table", () => {
  it("keeps the seat and the bids placed so far when they leave during bidding", async () => {
    const table = await openTable(GameType.SevenSix, { seats: 4, humans: 2 });
    const driver = new Driver(table);
    try {
      const [host, guest] = table.clients;
      // Stop as soon as at least one bid is in, so state has something to lose.
      const bidding = await driver.runUntil(
        (s) =>
          s.phase === GamePhase.Bidding &&
          (s.bids ?? []).some((b) => b !== null),
      );
      await table.settle();
      const before = shared(
        await table.service.getVisibleState(table.gameId, 0),
      );
      expect(bidding.phase).toBe(GamePhase.Bidding);

      const gone = event(host, "game:player_disconnected");
      guest.emit("game:leave", { gameId: table.gameId });
      const notice = await gone;
      expect(notice.seatIndex).toBe(1);
      expect(notice.timeoutSeconds).toBe(30);

      const room = (await table.service.getRoom(table.gameId))!;
      expect(room.engine.getState().players[1].isConnected).toBe(false);
      expect(shared(await table.service.getVisibleState(table.gameId, 0)))
        .toEqual(before);

      // The table continues once the group hands the seat to a bot.
      host.emit("game:replace_with_ai", {
        gameId: table.gameId,
        seatIndex: 1,
      });
      const replaced = await driver.runUntil((s) => s.players[1].isAI);
      expect(replaced.scores).toEqual(before.scores);
      const playing = await driver.runUntil(
        (s) => s.phase === GamePhase.Playing,
      );
      expect(playing.bids!.every((b) => b !== null)).toBe(true);
      expect(playing.players[1].isAI).toBe(true);
      expect(driver.errors).toEqual([]);
    } finally {
      driver.dispose();
      await table.close();
    }
  }, 30000);

  it("keeps the cards already on the table when they leave mid-trick", async () => {
    const table = await openTable(GameType.SevenSix, { seats: 4, humans: 2 });
    const driver = new Driver(table);
    try {
      const [host, guest] = table.clients;
      const midTrick = await driver.runUntil(
        (s) =>
          s.phase === GamePhase.Playing &&
          s.currentTrick.length > 0 &&
          s.currentTrick.length < 4,
      );
      await table.settle();
      const before = shared(
        await table.service.getVisibleState(table.gameId, 0),
      );
      expect(before.currentTrick.length).toBeGreaterThan(0);
      expect(before.currentTrick.length).toBeLessThan(4);
      expect(midTrick.phase).toBe(GamePhase.Playing);

      const gone = event(host, "game:player_disconnected");
      guest.emit("game:leave", { gameId: table.gameId });
      await gone;

      const held = await table.service.getVisibleState(table.gameId, 0);
      expect(held.currentTrick).toEqual(before.currentTrick);
      expect(held.phase).toBe(GamePhase.Playing);
      expect(held.players.map((p) => p.tricksWon)).toEqual(before.tricks);

      host.emit("game:replace_with_ai", {
        gameId: table.gameId,
        seatIndex: 1,
      });
      const finished = await driver.runUntil(
        (s) =>
          s.trickNumber > before.trickNumber ||
          s.phase === GamePhase.RoundScoring,
        20000,
      );
      expect(finished.players[1].isAI).toBe(true);
      expect(
        finished.players.reduce((n, p) => n + p.tricksWon, 0),
      ).toBeGreaterThan(before.tricks.reduce((n, t) => n + t, 0));
      expect(driver.errors).toEqual([]);
    } finally {
      driver.dispose();
      await table.close();
    }
  }, 30000);

  it("keeps the scores, the paused hand and the auto-deal choice when they leave during scoring", async () => {
    const table = await openTable(GameType.SevenSix, { seats: 4, humans: 2 });
    const driver = new Driver(table);
    try {
      const [host, guest] = table.clients;
      const scoring = await driver.runUntil(
        (s) => s.phase === GamePhase.RoundScoring,
        25000,
      );
      expect(scoring.roundNumber).toBe(0);

      const before = shared(scoring);
      expect(before.autoDeal).toBe(false);
      expect(before.scores).toEqual(before.roundScores);

      const gone = event(host, "game:player_disconnected");
      guest.emit("game:leave", { gameId: table.gameId });
      expect((await gone).seatIndex).toBe(1);

      // The hand stays scored and paused; nothing is dealt behind their back.
      const held = await table.service.getVisibleState(table.gameId, 0);
      expect(held.phase).toBe(GamePhase.RoundScoring);
      expect(held.roundNumber).toBe(0);
      expect(held.scores).toEqual(before.scores);
      expect(held.roundScores).toEqual(before.roundScores);
      expect(held.autoDeal).toBe(false);
      expect(held.players.every((p) => p.cardCount === 0)).toBe(true);

      // A remaining player can still start the next hand.
      const dealt = stateWhere(host, (s) => s.roundNumber === 1, 20000);
      host.emit("game:deal_next", { gameId: table.gameId, roundNumber: 0 });
      const next = await dealt;
      expect(next.phase).toBe(GamePhase.Bidding);
      expect(next.scores).toEqual(before.scores);
      expect(next.myHand).toHaveLength(6);
      expect(next.dealerSeat).toBe((before.dealerSeat! + 1) % 4);
    } finally {
      driver.dispose();
      await table.close();
    }
  }, 40000);
});

describe("several clients at one Seven-Six table", () => {
  it("agree on every public fact and never see another player's hand", async () => {
    const table = await openTable(GameType.SevenSix, { seats: 4, humans: 3 });
    const driver = new Driver(table);
    try {
      await driver.runUntil(
        (s) => s.phase === GamePhase.Playing && s.currentTrick.length > 0,
      );
      const states = await Promise.all(
        table.clients.map((_, seat) =>
          table.service.getVisibleState(table.gameId, seat),
        ),
      );
      const [first, ...rest] = states;
      for (const other of rest) expect(shared(other)).toEqual(shared(first));
      expect(new Set(states.map((s) => s.mySeat)).size).toBe(states.length);

      const hands = states.map((s) => s.myHand.map(cardKey));
      for (let i = 0; i < hands.length; i++) {
        for (let j = i + 1; j < hands.length; j++)
          expect(hands[i].filter((c) => hands[j].includes(c))).toEqual([]);
      }
      for (const state of states) {
        expect(state.players.some((p) => "hand" in p)).toBe(false);
        expect(JSON.stringify(state.players)).not.toContain('"hand"');
        if (state.currentPlayerSeat !== state.mySeat)
          expect(state.legalMoves).toEqual([]);
        expect(state.players[state.mySeat].cardCount).toBe(state.myHand.length);
      }
    } finally {
      driver.dispose();
      await table.close();
    }
  }, 30000);

  it("deal one hand when two clients ask at once, and reject a stale request", async () => {
    const table = await openTable(GameType.SevenSix, { seats: 4, humans: 2 });
    const driver = new Driver(table);
    try {
      const [host, guest] = table.clients;
      await driver.runUntil(
        (s) => s.phase === GamePhase.RoundScoring,
        25000,
      );
      const rejected = event(guest, "game:error");
      const dealt = stateWhere(host, (s) => s.roundNumber === 1, 20000);
      host.emit("game:deal_next", { gameId: table.gameId, roundNumber: 0 });
      guest.emit("game:deal_next", { gameId: table.gameId, roundNumber: 0 });
      const next = await dealt;
      expect(next.roundNumber).toBe(1);
      expect((await rejected).message).toMatch(/already advanced|not ready/);

      // A late retry of the hand that already advanced changes nothing.
      const stale = event(host, "game:error");
      host.emit("game:deal_next", { gameId: table.gameId, roundNumber: 0 });
      expect((await stale).message).toMatch(/already advanced/);
      expect(
        (await table.service.getVisibleState(table.gameId, 0)).roundNumber,
      ).toBe(1);
    } finally {
      driver.dispose();
      await table.close();
    }
  }, 40000);

  it("reject a table command from someone who is not seated", async () => {
    const table = await openTable(GameType.SevenSix, { seats: 4, humans: 2 });
    try {
      const { token } = await issueSession({
        id: randomUUID(),
        name: "Outsider",
        user: null,
      });
      const outsider = await table.client(token);
      for (const [name, payload] of [
        ["game:deal_next", { gameId: table.gameId, roundNumber: 0 }],
        ["game:set_auto_deal", { gameId: table.gameId, enabled: true }],
        ["game:replace_with_ai", { gameId: table.gameId, seatIndex: 1 }],
        ["game:end", { gameId: table.gameId }],
      ] as const) {
        const refused = event(outsider, "game:error");
        outsider.emit(name as any, payload as any);
        expect((await refused).message).toContain("not in this game");
      }
      expect(
        (await table.service.getVisibleState(table.gameId, 0)).autoDeal,
      ).toBe(false);
    } finally {
      await table.close();
    }
  }, 30000);
});

describe("Seven-Six bid validation over the socket", () => {
  it.each([
    ["3", "whole-number"],
    [1.5, "whole-number"],
    [null, "whole-number"],
    [-1, "Bid must be"],
    [99, "Bid must be"],
  ])("rejects the bid %p without changing the hand", async (bid, message) => {
    const table = await openTable(GameType.SevenSix, { seats: 4, humans: 2 });
    try {
      // The dealer, and so the first bidder, is chosen at random each game.
      const bidder = await currentHuman(table);
      const seat = table.latest.get(bidder)!.mySeat;
      const before = await table.service.getVisibleState(table.gameId, seat);
      expect(before.phase).toBe(GamePhase.Bidding);
      const refused = event(bidder, "game:error");
      bidder.emit("game:bid", { gameId: table.gameId, bid: bid as number });
      expect((await refused).message).toContain(message);
      const after = await table.service.getVisibleState(table.gameId, seat);
      expect(shared(after)).toEqual(shared(before));
      expect(after.bids![seat]).toBeNull();
    } finally {
      await table.close();
    }
  }, 30000);
});
