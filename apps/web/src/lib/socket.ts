'use client';

import { getSocket } from '@card-game/shared-socket';

// Re-export from shared package, configured with the web app's server URL
export { type GameSocket } from '@card-game/shared-socket';

export function getWebSocket() {
  return getSocket({
    serverUrl: process.env.NEXT_PUBLIC_SERVER_URL ?? 'http://localhost:3001',
  });
}
