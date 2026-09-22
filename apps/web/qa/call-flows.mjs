#!/usr/bin/env node
/**
 * Drives a real two-person call through the running app: a host on a desktop
 * viewport and a guest on a phone, both with Chromium's fake camera and
 * microphone, against a real LiveKit server. It fails when sound does not
 * arrive, when the phone layout breaks with video up, or when hiding the call
 * silences it.
 *
 * Needs the game server started with MEDIA_PROVIDER=livekit pointing at a
 * LiveKit server this machine can reach — `livekit-server --dev` on
 * ws://127.0.0.1:7880 with devkey/secret is enough.
 *
 * Usage:  npm run qa:call        (uses http://localhost:3000)
 *         BASE_URL=... PHONE=390x664 npm run qa:call
 */
import { chromium } from "playwright";

const EXE = process.env.CHROMIUM_PATH || undefined;
const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const [pw, ph] = (process.env.PHONE ?? "402x682").split("x").map(Number);
const b = await chromium.launch({
  executablePath: EXE,
  args: [
    "--no-sandbox",
    "--use-fake-device-for-media-stream",
    "--use-fake-ui-for-media-stream",
    "--autoplay-policy=no-user-gesture-required",
  ],
});
const fails = [];
const check = (ok, what) => {
  console.log((ok ? "  ok   " : "  FAIL ") + what);
  if (!ok) fails.push(what);
};

async function newPlayer(name, viewport) {
  const ctx = await b.newContext({
    viewport,
    ...(viewport.width < 800 ? { isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : {}),
  });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => fails.push(`${name} page error: ${e.message}`));
  return { ctx, page, name };
}
async function hydrated(page) {
  await page.waitForFunction(() => {
    const b = [...document.querySelectorAll(".mode-switch button")].find((e) => e.textContent.includes("friends"));
    if (!b) return false;
    if (b.getAttribute("aria-pressed") === "true") return true;
    b.click();
    return false;
  }, null, { timeout: 30000, polling: 250 });
}

/** What the page can hear: every attached audio element, with signal level. */
async function audio(page) {
  return page.evaluate(async () => {
    const out = [];
    for (const el of document.querySelectorAll("audio")) {
      const track = el.srcObject?.getAudioTracks?.()[0];
      const item = { paused: el.paused, ready: el.readyState, muted: el.muted, volume: el.volume, track: !!track, rms: 0 };
      if (track) {
        const ctx = new AudioContext();
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 2048;
        ctx.createMediaStreamSource(new MediaStream([track])).connect(analyser);
        const buf = new Float32Array(analyser.fftSize);
        const until = performance.now() + 1500;
        while (performance.now() < until) {
          await new Promise((r) => setTimeout(r, 50));
          analyser.getFloatTimeDomainData(buf);
          let sum = 0;
          for (const v of buf) sum += v * v;
          item.rms = Math.max(item.rms, Math.sqrt(sum / buf.length));
        }
        await ctx.close();
      }
      out.push(item);
    }
    return out;
  });
}
const rect = (page, sel) => page.evaluate((s) => {
  const e = document.querySelector(s);
  if (!e) return null;
  const r = e.getBoundingClientRect();
  return { x: r.x, y: r.y, w: r.width, h: r.height, right: r.right, bottom: r.bottom };
}, sel);
const overlaps = (a, c) => a && c && Math.min(a.right, c.right) > Math.max(a.x, c.x) + 0.5 && Math.min(a.bottom, c.bottom) > Math.max(a.y, c.y) + 0.5;

// ── Two people at one table ──────────────────────────────────────────────
const host = await newPlayer("host", { width: 1280, height: 860 });
await host.page.goto(BASE + "/", { waitUntil: "load" });
await hydrated(host.page);
await host.page.getByLabel("Your name").fill("Ada");
await host.page.getByRole("button", { name: /Create a private table/i }).click();
await host.page.waitForURL(/\/room\/[\w-]+/, { timeout: 30000 });
const roomUrl = host.page.url();
console.log("room:", roomUrl.split("/room/")[1]);
await host.page.waitForTimeout(1000);

