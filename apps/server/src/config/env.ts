import 'dotenv/config';

export const env = {
  DATABASE_URL:
    process.env.DATABASE_URL ??
    'postgresql://cardgame:cardgame_dev@localhost:5432/cardgame',
  REDIS_URL: process.env.REDIS_URL ?? 'redis://localhost:6379',
  SERVER_PORT: parseInt(process.env.PORT ?? process.env.SERVER_PORT ?? '3001', 10),
  WEB_URL: process.env.WEB_URL ?? process.env.CORS_ORIGIN ?? 'http://localhost:3000',
  JWT_SECRET: process.env.JWT_SECRET ?? 'dev-secret-change-in-production',
};
