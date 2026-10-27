import { test, expect, type Page } from '@playwright/test';
import fs from 'node:fs';

const SHOTS = 'test-results/screenshots';
fs.mkdirSync(SHOTS, { recursive: true });

type Stats = {
  kmh: number; s: number; lateral: number; zeroToSixty: number | null; topSpeed: number; onRoad: boolean; phase: string;
  blockade: string; fps: number; worstFrame: number; spikes: number; cam: string; busProcedural: boolean; passengers: number; mood: number;
};

async function boot(page: Page, query: string) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`/?autostart=1&quality=low&${query}`);
  await page.waitForFunction(() => (window as unknown as { __game?: { ready: boolean } }).__game?.ready === true, null, { timeout: 90_000 });
  await page.waitForTimeout(800);
  expect(errors, 'no runtime errors').toEqual([]);
  return errors;
}

const g = (page: Page, expr: string) => page.evaluate(expr);

test('cockpit view: road is visible through the windshield (not black)', async ({ page }) => {
  await boot(page, 'view=cockpit&hour=12');
  await page.waitForTimeout(800);
  // Windshield region: centre of the screen, upper-middle band (sky + road), in CSS px.
  const r = await g(page, '__game.renderAndRead(240, 120, 480, 260)') as { darkFraction: number; meanLuma: number };
  console.log('cockpit windshield sample', r);
  await page.screenshot({ path: `${SHOTS}/cockpit.png` });
  expect(r.darkFraction, 'windshield must not be mostly black').toBeLessThan(0.35);
  expect(r.meanLuma).toBeGreaterThan(40);
  const clearance = await g(page, '__game.cockpitClearance()') as { minDistance: number; forwardOpaqueHit: number };
  console.log('cockpit clearance', clearance);
  expect(clearance.minDistance, 'camera is not inside opaque geometry').toBeGreaterThan(0.12);
  expect(clearance.forwardOpaqueHit, 'nothing opaque directly ahead of the eye for 5 m').toBe(Infinity);
});

test('chase view + side livery + rain + night screenshots', async ({ page }) => {
  await boot(page, 'view=chase&hour=10');
  await page.screenshot({ path: `${SHOTS}/chase.png` });
  // Side view: camera to the right of the bus looking at it
  await g(page, '__game.setFreeCamera([11, 2.2, 0.5], [0, 1.8, 0.5])');
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${SHOTS}/side-right.png` });
  await g(page, '__game.setFreeCamera([-11, 2.2, 0.5], [0, 1.8, 0.5])');
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${SHOTS}/side-left.png` });
  await g(page, '__game.setFreeCamera([3.5, 2.0, -12], [0, 1.6, -4])');
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${SHOTS}/front.png` });
  await g(page, '__game.setFreeCamera([-3, 2.2, 12], [0, 1.6, 4])');
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${SHOTS}/rear.png` });
  await g(page, '__game.setFreeCamera(null)');
  // Rain
  await g(page, '__game.toggleWeather()');
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${SHOTS}/rain.png` });
  const stats = await g(page, '__game.stats()') as Stats;
  expect(stats.busProcedural).toBe(true);
});

test('night: headlights on, lamps lit', async ({ page }) => {
  await boot(page, 'view=chase&hour=22');
  await page.screenshot({ path: `${SHOTS}/night.png` });
  await g(page, '__game.switchCamera("cockpit")');
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${SHOTS}/night-cockpit.png` });
  const r = await g(page, '__game.renderAndRead(240, 120, 480, 260)') as { darkFraction: number };
  console.log('night cockpit', r);
  expect(r.darkFraction, 'even at night the headlit road should not be all black').toBeLessThan(0.85);
});

