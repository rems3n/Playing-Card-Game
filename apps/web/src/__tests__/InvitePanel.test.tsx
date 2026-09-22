import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  deviceInviteLink,
  InvitePanel,
  inviteText,
} from "../components/lobby/InvitePanel";

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

function setup(canSend: Array<"email" | "sms"> = []) {
  const opened: string[] = [];
  render(
    <InvitePanel
      roomId="a1b2c3d4"
      gameName="Seven-Six"
      myName="Ada"
      canSend={canSend}
      open={(href) => opened.push(href)}
    />,
  );
  return { opened, user: userEvent.setup() };
}

describe("the invitation message", () => {
  it("names the sender, the game, the link and the code", () => {
    const { subject, body } = inviteText(
      "Seven-Six",
      "Ada",
      "https://play.example/room/a1b2c3d4",
      "a1b2c3d4",
    );
    expect(subject).toBe("Ada invited you to a game of Seven-Six");
    expect(body).toContain("https://play.example/room/a1b2c3d4");
    expect(body).toContain("a1b2c3d4");
    expect(inviteText("Seven-Six", "   ", "l", "c").subject).toBe(
      "Someone invited you to a game of Seven-Six",
    );
  });

  it("builds a mail link and a message link the device can open", () => {
    const mail = deviceInviteLink("email", " them@example.com ", "Sub ject", "a b");
    expect(mail.startsWith("mailto:them%40example.com?subject=Sub%20ject")).toBe(
      true,
    );
    expect(mail).toContain("body=a%20b");
    const sms = deviceInviteLink("sms", "+353 87 123 4567", "s", "come play");
    expect(sms.startsWith("sms:+353871234567?&body=")).toBe(true);
    expect(sms).toContain("come%20play");
  });
});

describe("inviting someone from the lobby", () => {
  beforeEach(() => transport.reset());

  it("opens the player's own email app when the server cannot send", async () => {
    const { opened, user } = setup([]);
    expect(
      screen.getByText(/opens your own email app/i),
    ).toBeTruthy();
    await user.type(screen.getByLabelText("Email address"), "them@example.com");
    await user.click(screen.getByRole("button", { name: "Send invitation" }));
    expect(transport.emit).not.toHaveBeenCalled();
    expect(opened).toHaveLength(1);
    expect(opened[0]).toContain("mailto:them%40example.com");
    expect(screen.getByRole("status").textContent).toContain(
      "email app should open",
    );
  });

  it("switches to a phone number and opens the messaging app", async () => {
    const { opened, user } = setup([]);
    await user.click(screen.getByRole("button", { name: "Phone" }));
    await user.type(screen.getByLabelText("Phone number"), "+353871234567");
    await user.click(screen.getByRole("button", { name: "Send invitation" }));
    expect(opened[0]).toContain("sms:+353871234567");
    expect(screen.getByRole("status").textContent).toContain("messaging app");
  });

  it("asks the server to send where the server can, and clears on success", async () => {
    const { opened, user } = setup(["email"]);
    expect(screen.getByText("The invitation is sent for you.")).toBeTruthy();
    const field = screen.getByLabelText("Email address") as HTMLInputElement;
    await user.type(field, "them@example.com");
    await user.click(screen.getByRole("button", { name: "Send invitation" }));
    expect(opened).toEqual([]);
    expect(transport.emit).toHaveBeenCalledWith("room:send_invite", {
      roomId: "a1b2c3d4",
      channel: "email",
      to: "them@example.com",
    });
    expect(
      (screen.getByRole("button", { name: "Sending…" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    await act(async () => {
      transport.deliver("room:invite_sent", {
        channel: "email",
        to: "them@example.com",
      });
    });
    expect(field.value).toBe("");
    expect(screen.getByRole("status").textContent).toContain(
      "Invitation sent to them@example.com",
    );
  });

  it("falls back to the device for a channel the server does not send", async () => {
    const { opened, user } = setup(["email"]);
    await user.click(screen.getByRole("button", { name: "Phone" }));
    await user.type(screen.getByLabelText("Phone number"), "+15550109999");
    await user.click(screen.getByRole("button", { name: "Send invitation" }));
    expect(transport.emit).not.toHaveBeenCalled();
    expect(opened[0]).toContain("sms:+15550109999");
  });

  it("stops waiting when the server refuses", async () => {
    const { user } = setup(["email"]);
    await user.type(screen.getByLabelText("Email address"), "them@example.com");
    await user.click(screen.getByRole("button", { name: "Send invitation" }));
    await act(async () => {
      transport.deliver("room:error", { message: "That is not an address." });
    });
    expect(screen.getByRole("button", { name: "Send invitation" })).toBeTruthy();
  });

  it("will not send an empty address", async () => {
    const { opened, user } = setup(["email"]);
    const send = screen.getByRole("button", {
      name: "Send invitation",
    }) as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    await user.type(screen.getByLabelText("Email address"), "   ");
    expect(send.disabled).toBe(true);
    expect(opened).toEqual([]);
  });

  it("shows the room code and says what it grants", () => {
    setup([]);
    expect(
      (screen.getByLabelText("Room code") as HTMLInputElement).value,
    ).toBe("a1b2c3d4");
    expect(screen.getByText(/Anyone with this code can take a seat/)).toBeTruthy();
  });
});
