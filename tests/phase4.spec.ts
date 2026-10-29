import { test, expect, type Page } from '@playwright/test';
import fs from 'node:fs';

const SHOTS = 'test-results/screenshots';
fs.mkdirSync(SHOTS, { recursive: true });

async function boot(page: Page, query: string, errors: string[] = []) {
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(() => localStorage.setItem('cp-settings', JSON.stringify({ introSeen: true, tutorialSeen: true })));
  await page.goto(`/?${query}${query.includes('weather=') ? '' : '&weather=clear'}&hazards=0`); // tests pin the weather and Phase 6 hazards (random otherwise)
  await page.waitForFunction(() => (window as unknown as { __game?: { ready: boolean } }).__game?.ready === true, null, { timeout: 120_000 });
  await page.waitForTimeout(500);
  return errors;
}
const g = (page: Page, expr: string) => page.evaluate(expr);
const finished = (page: Page) => page.waitForFunction(() => (window as unknown as { __game: { finished: boolean } }).__game.finished === true, null, { timeout: 20_000 });

test('records: first finished run unlocks badges and ranks #1; records panel lists all badges', async ({ page }) => {
  const errors = await boot(page, 'quality=low&hour=22');
  await page.click('#menu-records'); await page.waitForTimeout(200);
  expect(await page.locator('.badge').count()).toBe(19);
  expect(await page.locator('.badge.on').count()).toBe(0);
  await page.click('#records-close');
  await page.click('#menu-start'); await page.waitForTimeout(400); await page.click('#pretrip-go'); await page.waitForTimeout(300);
  await g(page, '__game.traffic.enabled = false; __game.teleport(5900); __game.simulate(25, { throttle: 1, autopilot: true })');
  await finished(page); await page.waitForTimeout(200);
  const st = await g(page, '(() => { const s = __game.stats(); return { badges: s.lastBadges, rank: s.rank, best: s.career.bestRuns.length }; })()') as { badges: string[]; rank: number; best: number };
  console.log('records', st);
  expect(st.badges).toEqual(expect.arrayContaining(['first', 'no_fine', 'night']));
  expect(st.rank).toBe(1); expect(st.best).toBe(1);
  expect(await page.locator('#res-badges').innerText()).toContain('#১');
  await page.screenshot({ path: `${SHOTS}/records-results.png` });
  await g(page, 'document.getElementById("results").classList.add("hidden"); __game.openRecords("badges")'); await page.waitForTimeout(200);
  expect(await page.locator('.badge.on').count()).toBe(st.badges.length);
  await g(page, '__game.openRecords("runs")'); await page.waitForTimeout(200);
  expect(await page.locator('.runs tbody tr').count()).toBe(1);
  await page.screenshot({ path: `${SHOTS}/records-runs.png` });
  expect(errors).toEqual([]);
});

test('pwa: manifest with PNG icons is served and the icons exist', async ({ page, request }) => {
  await boot(page, 'quality=low&hour=11');
  const m = await (await request.get('/manifest.webmanifest')).json() as { icons: { src: string }[]; display: string };
  expect(m.icons.length).toBeGreaterThanOrEqual(4); expect(m.display).toBe('fullscreen');
  for (const ic of m.icons) expect((await request.get(ic.src)).status(), ic.src).toBe(200);
  expect(await page.locator('#menu-install').count()).toBe(1); // hidden until the browser offers an install prompt
});

test('route: Dhaka → Sylhet builds its own world (names, stops, scenery), finishes at Sylhet; switching routes reloads', async ({ page }) => {
  const errors = await boot(page, 'quality=low&hour=11&route=dhaka-sylhet&weather=clear');
  expect(await page.locator('#hud-route b').textContent()).toBe('ঢাকা → সিলেট');
  const w = await g(page, '(() => { const s = __game.stats(); const sc = __game.scene.getObjectByName("scenery"); return { stop0: __game.road.length > 6000, len: __game.road.length, sceneryMeshes: sc ? sc.children.length : 0 }; })()') as { len: number; sceneryMeshes: number };
  console.log('sylhet world', w);
  expect(w.len).toBeGreaterThan(6400); expect(w.sceneryMeshes).toBeGreaterThanOrEqual(2);
  await page.click('#menu-start'); await page.waitForTimeout(400);
  expect(await page.locator('.route-select button.on').textContent()).toContain('সিলেট');
  await page.screenshot({ path: `${SHOTS}/route-sylhet-pretrip.png` });
  await page.click('#pretrip-go'); await page.waitForTimeout(300);
  // Narsingdi stop serves passengers like Rajbari does
  await g(page, '(() => { __game.traffic.enabled = false; __game.teleport(1880); let st = __game.stats(); for (let i = 0; i < 60 && st.s < 1972; i++) st = __game.simulate(0.5, { throttle: 1, autopilot: true }); for (let i = 0; i < 40 && st.kmh > 2; i++) st = __game.simulate(0.5, { throttle: 0, brake: 1, autopilot: true }); __game.simulate(1.5, { throttle: 0, handbrake: true, autopilot: true }); __game.simulate(7, { throttle: 0, handbrake: true, autopilot: true }); })()');
  const st = await g(page, '(() => { const s = __game.stats(); return { stops: s.stops.map((x) => x.done), pax: s.passengers - (s.special ? 1 : 0), banner: document.getElementById("hud-banner-title").textContent }; })()') as { stops: boolean[]; pax: number };
  console.log('narsingdi', st);
  expect(st.stops[0]).toBe(true); expect(st.pax).toBe(24 - 7 + 12);
  await g(page, 'if (__game.choice.open) __game.choice.cancel()');
  await g(page, '__game.teleport(5450); __game.simulate(0.3, { throttle: 0, handbrake: true })'); await page.waitForTimeout(600);
  const sky = await g(page, '__game.renderAndRead(300, 20, 400, 100).meanLuma') as number;
  expect(sky, 'sky visible far from the origin (sky box follows the bus)').toBeGreaterThan(60);
  await page.screenshot({ path: `${SHOTS}/route-sylhet-teahills.png` });
  await g(page, '__game.teleport(6300); __game.simulate(30, { throttle: 1, autopilot: true })');
  await finished(page); await page.waitForTimeout(200);
  expect(await page.locator('#res-title').textContent()).toContain('সিলেটে');
  // switch back to Kushtia from the pre-trip card → reload with the other world
  await g(page, 'document.getElementById("results").classList.add("hidden"); __game.showPretrip()'); await page.waitForTimeout(300);
  await Promise.all([page.waitForNavigation({ waitUntil: 'load' }), page.click('.route-select button[data-route="kushtia-dhaka"]')]);
  await page.waitForFunction(() => (window as unknown as { __game?: { ready: boolean } }).__game?.ready === true, null, { timeout: 120_000 });
  expect(await page.locator('#hud-route b').textContent()).toBe('কুষ্টিয়া → ঢাকা');
  expect(errors).toEqual([]);
});
