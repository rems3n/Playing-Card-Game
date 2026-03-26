import {
  pgTable,
  uuid,
  varchar,
  text,
  boolean,
  integer,
  real,
  timestamp,
  date,
  jsonb,
  bigserial,
  uniqueIndex,
  index,
  check,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

// ── Users ──

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: varchar('email', { length: 255 }).notNull().unique(),
  username: varchar('username', { length: 30 }).unique(),
  displayName: varchar('display_name', { length: 50 }).notNull(),
  avatarUrl: text('avatar_url'),
  authProvider: varchar('auth_provider', { length: 20 }).notNull(), // 'google' | 'facebook'
  authProviderId: varchar('auth_provider_id', { length: 255 }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex('users_provider_unique').on(table.authProvider, table.authProviderId),
]);

// ── Ratings (one row per user per game type) ──

export const ratings = pgTable('ratings', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  gameType: varchar('game_type', { length: 20 }).notNull(), // 'hearts' | 'spades' | 'euchre'
  rating: real('rating').default(1500).notNull(),
  ratingDeviation: real('rating_deviation').default(350).notNull(),
  volatility: real('volatility').default(0.06).notNull(),
  gamesPlayed: integer('games_played').default(0).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex('ratings_user_game_unique').on(table.userId, table.gameType),
]);

// ── Games ──

export const games = pgTable('games', {
  id: uuid('id').primaryKey().defaultRandom(),
  gameType: varchar('game_type', { length: 20 }).notNull(),
  status: varchar('status', { length: 20 }).notNull(), // 'waiting' | 'active' | 'completed' | 'abandoned'
  config: jsonb('config').notNull(), // { maxPlayers, targetScore, etc. }
  finalScores: jsonb('final_scores'), // { seatIndex: score } at completion
  winnerSeat: integer('winner_seat'),
  winnerId: uuid('winner_id').references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  completedAt: timestamp('completed_at', { withTimezone: true }),
});

// ── Game Players (participants in a game, including AI) ──

export const gamePlayers = pgTable('game_players', {
  id: uuid('id').primaryKey().defaultRandom(),
  gameId: uuid('game_id').notNull().references(() => games.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').references(() => users.id), // NULL for AI
  seatPosition: integer('seat_position').notNull(),
  isAi: boolean('is_ai').default(false).notNull(),
  aiDifficulty: varchar('ai_difficulty', { length: 20 }),
  aiPersona: varchar('ai_persona', { length: 50 }),
  finalScore: integer('final_score'),
  ratingBefore: real('rating_before'),
  ratingAfter: real('rating_after'),
}, (table) => [
  uniqueIndex('game_players_seat_unique').on(table.gameId, table.seatPosition),
]);

// ── Game Events (event sourcing for replay) ──

export const gameEvents = pgTable('game_events', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  gameId: uuid('game_id').notNull().references(() => games.id, { onDelete: 'cascade' }),
  eventType: varchar('event_type', { length: 30 }).notNull(),
  playerSeat: integer('player_seat'),
  payload: jsonb('payload').notNull(),
  sequenceNum: integer('sequence_num').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index('game_events_game_seq_idx').on(table.gameId, table.sequenceNum),
]);

// ── Friendships ──

export const friendships = pgTable('friendships', {
  id: uuid('id').primaryKey().defaultRandom(),
  userAId: uuid('user_a_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  userBId: uuid('user_b_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  status: varchar('status', { length: 20 }).default('pending').notNull(), // 'pending' | 'accepted' | 'blocked'
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex('friendships_pair_unique').on(table.userAId, table.userBId),
  check('friendships_order_check', sql`${table.userAId} < ${table.userBId}`),
]);

// ── Game Invitations ──

export const invitations = pgTable('invitations', {
  id: uuid('id').primaryKey().defaultRandom(),
  fromUserId: uuid('from_user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  toUserId: uuid('to_user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  gameType: varchar('game_type', { length: 20 }).notNull(),
  config: jsonb('config').notNull(),
  status: varchar('status', { length: 20 }).default('pending').notNull(), // 'pending' | 'accepted' | 'declined' | 'expired'
  gameId: uuid('game_id').references(() => games.id),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
});

// ── Rating History (daily snapshots for charts) ──

export const ratingHistory = pgTable('rating_history', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  gameType: varchar('game_type', { length: 20 }).notNull(),
  rating: real('rating').notNull(),
  recordedAt: date('recorded_at').notNull(),
}, (table) => [
  uniqueIndex('rating_history_unique').on(table.userId, table.gameType, table.recordedAt),
]);
