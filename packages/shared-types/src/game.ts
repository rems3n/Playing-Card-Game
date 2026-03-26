// ── Card primitives ──

export enum Suit {
  Clubs = 'C',
  Diamonds = 'D',
  Hearts = 'H',
  Spades = 'S',
}

export enum Rank {
  Two = 2,
  Three = 3,
  Four = 4,
  Five = 5,
  Six = 6,
  Seven = 7,
  Eight = 8,
  Nine = 9,
  Ten = 10,
  Jack = 11,
  Queen = 12,
  King = 13,
  Ace = 14,
}

export interface Card {
  suit: Suit;
  rank: Rank;
}

// ── Game types ──

export enum GameType {
  Hearts = 'hearts',
  Spades = 'spades',
  Euchre = 'euchre',
}

export enum GamePhase {
  Waiting = 'waiting',
  Dealing = 'dealing',
  Passing = 'passing',
  Bidding = 'bidding',
  Playing = 'playing',
  TrickResolution = 'trick_resolution',
  RoundScoring = 'round_scoring',
  GameOver = 'game_over',
}

export enum GameStatus {
  Waiting = 'waiting',
  Active = 'active',
  Completed = 'completed',
  Abandoned = 'abandoned',
}

// ── Player ──

export interface PlayerState {
  seatIndex: number;
  userId: string | null; // null for AI
  displayName: string;
  hand: Card[];
  tricksWon: number;
  score: number;
  isAI: boolean;
  aiDifficulty?: AIDifficulty;
  isConnected: boolean;
}

export enum AIDifficulty {
  Beginner = 'beginner',
  Intermediate = 'intermediate',
  Advanced = 'advanced',
  Expert = 'expert',
}

// ── Trick ──

export interface PlayedCard {
  seatIndex: number;
  card: Card;
}

export interface TrickResult {
  winningSeat: number;
  cards: PlayedCard[];
  points: number;
}

// ── Game state ──

export interface GameConfig {
  gameType: GameType;
  maxPlayers: number;
  targetScore: number;
  aiDifficulty?: AIDifficulty;
}

export interface GameState {
  gameId: string;
  gameType: GameType;
  phase: GamePhase;
  config: GameConfig;
  players: PlayerState[];
  currentTrick: PlayedCard[];
  currentPlayerSeat: number;
  leadSeat: number;
  roundNumber: number;
  trickNumber: number;
  heartsBroken: boolean;
  passDirection?: PassDirection;
  scores: number[]; // cumulative scores per seat
  roundScores: number[]; // current round scores per seat
  trumpSuit?: Suit;
  bids?: (number | null)[]; // per seat, null = hasn't bid yet
}

/** What a specific player can see (hides opponents' hands) */
export interface VisibleGameState {
  gameId: string;
  gameType: GameType;
  phase: GamePhase;
  config: GameConfig;
  players: VisiblePlayerState[];
  currentTrick: PlayedCard[];
  currentPlayerSeat: number;
  leadSeat: number;
  roundNumber: number;
  trickNumber: number;
  heartsBroken: boolean;
  passDirection?: PassDirection;
  scores: number[];
  roundScores: number[];
  trumpSuit?: Suit;
  bids?: (number | null)[];
  myHand: Card[];
  mySeat: number;
  legalMoves: Card[];
}

export interface VisiblePlayerState {
  seatIndex: number;
  displayName: string;
  cardCount: number;
  tricksWon: number;
  score: number;
  isAI: boolean;
  isConnected: boolean;
}

// ── Hearts-specific ──

export enum PassDirection {
  Left = 'left',
  Right = 'right',
  Across = 'across',
  Keep = 'keep',
}

// ── Game events (for event sourcing) ──

export enum GameEventType {
  GameCreated = 'game_created',
  PlayerJoined = 'player_joined',
  DealStarted = 'deal_started',
  CardsDealt = 'cards_dealt',
  PassCards = 'pass_cards',
  BidPlaced = 'bid_placed',
  CardPlayed = 'card_played',
  TrickCompleted = 'trick_completed',
  RoundEnded = 'round_ended',
  GameEnded = 'game_ended',
}

export interface GameEvent {
  type: GameEventType;
  seatIndex?: number;
  payload: Record<string, unknown>;
  timestamp: number;
  sequenceNum: number;
}

// ── Rating ──

export interface RatingInfo {
  rating: number;
  ratingDeviation: number;
  volatility: number;
  gamesPlayed: number;
}

export interface RatingChange {
  userId: string;
  gameType: GameType;
  before: number;
  after: number;
  change: number;
}
