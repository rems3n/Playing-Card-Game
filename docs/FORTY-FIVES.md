# 45s and Euchre are not the same game

The app offers a game labelled **"45s / Euchre"**. The engine behind it
(`packages/game-engine/src/games/euchre/EuchreEngine.ts`) plays **Euchre**. It is
a correct Euchre implementation, pinned by `EuchreMoves.test.ts`, but it is not
Forty-Fives, and the two differ in almost every part that matters: the deck, the
card ranking, the scoring and the target.

This document records the differences so the gap stays a decision rather than an
assumption, and so that whoever writes the 45s engine has the rules in one place.

Forty-Fives has regional variants — Irish, Nova Scotian and "Auction 45s" all
differ. What follows is the common Irish/Canadian form. Pick a variant with the
people who will play it before writing code; the table below is where the
choices live.

## Side by side

| | Euchre (what the engine plays) | Forty-Fives |
| --- | --- | --- |
| Deck | 24 cards, 9 through A | **52 cards**, 2 through A |
| Hand | 5 cards | 5 cards, usually dealt 3 then 2 |
| Players | Exactly 4, partners opposite | 2, 4 or 6; 4 in two partnerships is usual |
| Trump chosen by | Turned-up card ordered up, then a free call, dealer stuck | Turned-up card, or **bidding** in Auction 45s (15/20/25/30) |
| Highest trump | Jack of trump (right bower) | **5 of trump** |
| Second | Jack of the same colour (left bower) | **Jack of trump** |
| Third | Ace of trump | **Ace of hearts — always trump, in every suit** |
| Rest of trump | A, K, Q, 10, 9 | Depends on the colour of trump — see below |
| Plain suits | A, K, Q, J, 10, 9 | Depends on the colour of the suit — see below |
| Trick value | Tricks are counted, not scored | **5 points per trick** |
| Bonus | None | **5 points for the highest trump played in the hand** |
| Hand total | 1, 2 or 4 points | 30 points (25 in tricks + 5 bonus) |
| Target | 10 | **45** |
| Going alone | Maker's partner sits out, march pays 4 | Not part of the base game; Auction 45s has a 30 bid ("jink") requiring all five tricks |
| Reneging | Not allowed; you always follow suit | **Allowed** for the top three trumps under conditions — see below |

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

Note what this costs an implementation: card strength is not a function of rank
alone, nor of rank plus "is it trump". It depends on the **colour** of the suit,
and one specific card (A♥) changes suit depending on what trump is. The Euchre
engine's `getCardStrength` returns `50 + rank` for trump and `rank` otherwise;
that shape cannot express this and would have to be replaced by a table.

## Reneging

In Euchre you must follow the lead suit whenever you hold it, and the engine
enforces exactly that.

In Forty-Fives a player holding one of the top three trumps (5 of trump, jack of
trump, A♥) may decline to follow when **trump is led**, keeping the card back —
unless the card led is *higher* than the one they hold, in which case they must
play it. A player holding no top-three trump follows suit normally. Reneging a
card you were not entitled to renege is a penalty in most house rules.

This is a rule about legality of a move, so it lands squarely in `isLegalMove`,
and it is the part most likely to cause arguments at a real table. Settle the
penalty with the players before implementing it.

## Scoring a hand

Each trick is worth 5 points, and the player who played the highest trump in the
whole hand takes another 5 — so 30 points are on the table every hand. First side
to 45 wins. In the bidding variant a side that bid and failed to make its bid
loses the amount bid instead of scoring.

The Euchre engine scores by comparing trick counts against a threshold of three.
Nothing about that carries over.

## What building 45s actually needs

Reusable as they are: the table, the lobby, the scoreboard, the mobile shell,
the call panel, the persistence and reconnect layers, the bot scheduler, and the
`GameEngine` base class with its phase machine and event log. None of that knows
which game is being played.

Needs writing:

1. A 52-card deal and a `FortyFivesEngine` extending `GameEngine`.
2. A strength table keyed by (card, trump suit) rather than an arithmetic rule,
   with the A♥ treated as trump in every suit.
3. `isLegalMove` with the reneging exception.
4. Per-trick scoring plus the highest-trump bonus, and a target of 45.
5. Bidding, if the Auction variant is wanted, replacing the order-up flow.
6. A game type in `GameType`, registration in `GameService`, and a bot strategy —
   the existing `EuchreAI` reasons about bowers and would mislead.
7. Seeded simulations in the shape of `FamilySimulation.test.ts`, checking every
   trick winner against an independent calculation, as the Seven-Six and Euchre
   engines already are.

Until that exists, the honest description of the current game is Euchre, and the
rules page says so.
