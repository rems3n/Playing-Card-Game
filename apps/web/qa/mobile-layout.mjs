#!/usr/bin/env node
/**
 * Drives the running web app through a complete Seven-Six hand at phone
 * viewports and reports layout defects: page overflow, controls outside the
 * viewport, overlapping hand cards, and touch targets under 44px.
 *
 * This measures a real browser at a real viewport. It does not replace a pass
 * on physical iOS Safari and Android Chrome, which additionally cover safe-area
 * insets, browser chrome, keyboard behaviour and orientation changes.
 *
 * Usage:  npm run qa:mobile            (uses http://localhost:3000)
 *         BASE_URL=... SEATS=7 SIZES=320x568 npm run qa:mobile
 */
import { chromium } from "playwright";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const SEATS = Number(process.env.SEATS ?? 7);
const GAME = process.env.GAME ?? "Seven-Six";
// Cards below this are reported. A seven-card hand cannot give every card 44px
// at 320px, so the hand keeps two-step select-then-play instead.
const MIN_TOUCH = Number(process.env.MIN_TOUCH ?? 44);
const MIN_HAND_CARD = Number(process.env.MIN_HAND_CARD ?? 42);

const ALL_SIZES = [
  { name: "320x568", width: 320, height: 568 },
  { name: "390x664", width: 390, height: 664 },
  { name: "430x780", width: 430, height: 780 },
  { name: "844x390", width: 844, height: 390 },
  { name: "390x540", width: 390, height: 540 },
];
const sizes = process.env.SIZES
  ? ALL_SIZES.filter((s) => process.env.SIZES.split(",").includes(s.name))
  : ALL_SIZES;

const measure = ([minTouch, minHandCard]) => {
  const d = document;
  const w = window;
  const vis = (e) => {
    const r = e.getBoundingClientRect();
    const s = w.getComputedStyle(e);
    return (
      r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none"
    );
  };
  const box = (e) => {
    const r = e.getBoundingClientRect();
    return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
  };
  const describe = (e) => ({
    el: String(e.className || e.tagName).slice(0, 50),
    text: ((e.getAttribute("aria-label") || e.textContent) || "").trim().replace(/\s+/g, " ").slice(0, 45),
    rect: box(e),
  });
  const page = d.querySelector(".game-page");
  const tracked =
    ".game-heading,.table-status,.trump-panel,.opponents,.bidding-panel," +
    ".bid-options button,.bidding-panel button[type=submit],.hand-panel," +
    ".hand-cards button,.hand-action button,.trick-play,.round-result," +
    ".round-result button,.my-seat";
  const targets = [...d.querySelectorAll(tracked)].filter(vis);
  const outside = targets
    .filter((e) => {
      const r = e.getBoundingClientRect();
      return r.left < -0.5 || r.top < -0.5 || r.right > w.innerWidth + 0.5 || r.bottom > w.innerHeight + 0.5;
    })
    .map(describe);

  // A control can sit inside the viewport and still be cut off by an ancestor
  // that hides its overflow, which is how the game shell keeps its height.
  const clipped = targets
    .map((e) => {
      const r = e.getBoundingClientRect();
      for (let p = e.parentElement; p; p = p.parentElement) {
        const s = w.getComputedStyle(p);
        const scrolls = /auto|scroll|hidden/;
        if (!scrolls.test(s.overflowY) && !scrolls.test(s.overflowX)) continue;
        const b = p.getBoundingClientRect();
        const cut =
          (scrolls.test(s.overflowY) && (r.top < b.top - 0.5 || r.bottom > b.bottom + 0.5)) ||
          (scrolls.test(s.overflowX) && (r.left < b.left - 0.5 || r.right > b.right + 0.5));
        if (cut)
          return {
            ...describe(e),
            clippedBy: String(p.className || p.tagName).slice(0, 40),
            box: { y: Math.round(b.top), h: Math.round(b.height) },
          };
      }
      return null;
    })
    .filter(Boolean);

  const cards = [...d.querySelectorAll(".hand-cards button")].filter(vis);
  const overlap = [];
  for (let i = 0; i < cards.length; i++) {
    for (let j = i + 1; j < cards.length; j++) {
      const a = cards[i].getBoundingClientRect();
      const b = cards[j].getBoundingClientRect();
      if (
        Math.min(a.right, b.right) > Math.max(a.left, b.left) + 0.5 &&
        Math.min(a.bottom, b.bottom) > Math.max(a.top, b.top) + 0.5
      )
        overlap.push([i, j]);
    }
  }

  const controls = [
    ...d.querySelectorAll(
      ".game-page button:not([disabled]), .game-page input:not([disabled])," +
        ".game-page select:not([disabled]), .game-page a[href]," +
        "dialog[open] button:not([disabled]), dialog[open] input:not([disabled])",
    ),
  ].filter(vis);
  // A checkbox wrapped in a label is tapped through the label, so measure that.
  const effective = (e) => (e.tagName === "INPUT" && e.closest("label")) || e;
  const small = controls
    .filter((e) => !e.closest(".hand-cards"))
    .map((e) => describe(effective(e)))
    .filter((o) => o.rect.w < minTouch || o.rect.h < minTouch);
  const smallCards = cards
    .map(describe)
    .filter((o) => o.rect.w < minHandCard || o.rect.h < minHandCard);

  const row = d.querySelector(".hand-cards");
  return {
    viewport: [w.innerWidth, w.innerHeight],
    phase: page && page.getAttribute("data-phase"),
    pageScrollX: d.documentElement.scrollWidth > w.innerWidth + 1,
    pageScrollY: d.documentElement.scrollHeight > w.innerHeight + 1,
    handClipped: row ? row.scrollWidth > row.clientWidth + 1 : false,
    handCards: cards.length,
    handCardSize: cards[0] ? box(cards[0]) : null,
    checked: targets.length,
    outside,
    clipped,
    overlap,
    small,
    smallCards,
  };
};

