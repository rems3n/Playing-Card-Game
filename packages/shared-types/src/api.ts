import type { GameType, GameStatus, AIDifficulty } from './game.js';
import type { UserProfile, FriendInfo } from './user.js';

// ── API Response wrapper ──

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}

// ── Auth ──

export interface AuthResponse {
  user: UserProfile;
  token: string;
}

// ── Game history ──

export interface GameSummary {
  gameId: string;
  gameType: GameType;
  status: GameStatus;
  players: GamePlayerSummary[];
  winnerId: string | null;
  createdAt: string;
  completedAt: string | null;
}

export interface GamePlayerSummary {
  userId: string | null;
  displayName: string;
  seatIndex: number;
  finalScore: number;
  isAI: boolean;
  aiDifficulty?: AIDifficulty;
}

// ── Leaderboard ──

export interface LeaderboardEntry {
  rank: number;
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  rating: number;
  gamesPlayed: number;
  winRate: number;
}

// ── Friends ──

export interface FriendRequest {
  id: string;
  fromUser: FriendInfo;
  createdAt: string;
}
