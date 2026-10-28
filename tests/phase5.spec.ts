import { test, expect, type Page } from '@playwright/test';
import fs from 'node:fs';

const SHOTS = 'test-results/screenshots';
fs.mkdirSync(SHOTS, { recursive: true });

async function boot(page: Page, query: string, errors: string[] = []) {
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(() => localStorage.setItem('cp-settings', JSON.stringify({ introSeen: true, tutorialSeen: true })));
  await page.goto(`/?${query}`);
  await page.waitForFunction(() => (window as unknown as { __game?: { ready: boolean } }).__game?.ready === true, null, { timeout: 120_000 });
  await page.waitForTimeout(500);
  return errors;
}
const g = (page: Page, expr: string) => page.evaluate(expr);
const finished = (page: Page) => page.waitForFunction(() => (window as unknown as { __game: { finished: boolean } }).__game.finished === true, null, { timeout: 20_000 });

test('chattogram route: hills + sea scenery, Chandpur fork, finishes in Chattogram', async ({ page }) => {
  const errors = await boot(page, 'quality=low&hour=11&route=dhaka-chattogram');
  expect(await page.locator('#hud-route b').innerText()).toContain('চট্টগ্রাম');
  await page.click('#menu-start'); await page.waitForTimeout(400);
  expect(await page.locator('.route-select button.on').innerText()).toContain('চট্টগ্রাম');
  await page.click('#pretrip-go'); await page.waitForTimeout(300);
  await g(page, '__game.traffic.enabled = false; __game.teleport(6150); __game.simulate(0.3, { throttle: 0, handbrake: true })'); await page.waitForTimeout(300);
  await page.screenshot({ path: `${SHOTS}/chattogram-sea.png` });
  await g(page, '__game.teleport(__game.road.length - 160); __game.simulate(30, { throttle: 1, autopilot: true })');
  await finished(page); await page.waitForTimeout(200);
  await expect(page.locator('#res-title')).toContainText('চট্টগ্রাম', { timeout: 5000 });
  expect(errors).toEqual([]);
});

test('weather: forecast on pre-trip, fog thickens + headlights, storm rains + lightning, button cycles', async ({ page }) => {
  const errors = await boot(page, 'quality=low&hour=11&weather=fog');
  await page.click('#menu-start'); await page.waitForTimeout(400);
  await expect(page.locator('#pretrip-weather')).toContainText('কুয়াশা');
  await page.click('#pretrip-go'); await page.waitForTimeout(300);
  const st = () => g(page, '(() => { const s = __game.stats(); return { weather: s.weather, wet: s.wet, fog: s.fogDensity, lightning: s.lightning, btn: document.getElementById("btn-weather").textContent }; })()') as Promise<{ weather: string; wet: number; fog: number; lightning: number; btn: string }>;
  const fog = await st();
  expect(fog.weather).toBe('fog'); expect(fog.fog).toBeGreaterThan(0.005); expect(fog.wet).toBeLessThan(0.1);
  expect(await g(page, '__game.bus.headlights.some((s) => s.intensity > 0)')).toBeTruthy();
  await page.screenshot({ path: `${SHOTS}/weather-fog.png` });
  await g(page, '__game.applyWeather("storm", true); __game.lightningIn = 0.1; __game.simulate(1, { throttle: 0.3 })'); await page.waitForTimeout(300);
  const storm = await st();
  expect(storm.weather).toBe('storm'); expect(storm.wet).toBeGreaterThan(0.9); expect(storm.lightning).toBeGreaterThanOrEqual(1); expect(storm.btn).toBe('⛈️');
  await page.screenshot({ path: `${SHOTS}/weather-storm.png` });
  await page.click('#btn-weather'); await page.waitForTimeout(200);
  expect((await st()).weather).toBe('clear');
  await expect(page.locator('#hud-msg')).toContainText('পরিষ্কার');
  expect(errors).toEqual([]);
});
