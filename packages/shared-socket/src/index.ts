import { io, type Socket } from 'socket.io-client';
import type {
  ClientToServerEvents,
  ServerToClientEvents,
} from '@card-game/shared-types';

export type GameSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

export interface SocketConfig {
  serverUrl: string;
}

let socket: GameSocket | null = null;

/**
 * Get or create the singleton Socket.io connection.
 * Platform-agnostic — works in web browsers, React Native, and Node.js.
 */
export function getSocket(config?: SocketConfig): GameSocket {
  if (!socket) {
    const url = config?.serverUrl ?? 'http://localhost:3001';
    socket = io(url, {
      autoConnect: false,
      transports: ['websocket'],
    });
  }
  return socket;
}

/** Disconnect and clear the singleton. Useful for logout/cleanup. */
export function disconnectSocket(): void {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}
