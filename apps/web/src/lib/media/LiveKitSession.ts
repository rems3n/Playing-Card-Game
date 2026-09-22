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
/** iPhone and iPad, including an iPad that presents itself as a Mac. */
function isApplePhoneOrTablet(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent ?? "";
  return (
    /iP(hone|ad|od)/.test(ua) ||
    (/Macintosh/.test(ua) && (navigator.maxTouchPoints ?? 0) > 1)
  );
}

export async function createLiveKitSession(): Promise<MediaSession> {
  const { Room, RoomEvent, Track, ConnectionState } = await import(
    "livekit-client"
  );

  let room: InstanceType<typeof Room> | null = null;
  // `error` means the call is over. `notice` means one control failed and the
  // call is still running. Conflating them once told a player their call had
  // ended while their camera was still publishing to everyone else.
  let error: string | null = null;
  let notice: string | null = null;
  // Sound is not automatic. A subscribed audio track plays only once it is
  // attached to an element, and a browser may still hold playback back until
  // the player taps something. Without both, a call is video only.
  let audioBlocked = false;
  const audioElements = new Map<string, HTMLMediaElement[]>();
  let audioHost: HTMLElement | null = null;
  const playAudio = (track: { sid?: string; attach(): HTMLMediaElement }) => {
    if (typeof document === "undefined") return;
    if (!audioHost) {
      audioHost = document.createElement("div");
      audioHost.setAttribute("aria-hidden", "true");
      audioHost.style.display = "none";
      document.body.appendChild(audioHost);
    }
    const element = track.attach();
    audioHost.appendChild(element);
    const key = track.sid ?? String(audioElements.size);
    audioElements.set(key, [...(audioElements.get(key) ?? []), element]);
  };
  const stopAudio = (track: { sid?: string; detach(): HTMLMediaElement[] }) => {
    for (const element of track.detach()) element.remove();
    if (track.sid) audioElements.delete(track.sid);
  };
  const stopAllAudio = () => {
    for (const elements of audioElements.values())
      for (const element of elements) {
        element.pause();
        element.remove();
      }
    audioElements.clear();
    audioHost?.remove();
    audioHost = null;
  };
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
        // A camera counts as on only once its track is here. It is published
        // before this browser subscribes, and a tile drawn in that gap had
        // nothing to attach, so a phone showed the other person's tile blank.
        const camera = person.getTrackPublication(Track.Source.Camera);
        people.push({
          identity: person.identity,
          seatIndex: seatOf(person.identity),
          displayName: person.name || person.identity,
          isLocal,
          microphoneOn: person.isMicrophoneEnabled,
          cameraOn: !!camera && !camera.isMuted && !!camera.track,
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
      notice,
      connected: state === ConnectionState.Connected,
      reconnecting: state === ConnectionState.Reconnecting,
      audioBlocked,
    };
  }
  const publish = () => {
    const next = snapshot();
    // A notice is an event, not a state: delivered once, so dismissing it does
    // not bring it back on the next participant change.
    notice = null;
    for (const listener of listeners) listener(next);
  };

  return {
    async connect(credentials: MediaCredentials) {
      error = null;
      notice = null;
      // Adaptive streaming and simulcast let the SFU drop video first when a
      // phone's connection degrades, so audio survives a weak network.
      room = new Room({ adaptiveStream: true, dynacast: true });
      room
        .on(RoomEvent.ParticipantConnected, publish)
        .on(RoomEvent.ParticipantDisconnected, publish)
        .on(RoomEvent.TrackSubscribed, publish)
        .on(RoomEvent.TrackUnsubscribed, publish)
        .on(RoomEvent.TrackMuted, publish)
        .on(RoomEvent.TrackUnmuted, publish)
        .on(RoomEvent.LocalTrackPublished, publish)
        .on(RoomEvent.LocalTrackUnpublished, publish)
        .on(RoomEvent.ConnectionStateChanged, publish)
        .on(RoomEvent.Reconnecting, publish)
        .on(RoomEvent.Reconnected, publish);
      // Remote sound: attach when it arrives, detach when it goes.
      room.on(RoomEvent.TrackSubscribed, (track) => {
        if (track.kind === Track.Kind.Audio) playAudio(track);
      });
      room.on(RoomEvent.TrackUnsubscribed, (track) => {
        if (track.kind === Track.Kind.Audio) stopAudio(track);
      });
      room.on(RoomEvent.AudioPlaybackStatusChanged, () => {
        audioBlocked = !room?.canPlaybackAudio;
        publish();
      });
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
        // Joining is a tap, so this usually lifts the autoplay block at once.
        await room.startAudio().catch(() => {});
        audioBlocked = !room.canPlaybackAudio;
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
      notice = null;
      audioBlocked = false;
      stopAllAudio();
      speaking.clear();
      mutedForMe.clear();
      publish();
      await leaving?.disconnect().catch(() => {});
    },
    async setMicrophone(on: boolean) {
      try {
        await room?.localParticipant.setMicrophoneEnabled(on);
      } catch (cause) {
        notice =
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
        notice =
          cause instanceof Error
            ? `Camera unavailable: ${cause.message}`
            : "Camera unavailable.";
      }
      publish();
    },
    async listAudioOutputs(): Promise<MediaDevice[]> {
      // Choosing an output needs setSinkId, and even where iOS exposes it the
      // system routes sound itself (speaker, headphones, Bluetooth), so a page
      // cannot. Offering a control that can only fail is how a harmless tap
      // once looked like a dropped call.
      if (
        typeof HTMLMediaElement === "undefined" ||
        !("setSinkId" in HTMLMediaElement.prototype) ||
        isApplePhoneOrTablet()
      )
        return [];
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
        notice =
          cause instanceof Error
            ? `Could not switch the speaker: ${cause.message}`
            : "Could not switch the speaker.";
      }
      publish();
    },
    async startAudio() {
      if (!room) return;
      try {
        await room.startAudio();
      } catch {
        // The status event below says whether it worked.
      }
      audioBlocked = !room.canPlaybackAudio;
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
    attachVideo(identity: string, element: HTMLVideoElement | null) {
      if (!room) return;
      const person =
        room.localParticipant.identity === identity
          ? room.localParticipant
          : room.remoteParticipants.get(identity);
      const publication = person?.getTrackPublication(Track.Source.Camera);
      const track = publication?.track;
      if (!track) return;
      if (element) track.attach(element);
      else track.detach();
    },
    onChange(listener) {
      listeners.add(listener);
      listener(snapshot());
      return () => listeners.delete(listener);
    },
  };
}
