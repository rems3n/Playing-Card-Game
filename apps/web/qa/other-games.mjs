#!/usr/bin/env node
/**
 * Plays Hearts, Spades and Rummy against Expert bots through the running app,
 * on a phone viewport and on a desktop one. Each game is driven from the
 * lobby through its own opening -- a pass, a bid, a draw -- into play, and the
 * run fails on a phase the table gives no way out of, page scrolling, controls
 * off screen, or touch targets under 44px.
 *
 * Usage:  npm run qa:other          (uses http://localhost:3000)
 *         GAMES=hearts,rummy PHONE=390x664 npm run qa:other
 */
import { chromium } from "playwright";

const EXE = process.env.CHROMIUM_PATH || undefined;
const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const GAMES = (process.env.GAMES ?? "hearts,spades,rummy").split(",");
const [pw, ph] = (process.env.PHONE ?? "390x664").split("x").map(Number);
const OUT = process.env.SHOTS ?? "";
const b = await chromium.launch({ executablePath: EXE, args: ["--no-sandbox"] });
const fails = [];
const check = (ok, what) => {
  console.log((ok ? "  ok   " : "  FAIL ") + what);
  if (!ok) fails.push(what);
};

async function hydrated(page) {
  await page.waitForFunction(() => {
    const b = [...document.querySelectorAll(".mode-choices input")].find((e) => (e.getAttribute("aria-label") || "").includes("Practice"));
    if (!b) return false;
    if (b.checked) return true;
    b.click();
    return false;
  }, null, { timeout: 30000, polling: 250 });
}
const phase = (page) => page.evaluate(() => document.querySelector(".game-page")?.getAttribute("data-phase") ?? null);
const layout = (page, label, name) => page.evaluate(([label, name, w, h]) => {
  const out = [];
  if (document.documentElement.scrollWidth > innerWidth + 1) out.push(`${name} ${label}: page scrolls sideways`);
  if (document.documentElement.scrollHeight > innerHeight + 1 && innerWidth < 800) out.push(`${name} ${label}: page scrolls vertically`);
  for (const e of document.querySelectorAll("button, select, input")) {
    const r = e.getBoundingClientRect();
    if (r.width === 0 || r.height === 0 || e.disabled) continue;
    // A desktop page may scroll down; a phone table must not. Sideways is
    // never allowed.
    const tall = innerWidth >= 800;
    const named = (e.getAttribute("aria-label") || e.textContent || "").trim().slice(0, 30) || `<${e.tagName.toLowerCase()} class="${String(e.className).slice(0, 30)}">`;
    if (r.right > innerWidth + 1 || r.left < -1 || (!tall && (r.bottom > innerHeight + 1 || r.top < -1)))
      out.push(`${name} ${label}: control off screen: ${named}`);
    if (innerWidth < 800 && (r.width < 44 || r.height < 44) && !e.closest("nav"))
      out.push(`${name} ${label}: touch target ${Math.round(r.width)}x${Math.round(r.height)}: ${(e.getAttribute("aria-label") || e.textContent || "").trim().slice(0, 30)}`);
  }
  return out;
}, [label, name, pw, ph]);

async function start(page, name) {
  await page.goto(BASE + "/", { waitUntil: "load" });
  await hydrated(page);
  // A phone widens its layout viewport to fit anything that cannot shrink;
  // the home page must lay out at the width it was given.
  const laidOut = await page.evaluate(() => innerWidth);
  const asked = page.viewportSize().width;
  if (laidOut !== asked) check(false, `${name} lobby: laid out ${laidOut}px wide on a ${asked}px screen`);
  // By the game's own name, exactly: Hearts' blurb mentions the queen of
  // spades, and a loose match once played Hearts when Spades was asked for.
  await page.locator(".lobby-games .choice-option").filter({ has: page.locator("strong", { hasText: new RegExp(`^${name}$`) }) }).first().click();
  await page.getByLabel("Your name").fill("Other games");
  await page.getByLabel(/Bot difficulty/).selectOption("expert");
  await page.getByRole("button", { name: /Start practice/i }).click();
  await page.waitForURL(/\/game\/[\w-]+/, { timeout: 30000 });
  await page.waitForTimeout(2500);
}

