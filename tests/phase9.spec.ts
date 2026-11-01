import { test, expect, type Page } from '@playwright/test';
import fs from 'node:fs';

const SHOTS = 'test-results/screenshots';
fs.mkdirSync(SHOTS, { recursive: true });

async function boot(page: Page, query: string, errors: string[] = []) {
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(() => localStorage.setItem('cp-settings', JSON.stringify({ introSeen: true, tutorialSeen: true })));
  await page.goto(`/?${query}${query.includes('weather=') ? '' : '&weather=clear'}`, { waitUntil: 'commit' });
  await page.waitForFunction(() => (window as unknown as { __game?: { ready: boolean } }).__game?.ready === true, null, { timeout: 180_000 });
  await page.waitForTimeout(500);
  return errors;
}
const g = (page: Page, expr: string) => page.evaluate(expr);
const start = async (page: Page) => { await page.click('#menu-start', { timeout: 120_000, force: true }); await page.waitForTimeout(400); await page.click('#pretrip-go', { timeout: 120_000, force: true }); await page.waitForTimeout(300); };

interface SurfaceStats { breakers: number[]; potholes: number; crossed: number; fast: number; potholeHits: number; log: { kind: string; kmh: number; s: number }[]; damage: number; mood: number; kmh: number }
const surf = (page: Page) => g(page, '(() => { const s = __game.stats(); return { breakers: s.surface.breakers, potholes: s.surface.potholes, crossed: s.surface.crossed, fast: s.surface.fast, potholeHits: s.surface.potholeHits, log: s.surface.log, damage: s.damage, mood: __game.passengers.mood, kmh: s.kmh }; })()') as Promise<SurfaceStats>;

test('road surface: speed breakers flank every town stop with signs, potholes dot the open road; fast crossings cost mood + damage, slow ones nothing; autopilot eases off', async ({ page }) => {
  test.setTimeout(600_000);
  const errors = await boot(page, 'quality=low&hour=10&view=chase');
  await start(page);
  let s = await surf(page);
  // two per stop town (3 towns with passengers) minus any that fall on a bridge/roundabout bulge; ?hazards=0 would give none
  expect(s.breakers.length).toBeGreaterThanOrEqual(4); expect(s.potholes).toBeGreaterThan(10);
  for (const b of s.breakers) expect(s.breakers.filter((x) => Math.abs(x - b) < 1).length).toBe(1);
  const [b0, b1] = s.breakers;
  // fast: hit the first breaker at ~70 km/h
  await g(page, `__game.traffic.enabled = false; __game.teleport(${b0} - 120); __game.cur.v = __game.prev.v = 16; __game.simulate(10, { throttle: 1 })`);
  s = await surf(page);
  expect(s.crossed).toBe(1); expect(s.fast).toBe(1); expect(s.log[0].kind).toBe('breaker'); expect(s.log[0].kmh).toBeGreaterThan(40);
  expect(s.damage).toBeGreaterThan(2); expect(s.mood).toBeLessThan(75);
  const dmg = s.damage, mood = s.mood;
  // slow: creep over the second one at < 20 km/h — no penalty
  await g(page, `__game.teleport(${b1} - 30); __game.simulate(4, { throttle: 0.25 }); __game.simulate(6, { throttle: 0.12 })`);
  s = await surf(page);
  expect(s.crossed).toBe(2); expect(s.fast).toBe(1); expect(s.log[1].kmh).toBeLessThan(25); expect(s.damage).toBe(dmg); expect(s.mood).toBe(mood);
  // pothole: aim the left wheel track at the first one at ~65 km/h
  await g(page, `(() => { const ph = __game.surface.potholes[0]; __game.teleport(ph.s - 120); const f = __game.road.sample(ph.s - 120); const lat = ph.lat - 1.05; __game.cur.x = __game.prev.x = f.x + f.rx * lat; __game.cur.z = __game.prev.z = f.z + f.rz * lat; __game.cur.v = __game.prev.v = 14; __game.simulate(9, { throttle: 0.9 }); })()`);
  s = await surf(page);
  expect(s.potholeHits).toBe(1); expect(s.damage).toBeGreaterThan(dmg);
  // autopilot: full throttle toward the first breaker from 160 m back, but it brakes to under 40
  await g(page, `__game.teleport(${b0} - 160); __game.cur.v = __game.prev.v = 15; __game.simulate(12, { throttle: 1, autopilot: true })`);
  s = await surf(page);
  const last = s.log[s.log.length - 1];
  expect(last.kind).toBe('breaker'); expect(last.s).toBe(b0); expect(last.kmh).toBeLessThan(40);
  // the hump is sampled under the axles: parked on it, the front axle height is positive
  await g(page, `__game.teleport(${b0} - 3.2); __game.simulate(0.5, { throttle: 0, handbrake: true })`);
  expect(await g(page, '__game.stats().surface.bumpFront') as number).toBeGreaterThan(0.05);
  await page.screenshot({ path: `${SHOTS}/surface-on-hump.png` });
  expect(errors).toEqual([]);
  // hazards=0 keeps the old deterministic road for the earlier suites
  await boot(page, 'quality=low&hour=10&hazards=0');
  expect((await g(page, '__game.stats().surface.breakers') as number[]).length).toBe(0);
});
