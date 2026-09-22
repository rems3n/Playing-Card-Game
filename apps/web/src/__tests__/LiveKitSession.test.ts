import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MediaCredentials } from "@card-game/shared-types";
import type { MediaSnapshot } from "@/lib/media/types";

/**
 * The LiveKit adapter against a stand-in for the SDK.
 *
 * These cover the line between a call that has ended and a control that
 * refused: getting it wrong told a player on a phone that their call was over
 * while their camera was still publishing to everyone else at the table.
 */
const room = vi.hoisted(() => ({
  switchFails: true,
  connectFails: false,
  playbackAllowed: true,
  /** The most recent Room, so a test can raise SDK events on it. */
  last: null as null | { emit(event: string, ...args: unknown[]): void },
}));

/** A remote audio track as the SDK hands it over: attach makes an element. */
function audioTrack(sid: string) {
  const elements: HTMLMediaElement[] = [];
  return {
    kind: "audio",
    sid,
    attach() {
      const element = document.createElement("audio");
      elements.push(element);
      return element;
    },
    detach() {
      return elements.splice(0);
    },
  };
}

vi.mock("livekit-client", () => {
  class Room {
    static async getLocalDevices() {
      return [
        { deviceId: "speaker", label: "Phone speaker" },
        { deviceId: "bt", label: "Headphones" },
      ];
    }
    state = "disconnected";
    localParticipant = {
      identity: "seat-0",
      name: "You",
      isMicrophoneEnabled: false,
      isCameraEnabled: false,
      getTrackPublication: () => undefined,
      setMicrophoneEnabled: async () => {},
      setCameraEnabled: async () => {},
    };
    remoteParticipants = new Map();
    handlers = new Map<string, Array<(...args: unknown[]) => void>>();
    on(event: string, handler: (...args: unknown[]) => void) {
      this.handlers.set(event, [...(this.handlers.get(event) ?? []), handler]);
      return this;
    }
    emit(event: string, ...args: unknown[]) {
      for (const handler of this.handlers.get(event) ?? []) handler(...args);
    }
    get canPlaybackAudio() {
      return room.playbackAllowed;
    }
    startAudio = async () => {
      if (!room.playbackAllowed) throw new Error("autoplay blocked");
    };
    constructor() {
      room.last = this;
    }
    async connect() {
      if (room.connectFails) throw new Error("no route to host");
      this.state = "connected";
    }
    async disconnect() {
      this.state = "disconnected";
    }
    async switchActiveDevice() {
      if (room.switchFails) throw new Error("not supported in this browser");
    }
  }
  return {
    Room,
    RoomEvent: new Proxy({}, { get: (_target, key) => String(key) }),
    Track: { Source: { Camera: "camera" }, Kind: { Audio: "audio", Video: "video" } },
    ConnectionState: {
      Connected: "connected",
      Reconnecting: "reconnecting",
      Disconnected: "disconnected",
    },
  };
});

const { createLiveKitSession } = await import("@/lib/media/LiveKitSession");

const credentials: MediaCredentials = {
  provider: "livekit",
  url: "wss://media.example",
  token: "token",
  roomName: "table-1",
  identity: "seat-0",
  displayName: "You",
  seatIndex: 0,
  expiresAt: Date.now() + 60_000,
};

async function connected() {
  const session = await createLiveKitSession();
  const seen: MediaSnapshot[] = [];
  session.onChange((snapshot) => seen.push(snapshot));
  await session.connect(credentials);
  return { session, seen, last: () => seen[seen.length - 1] };
}

beforeEach(() => {
  room.switchFails = true;
  room.connectFails = false;
  room.playbackAllowed = true;
  document.body.innerHTML = "";
});

