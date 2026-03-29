import type {
  AIDifficulty,
  Card,
  GameConfig,
  GameType,
  RatingChange,
  VisibleGameState,
} from './game.js';

// ── Waiting room types ──

export interface WaitingRoomPlayer {
  displayName: string;
  avatarUrl: string | null;
  isHost: boolean;
  seatIndex: number;
}

export interface WaitingRoomState {
  roomId: string;
  gameType: GameType;
  host: string; // display name
  players: WaitingRoomPlayer[];
  maxPlayers: number;
  fillWithAI: boolean;
  config?: Partial<GameConfig>;
}

// ── Client → Server events ──

export interface ClientToServerEvents {
  'game:join': (data: { gameId: string }) => void;
  'game:leave': (data: { gameId: string }) => void;
  'game:play_card': (data: { gameId: string; card: Card }) => void;
  'game:bid': (data: { gameId: string; bid: number | 'pass' }) => void;
  'game:pass_cards': (data: { gameId: string; cards: Card[] }) => void;
  'game:call_trump': (data: { gameId: string; suit: string | 'pass' }) => void;
  'game:go_alone': (data: { gameId: string }) => void;
  'game:draw_card': (data: { gameId: string; source: 'stock' | 'discard' }) => void;
  'game:lay_meld': (data: { gameId: string; cards: Card[] }) => void;
  'game:discard': (data: { gameId: string; card: Card }) => void;
  'game:replace_with_ai': (data: { gameId: string; seatIndex: number }) => void;
  'game:end': (data: { gameId: string }) => void;

  'matchmaking:join': (data: {
    gameType: GameType;
    config?: Partial<GameConfig>;
  }) => void;
  'matchmaking:cancel': () => void;
  'matchmaking:accept': (data: { matchId: string }) => void;
  'matchmaking:decline': (data: { matchId: string }) => void;

  'lobby:create_game': (data: {
    gameType: GameType;
    config?: Partial<GameConfig>;
    aiDifficulty?: AIDifficulty;
    fillWithAI?: boolean;
  }) => void;

  // Waiting room
  'room:create': (data: {
    gameType: GameType;
    config?: Partial<GameConfig>;
  }) => void;
  'room:join': (data: { roomId: string }) => void;
  'room:leave': (data: { roomId: string }) => void;
  'room:start': (data: { roomId: string }) => void;

  'invite:send': (data: {
    toUserId: string;
    gameType: GameType;
    config?: Partial<GameConfig>;
  }) => void;
  'invite:respond': (data: {
    invitationId: string;
    accept: boolean;
  }) => void;

  'chat:message': (data: { gameId: string; text: string }) => void;
}

// ── Server → Client events ──

export interface ServerToClientEvents {
  'game:state': (state: VisibleGameState) => void;
  'game:card_played': (data: {
    seatIndex: number;
    card: Card;
    nextSeat: number;
  }) => void;
  'game:trick_complete': (data: {
    winningSeat: number;
    cards: Array<{ seatIndex: number; card: Card }>;
    points: number;
  }) => void;
  'game:round_end': (data: {
    roundScores: number[];
    totalScores: number[];
  }) => void;
  'game:phase_change': (data: {
    phase: string;
    data?: Record<string, unknown>;
  }) => void;
  'game:over': (data: {
    finalScores: number[];
    winnerSeat: number;
    ratingChanges?: RatingChange[];
  }) => void;
  'game:player_reconnected': (data: { seatIndex: number }) => void;
  'game:player_disconnected': (data: {
    seatIndex: number;
    timeoutSeconds: number;
  }) => void;
  'game:error': (data: { code: string; message: string }) => void;

  'matchmaking:found': (data: {
    gameId: string;
    opponents: Array<{ displayName: string; seatIndex: number }>;
  }) => void;
  'matchmaking:waiting': (data: { position: number }) => void;
  'matchmaking:proposed': (data: {
    matchId: string;
    gameType: GameType;
    players: Array<{ displayName: string }>;
    expiresIn: number;
  }) => void;
  'matchmaking:accepted': (data: { matchId: string; acceptedCount: number; totalCount: number }) => void;
  'matchmaking:declined': (data: { matchId: string; reason: string }) => void;

  'lobby:game_created': (data: { gameId: string }) => void;

  // Waiting room
  'room:created': (data: { roomId: string }) => void;
  'room:update': (state: WaitingRoomState) => void;
  'room:started': (data: { gameId: string }) => void;
  'room:error': (data: { message: string }) => void;

  'invite:received': (data: {
    invitationId: string;
    fromDisplayName: string;
    gameType: GameType;
  }) => void;

  'chat:message': (data: {
    seatIndex: number;
    displayName: string;
    text: string;
    timestamp: number;
  }) => void;

  'presence:update': (data: {
    userId: string;
    online: boolean;
  }) => void;
}