const failures = [];
function check(size, step, m) {
  const found = [];
  if (m.pageScrollX) found.push("horizontal page scroll");
  if (m.pageScrollY) found.push("vertical page scroll");
  if (m.handClipped) found.push(`hand row clipped (${m.handCards} cards)`);
  if (m.outside.length) found.push("outside viewport: " + JSON.stringify(m.outside));
  if (m.clipped.length) found.push("cut off by a clipping ancestor: " + JSON.stringify(m.clipped));
  if (m.overlap.length) found.push("overlapping hand cards: " + JSON.stringify(m.overlap));
  if (m.small.length) found.push(`touch targets under ${MIN_TOUCH}px: ` + JSON.stringify(m.small));
  if (m.smallCards.length)
    found.push(`hand cards under ${MIN_HAND_CARD}px: ` + JSON.stringify(m.smallCards[0].rect));
  const card = m.handCardSize ? ` card=${m.handCardSize.w}x${m.handCardSize.h}` : "";
  console.log(`  [${step}] phase=${m.phase} cards=${m.handCards}${card} checked=${m.checked}`);
  for (const f of found) {
    console.log("    FAIL " + f);
    failures.push(`${size.name} | ${step} | ${f}`);
  }
  if (!found.length) console.log("    ok");
}

async function phaseOf(page) {
  return page.locator(".game-page").getAttribute("data-phase");
}
async function waitPhase(page, phase, timeout = 90000) {
  await page.waitForFunction(
    (p) => document.querySelector(".game-page")?.getAttribute("data-phase") === p,
    phase,
    { timeout, polling: 200 },
  );
}
async function playOneCard(page, timeout = 60000) {
  try {
    await page.waitForFunction(
      () => [...document.querySelectorAll(".hand-cards button")].some((e) => !e.disabled),
      null,
      { timeout, polling: 200 },
    );
  } catch {
    return null;
  }
  const card = page.locator(".hand-cards button:not([disabled])").first();
  const name = await card.getAttribute("aria-label");
  await card.click();
  await page.getByRole("button", { name: /Play card/ }).click();
  return name;
}

