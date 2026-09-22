import type {
  MediaCredentials,
  MediaDevice,
  MediaParticipant,
} from "@card-game/shared-types";

/**
 * The call, as the table sees it.
 *
 * The game UI only ever talks to this interface, so the provider can change
 * without touching a component, and tests can drive a fake call without a
 * browser, a camera or a server.
 */
export interface MediaSession {
  connect(credentials: MediaCredentials): Promise<void>;
  disconnect(): Promise<void>;
  setMicrophone(on: boolean): Promise<void>;
  setCamera(on: boolean): Promise<void>;
  /** Where this listener hears the call. Not every browser allows a choice. */
  listAudioOutputs(): Promise<MediaDevice[]>;
  setAudioOutput(deviceId: string): Promise<void>;
  /** Silence one person for this listener only; nobody else is affected. */
  setMutedForMe(identity: string, muted: boolean): Promise<void>;
  /** Render a participant's video into an element, or clear it with null. */
  attachVideo(identity: string, element: HTMLVideoElement | null): void;
  /** Called on every change of participants or connection state. */
  onChange(listener: (snapshot: MediaSnapshot) => void): () => void;
}

export interface MediaSnapshot {
  participants: MediaParticipant[];
  /** Set when the call dropped or could not be joined. Never blocks the game. */
  error: string | null;
  connected: boolean;
  reconnecting: boolean;
}

export type MediaSessionFactory = () => Promise<MediaSession>;
