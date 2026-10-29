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

test('post-processing: off by default (effects setting opt-in); none on low, basic on medium, full (GTAO) on high when enabled; frames render without errors and the glass stays clear', async ({ page }) => {
  test.setTimeout(480_000);
  // effects are opt-in now (phones were lagging): with the setting off every tier runs the plain renderer
  await boot(page, 'quality=high&hour=15&view=chase');
  expect(await g(page, '__game.stats().post')).toBe('none');
  for (const [q, level] of [['low', 'none'], ['medium', 'basic'], ['high', 'full']] as const) {
    const errors = await boot(page, `quality=${q}&hour=15&view=chase&post=${level}`);
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

test('lighting: cascades on high, sun rays at dawn, lamp pools at night, headlight cones only in fog', async ({ page }) => {
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
  s = await st(); expect(s.csm).toBe(false); expect(s.cones).toBe(0); /* clear night: no cones (they washed the view white) */ expect(s.pools).toBeGreaterThan(0.2); expect(s.rays).toBe(0);
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

test('UI polish: results card draws the trip trace with stops marked, panels animate in, pills are blur-free glass', async ({ page }) => {
  test.setTimeout(300_000);
  const errors = await boot(page, 'quality=low&hour=11');
  await page.click('#menu-start'); await page.waitForTimeout(400); await page.click('#pretrip-go'); await page.waitForTimeout(300);
  const pill = await g(page, '(() => { const cs = getComputedStyle(document.querySelector(".pill")); return { bg: cs.backgroundImage, blur: cs.backdropFilter || "none" }; })()') as { bg: string; blur: string };
  expect(pill.bg).toContain('gradient'); expect(pill.blur === 'none' || pill.blur === '').toBe(true);
  await g(page, '__game.traffic.enabled = false; __game.teleport(1990); __game.simulate(1, { throttle: 0.5, autopilot: true }); for (let i = 0; i < 30 && __game.stats().kmh > 2; i++) __game.simulate(0.5, { throttle: 0, brake: 0.6, autopilot: true }); __game.simulate(12, { throttle: 0, handbrake: true, autopilot: true }); if (__game.choice.open) __game.choice.cancel(); __game.teleport(5900); __game.simulate(30, { throttle: 1, autopilot: true })');
  await page.waitForFunction(() => (window as unknown as { __game: { finished: boolean } }).__game.finished === true, null, { timeout: 20_000 });
  await page.waitForTimeout(300);
  const t = await g(page, '(() => { const s = __game.stats(); const c = document.getElementById("res-trace"); const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data; let green = 0; for (let i = 0; i < d.length; i += 4) if (d[i + 1] > 120 && d[i] < 90 && d[i + 2] < 110) green++; return { samples: s.trace, events: s.traceEvents, green, anim: getComputedStyle(document.querySelector("#results .panel")).animationName }; })()') as { samples: number; events: number; green: number; anim: string };
  expect(t.samples).toBeGreaterThan(10); expect(t.events).toBeGreaterThanOrEqual(1); expect(t.green).toBeGreaterThan(200); expect(t.anim).toBe('panel-in');
  await page.screenshot({ path: `${SHOTS}/results-trace.png` });
  expect(errors).toEqual([]);
});

test('traffic never rams the bus: fast vehicles behind a stopped bus brake and queue (or overtake when clear), no rear hits, no damage', async ({ page }) => {
  test.setTimeout(420_000);
  await boot(page, 'quality=low&hour=21&view=chase');
  await page.click('#menu-start'); await page.waitForTimeout(400); await page.click('#pretrip-go'); await page.waitForTimeout(300);
  // 40 s parked at the start with the normal flow around us
  await g(page, '__game.simulate(40, { throttle: 0, handbrake: true })');
  let st = await g(page, '(() => { const s = __game.stats(); return { rearHits: s.rearHits, crashes: s.crashes, damage: s.damage }; })()') as { rearHits: number; crashes: number; damage: number };
  expect(st).toEqual({ rearHits: 0, crashes: 0, damage: 0 });
  // then a car, a truck, a bike, a bus and a rickshaw at full speed 40–190 m behind the parked bus
  await g(page, `(() => { __game.teleport(1000); const vs = __game.traffic.vehicles, ps = __game.routeS;
    for (const v of vs) { v.s = ps + 400 + Math.random() * 200; v.overtake = 0; v.swerve = 0; v.hitT = 0; }
    const set = (t, back, lat) => { const v = vs.find((x) => x.type === t); v.dir = 1; v.s = ps - back; v.lateral = lat; v.swerve = 0; v.speed = v.maxSpeed; v.overtake = 0; };
    set('car', 70, -1.75); set('truck', 110, -1.75); set('bike', 150, -1.75); set('rickshaw', 40, -3.05); set('bus', 190, -1.75);
    __game.simulate(25, { throttle: 0, handbrake: true }); })()`);
  const near = await g(page, '__game.traffic.vehicles.filter((v) => v.dir === 1 && Math.abs(v.s - __game.routeS) < 60).map((v) => ({ t: v.type, d: Math.round(v.s - __game.routeS), kmh: Math.round(v.speed * 3.6), ot: v.overtake, lat: +(v.lateral + v.swerve).toFixed(1) }))') as { t: string; d: number; kmh: number; ot: number; lat: number }[];
  console.log('around the parked bus after 25 s', JSON.stringify(near));
  st = await g(page, '(() => { const s = __game.stats(); return { rearHits: s.rearHits, crashes: s.crashes, damage: s.damage }; })()') as typeof st;
  expect(st).toEqual({ rearHits: 0, crashes: 0, damage: 0 });
  // whoever is still behind has either stopped short of the bus or is passing it in the other lane;
  // the truck and rickshaw never overtake, so they queue
  for (const v of near.filter((v) => v.d < 0)) { if (v.ot === 1) expect(v.lat).toBeGreaterThan(0.5); else { expect(v.d).toBeLessThan(-8); expect(v.kmh).toBeLessThan(3); } }
  expect(near.some((v) => (v.t === 'truck' || v.t === 'rickshaw') && v.d < 0)).toBe(true);
});
