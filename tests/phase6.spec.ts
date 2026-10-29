import { test, expect, type Page } from '@playwright/test';
import fs from 'node:fs';

const SHOTS = 'test-results/screenshots';
fs.mkdirSync(SHOTS, { recursive: true });

async function boot(page: Page, query: string, errors: string[] = []) {
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(() => localStorage.setItem('cp-settings', JSON.stringify({ introSeen: true, tutorialSeen: true })));
  await page.goto(`/?${query}${query.includes('weather=') || query.includes('challenge=') ? '' : '&weather=clear'}`);
  await page.waitForFunction(() => (window as unknown as { __game?: { ready: boolean } }).__game?.ready === true, null, { timeout: 120_000 });
  await page.waitForTimeout(500);
  return errors;
}
const g = (page: Page, expr: string) => page.evaluate(expr);
const finished = (page: Page) => page.waitForFunction(() => (window as unknown as { __game: { finished: boolean } }).__game.finished === true, null, { timeout: 20_000 });

test('daily challenge: a dated seed fixes route/hour/weather/contract, the pre-trip locks them, the score is kept and shared', async ({ page }) => {
  // 2026-10-29 seeds: Dhaka → Sylhet, 06:30, fog, express (the seed is a pure function of the date)
  const errors = await boot(page, 'quality=low&challenge=2026-10-29');
  expect(await page.locator('#hud-route b').innerText()).toContain('সিলেট');
  expect(await page.locator('#menu-start').innerText()).toContain('চ্যালেঞ্জ');
  await page.click('#menu-start'); await page.waitForTimeout(400);
  const pre = await g(page, '(() => { const s = __game.stats(); return { screen: __game.screen, challenge: s.challenge, hour: s.fixedHour, weather: s.weather, routeSel: document.querySelector(".route-select").classList.contains("hidden"), contracts: document.getElementById("pretrip-contracts").classList.contains("hidden"), box: document.getElementById("pretrip-challenge").innerText }; })()') as { screen: string; challenge: string; hour: number; weather: string; routeSel: boolean; contracts: boolean; box: string };
  expect(pre).toMatchObject({ screen: 'pretrip', challenge: '2026-10-29', hour: 6.5, weather: 'fog', routeSel: true, contracts: true });
  expect(pre.box).toContain('এক্সপ্রেস');
  await page.screenshot({ path: `${SHOTS}/challenge-pretrip.png` });
  await page.click('#pretrip-go'); await page.waitForTimeout(300);
  expect(await g(page, '__game.stats().contract')).toBe('express');
  await g(page, '__game.traffic.enabled = false; __game.teleport(__game.road.length - 160); __game.simulate(30, { throttle: 1, autopilot: true })');
  await finished(page); await page.waitForTimeout(300);
  const last = await g(page, '__game.stats().lastChallenge') as { score: number; best: number; isBest: boolean; runs: number };
  expect(last.isBest).toBe(true); expect(last.runs).toBe(1); expect(last.score).toBe(last.best); expect(last.score).toBeGreaterThan(10000);
  await expect(page.locator('#res-challenge')).toContainText('নতুন সেরা');
  await page.click('#btn-chal-share'); await page.waitForTimeout(200);
  expect(await page.locator('#btn-chal-share').innerText()).toContain('কপি');
  const book = JSON.parse(await g(page, 'localStorage.getItem("cp-challenge")') as string) as Record<string, { best: number; runs: number }>;
  expect(book['2026-10-29'].best).toBe(last.score);
  // the main-menu panel lists today's best; a fresh page with the same seed gives the same conditions
  await g(page, '__game.goToLanding()'); await page.waitForTimeout(100);
  await page.click('#menu-challenge'); await page.waitForTimeout(200);
  await expect(page.locator('#challenge-body')).toContainText('২৯/১০/২০২৬');
  expect(errors).toEqual([]);
});

