import { describe, expect, it, vi } from "vitest";
import {
  AIDifficulty,
  GameEventType,
  GamePhase,
  GameType,
} from "@card-game/shared-types";
import { GameService, TRICK_REVIEW_MS } from "../services/GameService.js";
import type { SerializedGame } from "../services/GameStateStore.js";

function store() {
  const records = new Map<string, SerializedGame>();
  return {
    save: async (id: string, data: SerializedGame) => {
      records.set(id, structuredClone(data));
    },
    load: async (id: string) => structuredClone(records.get(id) ?? null),
    remove: async (id: string) => {
      records.delete(id);
    },
  };
}

describe("completed trick presentation", () => {
  it("holds the final card for the full 3.5 seconds before enabling the next turn", async () => {
    vi.useFakeTimers();
    try {
      const service = new GameService(store());
      const id = service.createGame(GameType.Euchre);
      await service.startGame(id);
      const room = (await service.getRoom(id))!;
      await service.callTrump(
        id,
        1,
        (room.engine as any).getLegalTrumpCalls(1)[0],
      );
      for (let i = 0; i < 4; i++) {
        const seat = room.engine.getState().currentPlayerSeat;
        await service.playCard(id, seat, room.engine.getLegalMoves(seat)[0]);
      }
      const pending = service.waitForTrickReview(id);
      await vi.advanceTimersByTimeAsync(TRICK_REVIEW_MS - 1);
      expect((await service.getVisibleState(id, 0)).phase).toBe(
        GamePhase.TrickResolution,
      );
      await vi.advanceTimersByTimeAsync(1);
      await pending;
      expect((await service.getVisibleState(id, 0)).phase).toBe(
        GamePhase.Playing,
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it.each([GameType.SevenSix, GameType.Euchre])(
    "preserves every human-completed %s trick, including round/game boundaries",
    async (type) => {
      const storage = store();
      const service = new GameService(storage, async () => {});
      const id = service.createGame(
        type,
        type === GameType.SevenSix ? { maxPlayers: 2 } : { targetScore: 2 },
      );
      const room = (await service.getRoom(id))!;
      await service.startGame(id);
      let count = 0,
        boundaries = 0,
        steps = 0;
      while (
        room.engine.getState().phase !== GamePhase.GameOver &&
        steps++ < 2000
      ) {
        const state = room.engine.getState(),
          seat = state.currentPlayerSeat;
        if (state.phase === GamePhase.Bidding) {
          if (type === GameType.SevenSix) {
            const bids = (room.engine as any).getLegalBids(seat);
            await service.sevenSixPlaceBid(id, seat, bids[0]);
          } else
            await service.callTrump(
              id,
              seat,
              (room.engine as any).getLegalTrumpCalls(seat)[0],
            );
          continue;
        }
        if (state.phase === GamePhase.RoundScoring) {
          await service.dealNextRound(id, state.roundNumber);
          continue;
        }
        const before = structuredClone(state);
        const card = room.engine.getLegalMoves(seat)[0];
        const trick = await service.playCard(id, seat, card);
        if (!trick) continue;
        count++;
        if (
          room.engine.getState().roundNumber !== before.roundNumber ||
          state.phase === GamePhase.GameOver || state.phase === GamePhase.RoundScoring
        )
          boundaries++;
        expect(trick.cards.at(-1)).toEqual({ seatIndex: seat, card });
        for (const player of before.players) {
          const view = await service.getVisibleState(id, player.seatIndex);
          expect(view.phase).toBe(GamePhase.TrickResolution);
          expect(view.roundNumber).toBe(before.roundNumber);
          expect(view.currentTrick).toEqual(trick.cards);
          expect(view.trumpSuit).toBe(before.trumpSuit);
          expect(view.legalMoves).toEqual([]);
          expect(view.players[trick.winningSeat].tricksWon).toBe(
            before.players[trick.winningSeat].tricksWon + 1,
          );
          expect(view.myHand.length).toBe(
            player.hand.length - (player.seatIndex === seat ? 1 : 0),
          );
          expect(view.players.some((p) => "hand" in p)).toBe(false);
        }
        await expect(
          service.playCard(id, state.currentPlayerSeat, card),
        ).rejects.toThrow("wait");
        await expect(
          service.sevenSixPlaceBid(id, state.currentPlayerSeat, 0),
        ).rejects.toThrow();
        // A new server and refreshed client still see all the cards.
        const restored = new GameService(storage, async () => {});
        expect(await restored.getVisibleState(id, 0)).toMatchObject({
          phase: GamePhase.TrickResolution,
          currentTrick: trick.cards,
        });
        await service.waitForTrickReview(id);
        expect((await service.getVisibleState(id, 0)).lastTrick).toEqual(trick);
        expect((await service.getVisibleState(id, 0)).phase).toBe(
          room.engine.getState().phase,
        );
      }
      expect(count).toBe(
        room.engine
          .getEvents()
          .filter((e) => e.type === GameEventType.TrickCompleted).length,
      );
      expect(boundaries).toBeGreaterThan(0);
      expect(room.engine.getState().phase).toBe(GamePhase.GameOver);
    },
  );

  it.each([GameType.SevenSix, GameType.Euchre])(
    "broadcasts and holds every bot-completed %s trick",
    async (type) => {
      const delays: number[] = [],
        completed: number[] = [];
      const service = new GameService(store(), async (ms) => {
        delays.push(ms);
      });
      const id = service.createGame(type);
      await service.fillWithAI(id, AIDifficulty.Intermediate);
      await service.startGame(id);
      await service.executeAITurns(id, async () => {
        const view = await service.getVisibleState(id, 0);
        if (view.phase === GamePhase.TrickResolution) {
          completed.push(view.lastTrick!.sequence);
          expect(view.currentTrick).toHaveLength(4);
          expect(view.currentTrick).toEqual(view.lastTrick!.cards);
        }
      });
      const room = (await service.getRoom(id))!;
      expect(completed).toEqual(
        room.engine
          .getEvents()
          .filter((e) => e.type === GameEventType.TrickCompleted)
          .map((e) => e.sequenceNum),
      );
      expect(delays.filter((ms) => ms > TRICK_REVIEW_MS - 500 && ms <= TRICK_REVIEW_MS)).toHaveLength(
        completed.length,
      );
      expect(room.engine.getState().phase).toBe(GamePhase.GameOver);
    },
  );
});
