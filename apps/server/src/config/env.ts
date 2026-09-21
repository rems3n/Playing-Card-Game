import "dotenv/config";

export const env = {
  DATABASE_URL:
    process.env.DATABASE_URL ??
    "postgresql://cardgame:cardgame_dev@localhost:5432/cardgame",
  REDIS_URL: process.env.REDIS_URL ?? "redis://localhost:6379",
  SERVER_PORT: parseInt(
    process.env.PORT ?? process.env.SERVER_PORT ?? "3001",
    10,
  ),
  WEB_URL:
    process.env.WEB_URL ?? process.env.CORS_ORIGIN ?? "http://localhost:3000",
  JWT_SECRET: process.env.JWT_SECRET ?? "dev-secret-change-in-production",
  SESSION_EXCHANGE_SECRET:
    process.env.SESSION_EXCHANGE_SECRET ?? "local-session-exchange-only",
};

if (process.env.NODE_ENV === "production") {
  for (const key of [
    "JWT_SECRET",
    "SESSION_EXCHANGE_SECRET",
    "DATABASE_URL",
    "REDIS_URL",
    "WEB_URL",
  ] as const) {
    if (
      !process.env[key] ||
      (key.endsWith("SECRET") && process.env[key]!.length < 32)
    ) {
      throw new Error(`Configure ${key} before starting in production`);
    }
  }
}
