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

interface GhostStats { available: boolean; bestTime: number | null; delta: number | null; visible: boolean; newBest: boolean; result: string | null; samples: number }
const ghost = (page: Page) => g(page, '(() => { const s = __game.stats(); return { ...s.ghost, finished: __game.finished, hud: document.getElementById("hud-ghost").className, hudVal: document.getElementById("hud-ghost-val").textContent, res: document.getElementById("res-ghost").textContent }; })()') as Promise<GhostStats & { finished: boolean; hud: string; hudVal: string; res: string }>;
const frames = async (page: Page, n: number) => { const f0 = await g(page, '__game.frames') as number; await page.waitForFunction(([f0, n]) => (window as unknown as { __game: { frames: number } }).__game.frames > f0 + n, [f0, n], { timeout: 180_000 }); };

test('ghost bus: the first finished trip is saved, the next trip races it (translucent bus + HUD delta), a slower trip loses and a faster one becomes the new best; story/challenge trips do not count; setting hides it', async ({ page }) => {
  test.setTimeout(900_000);
  const errors = await boot(page, 'quality=low&hour=10&hazards=0&view=chase');
  await start(page);
  let s = await ghost(page); expect(s.available).toBe(false); expect(s.hud).toContain('hidden');
  // trip 1: flat out from the end of the bridge
  await g(page, '__game.traffic.enabled = false; __game.simulate(3, { throttle: 1, autopilot: true }); __game.teleport(__game.stats().world.bridgeEndS + 20); __game.simulate(60, { throttle: 1, autopilot: true })');
  await frames(page, 2);
  s = await ghost(page); expect(s.finished).toBe(true); expect(s.available).toBe(true); expect(s.newBest).toBe(true); expect(s.samples).toBeGreaterThan(50); expect(s.res).toContain('প্রথম সম্পূর্ণ ট্রিপ');
  const best = s.bestTime!;
  // trip 2: half throttle — behind the ghost, which is visible ahead; results say it arrived earlier
  await boot(page, 'quality=low&hour=10&hazards=0&view=chase'); await start(page);
  s = await ghost(page); expect(s.available).toBe(true); expect(s.bestTime).toBeCloseTo(best, 1); expect(s.hud).toContain('hidden'); // nothing to compare before moving
  await g(page, '__game.traffic.enabled = false; __game.simulate(3, { throttle: 1, autopilot: true }); __game.teleport(__game.stats().world.bridgeEndS + 20); __game.simulate(8, { throttle: 0.45, autopilot: true })');
  await frames(page, 1);
  s = await ghost(page); expect(s.visible).toBe(true); expect(s.delta).toBeGreaterThan(0.5); expect(s.hud).toContain('behind'); expect(s.hudVal.startsWith('+')).toBe(true);
  await page.screenshot({ path: `${SHOTS}/ghost-behind.png` });
  await g(page, '__game.simulate(120, { throttle: 0.45, autopilot: true })'); await frames(page, 2);
  s = await ghost(page); expect(s.finished).toBe(true); expect(s.newBest).toBe(false); expect(s.res).toContain('আগে পৌঁছেছিল'); expect(s.bestTime).toBeCloseTo(best, 1);
  // trip 3: the same flat-out line but from further along → faster → new best
  await boot(page, 'quality=low&hour=10&hazards=0&view=chase'); await start(page);
  await g(page, '__game.traffic.enabled = false; __game.simulate(2, { throttle: 1, autopilot: true }); __game.teleport(__game.stats().world.bridgeEndS + 200); __game.simulate(60, { throttle: 1, autopilot: true })');
  await frames(page, 2);
  s = await ghost(page); expect(s.finished).toBe(true); expect(s.newBest).toBe(true); expect(s.bestTime!).toBeLessThan(best); expect(s.res).toContain('নতুন সেরা সময়');
  // the setting hides the ghost mid-trip
  await boot(page, 'quality=low&hour=10&hazards=0&view=chase'); await start(page);
  await g(page, '__game.settings.set("ghost", false); __game.traffic.enabled = false; __game.simulate(2, { throttle: 1, autopilot: true }); __game.teleport(__game.stats().world.bridgeEndS + 220); __game.simulate(4, { throttle: 1, autopilot: true })');
  await frames(page, 1);
  s = await ghost(page); expect(s.available).toBe(true); expect(s.visible).toBe(false); expect(s.delta).toBeNull();
  expect(errors).toEqual([]);
});