const guest = await newPlayer("guest", { width: pw, height: ph });
await guest.page.goto(roomUrl, { waitUntil: "load" });
await guest.page.waitForTimeout(2500);
const guestName = guest.page.getByLabel("Your name");
if (await guestName.count()) {
  await guestName.fill("Bo");
  await guest.page.getByRole("button", { name: "Update name" }).click();
  await guest.page.waitForTimeout(1000);
}
for (const p of [host, guest]) {
  await p.page.getByRole("button", { name: "I'm ready" }).click();
  await p.page.waitForTimeout(600);
}
await host.page.getByRole("button", { name: /Start game/ }).click();
await host.page.waitForURL(/\/game\/[\w-]+/, { timeout: 30000 });
await guest.page.waitForURL(/\/game\/[\w-]+/, { timeout: 30000 });
for (const p of [host, guest]) await p.page.locator(".game-page").waitFor({ timeout: 30000 });
await guest.page.waitForTimeout(1500);

// ── Both join the call with camera and microphone on ─────────────────────
await host.page.locator(".media-panel .media-toggle").click();
await guest.page.getByRole("button", { name: "Join the table call" }).click();
for (const p of [host, guest]) {
  await p.page.getByRole("button", { name: /Join the call/ }).click();
}
// The count lives on the header button on a phone and in the status line on
// desktop; either way both sides must agree there are two people.
const inCall = (page) => page.evaluate(() => {
  const text = [...document.querySelectorAll(".media-status, .media-count, .media-tile")].map((e) => e.textContent).join(" ");
  return /2 in the call|\b2\b/.test(text) || document.querySelectorAll(".media-tile").length >= 2;
});
for (const p of [host, guest]) {
  await p.page.waitForFunction(() => document.querySelectorAll(".media-tile").length >= 2, null, { timeout: 30000 }).catch(() => {});
  check(await inCall(p.page), `${p.name} sees 2 in the call`);
  await p.page.getByRole("button", { name: "Unmute" }).click();
  await p.page.getByRole("button", { name: "Camera on" }).click();
}

// Video arrives...
for (const p of [host, guest]) {
  await p.page.waitForFunction(() => [...document.querySelectorAll("video")].filter((v) => v.srcObject).length >= 2, null, { timeout: 15000 }).catch(() => {});
  const videos = await p.page.evaluate(() => [...document.querySelectorAll("video")].filter((v) => v.srcObject).length);
  check(videos >= 2, `${p.name} shows both cameras (${videos} playing)`);
  if (videos < 2)
    console.log("       tiles:", JSON.stringify(await p.page.evaluate(() =>
      [...document.querySelectorAll(".media-tile")].map((t) => ({
        label: t.getAttribute("aria-label"),
        video: !!t.querySelector("video"),
        playing: !!t.querySelector("video")?.srcObject,
        size: [Math.round(t.getBoundingClientRect().width), Math.round(t.getBoundingClientRect().height)],
      })))));
}
await guest.page.waitForTimeout(1500);
// ...and so must sound. A call that is video only is the bug this exists for.
for (const p of [host, guest]) {
  const heard = await audio(p.page);
  const live = heard.filter((a) => a.track && !a.paused && a.ready >= 2 && !a.muted && a.volume > 0);
  check(live.length >= 1, `${p.name} has the other person's audio playing (${JSON.stringify(heard)})`);
  check(live.some((a) => a.rms > 0.001), `${p.name} actually receives audio signal`);
}

