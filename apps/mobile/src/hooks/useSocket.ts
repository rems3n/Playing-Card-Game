import { useEffect, useRef } from "react";
import { getSocket, type GameSocket } from "@card-game/shared-socket";
import Constants from "expo-constants";
import * as SecureStore from "expo-secure-store";
const SERVER_URL =
  Constants.expoConfig?.extra?.serverUrl ??
  "https://playing-card-game-production.up.railway.app";
let sessionRequest: Promise<string> | undefined;
async function guestToken(displayName: string) {
  if (!sessionRequest)
    sessionRequest = (async () => {
      const token = await SecureStore.getItemAsync("cardarena-guest-token");
      const response = await fetch(`${SERVER_URL}/api/auth/guest`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: token ?? undefined, displayName }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Unable to connect");
      await SecureStore.setItemAsync("cardarena-guest-token", result.token);
      return result.token as string;
    })().finally(() => {
      sessionRequest = undefined;
    });
  return sessionRequest;
}
export function useSocket(displayName = "Player", _email = ""): GameSocket {
  const socketRef = useRef(getSocket({ serverUrl: SERVER_URL }));
  useEffect(() => {
    const socket = socketRef.current;
    if (socket.connected) return;
    socket.auth = (callback) => {
      guestToken(displayName)
        .then((token) => callback({ token }))
        .catch(() => callback({}));
    };
    socket.connect();
  }, [displayName]);
  return socketRef.current;
}
