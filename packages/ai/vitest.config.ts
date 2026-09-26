import { defineConfig } from 'vitest/config';

// The calibration games play dozens of full games to prove the bot tiers are
// ordered. They take ~30s, so they run with `npm run test:slow` (and in CI),
// not on every `npm test`.
const slow = process.env.SLOW_TESTS === '1';

export default defineConfig({
  test: {
    globals: true,
    include: slow ? ['src/**/Calibration.test.ts'] : ['src/**/*.test.ts'],
    exclude: slow ? [] : ['src/**/Calibration.test.ts', 'node_modules/**'],
  },
});
