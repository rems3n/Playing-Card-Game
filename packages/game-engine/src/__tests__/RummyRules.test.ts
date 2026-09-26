import { describe, expect, it } from "vitest";
import { GamePhase, Rank, Suit, type Card } from "@card-game/shared-types";
import { RummyEngine } from "../games/rummy/RummyEngine.js";

/**
 * Two rules a table of bots showed were missing: a card laid off on a meld
 * already down, and an end to a hand once the stock has run dry twice. Without
 * them four hands of one and two cards drew and discarded for ever.
 */
const card = (rank: Rank, suit: Suit): Card => ({ rank, suit });

/** A two-player table stopped at seat 0's discard step with chosen hands. */
function table(hand0: Card[], hand1: Card[], melds0: Card[][] = []) {
  const engine = new RummyEngine("rules", { maxPlayers: 2, targetScore: 100 });
  engine.startGame();
  const state = engine.getState();
  const used = new Set([...hand0, ...hand1, ...melds0.flat()].map((c) => `${c.suit}${c.rank}`));
  const rest: Card[] = [];
  for (const suit of [Suit.Clubs, Suit.Diamonds, Suit.Hearts, Suit.Spades])
    for (let rank = Rank.Two; rank <= Rank.Ace; rank++)
      if (!used.has(`${suit}${rank}`)) rest.push(card(rank, suit));
  state.players[0].hand = [...hand0];
  state.players[1].hand = [...hand1];
  state.currentPlayerSeat = 0;
  engine.restore({
    ...engine.serialize(),
    state,
    drawPile: rest.slice(1),
    discardPile: [rest[0]],
    playerMelds: [melds0, []],
    rummyPhase: "discard",
  });
  return engine;
}

describe("laying off", () => {
  it("adds the fourth suit to a set and the next rank to a run, on anyone's meld", () => {
    const set = [card(Rank.Nine, Suit.Clubs), card(Rank.Nine, Suit.Diamonds), card(Rank.Nine, Suit.Hearts)];
    const run = [card(Rank.Four, Suit.Spades), card(Rank.Five, Suit.Spades), card(Rank.Six, Suit.Spades)];
    const engine = table([card(Rank.Nine, Suit.Spades), card(Rank.Seven, Suit.Spades), card(Rank.Three, Suit.Spades), card(Rank.King, Suit.Hearts)], [card(Rank.Two, Suit.Clubs), card(Rank.Two, Suit.Diamonds)], [set, run]);
    const fits = engine.getLegalLayOffs(0);
    expect(fits.map((f) => `${f.card.rank}${f.card.suit}->${f.meldIndex}`).sort()).toEqual(["3S->1", "7S->1", "9S->0"]);
    // The king fits nowhere; a fifth card never joins a set.
    expect(fits.some((f) => f.card.rank === Rank.King)).toBe(false);
    engine.layOff(0, card(Rank.Nine, Suit.Spades), 0, 0);
    expect(engine.getMelds()[0][0]).toHaveLength(4);
    expect(engine.getLegalLayOffs(0).some((f) => f.meldIndex === 0)).toBe(false);
    engine.layOff(0, card(Rank.Seven, Suit.Spades), 0, 1);
    engine.layOff(0, card(Rank.Three, Suit.Spades), 0, 1);
    expect(engine.getMelds()[0][1].map((c) => c.rank)).toEqual([3, 4, 5, 6, 7]);
    expect(engine.getState().players[0].hand).toEqual([card(Rank.King, Suit.Hearts)]);
    expect(engine.getState().phase).toBe(GamePhase.Playing);
  });

  it("refuses a card that does not fit, a meld that is not there, and the wrong moment", () => {
    const set = [card(Rank.Nine, Suit.Clubs), card(Rank.Nine, Suit.Diamonds), card(Rank.Nine, Suit.Hearts)];
    const engine = table([card(Rank.Eight, Suit.Spades)], [card(Rank.Two, Suit.Clubs)], [set]);
    expect(() => engine.layOff(0, card(Rank.Eight, Suit.Spades), 0, 0)).toThrow("does not fit");
    expect(() => engine.layOff(0, card(Rank.Eight, Suit.Spades), 1, 0)).toThrow("No such meld");
    expect(() => engine.layOff(1, card(Rank.Two, Suit.Clubs), 0, 0)).toThrow("Not your turn");
    expect(engine.getLegalLayOffs(1)).toEqual([]);
  });

  it("goes out by laying off the last card, and the hand ends", () => {
    const set = [card(Rank.Nine, Suit.Clubs), card(Rank.Nine, Suit.Diamonds), card(Rank.Nine, Suit.Hearts)];
    const engine = table([card(Rank.Nine, Suit.Spades)], [card(Rank.King, Suit.Clubs), card(Rank.Queen, Suit.Clubs)], [set]);
    engine.setRoundPause(true);
    engine.layOff(0, card(Rank.Nine, Suit.Spades), 0, 0);
    expect(engine.getState().phase).toBe(GamePhase.RoundScoring);
    // Seat 1 is caught with a king and a queen.
    expect(engine.getState().roundScores[1]).toBe(20);
    expect(engine.getState().roundScores[0]).toBe(0);
  });

  it("is on the visible state, so a table can offer it", () => {
    const set = [card(Rank.Nine, Suit.Clubs), card(Rank.Nine, Suit.Diamonds), card(Rank.Nine, Suit.Hearts)];
    const engine = table([card(Rank.Nine, Suit.Spades), card(Rank.Two, Suit.Hearts)], [card(Rank.Two, Suit.Clubs)], [set]);
    expect(engine.getVisibleState(0).legalLayOffs).toEqual([{ card: card(Rank.Nine, Suit.Spades), ownerSeat: 0, meldIndex: 0 }]);
    expect(engine.getVisibleState(1).legalLayOffs).toEqual([]);
  });
});

