import type {
  MediaCredentials,
  MediaDevice,
  MediaParticipant,
} from "@card-game/shared-types";
import type { MediaSession, MediaSnapshot } from "./types";

/**
 * The LiveKit adapter. It is the only file that knows LiveKit exists, and it is
 * imported on demand so a table without a call never loads it.
 *
 * Everything here is defensive: a failure turns into an error on the snapshot,
 * never an exception into the game UI.
 */
export async function createLiveKitSession(): Promise<MediaSession> {
  const { Room, RoomEvent, Track, ConnectionState } = await import(
    "livekit-client"
  );

  let room: InstanceType<typeof Room> | null = null;
  let error: string | null = null;
  const listeners = new Set<(snapshot: MediaSnapshot) => void>();
  const speaking = new Set<string>();
  const mutedForMe = new Set<string>();
  const seatOf = (identity: string) => {
    const match = /^seat-(\d+)$/.exec(identity);
    return match ? Number(match[1]) : -1;
  };

  function snapshot(): MediaSnapshot {
    const state = room?.state;
    const people: MediaParticipant[] = [];
    if (room) {
      const all = [
        room.localParticipant,
        ...Array.from(room.remoteParticipants.values()),
      ];
      for (const person of all) {
        const isLocal = person === room.localParticipant;
        people.push({
          identity: person.identity,
          seatIndex: seatOf(person.identity),
          displayName: person.name || person.identity,
          isLocal,
          microphoneOn: person.isMicrophoneEnabled,
          cameraOn: person.isCameraEnabled,
          speaking: speaking.has(person.identity),
          mutedForMe: mutedForMe.has(person.identity),
          connection:
            state === ConnectionState.Reconnecting
              ? "reconnecting"
              : state === ConnectionState.Connected
                ? "connected"
                : "disconnected",
        });
      }
      people.sort((a, b) => a.seatIndex - b.seatIndex);
    }
    return {
      participants: people,
      error,
      connected: state === ConnectionState.Connected,
      reconnecting: state === ConnectionState.Reconnecting,
    };
  }
  const publish = () => {
    const next = snapshot();
    for (const listener of listeners) listener(next);
  };

  return {
    async connect(credentials: MediaCredentials) {
      error = null;
      // Adaptive streaming and simulcast let the SFU drop video first when a
      // phone's connection degrades, so audio survives a weak network.
      room = new Room({ adaptiveStream: true, dynacast: true });
      for (const name of [
        RoomEvent.ParticipantConnected,
        RoomEvent.ParticipantDisconnected,
        RoomEvent.TrackSubscribed,
        RoomEvent.TrackUnsubscribed,
        RoomEvent.TrackMuted,
        RoomEvent.TrackUnmuted,
        RoomEvent.LocalTrackPublished,
        RoomEvent.LocalTrackUnpublished,
        RoomEvent.ConnectionStateChanged,
        RoomEvent.Reconnecting,
        RoomEvent.Reconnected,
      ])
        room.on(name as never, publish as never);
      room.on(RoomEvent.ActiveSpeakersChanged, (speakers) => {
        speaking.clear();
        for (const speaker of speakers) speaking.add(speaker.identity);
        publish();
      });
      room.on(RoomEvent.Disconnected, (reason) => {
        error = reason ? "The call ended. The game is unaffected." : null;
        publish();
      });
      try {
        await room.connect(credentials.url, credentials.token);
      } catch (cause) {
        error =
          cause instanceof Error
            ? `Could not join the call: ${cause.message}`
            : "Could not join the call.";
        room = null;
      }
      publish();
    },
    async disconnect() {
      const leaving = room;
      room = null;
      error = null;
      speaking.clear();
      mutedForMe.clear();
      publish();
      await leaving?.disconnect().catch(() => {});
    },
    async setMicrophone(on: boolean) {
      try {
        await room?.localParticipant.setMicrophoneEnabled(on);
      } catch (cause) {
        error =
          cause instanceof Error
            ? `Microphone unavailable: ${cause.message}`
            : "Microphone unavailable.";
      }
      publish();
    },
    async setCamera(on: boolean) {
      try {
        await room?.localParticipant.setCameraEnabled(on);
      } catch (cause) {
        error =
          cause instanceof Error
            ? `Camera unavailable: ${cause.message}`
            : "Camera unavailable.";
      }
      publish();
    },
    async listAudioOutputs(): Promise<MediaDevice[]> {
      try {
        const devices = await Room.getLocalDevices("audiooutput");
        return devices
          .filter((device) => device.deviceId)
          .map((device, index) => ({
            deviceId: device.deviceId,
            label: device.label || `Output ${index + 1}`,
          }));
      } catch {
        // Safari on iOS does not let a page choose the output.
        return [];
      }
    },
    async setAudioOutput(deviceId: string) {
      try {
        await room?.switchActiveDevice("audiooutput", deviceId);
      } catch (cause) {
        error =
          cause instanceof Error
            ? `Could not switch output: ${cause.message}`
            : "Could not switch output.";
      }
      publish();
    },
    async setMutedForMe(identity: string, muted: boolean) {
      if (muted) mutedForMe.add(identity);
      else mutedForMe.delete(identity);
      const person = room?.remoteParticipants.get(identity);
      try {
        person?.setVolume(muted ? 0 : 1);
      } catch {
        // Volume control is best effort; the flag still reflects the choice.
      }
      publish();
    },
    attachVideo(identity: string, element: HTMLElement | null) {
      if (!room) return;
      const person =
        room.localParticipant.identity === identity
          ? room.localParticipant
          : room.remoteParticipants.get(identity);
      const publication = person?.getTrackPublication(Track.Source.Camera);
      const track = publication?.track;
      if (!track) return;
      if (element) track.attach(element as HTMLVideoElement);
      else track.detach();
    },
    onChange(listener) {
      listeners.add(listener);
      listener(snapshot());
      return () => listeners.delete(listener);
    },
  };
}
