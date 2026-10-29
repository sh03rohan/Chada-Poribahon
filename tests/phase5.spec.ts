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

const stopAt = (page: Page, s: number) => g(page, `(() => { __game.teleport(${s}); __game.simulate(1, { throttle: 0.5, autopilot: true }); for (let i = 0; i < 30 && __game.stats().kmh > 2; i++) __game.simulate(0.5, { throttle: 0, brake: 0.6, autopilot: true }); __game.simulate(1.5, { throttle: 0, handbrake: true, autopilot: true }); })()`);

test('special passengers: dadi boards at Rajbari with a goal, tips at Faridpur after a smooth leg; student fails a slow leg', async ({ page }) => {
  const errors = await boot(page, 'quality=low&hour=11&weather=clear');
  await page.click('#menu-start'); await page.waitForTimeout(400); await page.click('#pretrip-go'); await page.waitForTimeout(300);
  await g(page, '__game.traffic.enabled = false; __game.forceSpecial("dadi")');
  await stopAt(page, 1990);
  await g(page, '__game.simulate(10, { throttle: 0, handbrake: true, autopilot: true })'); await page.waitForTimeout(200);
  let st = await g(page, '(() => { const s = __game.stats(); return { special: s.special, done: s.specialsDone, tips: s.tips, goal: document.getElementById("hud-goal").textContent, hidden: document.getElementById("hud-goal").classList.contains("hidden") }; })()') as { special: string | null; done: { id: string; ok: boolean }[]; tips: number; goal: string; hidden: boolean };
  expect(st.special).toBe('dadi'); expect(st.hidden).toBe(false); expect(st.goal).toContain('হার্ড ব্রেক');
  await page.screenshot({ path: `${SHOTS}/special-boarded.png` });
  await g(page, '__game.choice.cancel()');
  await stopAt(page, 3430); await page.waitForTimeout(200);
  st = await g(page, '(() => { const s = __game.stats(); return { special: s.special, done: s.specialsDone, tips: s.tips, goal: "", hidden: document.getElementById("hud-goal").classList.contains("hidden") }; })()') as typeof st;
  expect(st.special).toBeNull(); expect(st.done).toEqual([{ id: 'dadi', ok: true }]); expect(st.tips).toBe(200); expect(st.hidden).toBe(true);
  // student wants speed: creep the leg Faridpur → Bhanga slowly and the exam is missed (no tip, mood dips)
  await g(page, '__game.forceSpecial("student"); __game.simulate(10, { throttle: 0, handbrake: true, autopilot: true })'); await page.waitForTimeout(100);
  expect((await g(page, '__game.stats().special'))).toBe('student');
  await g(page, '__game.elapsed += 400');
  const moodBefore = await g(page, '__game.passengers.mood') as number;
  await stopAt(page, 4470); await page.waitForTimeout(200);
  st = await g(page, '(() => { const s = __game.stats(); return { special: s.special, done: s.specialsDone, tips: s.tips, goal: "", hidden: true }; })()') as typeof st;
  expect(st.done[1]).toEqual({ id: 'student', ok: false }); expect(st.tips).toBe(200);
  expect(await g(page, '__game.passengers.mood') as number).toBeLessThan(moodBefore + 6);
  await g(page, '__game.simulate(10, { throttle: 0, handbrake: true, autopilot: true }); __game.teleport(__game.road.length - 160); __game.simulate(30, { throttle: 1, autopilot: true })');
  await finished(page); await page.waitForTimeout(200);
  expect(await page.locator('#results').innerText()).toContain('বকশিশ');
  expect(await g(page, '__game.stats().lastBadges') as string[]).toContain('tipped');
  expect(errors).toEqual([]);
});