// ── The phone layout with two videos up ──────────────────────────────────
const g = guest.page;
const scrollX = await g.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
const scrollY = await g.evaluate(() => document.documentElement.scrollHeight > innerHeight + 1);
check(!scrollX, "phone: no sideways scroll with the call up");
check(!scrollY, "phone: no page scroll with the call up");
const panel = await rect(g, ".media-panel");
const leave = await rect(g, ".media-leave");
check(leave && leave.right <= pw + 0.5 && leave.bottom <= ph + 0.5 && leave.x >= 0, `phone: Leave call is on screen (${JSON.stringify(leave)})`);
check(panel && panel.h <= ph * 0.3, `phone: call panel takes at most 30% of the screen (${panel && Math.round(panel.h)}px of ${ph})`);
const bid = await rect(g, ".bid-surface");
const trick = await rect(g, ".trick-space");
// What is painted, not what is laid out: a card clipped by its scrolling
// space has a tall box but covers nothing.
const covered = (sel) => g.evaluate((s) => {
  const e = document.querySelector(s);
  if (!e || e.getBoundingClientRect().width === 0) return false;
  const r = e.getBoundingClientRect();
  const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
  return !!hit && !e.contains(hit) && !hit.contains(e);
}, sel);
if (bid) {
  check(!(await covered(".opponents")), "phone: the bidding card does not cover the opponents");
  check(!(await covered(".my-seat")), "phone: the bidding card does not cover your seat");
  const fits = trick && bid.h <= trick.h + 0.5;
  const form = await g.evaluate(() => !!document.querySelector(".bidding-panel form"));
  // The card should fit outright. A player who must bid gets the whole
  // form; one who is waiting gets a line, and both must fit the space.
  check(fits, `phone: the bidding ${form ? "form" : "card"} fits its space without scrolling (card ${Math.round(bid.h)}px, space ${trick && Math.round(trick.h)}px)`);
  if (form) {
    const submit = await rect(g, ".bidding-panel button[type=submit]");
    check(submit && submit.bottom <= ph + 0.5 && submit.y >= 0, "phone: Submit bid is on screen while bidding with the call up");
  }
} else console.log("  (no bidding card on screen; skipped bidding checks)");
// A phone routes its own sound; a page cannot, so no picker is drawn there.
check((await g.locator(".media-output:visible").count()) === 0, "phone: no speaker picker is offered");
const hand = await rect(g, ".hand-cards");
check(hand && hand.bottom <= ph + 0.5, "phone: the hand is fully on screen");
const small = await g.evaluate(() => [...document.querySelectorAll(".media-panel button, .media-panel select")].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && (r.width < 44 || r.height < 44); }).map((e) => e.textContent.trim().slice(0, 20)));
check(small.length === 0, `phone: every call control is a full touch target (${small.join(", ") || "all"})`);
await g.screenshot({ path: `/tmp/claude-0/-home-user-Playing-Card-Game/e0791c02-7612-5d4b-911b-210004434f20/scratchpad/call-phone-${pw}x${ph}.png` }).catch(() => {});

// ── Hiding the call must not silence it ──────────────────────────────────
await g.getByRole("button", { name: "Hide the table call" }).click();
await g.waitForTimeout(800);
const hidden = await audio(g);
check(hidden.some((a) => a.track && !a.paused), "phone: sound continues after Hide call");
check(!(await g.evaluate(() => document.documentElement.scrollHeight > innerHeight + 1)), "phone: no page scroll after Hide call");
const felt = await rect(g, ".trick-space");
check(felt && trick && felt.h > trick.h, "phone: hiding the call gives the table its height back");

// ── Leaving really leaves ────────────────────────────────────────────────
await g.getByRole("button", { name: "Show call" }).click().catch(() => g.getByRole("button", { name: "Join the table call" }).click());
await g.waitForTimeout(500);
await g.getByRole("button", { name: "Leave call" }).click();
await g.waitForTimeout(2000);
check((await audio(g)).length === 0, "phone: no audio element remains after leaving");
await host.page.waitForTimeout(1500);
check((await host.page.locator(".media-status").innerText()).includes("1 in the call"), "host sees the guest leave");

await b.close();
console.log("\n==== " + (fails.length ? fails.length + " FAILED" : "all call checks passed") + " ====");
for (const f of fails) console.log("• " + f);
process.exit(fails.length ? 1 : 0);