async function startPractice(page) {
  await page.goto(BASE + "/", { waitUntil: "load" });
  // Hydration can land after first paint, so retry until the switch takes.
  await page.getByRole("button", { name: "Practice with bots" }).click();
  await page.waitForFunction(
    () => {
      const b = [...document.querySelectorAll(".mode-switch button")].find((e) =>
        e.textContent.includes("Practice"),
      );
      if (!b) return false;
      if (b.getAttribute("aria-pressed") === "true") return true;
      b.click();
      return false;
    },
    null,
    { timeout: 30000, polling: 250 },
  );
  await page.getByRole("button", { name: new RegExp(GAME.replace("/", "\\/"), "i") }).first().click();
  await page.getByLabel("Your name").fill("Layout check");
  // Both games offer a seat count; 45s only allows 2, 4 and 6.
  await page.getByLabel("Seats at the table").selectOption(String(SEATS));
  await page.getByRole("button", { name: /Start practice/i }).click();
  await page.waitForURL(/\/game\/[\w-]+/, { timeout: 30000 });
  await page.locator(".game-page").waitFor({ timeout: 30000 });
}

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
  args: ["--no-sandbox"],
});
for (const size of sizes) {
  console.log(`\n=== ${size.name} · ${SEATS} seats · ${GAME} ===`);
  const ctx = await browser.newContext({
    viewport: { width: size.width, height: size.height },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
  });
  // `next dev` renders a floating indicator in the bottom-left corner that a
  // production build does not have. Hide it so it cannot swallow a tap.
  await ctx.addInitScript(() => {
    const hide = () => {
      const style = document.createElement("style");
      style.textContent = "nextjs-portal{display:none !important}";
      document.head.appendChild(style);
    };
    if (document.head) hide();
    else document.addEventListener("DOMContentLoaded", hide);
  });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => {
    console.log("    FAIL page error: " + e.message);
    failures.push(`${size.name} | page error | ${e.message}`);
  });
  const step = async (name) =>
    check(size, name, await page.evaluate(measure, [MIN_TOUCH, MIN_HAND_CARD]));
  try {
    await startPractice(page);
    await waitPhase(page, "bidding");
    await page.waitForTimeout(1200);
    await step("bidding");

    const submit = page.locator(".bidding-panel button[type=submit]");
    if (!(await submit.isDisabled()))
      failures.push(`${size.name} | bidding | submit is enabled before a bid is chosen`);
    const tiles = page.locator(".bid-options button:not([disabled])");
    if (await tiles.count()) {
      await tiles.first().click();
      await step("bid selected");
      await submit.click();
    } else {
      // 45s: a seat with nothing left to outbid can only pass.
      await page.locator(".bidding-panel .button.secondary").click();
    }

    // 45s runs an auction; whoever wins it then names trump on the same panel.
    // Seven-Six has no such step, so this is skipped where it does not appear.
    const trump = page.locator(".trump-options button:not([disabled])");
    await page
      .waitForFunction(
        () =>
          !!document.querySelector(".trump-options") ||
          document.querySelector(".game-page")?.dataset.phase !== "bidding",
        null,
        { timeout: 30000, polling: 250 },
      )
      .catch(() => {});
    if (await trump.count()) {
      await step("naming trump");
      await trump.first().click();
    }

    await page.waitForTimeout(800);
    await page.getByRole("button", { name: /Table menu/i }).click();
    await page.waitForTimeout(400);
    await step("table menu");
    await page.getByRole("button", { name: /^Rules$/ }).click();
    await page.waitForTimeout(500);
    await step("rules");
    await page.keyboard.press("Escape");
    await page.waitForTimeout(400);
    if (await page.locator("dialog[open]").count())
      failures.push(`${size.name} | rules | Escape did not close the dialog`);

    await waitPhase(page, "playing");
    await page.waitForTimeout(1200);
    await step("playing");

    // With a media provider configured, the call panel must take space from
    // the felt and never cover the hand, the bid tiles or the action buttons.
    // A phone opens the call from the Table menu; the panel is not drawn until
    // then, so that a table without a call costs no height.
    await page.getByRole("button", { name: /Table menu/i }).click();
    await page.waitForTimeout(400);
    // The entry only exists where a media provider is configured; without one
    // there is nothing to open and nothing should offer to.
    const callEntry = page.getByRole("button", { name: /^(Call|Show call)$/ });
    if (await callEntry.count()) {
      await callEntry.first().click();
      await page.waitForTimeout(500);
      const callToggle = page.locator(".media-panel .media-toggle");
      await step("call panel open");
      const overlaps = await page.evaluate(() => {
        const call = document.querySelector(".media-panel");
        if (!call) return [];
        const a = call.getBoundingClientRect();
        const guarded = ".hand-cards, .hand-action, .bid-options, .bidding-panel button[type=submit], .round-result button";
        return [...document.querySelectorAll(guarded)]
          .filter((e) => e.getBoundingClientRect().width > 0)
          .filter((e) => {
            const b = e.getBoundingClientRect();
            return (
              Math.min(a.right, b.right) > Math.max(a.left, b.left) + 0.5 &&
              Math.min(a.bottom, b.bottom) > Math.max(a.top, b.top) + 0.5
            );
          })
          .map((e) => String(e.className).slice(0, 40));
      });
      if (overlaps.length)
        failures.push(
          `${size.name} | call panel | covers gameplay controls: ${overlaps.join(", ")}`,
        );
      await callToggle.click();
      await page.waitForTimeout(400);
      await step("call panel closed");
    } else {
      await page.getByRole("button", { name: /Back to game/ }).click();
      await page.waitForTimeout(300);
      console.log("  [call panel] no media provider configured; skipped");
    }

    await playOneCard(page);

    try {
      await waitPhase(page, "trick_resolution", 60000);
      await page.waitForTimeout(600);
      await step("trick review");
      if (!(await page.locator(".trick-announcement").count()))
        failures.push(`${size.name} | trick review | no winner announcement`);
    } catch {
      console.log("  [trick review] not observed in window");
    }

    await page.waitForTimeout(1500);
    const lastTrick = page.getByRole("button", { name: /^Last trick$/ });
    if (!(await lastTrick.isDisabled())) {
      await lastTrick.click();
      await page.waitForTimeout(400);
      await step("last trick");
      await page.keyboard.press("Escape");
      await page.waitForTimeout(300);
    }

    await page.reload({ waitUntil: "load" });
    await page.locator(".game-page").waitFor({ timeout: 30000 });
    await page.waitForTimeout(2500);
    await step("after refresh in play");

    for (let i = 0; i < 60; i++) {
      const p = await phaseOf(page);
      if (p === "round_scoring" || p === "game_over") break;
      if ((await playOneCard(page, 30000)) === null) await page.waitForTimeout(1200);
    }
    if ((await phaseOf(page)) !== "round_scoring") {
      failures.push(`${size.name} | hand end | never reached round_scoring`);
    } else {
      await page.waitForTimeout(600);
      await step("round scoring");
      await page.reload({ waitUntil: "load" });
      await page.locator(".game-page").waitFor({ timeout: 30000 });
      await page.waitForTimeout(2500);
      if ((await phaseOf(page)) !== "round_scoring")
        failures.push(`${size.name} | refresh | scoring pause lost on reload`);
      await step("after refresh in scoring");

      await page.getByRole("button", { name: /Table menu/i }).click();
      await page.waitForTimeout(400);
      const auto = page.locator("dialog[open] .auto-deal-control input");
      await auto.click();
      await page.waitForTimeout(1200);
      if (!(await auto.isChecked())) failures.push(`${size.name} | auto-deal | could not enable`);
      await auto.click();
      await page.waitForTimeout(1200);
      if (await auto.isChecked()) failures.push(`${size.name} | auto-deal | could not disable`);
      await page.getByRole("button", { name: /Back to game/ }).click();
      await page.waitForTimeout(400);

      await page.getByRole("button", { name: /Deal next hand/ }).click();
      await page.waitForTimeout(2500);
      if ((await phaseOf(page)) !== "bidding")
        failures.push(`${size.name} | deal next | did not start the next hand`);
      await step("after deal next");
    }

    await page.getByRole("button", { name: /Table menu/i }).click();
    await page.waitForTimeout(400);
    await page.getByRole("button", { name: /Leave table/ }).click();
    await page.waitForTimeout(400);
    await step("leave dialog");
    await page.getByRole("button", { name: /^Leave table$/ }).last().click();
    await page.waitForTimeout(1500);
    if (new URL(page.url()).pathname !== "/")
      failures.push(`${size.name} | leave | did not return to the games page`);
  } catch (e) {
    // Keep the locator and the retry log: they say which control was stuck.
    const detail = e.message.split("\n").slice(0, 6).join(" / ");
    console.log("  FAIL flow: " + detail);
    failures.push(`${size.name} | flow | ${detail}`);
  }
  await ctx.close();
}
await browser.close();

console.log("\n==== result ====");
if (!failures.length) {
  console.log(`No layout defects at ${sizes.map((s) => s.name).join(", ")} with ${SEATS} seats.`);
  process.exit(0);
}
for (const f of failures) console.log("• " + f);
process.exit(1);
