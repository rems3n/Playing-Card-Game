# CardArena testing

See [Family-game QA](docs/FAMILY-GAME-QA.md) for the current coverage matrix,
reported defects, corrections, and remaining acceptance work. Earlier counts and
claims that AI/server coverage was absent are obsolete.

```sh
npm ci --ignore-scripts
npm test
npx turbo run build --filter=@card-game/server --filter=@card-game/web
npx tsc --noEmit -p apps/mobile/tsconfig.json
```

`npm test` includes engine simulations, AI, server, real Socket.IO client tests,
and web component interactions. CI additionally applies migrations and sets
`RUN_DURABILITY_TESTS=1` against disposable PostgreSQL and Redis containers.
Never run those destructive test fixtures against production data.

For focused regressions:

```sh
npm run test --workspace=@card-game/web
npm run test --workspace=@card-game/server -- src/__tests__/TrickReview.test.ts src/__tests__/SocketGameplay.test.ts
npm run test --workspace=@card-game/game-engine -- src/__tests__/FamilySimulation.test.ts
```

Test game rules and visible behavior independently. A build passing does not
prove that card dimensions, animations, touch interaction, or timing are correct.
Verify those in the deployed browser preview after the automated gates pass.
