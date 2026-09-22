"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  MediaConfig,
  MediaCredentials,
  MediaDevice,
  MediaErrorCode,
  MediaParticipant,
  MediaStatus,
} from "@card-game/shared-types";
import type {
  MediaSession,
  MediaSessionFactory,
  MediaSnapshot,
} from "@/lib/media/types";
import { useSocket } from "./useSocket";
import { useServerConfig } from "./useServerConfig";

const MEDIA_OFF: MediaConfig = { enabled: false, provider: "none" };

/** Asks the server once whether call controls should exist at all. */
export function useMediaConfig(fetcher: typeof fetch | null = null) {
  return useServerConfig<MediaConfig>("/media/config", MEDIA_OFF, fetcher);
}

export interface MediaController {
  status: MediaStatus;
  participants: MediaParticipant[];
  /** A sentence to show beside the table. The game is never blocked by it. */
  error: string | null;
  microphoneOn: boolean;
  cameraOn: boolean;
  /** Empty where the browser does not allow choosing an output. */
  audioOutputs: MediaDevice[];
  audioOutput: string;
  selectAudioOutput(deviceId: string): void;
  /** Silence one person for this listener only. */
  toggleMutedForMe(identity: string): void;
  join(): void;
  leave(): void;
  toggleMicrophone(): void;
  toggleCamera(): void;
  attachVideo(identity: string, element: HTMLVideoElement | null): void;
  dismissError(): void;
}

/**
 * Owns the call for one table.
 *
 * Camera and microphone start off. Leaving the call leaves only the call. Every
 * failure lands in `error` and leaves the game socket alone, which is why no
 * path here throws or touches game state.
 */
