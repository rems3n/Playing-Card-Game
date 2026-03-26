import path from 'path';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import { Server } from 'socket.io';
import type {
  ClientToServerEvents,
  ServerToClientEvents,
} from '@card-game/shared-types';
import { env } from './config/env.js';
import { GameService } from './services/GameService.js';
import { setupGameHandlers } from './socket/gameRoom.js';
import { socketAuth } from './middleware/auth.js';
import { redis } from './config/redis.js';
import { userRoutes } from './routes/users.js';
import { gameRoutes } from './routes/games.js';
import { uploadRoutes } from './routes/upload.js';
import { friendRoutes } from './routes/friends.js';
import { leaderboardRoutes } from './routes/leaderboard.js';
import { ratingHistoryRoutes } from './routes/ratingHistory.js';

async function main() {
  const fastify = Fastify({ logger: true });

  const allowedOrigins = [env.WEB_URL, 'http://localhost:3000'].filter(Boolean);
  await fastify.register(cors, {
    origin: allowedOrigins,
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
  });

  // File upload support (5MB max)
  await fastify.register(multipart, {
    limits: { fileSize: 5 * 1024 * 1024 },
  });

  // Serve uploaded files
  await fastify.register(fastifyStatic, {
    root: path.resolve('uploads'),
    prefix: '/uploads/',
  });

  // Health check
  fastify.get('/health', async () => ({ status: 'ok' }));

  // Connect Redis
  await redis.connect();

  // API routes
  await fastify.register(userRoutes);
  await fastify.register(gameRoutes);
  await fastify.register(uploadRoutes);
  await fastify.register(friendRoutes);
  await fastify.register(leaderboardRoutes);
  await fastify.register(ratingHistoryRoutes);

  // Start the HTTP server
  await fastify.listen({ port: env.SERVER_PORT, host: '0.0.0.0' });

  // Attach Socket.io to the underlying Node HTTP server
  const io = new Server<ClientToServerEvents, ServerToClientEvents>(
    fastify.server,
    {
      cors: {
        origin: allowedOrigins,
        credentials: true,
      },
    },
  );

  // Socket auth middleware (allows guests for now)
  io.use(socketAuth);

  const gameService = new GameService();
  setupGameHandlers(io, gameService);

  console.log(`Game server running on port ${env.SERVER_PORT}`);
}

main().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
