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
  /**
   * The call is over: it dropped, or it could not be joined. Whoever reads
   * this must assume nothing is being published any more, so only report it
   * when that is true. Never blocks the game.
   */
  error: string | null;
  /**
   * Something failed without ending the call — a speaker this browser will
   * not switch, a camera it will not open. The call carries on, and saying
   * otherwise would tell a player they had left while still on air.
   * Delivered once, not held.
   */
  notice: string | null;
  connected: boolean;
  reconnecting: boolean;
}

export type MediaSessionFactory = () => Promise<MediaSession>;
