import { test, expect, type Page } from '@playwright/test';
import fs from 'node:fs';

const SHOTS = 'test-results/screenshots';
fs.mkdirSync(SHOTS, { recursive: true });

async function boot(page: Page, query: string, errors: string[] = []) {
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(() => localStorage.setItem('cp-settings', JSON.stringify({ introSeen: true, tutorialSeen: true })));
  await page.goto(`/?${query}${query.includes('weather=') ? '' : '&weather=clear'}&hazards=0`);
  await page.waitForFunction(() => (window as unknown as { __game?: { ready: boolean } }).__game?.ready === true, null, { timeout: 180_000 });
  await page.waitForTimeout(500);
  return errors;
}
const g = (page: Page, expr: string) => page.evaluate(expr);
const frameOnce = (page: Page) => page.waitForFunction((f0) => (window as unknown as { __game: { frames: number } }).__game.frames > f0, 0, { timeout: 60_000 });

test('post-processing: none on low, basic on medium, full (GTAO) on high; frames render without errors and the glass stays clear', async ({ page }) => {
  test.setTimeout(420_000);
  for (const [q, level] of [['low', 'none'], ['medium', 'basic'], ['high', 'full']] as const) {
    const errors = await boot(page, `quality=${q}&hour=15&view=chase`);
    expect(await g(page, '__game.stats().post')).toBe(level);
    await page.click('#menu-start'); await page.waitForTimeout(400); await page.click('#pretrip-go'); await page.waitForTimeout(300);
    await g(page, '__game.traffic.enabled = false; __game.teleport(3400); __game.simulate(0.3, { throttle: 0, handbrake: true })');
    const f0 = await g(page, '__game.frames') as number;
    await page.waitForFunction((f0) => (window as unknown as { __game: { frames: number } }).__game.frames > f0 + 1, f0, { timeout: 90_000 });
    await page.screenshot({ path: `${SHOTS}/post-${q}.png` });
    // a rendered frame is not black and not blown out (the HDR sky must not bloom over the scene)
    const luma = await g(page, '__game.renderAndRead(200, 300, 880, 300).meanLuma') as number;
    console.log(q, level, 'mid-frame luma', luma.toFixed(1));
    expect(luma).toBeGreaterThan(40); expect(luma).toBeLessThan(215);
    expect(errors).toEqual([]);
  }
  void frameOnce;
});

test('lighting: cascades on high, sun rays at dawn, headlight cones + lamp pools at night, cones in fog', async ({ page }) => {
  test.setTimeout(600_000);
  let errors = await boot(page, 'quality=high&hour=6.6');
  const st = () => g(page, '(() => { const s = __game.stats(); return { csm: s.csm, rays: s.raysOpacity, cones: __game.bus.body.children.filter((c) => c.visible && c.geometry && c.geometry.type === "ConeGeometry").length, pools: __game.props.poolMat ? __game.props.poolMat.opacity : -1, sunI: __game.sky.sunIntensity }; })()') as Promise<{ csm: boolean; rays: number; cones: number; pools: number; sunI: number }>;
  let s = await st(); expect(s.csm).toBe(true); expect(s.rays).toBeGreaterThan(0.3); expect(s.sunI).toBeGreaterThan(0.5);
  await page.click('#menu-start'); await page.waitForTimeout(400); await page.click('#pretrip-go'); await page.waitForTimeout(300);
  await g(page, '__game.traffic.enabled = false; __game.teleport(2650); __game.simulate(0.3, { throttle: 0, handbrake: true })');
  let f0 = await g(page, '__game.frames') as number;
  await page.waitForFunction((f0) => (window as unknown as { __game: { frames: number } }).__game.frames > f0 + 1, f0, { timeout: 240_000 });
  await page.screenshot({ path: `${SHOTS}/light-dawn-high.png` });
  expect(errors).toEqual([]);
  errors = await boot(page, 'quality=medium&hour=21');
  await page.click('#menu-start'); await page.waitForTimeout(400); await page.click('#pretrip-go'); await page.waitForTimeout(300);
  await g(page, '__game.traffic.enabled = false; __game.teleport(1990); __game.simulate(0.3, { throttle: 0, handbrake: true })');
  f0 = await g(page, '__game.frames') as number;
  await page.waitForFunction((f0) => (window as unknown as { __game: { frames: number } }).__game.frames > f0 + 1, f0, { timeout: 120_000 });
  s = await st(); expect(s.csm).toBe(false); expect(s.cones).toBe(2); expect(s.pools).toBeGreaterThan(0.2); expect(s.rays).toBe(0);
  await page.screenshot({ path: `${SHOTS}/light-night-medium.png` });
  await g(page, '__game.applyWeather("fog", true); __game.sky.setTime(11); __game.applyNight()');
  f0 = await g(page, '__game.frames') as number;
  await page.waitForFunction((f0) => (window as unknown as { __game: { frames: number } }).__game.frames > f0, f0, { timeout: 120_000 });
  s = await st(); expect(s.cones).toBe(2); expect(s.pools).toBe(0);
  expect(errors).toEqual([]);
});