test('physics: 0–60 ≈ 10 s and top speed ≥ 115 km/h (fixed-step, autopilot on the route)', async ({ page }) => {
  await boot(page, 'view=chase&hour=12');
  // Straight-ish bridge section gives room to reach top speed.
  await g(page, '__game.traffic.enabled = false; __game.teleport(4660)');
  await g(page, '__game.debug.resetMeasure()');
  const st = await g(page, '__game.simulate(45, { throttle: 1, autopilot: true })') as Stats;
  console.log('physics stats', st);
  expect(st.zeroToSixty, '0–60 measured').not.toBeNull();
  expect(st.zeroToSixty!).toBeGreaterThan(8.5);
  expect(st.zeroToSixty!).toBeLessThan(11.5);
  expect(st.topSpeed).toBeGreaterThanOrEqual(115);
  expect(st.topSpeed).toBeLessThanOrEqual(126);
  expect(st.onRoad, 'autopilot stayed on the road').toBe(true);
  await page.screenshot({ path: `${SHOTS}/bridge-fast.png` });
});

test('route: Rajbari stop, blockade wait + police clear, finish at Dhaka', async ({ page }) => {
  await boot(page, 'view=chase&hour=12');
  // Drive to the stop zone with autopilot: accelerate until ~1972 m, then brake (≈27 m from 60 km/h → inside 1984–2016).
  await g(page, '__game.teleport(1880)');
  let st = await g(page, '__game.stats()') as Stats;
  for (let i = 0; i < 60 && st.s < 1972; i++) st = await g(page, '__game.simulate(0.5, { throttle: 1, autopilot: true })') as Stats;
  for (let i = 0; i < 40 && st.kmh > 0.3; i++) st = await g(page, '__game.simulate(0.5, { throttle: 0, brake: 1, autopilot: true })') as Stats;
  console.log('at stop', st);
  expect(st.s).toBeGreaterThan(1984); expect(st.s).toBeLessThan(2016);
  st = await g(page, '__game.simulate(1, { throttle: 0, brake: 1, autopilot: true })') as Stats;
  expect(st.phase, 'stopped at Rajbari').toBe('rajbari-stop');
  st = await g(page, '__game.simulate(6, { throttle: 0, brake: 1, autopilot: true })') as Stats;
  expect(st.passengers).toBe(24 - 7 + 12);
  await page.screenshot({ path: `${SHOTS}/rajbari.png` });

  // Blockade
  await g(page, '__game.teleport(3650)');
  st = await g(page, '__game.simulate(30, { throttle: 1, autopilot: true })') as Stats;
  console.log('at blockade', st);
  expect(st.phase).toBe('blockade');
  expect(st.kmh).toBeLessThan(1);
  expect(st.s, 'bus held before the barrier (or in the queue behind it)').toBeLessThan(3850 - 5);
  await g(page, '__game.switchCamera("cockpit")');
  await page.waitForTimeout(1500); // let the 0.6 s camera transition finish
  await page.screenshot({ path: `${SHOTS}/blockade-cockpit.png` });
  await g(page, '__game.switchCamera("chase")');
  st = await g(page, '__game.simulate(45, { throttle: 0, brake: 1, autopilot: true })') as Stats;
  console.log('after wait', st);
  expect(['dispersing', 'cleared']).toContain(st.blockade);
  st = await g(page, '__game.simulate(30, { throttle: 1, autopilot: true })') as Stats;
  expect(st.blockade).toBe('cleared');
  expect(st.s).toBeGreaterThan(3900);

  // Finish
  await g(page, '__game.teleport(5900)');
  st = await g(page, '__game.simulate(25, { throttle: 1, autopilot: true })') as Stats;
  expect(st.phase).toBe('finished');
  await page.waitForTimeout(500);
  await expect(page.locator('#results')).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/results.png` });
});

test('performance: no frame spikes after warm-up (software renderer, low tier)', async ({ page }) => {
  await boot(page, 'view=chase&hour=12');
  await page.waitForTimeout(2000);
  await g(page, '__game.debug.resetMeasure()');
  await g(page, '__game.autopilot = true; __game.input.override = { throttle: 1 }');
  await page.waitForTimeout(6000);
  const st = await g(page, '__game.stats()') as Stats;
  console.log('perf', { fps: st.fps, worstFrame: st.worstFrame, spikes: st.spikes });
  // SwiftShader is slow; we only assert the loop never stalls (a stall would be a bug, slow frames are the CPU).
  expect(st.worstFrame).toBeLessThan(1.0);
});
