import {
  type Card,
  type VisibleGameState,
  type PlayedCard,
  type GameConfig,
  GamePhase,
  GameType,
  Suit,
  Rank,
} from '@card-game/shared-types';

export function card(suit: Suit, rank: Rank): Card {
  return { suit, rank };
}

export function makeState(overrides: Partial<VisibleGameState> & { gameType: GameType; myHand: Card[]; legalMoves: Card[] }): VisibleGameState {
  const defaults: VisibleGameState = {
    gameId: 'test',
    gameType: overrides.gameType,
    phase: GamePhase.Playing,
    config: { gameType: overrides.gameType, maxPlayers: 4, targetScore: 100 },
    players: [
      { seatIndex: 0, displayName: 'You', cardCount: 13, tricksWon: 0, score: 0, isAI: false, isConnected: true },
      { seatIndex: 1, displayName: 'Bot1', cardCount: 13, tricksWon: 0, score: 0, isAI: true, isConnected: true },
      { seatIndex: 2, displayName: 'Bot2', cardCount: 13, tricksWon: 0, score: 0, isAI: true, isConnected: true },
      { seatIndex: 3, displayName: 'Bot3', cardCount: 13, tricksWon: 0, score: 0, isAI: true, isConnected: true },
    ],
    currentTrick: [],
    currentPlayerSeat: 0,
    leadSeat: 0,
    roundNumber: 0,
    trickNumber: 0,
    heartsBroken: false,
    scores: [0, 0, 0, 0],
    roundScores: [0, 0, 0, 0],
    myHand: overrides.myHand,
    mySeat: 0,
    legalMoves: overrides.legalMoves,
  };
  return { ...defaults, ...overrides };
}