test('audio layers: crowd near a stand, bell + train at the crossing, siren at the blockade, water on the bridge; fine plays a sting', async ({ page }) => {
  const errors = await boot(page, 'quality=low&hour=11&weather=clear');
  await page.click('#menu-start'); await page.waitForTimeout(400); await page.click('#pretrip-go'); await page.waitForTimeout(300);
  expect(await g(page, '__game.audio.ready')).toBe(true);
  const lv = (k: string, min: number) => page.waitForFunction(([k, min]) => (window as unknown as { __game: { audio: { levels: Record<string, number> } } }).__game.audio.levels[k] >= min, [k, min] as [string, number], { timeout: 8000 });
  await g(page, '__game.traffic.enabled = false; __game.teleport(1950); __game.simulate(0.3, { throttle: 0, handbrake: true })');
  await lv('crowd', 0.2);
  await g(page, '__game.teleport(__game.stats().world.railS - 150); __game.simulate(0.5, { throttle: 0.3, autopilot: true }); for (let i = 0; i < 20 && __game.stats().kmh > 2; i++) __game.simulate(0.5, { throttle: 0, brake: 0.8, autopilot: true }); __game.simulate(4, { throttle: 0, handbrake: true })');
  expect(await g(page, '__game.stats().rail')).toBe('closed');
  await lv('bell', 0.05); await lv('train', 0.2);
  await g(page, '__game.teleport(__game.stats().world.andolonS - 60); __game.simulate(0.3, { throttle: 0, handbrake: true }); __game.blockade.startWaiting(); __game.blockade.forcePolice(); __game.simulate(0.5, { throttle: 0, handbrake: true })');
  await lv('siren', 0.5); await lv('crowd', 0.5);
  await g(page, '__game.teleport(__game.stats().world.bridgeStartS + 200); __game.simulate(0.3, { throttle: 0, handbrake: true })');
  await lv('water', 0.6);
  expect(errors).toEqual([]);
});

test('photo mode: pause → orbit camera with HUD hidden, saves a captioned PNG, F / Esc toggle from driving', async ({ page }) => {
  const errors = await boot(page, 'quality=low&hour=16&weather=clear');
  await page.click('#menu-start'); await page.waitForTimeout(400); await page.click('#pretrip-go'); await page.waitForTimeout(300);
  await g(page, '__game.traffic.enabled = false; __game.teleport(3400); __game.simulate(0.3, { throttle: 0, handbrake: true })');
  await page.keyboard.press('KeyP'); await page.waitForTimeout(200);
  await page.click('#pause-photo'); await page.waitForTimeout(200);
  expect(await g(page, '(() => ({ on: __game.photo.on, paused: __game.paused, hud: document.getElementById("hud").classList.contains("hidden"), pause: document.getElementById("pause").classList.contains("hidden") }))()')).toEqual({ on: true, paused: true, hud: true, pause: true });
  const before = await g(page, '__game.photo.yaw') as number;
  await page.mouse.move(640, 360); await page.mouse.down(); await page.mouse.move(400, 360, { steps: 6 }); await page.mouse.up();
  expect(await g(page, '__game.photo.yaw') as number).not.toBeCloseTo(before, 3);
  const dl = page.waitForEvent('download', { timeout: 20_000 });
  await page.click('#photo-save');
  const d = await dl; expect(d.suggestedFilename()).toMatch(/chada-poribohon-\d+\.png/);
  expect(await g(page, '__game.photo.lastBlob?.size ?? 0') as number).toBeGreaterThan(20_000);
  await page.screenshot({ path: `${SHOTS}/photo-mode.png` });
  await page.click('#photo-close'); await page.waitForTimeout(200);
  expect(await g(page, '(() => ({ on: __game.photo.on, paused: __game.paused, pause: document.getElementById("pause").classList.contains("hidden") }))()')).toEqual({ on: false, paused: true, pause: false });
  await page.click('#pause-resume'); await page.waitForTimeout(100);
  await page.keyboard.press('KeyF'); await page.waitForTimeout(100);
  expect(await g(page, '__game.photo.on')).toBe(true);
  await page.keyboard.press('Escape'); await page.waitForTimeout(100);
  expect(await g(page, '(() => ({ on: __game.photo.on, paused: __game.paused }))()')).toEqual({ on: false, paused: false });
  expect(errors).toEqual([]);
});
