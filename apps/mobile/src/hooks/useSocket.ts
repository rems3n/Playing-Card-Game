import { useEffect, useRef } from 'react';
import { getSocket, type GameSocket } from '@card-game/shared-socket';

const SERVER_URL = 'http://localhost:3001'; // TODO: configure per environment

export function useSocket(displayName: string = 'Player', email: string = ''): GameSocket {
  const socketRef = useRef<GameSocket>(
    getSocket({ serverUrl: SERVER_URL }),
  );
  const hasConnected = useRef(false);

  useEffect(() => {
    const socket = socketRef.current;
    if (hasConnected.current) return;
    hasConnected.current = true;

    socket.auth = { displayName, email };
    socket.connect();
  }, [displayName, email]);

  return socketRef.current;
}
