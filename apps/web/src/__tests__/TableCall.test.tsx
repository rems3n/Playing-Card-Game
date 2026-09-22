import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type {
  MediaCredentials,
  MediaParticipant,
} from "@card-game/shared-types";
import type { MediaSession, MediaSnapshot } from "@/lib/media/types";
import { useMedia } from "@/hooks/useMedia";
import { MediaPanel } from "../components/game/MediaPanel";

const transport = vi.hoisted(() => {
  const handlers = new Map<string, Set<(value: any) => void>>();
  return {
    handlers,
    emit: vi.fn(),
    on: (event: string, callback: (value: any) => void) => {
      if (!handlers.has(event)) handlers.set(event, new Set());
      handlers.get(event)!.add(callback);
    },
    off: (event: string, callback: (value: any) => void) => {
      handlers.get(event)?.delete(callback);
    },
    deliver(event: string, value: any) {
      for (const callback of handlers.get(event) ?? []) callback(value);
    },
    reset() {
      handlers.clear();
      this.emit.mockClear();
    },
  };
});
vi.mock("@/hooks/useSocket", () => ({ useSocket: () => transport }));

const credentials: MediaCredentials = {
  provider: "test",
  url: "wss://media.example",
  token: "token",
  roomName: "table-1",
  identity: "seat-0",
  displayName: "You",
  seatIndex: 0,
  expiresAt: Date.now() + 60_000,
};

function person(
  seatIndex: number,
  overrides: Partial<MediaParticipant> = {},
): MediaParticipant {
  return {
    identity: `seat-${seatIndex}`,
    seatIndex,
    displayName: `Player ${seatIndex}`,
    isLocal: seatIndex === 0,
    microphoneOn: false,
    cameraOn: false,
    speaking: false,
    connection: "connected",
    mutedForMe: false,
    ...overrides,
  };
}

/** A call with no browser, no camera and no server. */
function fakeSession() {
  const listeners = new Set<(snapshot: MediaSnapshot) => void>();
  const calls = {
    connect: 0,
    disconnect: 0,
    microphone: [] as boolean[],
    camera: [] as boolean[],
    attached: [] as Array<[string, boolean]>,
    outputs: [] as string[],
    mutedForMe: [] as Array<[string, boolean]>,
  };
  let outputs = [
    { deviceId: "default", label: "Phone speaker" },
    { deviceId: "bt", label: "Headphones" },
  ];
  let snapshot: MediaSnapshot = {
    participants: [],
    error: null,
    notice: null,
    connected: false,
    reconnecting: false,
  };
  // The real session refuses to switch the speaker on browsers without
  // setSinkId, which is what a phone does.
  let outputFails = false;
  const publish = (next: Partial<MediaSnapshot>) => {
    // A notice is delivered once, exactly as the LiveKit session does it.
    snapshot = { ...snapshot, notice: null, ...next };
    for (const listener of listeners) listener(snapshot);
  };
  const session: MediaSession = {
    async connect() {
      calls.connect++;
      publish({ connected: true, participants: [person(0)] });
    },
    async disconnect() {
      calls.disconnect++;
      publish({ connected: false, reconnecting: false, participants: [], error: null });
    },
    async setMicrophone(on) {
      calls.microphone.push(on);
      publish({
        participants: snapshot.participants.map((p) =>
          p.isLocal ? { ...p, microphoneOn: on } : p,
        ),
      });
    },
    async setCamera(on) {
      calls.camera.push(on);
      publish({
        participants: snapshot.participants.map((p) =>
          p.isLocal ? { ...p, cameraOn: on } : p,
        ),
      });
    },
    async listAudioOutputs() {
      return outputs;
    },
    async setAudioOutput(deviceId) {
      calls.outputs.push(deviceId);
      if (outputFails)
        publish({ notice: "Could not switch the speaker: not supported." });
    },
    async setMutedForMe(identity, muted) {
      calls.mutedForMe.push([identity, muted]);
      publish({
        participants: snapshot.participants.map((p) =>
          p.identity === identity ? { ...p, mutedForMe: muted } : p,
        ),
      });
    },
    attachVideo(identity, element) {
      calls.attached.push([identity, !!element]);
    },
    onChange(listener) {
      listeners.add(listener);
      listener(snapshot);
      return () => listeners.delete(listener);
    },
  };
  return {
    session,
    calls,
    publish,
    withoutOutputs() {
      outputs = [];
      return this;
    },
    withFailingOutput() {
      outputFails = true;
      return this;
    },
    get connected() {
      return snapshot.connected;
    },
  };
}

function Harness({
  create,
  enabled = true,
  currentPlayerSeat = 0,
}: {
  create: () => Promise<MediaSession>;
  enabled?: boolean;
  currentPlayerSeat?: number;
}) {
  const media = useMedia({ gameId: "game-1", enabled, createSession: create });
  return (
    <MediaPanel
      media={media}
      currentPlayerSeat={currentPlayerSeat}
      open
      onOpenChange={() => {}}
    />
  );
}

