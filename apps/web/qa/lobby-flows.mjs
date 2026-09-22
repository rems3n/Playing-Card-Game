#!/usr/bin/env node
/**
 * Drives the waiting room with two real browsers — a host on a desktop viewport
 * and a guest on a phone — through ready state, host seat control, the invite
 * panel and starting the game.
 *
 * Usage:  npm run qa:lobby        (uses http://localhost:3000)
 *         BASE_URL=... npm run qa:lobby
 */
import { chromium } from 'playwright';

const EXE = process.env.CHROMIUM_PATH || undefined;
const BASE = process.env.BASE_URL ?? 'http://localhost:3000';
const b = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
const fails = [];
const check = (ok, what) => { console.log((ok ? '  ok   ' : '  FAIL ') + what); if (!ok) fails.push(what); };

async function newPlayer(name, viewport) {
  const ctx = await b.newContext({ viewport, ...(viewport.width < 800 ? { isMobile: true, hasTouch: true } : {}) });
  const page = await ctx.newPage();
  page.on('pageerror', e => fails.push(`${name} page error: ${e.message}`));
  return { ctx, page, name };
}
// React hydration can land after first paint, so press until it takes.
async function hydrated(page) {
  await page.waitForFunction(() => {
    const b = [...document.querySelectorAll('.mode-switch button')].find(e => e.textContent.includes('friends'));
    if (!b) return false;
    if (b.getAttribute('aria-pressed') === 'true') return true;
    b.click();
    return false;
  }, null, { timeout: 30000, polling: 250 });
}

// Host creates a private table on desktop; guest joins on a phone.
const host = await newPlayer('host', { width: 1280, height: 860 });
await host.page.goto(BASE + '/', { waitUntil: 'load' });
await hydrated(host.page);
await host.page.getByLabel('Your name').fill('Ada');
await host.page.getByRole('button', { name: /Create a private table/i }).click();
await host.page.waitForURL(/\/room\/[\w-]+/, { timeout: 30000 }).catch(async () => {
  console.log('  home page said:', await host.page.locator('[role=alert], .connection-notice').allInnerTexts());
  throw new Error('could not create a private table');
});
const roomUrl = host.page.url();
const roomId = roomUrl.split('/room/')[1];
console.log('room:', roomId);
await host.page.waitForTimeout(1200);

check((await host.page.locator('.waiting-seat').first().innerText()).includes('Not ready yet'), 'host seat starts as Not ready yet');
const startBtn = host.page.getByRole('button', { name: /Start game/ });
check(await startBtn.isDisabled(), 'Start is disabled before anyone is ready');

const guest = await newPlayer('guest', { width: 390, height: 780 });
await guest.page.goto(roomUrl, { waitUntil: 'load' });
await guest.page.waitForTimeout(2500);
const guestName = guest.page.getByLabel('Your name');
if (await guestName.count()) { await guestName.fill('Bo'); await guest.page.getByRole('button', { name: 'Update name' }).click(); await guest.page.waitForTimeout(1200); }
check((await host.page.locator('.waiting-seat').count()) >= 2, 'host sees the guest arrive');

// Ready toggles
await host.page.getByRole('button', { name: "I'm ready" }).click();
await host.page.waitForTimeout(600);
check((await host.page.locator('.waiting-seat').first().innerText()).includes('Ready'), 'host shows Ready after pressing it');
check(await startBtn.isDisabled(), 'Start still disabled while the guest is not ready');
check((await host.page.locator('.setup-note').innerText()).includes('Bo'), 'the note names who is still deciding');

await guest.page.getByRole('button', { name: "I'm ready" }).click();
await guest.page.waitForTimeout(800);
check(!(await startBtn.isDisabled()), 'Start enables once everyone is ready');

// Un-ready blocks it again
await guest.page.getByRole('button', { name: 'Not ready' }).click();
await guest.page.waitForTimeout(800);
check(await startBtn.isDisabled(), 'un-readying blocks the start again');
await guest.page.getByRole('button', { name: "I'm ready" }).click();
await guest.page.waitForTimeout(800);

// Invite panel on the phone
const invite = guest.page.locator('.invitation-panel');
check(await invite.isVisible(), 'the guest sees the invite panel on a phone');
const note = invite.locator('.invite-form .small-note');
check((await note.innerText()).includes('own email app'), 'email invite says it opens the email app');
await invite.getByRole('button', { name: 'Phone' }).click();
await guest.page.waitForTimeout(300);
check((await note.innerText()).includes('messaging app'), 'phone invite says it opens the messaging app');
await invite.getByLabel('Phone number').fill('+353871234567');
check(await invite.getByRole('button', { name: 'Send invitation' }).isEnabled(), 'Send enables once a number is typed');
await invite.getByRole('button', { name: 'Email' }).click();
await guest.page.waitForTimeout(300);
check(await invite.getByLabel('Email address').count() === 1, 'the channel switch swaps the field');
const smalls = [];
for (const el of await invite.locator('button, input').all()) {
  const box = await el.boundingBox();
  if (box && box.height < 44) smalls.push(`${(await el.getAttribute('aria-label')) || (await el.innerText().catch(()=>'input'))} ${Math.round(box.height)}px`);
}
check(smalls.length === 0, `invite controls are full touch targets${smalls.length ? ': ' + smalls.join(', ') : ''}`);
const roomField = await invite.getByLabel('Room code').inputValue();
check(roomField === roomId, 'the room code field shows the code');
const overflow = await guest.page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
check(!overflow, 'the lobby does not scroll sideways on a phone');

// Host frees the guest's seat, then the guest rejoins and readies again
await host.page.locator('.waiting-seat').nth(1).getByRole('button', { name: 'Free seat' }).click();
await host.page.waitForTimeout(900);
check((await host.page.locator('.waiting-seat.empty').count()) >= 1, 'freeing a seat empties it for the host');
await guest.page.waitForTimeout(600);
check((await guest.page.locator('.notice').innerText()).includes('freed your seat'), 'the removed player is told why');

await guest.page.goto(roomUrl, { waitUntil: 'load' });
await guest.page.waitForTimeout(2500);
await guest.page.getByRole('button', { name: "I'm ready" }).click();
await guest.page.waitForTimeout(900);
check(!(await startBtn.isDisabled()), 'Start enables again after the guest rejoins and readies');

// Refresh keeps ready
await host.page.reload({ waitUntil: 'load' });
await host.page.waitForTimeout(2500);
check((await host.page.locator('.waiting-seat').first().innerText()).includes('Ready'), 'a refresh keeps the ready flag');

// And the game actually starts
await host.page.getByRole('button', { name: /Start game/ }).click();
await host.page.waitForURL(/\/game\/[\w-]+/, { timeout: 30000 });
check(true, 'the host can start the game');
await guest.page.waitForURL(/\/game\/[\w-]+/, { timeout: 30000 }).then(() => check(true, 'the guest is taken to the table too')).catch(() => check(false, 'the guest is taken to the table too'));

await b.close();
console.log('\n==== ' + (fails.length ? fails.length + ' FAILED' : 'all lobby checks passed') + ' ====');
for (const f of fails) console.log('• ' + f);
process.exit(fails.length ? 1 : 0);