export function useMedia({
  gameId,
  enabled,
  createSession,
}: {
  gameId: string | null;
  enabled: boolean;
  createSession: MediaSessionFactory;
}): MediaController {
  const socket = useSocket();
  const [status, setStatus] = useState<MediaStatus>("off");
  const [snapshot, setSnapshot] = useState<MediaSnapshot>({
    participants: [],
    error: null,
    notice: null,
    connected: false,
    reconnecting: false,
  });
  const [error, setError] = useState<string | null>(null);
  const [microphoneOn, setMicrophoneOn] = useState(false);
  const [cameraOn, setCameraOn] = useState(false);
  const [audioOutputs, setAudioOutputs] = useState<MediaDevice[]>([]);
  const [audioOutput, setAudioOutput] = useState("");
  const session = useRef<MediaSession | null>(null);
  const unsubscribe = useRef<(() => void) | null>(null);
  const wanted = useRef(false);

  const teardown = useCallback(async () => {
    unsubscribe.current?.();
    unsubscribe.current = null;
    const open = session.current;
    session.current = null;
    setMicrophoneOn(false);
    setCameraOn(false);
    setAudioOutputs([]);
    setAudioOutput("");
    setSnapshot({
      participants: [],
      error: null,
      notice: null,
      connected: false,
      reconnecting: false,
    });
    await open?.disconnect().catch(() => {});
  }, []);

  // Leaving the table ends the call; it never ends the game.
  useEffect(() => {
    return () => {
      wanted.current = false;
      void teardown();
    };
  }, [gameId, teardown]);

  // If the server withdraws calls the controls disappear, so the room has to
  // go with them rather than publishing on behind a hidden panel.
  useEffect(() => {
    if (enabled) return;
    wanted.current = false;
    void teardown();
  }, [enabled, teardown]);

  useEffect(() => {
    if (!enabled) return;
    const onCredentials = async (credentials: MediaCredentials) => {
      if (!wanted.current) return;
      try {
        // Never stack two rooms: an earlier one would keep publishing unseen.
        if (session.current) await teardown();
        const next = await createSession();
        if (!wanted.current) {
          await next.disconnect().catch(() => {});
          return;
        }
        session.current = next;
        unsubscribe.current = next.onChange(setSnapshot);
        await next.connect(credentials);
        // Output choice is a nicety: a browser that refuses simply has none.
        const outputs = await next.listAudioOutputs().catch(() => []);
        if (wanted.current) setAudioOutputs(outputs);
      } catch (cause) {
        setError(
          cause instanceof Error
            ? `Could not start the call: ${cause.message}`
            : "Could not start the call.",
        );
        setStatus("failed");
        wanted.current = false;
        void teardown();
      }
    };
    const onError = (data: { code: MediaErrorCode; message: string }) => {
      if (!wanted.current) return;
      wanted.current = false;
      setError(data.message);
      setStatus(data.code === "MEDIA_DISABLED" ? "unavailable" : "failed");
      void teardown();
    };
    socket.on("media:credentials", onCredentials);
    socket.on("media:error", onError);
    return () => {
      socket.off("media:credentials", onCredentials);
      socket.off("media:error", onError);
    };
  }, [socket, enabled, createSession, teardown]);

  useEffect(() => {
    if (!wanted.current) return;
    if (snapshot.error) {
      setError(snapshot.error);
      setStatus("failed");
      // Telling someone the call is over while their camera still publishes is
      // worse than any call failure, so the room really is left here.
      wanted.current = false;
      void teardown();
      return;
    }
    // A control that failed is said out loud and changes nothing else: the
    // call keeps running, and the player is still on air.
    if (snapshot.notice) setError(snapshot.notice);
    if (snapshot.reconnecting) setStatus("reconnecting");
    else if (snapshot.connected) setStatus("connected");
  }, [snapshot, teardown]);

  const join = useCallback(() => {
    if (!enabled || !gameId) return;
    // Rejoining after a failure has to work, so the guard is the live call
    // rather than a flag that a failure could leave stuck set.
    if (status === "connecting" || status === "connected" || status === "reconnecting")
      return;
    wanted.current = true;
    setError(null);
    setStatus("connecting");
    socket.emit("media:token", { gameId });
  }, [enabled, gameId, socket, status]);

  const leave = useCallback(() => {
    wanted.current = false;
    setStatus("off");
    setError(null);
    void teardown();
  }, [teardown]);

  const toggleMicrophone = useCallback(() => {
    const next = !microphoneOn;
    setMicrophoneOn(next);
    void session.current?.setMicrophone(next).catch(() => {});
  }, [microphoneOn]);

  const toggleCamera = useCallback(() => {
    const next = !cameraOn;
    setCameraOn(next);
    void session.current?.setCamera(next).catch(() => {});
  }, [cameraOn]);

  const selectAudioOutput = useCallback((deviceId: string) => {
    setAudioOutput(deviceId);
    void session.current?.setAudioOutput(deviceId).catch(() => {});
  }, []);

  const toggleMutedForMe = useCallback(
    (identity: string) => {
      const person = snapshot.participants.find(
        (p) => p.identity === identity,
      );
      void session.current
        ?.setMutedForMe(identity, !person?.mutedForMe)
        .catch(() => {});
    },
    [snapshot.participants],
  );

  const attachVideo = useCallback(
    (identity: string, element: HTMLVideoElement | null) =>
      session.current?.attachVideo(identity, element),
    [],
  );

  return useMemo(
    () => ({
      status: enabled ? status : "unavailable",
      participants: snapshot.participants,
      error,
      microphoneOn,
      cameraOn,
      audioOutputs,
      audioOutput,
      selectAudioOutput,
      toggleMutedForMe,
      join,
      leave,
      toggleMicrophone,
      toggleCamera,
      attachVideo,
      dismissError: () => setError(null),
    }),
    [
      enabled,
      status,
      snapshot.participants,
      error,
      microphoneOn,
      cameraOn,
      audioOutputs,
      audioOutput,
      selectAudioOutput,
      toggleMutedForMe,
      join,
      leave,
      toggleMicrophone,
      toggleCamera,
      attachVideo,
    ],
  );
}