async function joinCall(fake: ReturnType<typeof fakeSession>) {
  const user = userEvent.setup();
  render(<Harness create={async () => fake.session} />);
  await user.click(screen.getByRole("button", { name: "Join the call" }));
  expect(transport.emit).toHaveBeenCalledWith("media:token", {
    gameId: "game-1",
  });
  await act(async () => {
    transport.deliver("media:credentials", credentials);
  });
  await waitFor(() => expect(fake.calls.connect).toBe(1));
  return user;
}

describe("the table call", () => {
  beforeEach(() => transport.reset());

  it("keeps the call running when the browser refuses to switch the speaker", async () => {
    const fake = fakeSession().withFailingOutput();
    const user = await joinCall(fake);
    await user.click(screen.getByRole("button", { name: "Camera on" }));
    await waitFor(() => expect(fake.calls.camera).toEqual([true]));

    await user.selectOptions(screen.getByLabelText("Sound out"), "bt");

    // The message is said out loud...
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain(
        "Could not switch the speaker",
      ),
    );
    // ...and nothing else changes: the call is still up, the camera is still
    // publishing, and the player is not told they have left.
    expect(screen.getByRole("status").textContent).toContain("in the call");
    expect(screen.queryByText(/not connected/i)).toBeNull();
    expect(screen.queryByRole("button", { name: "Join the call" })).toBeNull();
    expect(fake.calls.disconnect).toBe(0);
    expect(fake.connected).toBe(true);
    expect(fake.calls.camera).toEqual([true]);
  });

  it("really leaves the room whenever it says the call is not connected", async () => {
    const fake = fakeSession();
    const user = await joinCall(fake);
    await user.click(screen.getByRole("button", { name: "Camera on" }));
    await waitFor(() => expect(fake.calls.camera).toEqual([true]));

    await act(async () => {
      fake.publish({ error: "The call ended. The game is unaffected." });
    });

    await waitFor(() =>
      expect(screen.getByRole("status").textContent).toContain(
        "The call is not connected",
      ),
    );
    // The screen said the call is over, so the room must be gone with it.
    await waitFor(() => expect(fake.calls.disconnect).toBe(1));
    expect(fake.connected).toBe(false);

    // And rejoining has to work, rather than silently doing nothing.
    transport.emit.mockClear();
    await user.click(screen.getByRole("button", { name: "Join the call" }));
    expect(transport.emit).toHaveBeenCalledWith("media:token", {
      gameId: "game-1",
    });
    await act(async () => {
      transport.deliver("media:credentials", credentials);
    });
    await waitFor(() => expect(fake.calls.connect).toBe(2));
    expect(screen.getByRole("status").textContent).toContain("in the call");
  });

  it("asks the server for credentials and starts with the microphone and camera off", async () => {
    const fake = fakeSession();
    await joinCall(fake);
    expect(await screen.findByText("1 in the call")).toBeTruthy();
    expect(fake.calls.microphone).toEqual([]);
    expect(fake.calls.camera).toEqual([]);
    expect(
      (screen.getByRole("button", { name: "Unmute" }) as HTMLButtonElement)
        .ariaPressed,
    ).toBe("false");
    expect(
      (screen.getByRole("button", { name: "Camera on" }) as HTMLButtonElement)
        .ariaPressed,
    ).toBe("false");
  });

  it("turns the microphone and camera on and off again", async () => {
    const fake = fakeSession();
    const user = await joinCall(fake);
    await user.click(screen.getByRole("button", { name: "Unmute" }));
    await waitFor(() => expect(fake.calls.microphone).toEqual([true]));
    await user.click(await screen.findByRole("button", { name: "Mute" }));
    await waitFor(() => expect(fake.calls.microphone).toEqual([true, false]));
    await user.click(screen.getByRole("button", { name: "Camera on" }));
    await waitFor(() => expect(fake.calls.camera).toEqual([true]));
    await user.click(await screen.findByRole("button", { name: "Camera off" }));
    await waitFor(() => expect(fake.calls.camera).toEqual([true, false]));
  });

  it("lists everyone with their names and connection state", async () => {
    const fake = fakeSession();
    await joinCall(fake);
    await act(async () => {
      fake.publish({
        participants: [
          person(0, { microphoneOn: true }),
          person(1, { displayName: "Ada", speaking: true }),
          person(2, { displayName: "Bo", connection: "reconnecting" }),
        ],
      });
    });
    expect(await screen.findByText("3 in the call")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: /Player 0 \(you\)\. Microphone on/ }),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: /Ada\. Microphone off/ })).toBeTruthy();
    const reconnecting = screen.getByRole("button", { name: /Bo\. Reconnecting/ });
    expect(reconnecting.textContent).toContain("Reconnecting");
  });

  it("shows the caller whose turn it is and lets one person be pinned", async () => {
    const fake = fakeSession();
    const user = userEvent.setup();
    render(<Harness create={async () => fake.session} currentPlayerSeat={1} />);
    await user.click(screen.getByRole("button", { name: "Join the call" }));
    await act(async () => {
      transport.deliver("media:credentials", credentials);
    });
    await act(async () => {
      fake.publish({ participants: [person(0), person(1, { displayName: "Ada" })] });
    });
    const ada = await screen.findByRole("button", { name: /Ada\./ });
    expect(ada.className).toContain("their-turn");
    expect(ada.getAttribute("aria-pressed")).toBe("false");
    await user.click(ada);
    expect(ada.getAttribute("aria-pressed")).toBe("true");
    expect(ada.className).toContain("pinned");
    await user.click(ada);
    expect(ada.getAttribute("aria-pressed")).toBe("false");
  });

  it("leaves the call without touching the game socket", async () => {
    const fake = fakeSession();
    const user = await joinCall(fake);
    transport.emit.mockClear();
    await user.click(screen.getByRole("button", { name: "Leave call" }));
    await waitFor(() => expect(fake.calls.disconnect).toBe(1));
    expect(transport.emit).not.toHaveBeenCalled();
    expect(
      await screen.findByRole("button", { name: "Join the call" }),
    ).toBeTruthy();
    expect(screen.getByText("You are not in the call")).toBeTruthy();
  });

  it("reports a refusal from the server and offers to try again", async () => {
    const user = userEvent.setup();
    render(<Harness create={async () => fakeSession().session} />);
    await user.click(screen.getByRole("button", { name: "Join the call" }));
    await act(async () => {
      transport.deliver("media:error", {
        code: "MEDIA_NOT_SEATED",
        message: "You are not at this table",
      });
    });
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("You are not at this table");
    expect(alert.textContent).toContain("You can keep playing");
    expect(screen.getByRole("button", { name: "Join the call" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("survives a provider that cannot be loaded at all", async () => {
    const user = userEvent.setup();
    render(
      <Harness
        create={async () => {
          throw new Error("network down");
        }}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Join the call" }));
    await act(async () => {
      transport.deliver("media:credentials", credentials);
    });
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("network down");
    expect(screen.getByRole("button", { name: "Join the call" })).toBeTruthy();
  });

  it("shows a dropped call as an error and keeps the join control", async () => {
    const fake = fakeSession();
    await joinCall(fake);
    await act(async () => {
      fake.publish({ connected: false, error: "The call ended." });
    });
    expect((await screen.findByRole("alert")).textContent).toContain(
      "The call ended.",
    );
    expect(screen.getByText("The call is not connected")).toBeTruthy();
  });

  it("offers an output choice only where the browser has one", async () => {
    const fake = fakeSession();
    const user = await joinCall(fake);
    const output = await screen.findByLabelText("Sound out");
    await user.selectOptions(output, "bt");
    expect(fake.calls.outputs).toEqual(["bt"]);

    cleanup();
    transport.reset();
    const bare = fakeSession().withoutOutputs();
    await joinCall(bare);
    expect(screen.queryByLabelText("Sound out")).toBeNull();
  });

  it("silences one person for this listener only", async () => {
    const fake = fakeSession();
    const user = await joinCall(fake);
    await act(async () => {
      fake.publish({
        participants: [person(0), person(1, { displayName: "Ada" })],
      });
    });
    const ada = await screen.findByRole("button", { name: /Ada\./ });
    // Local mute belongs to the person being looked at, so pin them first.
    expect(screen.queryByRole("button", { name: /Silence Ada/ })).toBeNull();
    await user.click(ada);
    await user.click(
      await screen.findByRole("button", { name: "Silence Ada for me" }),
    );
    expect(fake.calls.mutedForMe).toEqual([["seat-1", true]]);
    const restore = await screen.findByRole("button", {
      name: "Hear Ada again",
    });
    expect(restore.getAttribute("aria-pressed")).toBe("true");
    expect(
      screen.getByRole("button", { name: /Ada\. Silenced for you/ }),
    ).toBeTruthy();
    await user.click(restore);
    expect(fake.calls.mutedForMe).toEqual([
      ["seat-1", true],
      ["seat-1", false],
    ]);
  });

  it("does not offer to silence yourself", async () => {
    const fake = fakeSession();
    const user = await joinCall(fake);
    const me = await screen.findByRole("button", { name: /Player 0 \(you\)/ });
    await user.click(me);
    expect(screen.queryByRole("button", { name: /Silence/ })).toBeNull();
  });

  it("renders nothing when the server has no provider", () => {
    const { container } = render(
      <Harness create={async () => fakeSession().session} enabled={false} />,
    );
    expect(container.firstChild).toBeNull();
    expect(transport.emit).not.toHaveBeenCalled();
  });
});