describe("hearing the call", () => {
  it("plays a subscribed audio track and stops it when it goes", async () => {
    const { session, last } = await connected();
    // Nothing plays on its own: an audio track has to be attached somewhere.
    expect(document.querySelectorAll("audio")).toHaveLength(0);
    const voice = audioTrack("TR_voice");
    room.last!.emit("TrackSubscribed", voice);
    const playing = document.querySelectorAll("audio");
    expect(playing).toHaveLength(1);
    // Out of sight but in the document, so no browser garbage-collects it.
    expect(playing[0].closest("[aria-hidden=true]")).not.toBeNull();
    expect(last().connected).toBe(true);

    room.last!.emit("TrackUnsubscribed", voice);
    expect(document.querySelectorAll("audio")).toHaveLength(0);

    room.last!.emit("TrackSubscribed", audioTrack("TR_again"));
    expect(document.querySelectorAll("audio")).toHaveLength(1);
    await session.disconnect();
    expect(document.querySelectorAll("audio")).toHaveLength(0);
  });

  it("shows a camera only once its track has arrived", async () => {
    const { last } = await connected();
    // Published, not yet subscribed: what a phone sees for a moment after
    // the other person turns their camera on.
    const publication: { isMuted: boolean; track?: object } = { isMuted: false };
    const other = {
      identity: "seat-1",
      name: "Ada",
      isMicrophoneEnabled: true,
      isCameraEnabled: true,
      getTrackPublication: () => publication,
    };
    (room.last as unknown as { remoteParticipants: Map<string, unknown> }).remoteParticipants.set("seat-1", other);
    room.last!.emit("ActiveSpeakersChanged", []);
    expect(last().participants.find((p) => p.identity === "seat-1")?.cameraOn).toBe(false);

    publication.track = {};
    room.last!.emit("TrackSubscribed", { kind: "video", sid: "TR_cam", attach: () => document.createElement("video"), detach: () => [] });
    expect(last().participants.find((p) => p.identity === "seat-1")?.cameraOn).toBe(true);
  });

  it("ignores video when deciding what to play", async () => {
    await connected();
    room.last!.emit("TrackSubscribed", { kind: "video", sid: "TR_cam", attach: () => document.createElement("video"), detach: () => [] });
    expect(document.querySelectorAll("audio")).toHaveLength(0);
  });

  it("says when the browser is holding the sound back, and lifts it on request", async () => {
    room.playbackAllowed = false;
    const { session, last } = await connected();
    expect(last().audioBlocked).toBe(true);
    expect(last().connected).toBe(true);
    // The tap that lifts the block arrives as a status change from the SDK.
    room.playbackAllowed = true;
    await session.startAudio();
    expect(last().audioBlocked).toBe(false);
  });

  it("reflects a block the SDK reports after joining", async () => {
    const { last } = await connected();
    expect(last().audioBlocked).toBe(false);
    room.playbackAllowed = false;
    room.last!.emit("AudioPlaybackStatusChanged");
    expect(last().audioBlocked).toBe(true);
  });
});

describe("the LiveKit adapter", () => {
  it("reports a speaker it cannot switch without ending the call", async () => {
    const { session, last } = await connected();
    expect(last()).toMatchObject({ connected: true, error: null });

    await session.setAudioOutput("bt");

    const after = last();
    expect(after.notice).toMatch(/Could not switch the speaker/);
    // The two that matter: the call is not over, and nothing says it is.
    expect(after.error).toBeNull();
    expect(after.connected).toBe(true);
  });

  it("delivers a notice once instead of holding it", async () => {
    const { session, last } = await connected();
    await session.setAudioOutput("bt");
    expect(last().notice).toBeTruthy();
    // Any later change must not raise the same notice again, or dismissing it
    // would be undone by the next person to join.
    await session.setMutedForMe("seat-1", true);
    expect(last().notice).toBeNull();
    expect(last().connected).toBe(true);
  });

  it("reports a call it could not join as an error, not a notice", async () => {
    room.connectFails = true;
    const { last } = await connected();
    expect(last().error).toMatch(/Could not join the call/);
    expect(last().notice).toBeNull();
    expect(last().connected).toBe(false);
  });

  it("offers no speaker choice where the browser cannot switch one", async () => {
    const { session } = await connected();
    // jsdom has no setSinkId, which is the situation on a phone.
    expect("setSinkId" in HTMLMediaElement.prototype).toBe(false);
    expect(await session.listAudioOutputs()).toEqual([]);

    Object.defineProperty(HTMLMediaElement.prototype, "setSinkId", {
      value: async () => {},
      configurable: true,
    });
    try {
      expect(await session.listAudioOutputs()).toEqual([
        { deviceId: "speaker", label: "Phone speaker" },
        { deviceId: "bt", label: "Headphones" },
      ]);
    } finally {
      delete (HTMLMediaElement.prototype as { setSinkId?: unknown }).setSinkId;
    }
  });
});