test('garage minibus: bought with balance, survives reload, shorter body with 24 seats, lighter/quicker physics with a 105 km/h cap', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(() => { localStorage.setItem('cp-settings', JSON.stringify({ introSeen: true, tutorialSeen: true })); if (!localStorage.getItem('cp-career')) localStorage.setItem('cp-career', JSON.stringify({ balance: 60000, xp: 2500, trips: 5 })); });
  await page.goto('/?quality=low&hour=12&weather=clear');
  await page.waitForFunction(() => (window as unknown as { __game?: { ready: boolean } }).__game?.ready === true, null, { timeout: 120_000 });
  expect(await g(page, '(() => { const s = __game.stats(); return [s.bus, s.seats, s.busLength]; })()')).toEqual(['bus', 36, 11.2]);
  await page.click('#menu-garage'); await page.waitForTimeout(200);
  expect(await page.locator('.gcard.bus').count()).toBe(2);
  await page.screenshot({ path: `${SHOTS}/garage-buses.png` });
  await page.click('.gbus[data-bus="mini"]');  // buys + reloads
  await page.waitForTimeout(1500);
  await page.waitForFunction(() => (window as unknown as { __game?: { ready: boolean } }).__game?.ready === true, null, { timeout: 120_000 });
  const st = await g(page, '(() => { const s = __game.stats(); return { bus: s.bus, seats: s.seats, len: s.busLength, mass: s.mods.mass, cap: s.mods.busCapKmh, balance: s.career.balance, owned: s.career.busesOwned }; })()') as { bus: string; seats: number; len: number; mass: number; cap: number; balance: number; owned: string[] };
  expect(st).toMatchObject({ bus: 'mini', seats: 24, len: 8.2, cap: 105, balance: 15000 }); expect(st.mass).toBeLessThan(0.7); expect(st.owned).toEqual(['bus', 'mini']);
  await page.click('#menu-start'); await page.waitForTimeout(400); await page.click('#pretrip-go'); await page.waitForTimeout(300);
  await expect(page.locator('#hud-pass')).toContainText('/ ২৪', { timeout: 10_000 });
  await g(page, '__game.traffic.enabled = false; __game.teleport(3400); __game.simulate(0.3, { throttle: 0, handbrake: true }); __game.openPhoto(); __game.photo.yaw = 1.2; __game.photo.pitch = 0.15; __game.photo.dist = 13');
  await page.waitForTimeout(2500); await page.screenshot({ path: `${SHOTS}/minibus-side.png` });
  const perf = await g(page, '(() => { __game.photo.close(); __game.teleport(4660); const st = __game.simulate(40, { throttle: 1, autopilot: true }); return { zeroToSixty: st.zeroToSixty, top: st.topSpeed }; })()') as { zeroToSixty: number; top: number };
  console.log('minibus perf', perf);
  expect(perf.zeroToSixty).toBeLessThan(9.5); expect(perf.top).toBeGreaterThan(95); expect(perf.top).toBeLessThan(108);
  expect(errors).toEqual([]);
});

test('night hazards: unlit vehicles exist at night, L toggles the high beam, a herder walks cows across and hitting one costs ৳2,000', async ({ page }) => {
  const errors = await boot(page, 'quality=low&hour=21&weather=clear');
  await page.click('#menu-start'); await page.waitForTimeout(400); await page.click('#pretrip-go'); await page.waitForTimeout(300);
  const st = () => g(page, '(() => { const s = __game.stats(); return { highBeam: s.highBeam, unlit: s.unlit, cattle: s.cattle.map((c) => c.state), cowHits: s.cowHits, fines: s.ledger.fines, crashes: s.crashes, beamHidden: document.getElementById("btn-beam").classList.contains("hidden"), dist: __game.bus.headlights[1].distance }; })()') as Promise<{ highBeam: boolean; unlit: number; cattle: string[]; cowHits: number; fines: number; crashes: number; beamHidden: boolean; dist: number }>;
  let s = await st();
  expect(s.unlit).toBeGreaterThan(0); expect(s.beamHidden).toBe(false); expect(s.highBeam).toBe(false); expect(s.dist).toBe(70);
  await page.keyboard.press('KeyL'); await page.waitForTimeout(100);
  s = await st(); expect(s.highBeam).toBe(true); expect(s.dist).toBe(130);
  await expect(page.locator('#btn-beam')).toHaveClass(/on/);
  await page.screenshot({ path: `${SHOTS}/night-highbeam.png` });
  await page.click('#btn-beam'); await page.waitForTimeout(100); expect((await st()).highBeam).toBe(false);
  // cattle: the crossing starts as the bus comes within 220 m
  await g(page, '__game.traffic.enabled = false; const sp = __game.cattle.spots[0]; __game.teleport(sp.s - 200); __game.simulate(0.5, { throttle: 0, handbrake: true })');
  expect((await st()).cattle[0]).toBe('crossing');
  await expect(page.locator('#hud-msg')).toContainText('গরু', { timeout: 8000 });
  await g(page, 'const sp = __game.cattle.spots[0]; __game.teleport(sp.s - 45); __game.simulate(5, { throttle: 0, handbrake: true })');
  await page.waitForTimeout(2500); await page.screenshot({ path: `${SHOTS}/night-cattle.png` });
  // ram the lead cow
  await g(page, 'const sp = __game.cattle.spots[0]; sp.cows.forEach((c, i) => { c.lat = -1.75 - i * 0.9; c.speed = 0.05; }); __game.teleport(sp.s - 25); __game.simulate(5, { throttle: 1, autopilot: true })');
  await page.waitForFunction(() => (window as unknown as { __game: { stats(): { cowHits: number } } }).__game.stats().cowHits >= 1, null, { timeout: 10_000 });
  s = await st(); expect(s.crashes).toBeGreaterThanOrEqual(1); expect(s.fines).toBeGreaterThanOrEqual(2000);
  await expect(page.locator('#hud-msg')).toContainText('গরুকে ধাক্কা');
  expect(errors).toEqual([]);
});