interface FatigueStats { value: number; breaks: number; microsleeps: number; asleep: boolean; tea: number; btnHidden: boolean }
const fat = (page: Page) => g(page, '(() => { const s = __game.stats(); return { ...s.fatigue, elapsed: __game.elapsed, kmh: s.kmh, mood: __game.passengers.mood, veil: +document.getElementById("fatigue-veil").style.opacity, blink: document.getElementById("fatigue-veil").classList.contains("blink"), net: __game.ledger.net }; })()') as Promise<FatigueStats & { elapsed: number; kmh: number; mood: number; veil: number; blink: boolean; net: number }>;

test('driver fatigue: climbs with driving time, darkens the view and lazies the steering past 60, micro-sleeps at 100; a chai break while stopped costs 3 minutes + ৳30 and restores the driver', async ({ page }) => {
  test.setTimeout(600_000);
  const errors = await boot(page, 'quality=low&hour=22&hazards=0&view=chase');
  await start(page);
  let s = await fat(page); expect(s.value).toBe(0); expect(s.btnHidden).toBe(true);
  // tiredness is clocked in the frame loop (real time): a few frames of driving nudge it up, the bar stays hidden under 15
  await g(page, '__game.traffic.enabled = false; __game.teleport(600); __game.simulate(5, { throttle: 0.8, autopilot: true }); __game.input.override = { throttle: 0.6 }; __game.autopilot = true');
  await frames(page, 3);
  s = await fat(page); expect(s.value).toBeGreaterThan(0); expect(s.veil).toBe(0);
  expect(await page.locator('#hud-fatigue').isVisible()).toBe(false);
  // tired: the veil shows and the bar turns orange
  await g(page, '__game.fatigue.value = 75'); await frames(page, 1);
  s = await fat(page); expect(s.veil).toBeGreaterThan(0.1); expect(s.veil).toBeLessThan(0.5);
  expect(await page.locator('#hud-fatigue').isVisible()).toBe(true); await expect(page.locator('#hud-fatigue-fill')).toHaveClass(/high/);
  // asleep at the wheel: a micro-sleep blinks the lids shut, steering drops to zero, the passengers shout
  await g(page, '__game.fatigue.value = 100; __game.fatigue.sinceSleep = 20'); await frames(page, 2);
  await g(page, '__game.simulate(1, { throttle: 0.8, autopilot: true })'); await frames(page, 1);
  s = await fat(page); expect(s.microsleeps).toBeGreaterThanOrEqual(1); expect(s.mood).toBeLessThan(75);
  await page.screenshot({ path: `${SHOTS}/fatigue-asleep.png` });
  // stop → the chai button appears; take the break
  await g(page, '__game.input.override = null; __game.autopilot = false; __game.simulate(6, { throttle: 0, brake: 1, handbrake: true })'); await frames(page, 2);
  s = await fat(page); expect(s.kmh).toBeLessThan(1); expect(s.btnHidden).toBe(false);
  const before = s;
  await page.click('#btn-chai', { force: true }); await page.waitForTimeout(400);
  expect(await g(page, '__game.choice.open')).toBe(true); await expect(page.locator('#choice-title')).toContainText('চা-বিরতি');
  await page.click('#choice-a', { force: true }); await page.waitForTimeout(500); await frames(page, 1);
  s = await fat(page);
  expect(s.breaks).toBe(1); expect(s.tea).toBe(30); expect(s.net).toBe(before.net - 30); expect(s.value).toBeCloseTo(35, 0); expect(s.elapsed - before.elapsed).toBeGreaterThanOrEqual(180);
  expect(s.mood).toBeGreaterThan(before.mood); expect(s.veil).toBe(0); expect(s.blink).toBe(false);
  // declining the offer changes nothing
  await g(page, '__game.fatigue.value = 50'); await frames(page, 1);
  await page.click('#btn-chai', { force: true }); await page.waitForTimeout(300); await page.click('#choice-b', { force: true }); await page.waitForTimeout(300);
  s = await fat(page); expect(s.breaks).toBe(1); expect(s.tea).toBe(30);
  expect(errors).toEqual([]);
});

