# Auction Forty-Fives

The app plays **Auction 45s**. The engine is
`packages/game-engine/src/games/forty-fives/FortyFivesEngine.ts`, the card
ranking is `packages/game-engine/src/games/forty-fives/ranking.ts`, and the bot
is `packages/ai/src/games/FortyFivesAI.ts`.

Forty-Fives has regional variants — Irish, Nova Scotian and Auction all differ.
This document records the variant that is implemented, so the differences from
the version anyone remembers stay a decision rather than a surprise.

## The variant implemented

| | This implementation |
| --- | --- |
| Deck | 52 cards, 2 through A |
| Hand | 5 cards each |
| Players | 2, 4 or 6. Four and six play in two teams, alternating seats. Two players are each their own side. |
| Trump chosen by | Bidding: 15, 20, 25 or 30. No turned-up card. |
| Highest trump | 5 of trump |
| Second | Jack of trump |
| Third | Ace of hearts — trump in every suit |
| Rest of trump | Depends on the colour of trump — see below |
| Plain suits | Depends on the colour of the suit — see below |
| Trick value | 5 points |
| Bonus | 5 points for the highest trump played in the hand |
| Hand total | 30 points (25 in tricks + 5 bonus) |
| Target | 45 |
| Reneging | Allowed for the top three trumps under conditions — see below |

Not implemented: going alone, the 30 "jink" bid requiring all five tricks as a
distinct scoring case (30 is a legal bid, but it scores like any other bid),
robbing the pack, and house penalties for an illegal renege — an illegal renege
is simply rejected as an illegal move.

## The auction

The player to the dealer's left bids first, and bidding goes once round the
table.

- Legal bids are 15, 20, 25 and 30, or pass.
- Each bid must beat the standing bid. **The dealer may match it instead**, and
  takes the contract when they do.
- If everyone else passes, the dealer must bid — pass is not offered.
- The winner of the auction names trump and leads the first trick. Nobody else
  can name trump, and no further bids are accepted once the auction closes.

`getLegalBids(seat)` returns exactly what that seat may do at that moment,
including the pass, and the web bidding panel renders only those options. It
returns an empty array once the auction is over.

## The ranking, in full

Two rules do all the work: the **5, the jack and the ace of hearts are the top
three trumps in that order, in every suit**, and everything else follows
**"highest in red, lowest in black"** — in a red suit the numerals run high to
low as you expect, and in a black suit they run the other way, so the 2 is the
highest numeral and the 10 the lowest.

**Trump, when trump is hearts**
5♥, J♥, A♥, K♥, Q♥, 10♥, 9♥, 8♥, 7♥, 6♥, 4♥, 3♥, 2♥

**Trump, when trump is diamonds**
5♦, J♦, A♥, A♦, K♦, Q♦, 10♦, 9♦, 8♦, 7♦, 6♦, 4♦, 3♦, 2♦

**Trump, when trump is clubs**
5♣, J♣, A♥, A♣, K♣, Q♣, 2♣, 3♣, 4♣, 6♣, 7♣, 8♣, 9♣, 10♣

**Trump, when trump is spades**
5♠, J♠, A♥, A♠, K♠, Q♠, 2♠, 3♠, 4♠, 6♠, 7♠, 8♠, 9♠, 10♠

**A plain red suit** (hearts when not trump has no ace — it is trump)
A, K, Q, J, 10, 9, 8, 7, 6, 5, 4, 3, 2

**A plain black suit**
K, Q, J, A, 2, 3, 4, 5, 6, 7, 8, 9, 10

Card strength is therefore not a function of rank alone, nor of rank plus "is it
trump": it depends on the **colour** of the suit, and one specific card (A♥)
changes suit depending on what trump is. `ranking.ts` builds the orders from the
two rules above rather than hard-coding four tables, so the rules stay visible;
`FortyFivesRules.test.ts` checks the result against the tables in this document,
transcribed independently.

## Reneging

A player holding one of the top three trumps (5 of trump, jack of trump, A♥) may
decline to follow when **trump is led**, keeping the card back — unless the card
led is *higher* than the one they hold, in which case they must play it. A
player holding no top-three trump follows suit normally, and nobody may hold a
card back when a plain suit is led.

This lives in `isLegalMove`. The one card that can never be held back is the 5
of trump, since nothing outranks it.

## Scoring a hand

Each trick is worth 5 points, and the side that played the highest trump in the
whole hand takes another 5 — so 30 points are on the table every hand. A side
that bid and fell short of its bid **loses the amount bid** instead of scoring;
the other side always scores what it took. First side to 45 wins. If both sides
cross 45 on the same hand, the side that bid is counted out first.

## Tests

- `packages/game-engine/src/__tests__/FortyFivesRules.test.ts` — 32 tests: the
  ranking tables, the ace of hearts, 2♣ beating 10♣, following suit, six
  reneging cases, trick winners, the whole auction including the dealer's hold
  and the stuck dealer, seat-count validation, and scoring.
- `packages/game-engine/src/__tests__/FortyFivesSimulation.test.ts` — 60 tests:
  seeded complete games at 2, 4 and 6 seats, checking every trick winner and
  every hand score against an independent calculation, plus serialize/restore
  equality.
- `apps/server/src/__tests__/` — the auction, trick presentation, next-hand
  control and a full mixed human/bot game through the real socket handlers.
