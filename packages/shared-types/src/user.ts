import type { GameType, RatingInfo } from './game.js';

export interface User {
  id: string;
  email: string;
  displayName: string;
  avatarUrl: string | null;
  authProvider: 'google' | 'facebook';
  createdAt: string;
  lastSeenAt: string;
}

export interface UserProfile extends User {
  ratings: Record<GameType, RatingInfo>;
  stats: UserStats;
}

export interface UserStats {
  totalGames: number;
  totalWins: number;
  totalLosses: number;
  gameStats: Record<GameType, GameTypeStats>;
}

export interface GameTypeStats {
  gamesPlayed: number;
  wins: number;
  losses: number;
  winRate: number;
  currentStreak: number;
  bestStreak: number;
  averageScore: number;
}

export interface FriendInfo {
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  online: boolean;
  currentGame: string | null;
}