test('controls: tilt steering maps the phone roll to analog steer (with calibration), a gamepad steers/throttles and its buttons fire once, bumps and crashes buzz the haptics', async ({ page }) => {
  test.setTimeout(600_000);
  const errors = await boot(page, 'quality=low&hour=10&view=chase');
  await start(page);
  // --- tilt -------------------------------------------------------------------------------
  await g(page, '__game.settings.set("steering", "tilt")'); await page.waitForTimeout(300);
  let inp = await g(page, '__game.stats().input') as { tilt: { enabled: boolean; angle: number | null; steer: number | null; permission: string }; scheme: string; analogSteer: number | null; haptics: string[] };
  expect(inp.scheme).toBe('tilt'); expect(inp.tilt.enabled).toBe(true); expect(inp.tilt.permission).toBe('granted');
  expect(await page.locator('#tilt-ui .bubble').count()).toBe(1);
  // feed a synthetic motion sample: the screen's right edge 15° down (in whatever orientation the headless screen reports)
  const feed = (deg: number) => g(page, `(() => { const t = (screen.orientation && screen.orientation.type) || 'portrait-primary'; const r = -Math.sin(${deg} * Math.PI / 180) * 9.8, u = Math.cos(${deg} * Math.PI / 180) * 9.8;
    let x, y; if (t === 'landscape-primary') { y = -r; x = u; } else if (t === 'landscape-secondary') { y = r; x = -u; } else if (t === 'portrait-secondary') { x = -r; y = -u; } else { x = r; y = u; }
    __game.input.tilt.onMotion({ accelerationIncludingGravity: { x, y, z: 0 } }); return __game.input.tilt.steer; })()`) as Promise<number | null>;
  const s15 = await feed(15); expect(s15).toBeGreaterThan(0.5); expect(s15).toBeLessThan(0.7);
  await frames(page, 1);
  inp = await g(page, '__game.stats().input') as typeof inp; expect(inp.analogSteer).toBeCloseTo(s15!, 2); expect(inp.tilt.angle).toBeCloseTo(15, 0);
  const sm15 = await feed(-15); expect(sm15).toBeLessThan(-0.5);
  // calibrate while tilted: that becomes the new zero
  await g(page, '__game.input.tilt.calibrate()'); expect(await feed(-15)).toBe(0); expect(await feed(0)).toBeGreaterThan(0.5);
  await g(page, '__game.settings.set("steering", "buttons")'); await page.waitForTimeout(200);
  inp = await g(page, '__game.stats().input') as typeof inp; expect(inp.tilt.enabled).toBe(false); expect(inp.tilt.steer).toBeNull();
  // --- gamepad ----------------------------------------------------------------------------
  const pad = await g(page, `(() => { const b = () => ({ pressed: false, touched: false, value: 0 }); const gp = { index: 0, id: 'Test Pad', connected: true, mapping: 'standard', timestamp: 0, axes: [0.6, 0, 0, 0], buttons: Array.from({ length: 17 }, b) };
    window.__pad = gp; navigator.getGamepads = () => [gp]; __game.input.gamepadIndex = 0; const r = { ...__game.input.poll() }; gp.buttons[7].value = 0.8; const r2 = { ...__game.input.poll() }; return { steer: r.steer, throttle: r2.throttle }; })()`) as { steer: number; throttle: number };
  expect(pad.steer).toBeCloseTo((0.6 - 0.12) / 0.88, 2); expect(pad.throttle).toBeCloseTo(0.8, 2);
  const cam0 = await g(page, '__game.cam.mode') as string;
  await g(page, '__pad.buttons[3].pressed = true; __game.input.poll(); __game.input.poll()');
  const cam1 = await g(page, '__game.cam.mode') as string; expect(cam1).not.toBe(cam0);
  await g(page, '__game.input.poll(); __game.input.poll()'); expect(await g(page, '__game.cam.mode')).toBe(cam1); // held = no repeat
  await g(page, '__pad.buttons[3].pressed = false; __game.input.poll(); __pad.buttons[3].pressed = true; __game.input.poll()');
  expect(await g(page, '__game.cam.mode')).not.toBe(cam1);
  await g(page, '__game.input.gamepadIndex = null; __pad.buttons[3].pressed = false');
  // --- haptics ----------------------------------------------------------------------------
  const b0 = await g(page, '__game.surface.breakers[0].s') as number;
  await g(page, `__game.traffic.enabled = false; __game.teleport(${b0} - 120); __game.cur.v = __game.prev.v = 16; __game.simulate(10, { throttle: 1 })`);
  inp = await g(page, '__game.stats().input') as typeof inp; expect(inp.haptics).toContain('thud');
  expect(errors).toEqual([]);
});