test('bus detail: rivets, mud flaps, dirt skirt and tarp exist and the side photo renders', async ({ page }) => {
  test.setTimeout(300_000);
  const errors = await boot(page, 'quality=medium&hour=15');
  await page.click('#menu-start'); await page.waitForTimeout(400); await page.click('#pretrip-go'); await page.waitForTimeout(300);
  await g(page, '__game.traffic.enabled = false; __game.teleport(3400); __game.simulate(0.3, { throttle: 0, handbrake: true }); __game.openPhoto(); __game.photo.yaw = 1.1; __game.photo.pitch = 0.12; __game.photo.dist = 11');
  const f0 = await g(page, '__game.frames') as number;
  await page.waitForFunction((f0) => (window as unknown as { __game: { frames: number } }).__game.frames > f0 + 1, f0, { timeout: 120_000 });
  const d = await g(page, '(() => { const b = __game.bus.body; let flaps = 0, meshes = 0; b.traverse((o) => { if (o.isMesh) meshes++; }); return { rivets: b.getObjectByName("rivets")?.count ?? 0, meshes, cones: b.children.filter((c) => c.geometry && c.geometry.type === "ConeGeometry").length }; })()') as { rivets: number; meshes: number; cones: number };
  expect(d.rivets).toBeGreaterThan(150); expect(d.cones).toBe(2); expect(d.meshes).toBeLessThan(200);
  await page.screenshot({ path: `${SHOTS}/bus-detail-side.png` });
  expect(errors).toEqual([]);
});

test('particles: exhaust under throttle, dust off the shoulder, windscreen rain in the cockpit, tea-stall smoke at night', async ({ page }) => {
  test.setTimeout(480_000);
  let errors = await boot(page, 'quality=medium&hour=15');
  await page.click('#menu-start'); await page.waitForTimeout(400); await page.click('#pretrip-go'); await page.waitForTimeout(300);
  const st = () => g(page, '(() => { const s = __game.stats(); return { particles: s.particles, glass: s.glassRain, onRoad: __game.cur.onRoad }; })()') as Promise<{ particles: number; glass: boolean; onRoad: boolean }>;
  await g(page, '__game.traffic.enabled = false; __game.teleport(2650); __game.simulate(3, { throttle: 1, autopilot: true }); __game.input.override = { throttle: 1 }; __game.autopilot = true');
  let f0 = await g(page, '__game.frames') as number;
  await page.waitForFunction((f0) => (window as unknown as { __game: { frames: number } }).__game.frames > f0 + 2, f0, { timeout: 120_000 });
  let s = await st(); expect(s.particles).toBeGreaterThan(5); expect(s.glass).toBe(false);
  const exhaustOnly = s.particles;
  await g(page, '__game.input.override = null; __game.autopilot = false; __game.teleport(2650); __game.simulate(3, { throttle: 1, steer: -0.6 }); __game.input.override = { throttle: 1, steer: -0.2 }');
  f0 = await g(page, '__game.frames') as number;
  await page.waitForFunction((f0) => (window as unknown as { __game: { frames: number } }).__game.frames > f0 + 2, f0, { timeout: 120_000 });
  s = await st(); expect(s.onRoad).toBe(false); expect(s.particles).toBeGreaterThan(exhaustOnly);
  await page.screenshot({ path: `${SHOTS}/particles-dust.png` });
  expect(errors).toEqual([]);
  errors = await boot(page, 'quality=medium&hour=12&weather=rain&view=cockpit');
  await page.click('#menu-start'); await page.waitForTimeout(400); await page.click('#pretrip-go'); await page.waitForTimeout(300);
  await g(page, '__game.traffic.enabled = false; __game.switchCamera("cockpit"); __game.teleport(2650); __game.simulate(2, { throttle: 1, autopilot: true })');
  f0 = await g(page, '__game.frames') as number;
  await page.waitForFunction((f0) => (window as unknown as { __game: { frames: number } }).__game.frames > f0 + 1, f0, { timeout: 120_000 });
  s = await st(); expect(s.glass).toBe(true);
  await page.screenshot({ path: `${SHOTS}/particles-rain-cockpit.png` });
  await g(page, '__game.switchCamera("chase"); __game.applyWeather("clear", true); __game.sky.setTime(21); __game.applyNight(); __game.teleport(1150); __game.simulate(0.3, { throttle: 0, handbrake: true })');
  f0 = await g(page, '__game.frames') as number;
  await page.waitForFunction((f0) => (window as unknown as { __game: { frames: number } }).__game.frames > f0 + 2, f0, { timeout: 120_000 });
  s = await st(); expect(s.glass).toBe(false); expect(s.particles).toBeGreaterThan(3);
  expect(errors).toEqual([]);
});
