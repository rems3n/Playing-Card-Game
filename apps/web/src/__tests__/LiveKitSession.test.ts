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
const room = vi.hoisted(() => ({ switchFails: true, connectFails: false }));

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
    on() {
      return this;
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
    Track: { Source: { Camera: "camera" } },
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
