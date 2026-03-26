'use client';

import { useEffect, useRef } from 'react';
import { useSession } from 'next-auth/react';
import { type GameSocket } from '@card-game/shared-socket';
import { getWebSocket } from '@/lib/socket';

const SERVER_URL = process.env.NEXT_PUBLIC_SERVER_URL ?? 'http://localhost:3001';

export function useSocket(): GameSocket {
  const { data: session, status } = useSession();
  const socketRef = useRef<GameSocket>(getWebSocket());
  const hasConnected = useRef(false);

  useEffect(() => {
    const socket = socketRef.current;

    if (status === 'loading') return;
    if (hasConnected.current) return;

    const email = session?.user?.email;

    if (!email) {
      // Guest connection
      hasConnected.current = true;
      socket.auth = { displayName: 'Guest', email: '' };
      socket.connect();
      return;
    }

    // Fetch DB profile to get username before connecting
    fetch(`${SERVER_URL}/api/users/me?email=${encodeURIComponent(email)}`)
      .then((r) => r.json())
      .then((data) => {
        if (hasConnected.current) return;
        hasConnected.current = true;

        const profile = data.profile;
        // Prefer username, fall back to displayName, then Google name
        const name = profile?.username
          ? profile.username
          : profile?.displayName ?? session?.user?.name ?? 'Player';

        socket.auth = { displayName: name, email };
        socket.connect();
      })
      .catch(() => {
        if (hasConnected.current) return;
        hasConnected.current = true;
        socket.auth = {
          displayName: session?.user?.name ?? 'Player',
          email,
        };
        socket.connect();
      });
  }, [session, status]);

  return socketRef.current;
}