describe("a stock that runs dry", () => {
  it("is turned over once, and ends the hand the second time", () => {
    const engine = new RummyEngine("stock", { maxPlayers: 2, targetScore: 100 });
    engine.startGame();
    engine.setRoundPause(true);
    const state = engine.getState();
    // Two cards in the stock, a discard pile to turn over, and hands that
    // can never meld.
    state.players[0].hand = [card(Rank.Two, Suit.Clubs)];
    state.players[1].hand = [card(Rank.Nine, Suit.Hearts)];
    state.currentPlayerSeat = 0;
    engine.restore({
      ...engine.serialize(),
      state,
      drawPile: [card(Rank.King, Suit.Spades)],
      discardPile: [card(Rank.Four, Suit.Diamonds), card(Rank.Six, Suit.Diamonds), card(Rank.Ten, Suit.Clubs)],
      playerMelds: [[], []],
      rummyPhase: "draw",
    });
    engine.drawCard(0, "stock");
    engine.discardCard(0, card(Rank.King, Suit.Spades));
    // The stock is empty: seat 1's draw turns the discard pile over.
    engine.drawCard(1, "stock");
    expect(engine.getState().drawPile!.length).toBeGreaterThan(0);
    expect(engine.getState().phase).toBe(GamePhase.Playing);
    // Play the new stock down without anyone going out.
    let guard = 0;
    while (engine.getState().phase === GamePhase.Playing && guard++ < 40) {
      const seat = engine.getState().currentPlayerSeat;
      if (engine.getRummyPhase() === "draw") engine.drawCard(seat, "stock");
      if (engine.getState().phase !== GamePhase.Playing) break;
      engine.discardCard(seat, engine.getState().players[seat].hand[0]);
    }
    expect(engine.getState().phase).toBe(GamePhase.RoundScoring);
    // Everyone is scored on what they hold, as they would have been.
    expect(engine.getState().roundScores.every((s) => s >= 0)).toBe(true);
    // Persisted, so a restart mid-hand keeps the count.
    expect(engine.serialize().stockTurned).toBe(true);
    const copy = new RummyEngine("stock", { maxPlayers: 2, targetScore: 100 });
    copy.restore(engine.serialize());
    expect(copy.serialize().stockTurned).toBe(true);
  });
});
