import { describe, expect, it, vi } from "vitest";
import { GamePhase, GameType } from "@card-game/shared-types";
import { GameService, ROUND_REVIEW_MS } from "../services/GameService.js";
import type { SerializedGame } from "../services/GameStateStore.js";

function storage() {
  const saved = new Map<string, SerializedGame>();
  return {
    save: async (id: string, data: SerializedGame) => { saved.set(id, structuredClone(data)); },
    load: async (id: string) => structuredClone(saved.get(id) ?? null),
    remove: async (id: string) => { saved.delete(id); },
  };
}
/**
 * One step of the bidding phase in either family game. Seven-Six takes a
 * number of tricks; 45s runs an auction and then the winner names trump.
 */
async function bidStep(service: GameService, id: string, room: any, seat: number) {
  const calls = room.engine.getLegalTrumpCalls?.(seat) ?? [];
  if (calls.length) await service.callTrump(id, seat, calls[0]);
  else await service.placeFamilyBid(id, seat, room.engine.getLegalBids(seat)[0]);
}

async function finishHand(service: GameService, id: string) {
  const room = (await service.getRoom(id))!;
  while (![GamePhase.RoundScoring, GamePhase.GameOver].includes(room.engine.getState().phase)) {
    const state = room.engine.getState();
    const seat = state.currentPlayerSeat;
    if (state.phase === GamePhase.Bidding) {
      await bidStep(service, id, room, seat);
    } else {
      await service.playCard(id, seat, room.engine.getLegalMoves(seat)[0]);
      await service.waitForTrickReview(id);
    }
  }
}

describe("next-hand controls", () => {
  it.each([GameType.SevenSix, GameType.FortyFives])("%s waits for a deal, restores scores and preference, and rejects stale double deals", async type => {
    const store = storage();
    const service = new GameService(store, async () => {});
    const id = service.createGame(type);
    await service.joinGame(id, "human", "You");
    await service.startGame(id);
    await expect(service.dealNextRound(id, 0)).rejects.toThrow("not ready");
    await finishHand(service, id);
    const finished = await service.getVisibleState(id, 0);
    expect(finished.phase).toBe(GamePhase.RoundScoring);
    expect(finished.roundNumber).toBe(0);
    expect(finished.players.every(p => p.cardCount === 0)).toBe(true);
    expect(finished.scores).toEqual(finished.roundScores);
    expect(finished.autoDeal).toBe(false);
    await service.executeAITurns(id);
    expect((await service.getVisibleState(id, 0)).phase).toBe(GamePhase.RoundScoring);
    await service.setAutoDeal(id, true);
    const restored = new GameService(store, async () => {});
    const recovered = await restored.getVisibleState(id, 0);
    expect(recovered).toMatchObject({ phase: GamePhase.RoundScoring, roundNumber: 0, autoDeal: true, scores: finished.scores });
    expect(recovered.trumpCard).toEqual(finished.trumpCard);
    await restored.setAutoDeal(id, false);
    await restored.dealNextRound(id, 0);
    const next = await restored.getVisibleState(id, 0);
    expect(next.phase).toBe(GamePhase.Bidding);
    expect(next.roundNumber).toBe(1);
    expect(next.scores).toEqual(finished.scores);
    expect(next.players.every(p => p.tricksWon === 0)).toBe(true);
    expect(next.dealerSeat).toBe((finished.dealerSeat! + 1) % 4);
    expect(next.myHand.length).toBe(type === GameType.SevenSix ? 6 : 5);
    await expect(restored.dealNextRound(id, 0)).rejects.toThrow("already advanced");
    expect((await restored.getVisibleState(id, 0)).roundNumber).toBe(1);
  });

  it("honors the full auto-deal delay, cancels when disabled, and can be re-enabled", async () => {
    const store = storage();
    let timed = false;
    const service = new GameService(store, ms => timed ? new Promise(resolve => setTimeout(resolve, ms)) : Promise.resolve());
    const id = service.createGame(GameType.SevenSix, { maxPlayers: 2 });
    await service.joinGame(id, "human", "You");
    await service.startGame(id);
    await finishHand(service, id);
    vi.useFakeTimers();
    try {
      timed = true;
      await service.setAutoDeal(id, true);
      const cancelled = service.executeAITurns(id);
      await vi.advanceTimersByTimeAsync(ROUND_REVIEW_MS - 1);
      expect((await service.getVisibleState(id, 0)).roundNumber).toBe(0);
      await service.setAutoDeal(id, false);
      await vi.advanceTimersByTimeAsync(1);
      await cancelled;
      expect((await service.getVisibleState(id, 0)).phase).toBe(GamePhase.RoundScoring);
      await service.setAutoDeal(id, true);
      const advanced = service.executeAITurns(id);
      await vi.advanceTimersByTimeAsync(ROUND_REVIEW_MS);
      await advanced;
      expect((await service.getVisibleState(id, 0))).toMatchObject({ roundNumber: 1, phase: GamePhase.Bidding, autoDeal: true });
      await service.setAutoDeal(id, false);
      expect((await service.getVisibleState(id, 0)).autoDeal).toBe(false);
    } finally { vi.useRealTimers(); }
  });
});
