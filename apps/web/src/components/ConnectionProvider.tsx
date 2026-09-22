"use client";
import { createContext, useContext, useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { getWebSocket } from "@/lib/socket";
import { clearPlayerSession, getPlayerSession } from "@/lib/game-session";
import { useGameStore } from "@card-game/shared-store";

let activeParticipant = "";
let activeName = "";
const Context = createContext({
  connected: false,
  message: "",
  retry: () => {},
});
export const useConnection = () => useContext(Context);

export async function connectPlayer(name?: string) {
  const socket = getWebSocket();
  const session = await getPlayerSession(name);
  if (
    socket.connected &&
    (!name || name === session.displayName) &&
    activeParticipant === session.participantId &&
    activeName === session.displayName
  )
    return;
  socket.disconnect();
  socket.auth = (callback) => {
    getPlayerSession()
      .then((player) => {
        activeParticipant = player.participantId;
        activeName = player.displayName;
        callback({ token: player.token });
      })
      .catch(() => callback({}));
  };
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(
      () => finish(new Error("Connection timed out. Please try again.")),
      12000,
    );
    function finish(error?: Error) {
      clearTimeout(timer);
      socket.off("connect", ready);
      socket.off("connect_error", failed);
      error ? reject(error) : resolve();
    }
    function ready() {
      finish();
    }
    function failed(error: Error) {
      finish(error);
    }
    socket.once("connect", ready);
    socket.once("connect_error", failed);
    socket.connect();
  });
}

export function ConnectionProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const { data: session, status } = useSession();
  const [connected, setConnected] = useState(false);
  const [message, setMessage] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (status === "loading") return;
    let cancelled = false;
    const socket = getWebSocket();
    clearPlayerSession();
    useGameStore.getState().reset();
    function ready() {
      setConnected(true);
      setMessage("");
    }
    function lost() {
      setConnected(false);
      setMessage("Connection interrupted. Reconnecting…");
    }
    function failed(error: Error) {
      setConnected(false);
      setMessage(error.message);
    }
    socket.on("connect", ready);
    socket.on("disconnect", lost);
    socket.on("connect_error", failed);
    socket.auth = (callback) => {
      getPlayerSession()
        .then((player) => {
          if (!cancelled) {
            activeParticipant = player.participantId;
            activeName = player.displayName;
            callback({ token: player.token });
          }
        })
        .catch((error) => {
          if (!cancelled) {
            failed(error);
            callback({});
          }
        });
    };
    socket.connect();
    return () => {
      cancelled = true;
      socket.off("connect", ready);
      socket.off("disconnect", lost);
      socket.off("connect_error", failed);
      socket.disconnect();
    };
  }, [status, session?.user?.email, attempt]);
  return (
    <Context.Provider
      value={{ connected, message, retry: () => setAttempt((n) => n + 1) }}
    >
      {children}
    </Context.Provider>
  );
}
