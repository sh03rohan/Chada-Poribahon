import { test, expect, type Page } from '@playwright/test';
import fs from 'node:fs';

const SHOTS = 'test-results/screenshots';
fs.mkdirSync(SHOTS, { recursive: true });

async function boot(page: Page, query: string, errors: string[] = [], career: Record<string, unknown> | null = null) {
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript((c) => {
    localStorage.setItem('cp-settings', JSON.stringify({ introSeen: true, tutorialSeen: true }));
    if (c && !localStorage.getItem('cp-career')) localStorage.setItem('cp-career', JSON.stringify(c));
  }, career);
  await page.goto(`/?${query}`);
  await page.waitForFunction(() => (window as unknown as { __game?: { ready: boolean } }).__game?.ready === true, null, { timeout: 90_000 });
  await page.waitForTimeout(500);
  return errors;
}
const g = (page: Page, expr: string) => page.evaluate(expr);
const finished = (page: Page) => page.waitForFunction(() => (window as unknown as { __game: { finished: boolean } }).__game.finished === true, null, { timeout: 20_000 });
const ready = (page: Page) => page.waitForFunction(() => (window as unknown as { __game?: { ready: boolean } }).__game?.ready === true, null, { timeout: 90_000 });

test('career: fresh profile, a finished run pays into the balance, XP + level persist across reload', async ({ page }) => {
  const errors = await boot(page, 'quality=low&hour=11');
  expect(await page.locator('#career-chip').innerText()).toContain('লেভেল ১');
  await page.click('#menu-start'); await page.waitForTimeout(400); await page.click('#pretrip-go'); await page.waitForTimeout(300);
  await g(page, '__game.traffic.enabled = false; __game.teleport(5900); __game.simulate(25, { throttle: 1, autopilot: true })');
  await finished(page); await page.waitForTimeout(200);
  const o = await g(page, '__game.stats().lastOutcome') as { earned: number; xpGained: number; levelUp: boolean; balance: number };
  console.log('outcome', o);
  expect(o.earned).toBe(10800); expect(o.xpGained).toBeGreaterThan(300); expect(o.levelUp).toBe(true); expect(o.balance).toBe(10800);
  expect(await page.locator('#res-career').innerText()).toContain('XP');
  await page.screenshot({ path: `${SHOTS}/career-results.png` });
  await page.reload(); await ready(page); await page.waitForTimeout(400);
  const p = await g(page, '__game.stats().career') as { balance: number; trips: number; level: number };
  expect(p.balance).toBe(10800); expect(p.trips).toBe(1); expect(p.level).toBe(2);
  expect(await page.locator('#career-chip').innerText()).toContain('লেভেল ২');
  expect(errors).toEqual([]);
});

test('garage: upgrades cost balance, change braking / acceleration, repaint persists', async ({ page }) => {
  const errors = await boot(page, 'quality=low&hour=11', [], { balance: 40000, xp: 1500, trips: 4 });
  await page.click('#menu-start'); await page.waitForTimeout(400); await page.click('#pretrip-go'); await page.waitForTimeout(300);
  const brakeDist = () => g(page, '(() => { const g = __game; g.traffic.enabled = false; g.teleport(4700); let st = g.simulate(14, { throttle: 1, autopilot: true }); const s0 = st.s; for (let i = 0; i < 30 && st.kmh > 0.5; i++) st = g.simulate(0.25, { brake: 1, autopilot: true }); return st.s - s0; })()') as Promise<number>;
  const zeroToSixty = () => g(page, '(() => { const g = __game; g.teleport(4660); g.debug.resetMeasure(); return g.simulate(20, { throttle: 1, autopilot: true }).zeroToSixty; })()') as Promise<number>;
  const d0 = await brakeDist(), a0 = await zeroToSixty();
  await g(page, '__game.openGarage()'); await page.waitForTimeout(200);
  await page.screenshot({ path: `${SHOTS}/garage.png` });
  for (let i = 0; i < 3; i++) await page.click('.gbuy[data-up="brakes"]');
  await page.click('.gbuy[data-up="engine"]'); await page.click('.gbuy[data-up="engine"]');
  await page.click('.swatch[data-livery="2"]');
  expect(await page.locator('.gbuy[data-up="brakes"]').isDisabled(), 'maxed brakes').toBe(true);
  const c = await g(page, '__game.stats().career') as { balance: number; upgrades: { brakes: number; engine: number }; livery: number };
  expect(c.upgrades.brakes).toBe(3); expect(c.upgrades.engine).toBe(2); expect(c.livery).toBe(2);
  expect(c.balance).toBe(40000 - 3000 - 6000 - 10000 - 4000 - 8000 - 2000);
  await page.click('#garage-close');
  const d1 = await brakeDist(), a1 = await zeroToSixty();
  console.log('braking', d0, '→', d1, '0-60', a0, '→', a1);
  expect(d1).toBeLessThan(d0 * 0.9); expect(a1).toBeLessThan(a0 - 0.8);
  await page.reload(); await ready(page); await page.waitForTimeout(400);
  const m = await g(page, '__game.mods') as { brake: number; torque: number };
  expect(m.brake).toBeCloseTo(1.36, 2); expect(m.torque).toBeCloseTo(1.16, 2);
  expect(await g(page, '__game.stats().career.livery')).toBe(2);
  expect(errors).toEqual([]);
});

test('contracts: three daily offers on the pre-trip card; a met contract pays bonus + XP, a missed one does not', async ({ page }) => {
  const errors = await boot(page, 'quality=low&hour=11', [], { balance: 1000, xp: 2500, trips: 3 });
  await page.click('#menu-start'); await page.waitForTimeout(400);
  expect(await page.locator('#pretrip-contracts .contract').count(), 'none + 3 offers').toBe(4);
  await page.screenshot({ path: `${SHOTS}/contracts-pretrip.png` });
  await g(page, '__game.forceContract("ontime")');
  await page.click('#pretrip-go'); await page.waitForTimeout(300);
  expect(await page.locator('#toasts').innerText()).toContain('কন্ট্রাক্ট');
  await g(page, '__game.traffic.enabled = false; __game.teleport(5900); __game.simulate(25, { throttle: 1, autopilot: true })');
  await finished(page); await page.waitForTimeout(200);
  let st = await g(page, '(() => { const s = __game.stats(); return { done: s.lastContract?.done, earned: s.lastOutcome.earned, xp: s.lastOutcome.xpGained, balance: s.career.balance }; })()') as { done: boolean; earned: number; xp: number; balance: number };
  console.log('ontime', st);
  expect(st.done).toBe(true); expect(st.earned).toBe(10800 + 1500); expect(st.balance).toBe(1000 + 10800 + 1500);
  expect(await page.locator('#res-career .contract').innerText()).toContain('✅');
  // missed: "fullload" needs 30 passengers (a teleported run arrives with 24)
  await g(page, '__game.forceContract("fullload"); __game.startRun()'); await page.waitForTimeout(300);
  await g(page, '__game.traffic.enabled = false; __game.teleport(5900); __game.simulate(25, { throttle: 1, autopilot: true })');
  await finished(page); await page.waitForTimeout(200);
  st = await g(page, '(() => { const s = __game.stats(); return { done: s.lastContract?.done, earned: s.lastOutcome.earned, xp: s.lastOutcome.xpGained, balance: s.career.balance }; })()') as typeof st;
  console.log("fullload", st);
  expect(st.done).toBe(false); expect(st.earned).toBe(10800);
  expect(await page.locator('#res-career .contract').innerText()).toContain('❌');
  expect(errors).toEqual([]);
});