/** One card game (Hearts or Spades) from its opening into the first trick. */
async function trickGame(page, name, label) {
  await start(page, name);
  const pageShell = await page.locator(".game-page").count();
  check(pageShell === 1, `${name} ${label}: the table renders`);
  let steps = 0;
  let sawPlay = false;
  let played = 0;
  while (steps++ < 60) {
    const p = await phase(page);
    if (p === "passing") {
      const cards = page.locator(".hand-cards button:not([disabled])");
      const n = await cards.count();
      check(n >= 3, `${name} ${label}: the pass lets cards be chosen (${n} enabled)`);
      // A fanned hand shows each card's left edge; that is where a thumb lands.
      for (let i = 0; i < 3; i++) await cards.nth(i).click({ position: { x: 8, y: 24 } });
      for (const f of await layout(page, `${label} passing`, name)) check(false, f);
      const pass = page.getByRole("button", { name: "Pass these 3 cards" });
      check(!(await pass.isDisabled()), `${name} ${label}: Pass enables after three cards`);
      await pass.click();
      await page.waitForFunction(() => document.querySelector(".game-page")?.getAttribute("data-phase") !== "passing", null, { timeout: 30000 }).catch(() => {});
      check((await phase(page)) !== "passing", `${name} ${label}: the pass resolves once everyone has passed`);
      continue;
    }
    if (p === "bidding") {
      const mine = await page.locator(".bidding-panel form").count();
      if (mine) {
        for (const f of await layout(page, `${label} bidding`, name)) check(false, f);
        await page.locator(".bid-options input:not([disabled])").nth(2).click();
        await page.locator(".bidding-panel button[type=submit]").click();
      }
      await page.waitForTimeout(700);
      continue;
    }
    if (p === "playing") {
      sawPlay = true;
      if (played === 0) for (const f of await layout(page, `${label} playing`, name)) check(false, f);
      const legal = page.locator(".hand-cards button:not([disabled])");
      if (await legal.count()) {
        await legal.first().click({ position: { x: 8, y: 24 } });
        await page.getByRole("button", { name: /^Play / }).click();
        played++;
        if (played >= 3) break;
      }
      await page.waitForTimeout(600);
      continue;
    }
    if (p === "trick_resolution") {
      await page.waitForTimeout(800);
      continue;
    }
    await page.waitForTimeout(700);
  }
  check(sawPlay, `${name} ${label}: reaches play`);
  check(played >= 3, `${name} ${label}: the person can play cards (${played} played)`);
  if (OUT) await page.screenshot({ path: `${OUT}/other-${name.toLowerCase()}-${label}.png` }).catch(() => {});
}

async function rummy(page, label) {
  await start(page, "Rummy");
  await page.waitForTimeout(1500);
  let turns = 0;
  for (let i = 0; i < 40 && turns < 3; i++) {
    const stock = page.getByRole("button", { name: /^Draw from stock/ });
    if (await stock.count() && !(await stock.isDisabled())) {
      await stock.click();
      await page.waitForTimeout(600);
    }
    const discard = page.getByRole("button", { name: "Discard" });
    if (!(await discard.count())) {
      // Choose one card; the Discard button appears for a single choice.
      const cards = page.locator(".rummy-hand button:not([disabled])");
      if (await cards.count()) await cards.first().click();
      await page.waitForTimeout(300);
    }
    if (await discard.count()) {
      // Rummy's board is still a desktop layout: on a phone it scrolls and
      // its cards are small. Reported, not failed, until it is redesigned.
      if (turns === 0)
        for (const f of await layout(page, `${label} playing`, "Rummy"))
          console.log(`  note ${f} (known: the Rummy board is not yet a phone layout)`);
      await discard.click();
      turns++;
    }
    await page.waitForTimeout(1200);
  }
  check(turns >= 1, `Rummy ${label}: the person can draw and discard (${turns} turns)`);
  if (OUT) await page.screenshot({ path: `${OUT}/other-rummy-${label}.png` }).catch(() => {});
}

for (const [label, viewport] of [["phone", { width: pw, height: ph, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }], ["desktop", { width: 1280, height: 860 }]]) {
  const ctx = await b.newContext(viewport.isMobile ? { viewport: { width: viewport.width, height: viewport.height }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : { viewport });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => check(false, `${label}: page error ${e.message}`));
  for (const game of GAMES) {
    console.log(`\n=== ${game} · ${label} ===`);
    try {
      if (game === "hearts") await trickGame(page, "Hearts", label);
      else if (game === "spades") await trickGame(page, "Spades", label);
      else if (game === "rummy") await rummy(page, label);
    } catch (e) {
      check(false, `${game} ${label}: ${String(e.message).split("\n")[0]}`);
    }
  }
  await ctx.close();
}
await b.close();
console.log("\n==== " + (fails.length ? fails.length + " FAILED" : "all other-game checks passed") + " ====");
for (const f of fails) console.log("• " + f);
process.exit(fails.length ? 1 : 0);
