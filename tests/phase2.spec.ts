import { test, expect, type Page } from '@playwright/test';
import fs from 'node:fs';

const SHOTS = 'test-results/screenshots';
fs.mkdirSync(SHOTS, { recursive: true });

async function boot(page: Page, query: string, errors: string[] = []) {
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/404|Failed to load resource/.test(m.text())) errors.push('console: ' + m.text()); });
  await page.goto(`/?${query}`);
  await page.waitForFunction(() => (window as unknown as { __game?: { ready: boolean } }).__game?.ready === true, null, { timeout: 90_000 });
  await page.waitForTimeout(600);
  return errors;
}
const g = (page: Page, expr: string) => page.evaluate(expr);

test('people: crowd close-up is human-looking and varied, police present', async ({ page }) => {
  const errors = await boot(page, 'autostart=1&quality=medium&hour=11&view=chase');
  await g(page, '__game.teleport(3826); __game.setFreeCamera([-2.5, 1.65, -27.5], [0.5, 1.2, -33])');
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${SHOTS}/crowd-closeup.png` });
  await g(page, '__game.setFreeCamera([3.5, 1.5, -31], [-1, 1.3, -26])');
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${SHOTS}/crowd-closeup-2.png` });
  const info = await g(page, '(() => { const b = __game.blockade; const ids = new Set(b.crowd.map(p => p.variant.id)); const tris = b.crowd[0].mesh.geometry.attributes.position.count / 3; return { crowd: b.crowd.length, police: b.police.length, variants: ids.size, tris, actions: [...new Set(b.crowd.map(p => p.action))], anyCapsule: !!__game.scene.getObjectByProperty("type", "CapsuleGeometry") }; })()') as { crowd: number; police: number; variants: number; tris: number; actions: string[] };
  console.log('crowd', info);
  expect(info.crowd).toBeGreaterThanOrEqual(20); expect(info.crowd).toBeLessThanOrEqual(28);
  expect(info.police).toBeGreaterThanOrEqual(4); expect(info.police).toBeLessThanOrEqual(6);
  expect(info.variants).toBeGreaterThanOrEqual(12);
  expect(info.tris).toBeGreaterThan(400); expect(info.tris).toBeLessThan(1400);
  expect(info.actions).toEqual(expect.arrayContaining(['sit', 'film']));
  await g(page, '__game.setFreeCamera(null); __game.switchCamera("cockpit"); __game.simulate(12, { throttle: 0.6, autopilot: true })');
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${SHOTS}/blockade-cockpit.png` });
  // wait at the barrier: van arrives (phase 'police'), officers walk in with hand signals, crowd walks off
  let st = await g(page, '__game.stats()') as { blockade: string; kmh: number };
  for (let i = 0; i < 15 && st.blockade !== 'waiting'; i++) st = await g(page, '__game.simulate(2, { throttle: 0.5, autopilot: true })') as typeof st;
  expect(st.blockade).toBe('waiting');
  // (the page's own frame loop also advances the event in real time between calls, so poll the phase)
  for (let i = 0; i < 40 && st.blockade === 'waiting'; i++) st = await g(page, '__game.simulate(1, { throttle: 0, brake: 1 })') as typeof st;
  console.log('after wait', st);
  expect(st.blockade).toBe('police');
  await g(page, '__game.switchCamera("chase"); __game.setFreeCamera([-5, 2.4, -14], [1.5, 1.3, -22])');
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${SHOTS}/police-arrive.png` });
  for (let i = 0; i < 12 && st.blockade === 'police'; i++) st = await g(page, '__game.simulate(1, { throttle: 0, brake: 1 })') as typeof st;
  expect(st.blockade).toBe('dispersing');
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${SHOTS}/police-dispersal.png` });
  const walking = await g(page, '__game.blockade.crowd.filter(p => p.target).length') as number;
  console.log('crowd walking away', walking);
  expect(walking).toBeGreaterThan(5);
  expect(errors).toEqual([]);
});

test('driver: IK hands on the wheel in cockpit, driver visible from outside, glass transparent', async ({ page }) => {
  const errors = await boot(page, 'autostart=1&quality=medium&hour=11&view=cockpit');
  await g(page, '__game.input.override = { steer: 0.35 }; __game.simulate(1, { throttle: 0, steer: 0.35 })');
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${SHOTS}/cockpit-hands.png` });
  await g(page, '__game.bus.updateDriver(__game.cur.steerAngle, 0.016, false, false)');
  const err = await g(page, '__game.driverHandError()') as { left: number; right: number };
  console.log('hand IK error (m)', err);
  expect(err.left).toBeLessThan(0.06); expect(err.right).toBeLessThan(0.06);
  const r = await g(page, '__game.renderAndRead(300, 100, 360, 180)') as { darkFraction: number };
  expect(r.darkFraction, 'road visible through windshield with driver present').toBeLessThan(0.35);
  const clearance = await g(page, '__game.cockpitClearance()') as { minDistance: number; forwardOpaqueHit: number };
  expect(clearance.forwardOpaqueHit).toBe(Infinity);
  await g(page, '__game.input.override = null; __game.traffic.enabled = false; __game.traffic.group.visible = false; __game.switchCamera("chase"); __game.setFreeCamera([4.5, 2.3, -8.5], [0.4, 1.9, -3.5])');
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${SHOTS}/chase-driver.png` });
  await g(page, '__game.setFreeCamera([-4.5, 2.0, -7], [-0.5, 1.6, -3])');
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${SHOTS}/helper-door.png` });
  expect(errors).toEqual([]);
});

test('steering schemes + settings persist across reload, only selected scheme in DOM', async ({ page }) => {
  await boot(page, 'autostart=1&quality=low&hour=11&touch=1');
  await g(page, '__game.settings.set("steering", "wheel"); __game.settings.set("side", "right"); __game.settings.set("sensitivity", 1.25); __game.settings.set("northUp", true); document.getElementById("settings").classList.remove("hidden")');
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${SHOTS}/settings-wheel.png` });
  expect(await page.locator('#wheel-ui').count()).toBe(1);
  expect(await page.locator('#touch-steer .tbtn').count()).toBe(0);
  expect(await page.locator('#touch').getAttribute('class')).toContain('side-right');
  // drag the wheel: steering input should become non-zero, then self-centre
  const box = (await page.locator('#wheel-ui').boundingBox())!;
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  await g(page, 'document.getElementById("settings").classList.add("hidden")');
  await page.mouse.move(cx, cy - 70); await page.mouse.down(); await page.mouse.move(cx + 70, cy, { steps: 12 });
  await page.waitForTimeout(150);
  const s1 = await g(page, '__game.input.poll().steer') as number;
  console.log('wheel steer while dragging', s1);
  expect(s1).toBeGreaterThan(0.2);
  await page.mouse.up();
  await page.waitForTimeout(1500);
  const s2 = await g(page, '__game.input.poll().steer') as number;
  expect(Math.abs(s2)).toBeLessThan(0.05);
  // reload → persisted
  await page.reload();
  await page.waitForFunction(() => (window as unknown as { __game?: { ready: boolean } }).__game?.ready === true, null, { timeout: 90_000 });
  const persisted = await g(page, '({ ...__game.settings.value })') as Record<string, unknown>;
  console.log('persisted', persisted);
  expect(persisted.steering).toBe('wheel'); expect(persisted.side).toBe('right'); expect(persisted.sensitivity).toBe(1.25); expect(persisted.northUp).toBe(true);
  await g(page, '__game.startRun(); __game.settings.set("steering", "buttons"); __game.settings.set("side", "left"); document.getElementById("settings").classList.remove("hidden")');
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${SHOTS}/settings-buttons.png` });
  expect(await page.locator('#wheel-ui').count()).toBe(0);
  expect(await page.locator('#touch-steer .tbtn').count()).toBe(2);
  // keyboard always works
  await g(page, 'document.getElementById("settings").classList.add("hidden")');
  await page.keyboard.down('KeyD'); await page.waitForTimeout(200);
  expect(await g(page, '__game.input.poll().steer') as number).toBeGreaterThan(0.5);
  await page.keyboard.up('KeyD');
});

test('map: minimap + full map + fork signboards + wrong branch warning & recovery', async ({ page }) => {
  const errors = await boot(page, 'autostart=1&quality=low&hour=11&view=chase');
  await g(page, '__game.simulate(3, { throttle: 1, autopilot: true })');
  await page.waitForTimeout(300);
  expect(await page.locator('#minimap').isVisible()).toBe(true);
  await page.screenshot({ path: `${SHOTS}/minimap-hud.png` });
  await g(page, '__game.teleport(2352); __game.setFreeCamera([1.5, 4.8, 4], [0, 4.5, -30])');
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${SHOTS}/fork-signboards.png` });
  await g(page, '__game.setFreeCamera(null)');
  // take the wrong branch
  await g(page, '__game.teleport(2380); __game.autopilotRoad = __game.fork.branch');
  let st = await g(page, '__game.simulate(24, { throttle: 0.9, autopilot: true })') as { onBranch: boolean; wrongBranch: boolean; mood: number; branchS: number };
  console.log('on branch', st);
  expect(st.onBranch).toBe(true); expect(st.wrongBranch).toBe(true);
  expect(await page.locator('#hud-msg').textContent()).toContain('রাস্তা ভুল');
  await g(page, '__game.toggleMap(true)');
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${SHOTS}/fullmap-reroute.png` });
  expect(await page.locator('#fullmap-info').textContent()).toContain('রাস্তা ভুল');
  await g(page, '__game.toggleMap(false)');
  // U-turn: come back along the branch toward the fork
  await g(page, '__game.teleportBranch(__game.stats().branchS, true); __game.autopilotDir = -1');
  let back = st;
  for (let i = 0; i < 14 && (back.wrongBranch || back.onBranch); i++) back = await g(page, '__game.simulate(4, { throttle: 0.7, autopilot: true })') as typeof st;
  console.log('recovered', back);
  expect(back.wrongBranch).toBe(false); expect(back.onBranch).toBe(false);
  expect(await page.locator('#hud-msg').textContent()).toContain('ঠিক রাস্তায়');
  await g(page, '__game.autopilotRoad = null; __game.autopilotDir = 1');
  expect(errors).toEqual([]);
});

test('landing + intro: frames at 3/10/16/21/26 s, skip works at every second, intro remembered', async ({ page }) => {
  test.setTimeout(600_000);
  const errors = await boot(page, 'quality=low&hour=10'); // low tier keeps the 30-skip loop inside the budget on software GL
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${SHOTS}/landing.png` });
  expect(await page.locator('#landing').isVisible()).toBe(true);
  expect(await page.locator('#menu-start').textContent()).toContain('শুরু করুন');
  // play with frames
  await g(page, '(void __game.playIntro(), 0)');
  for (const t of [3, 10, 16, 21, 26]) {
    await page.waitForFunction((tt) => (window as unknown as { __game: { stats(): { cineTime: number; cineActive: boolean } } }).__game.stats().cineTime >= tt, t, { timeout: 60_000 });
    expect(await page.locator('#cine-skip').isVisible(), `skip visible at ${t}s`).toBe(true);
    const cap = await page.locator('#cine-caption').textContent();
    expect(cap!.length).toBeGreaterThan(3);
    await page.screenshot({ path: `${SHOTS}/intro-${t}s.png` });
  }
  await page.waitForFunction(() => !(window as unknown as { __game: { stats(): { cineActive: boolean } } }).__game.stats().cineActive, null, { timeout: 60_000 });
  expect(await page.locator('#pretrip').isVisible()).toBe(true);
  await page.screenshot({ path: `${SHOTS}/pretrip.png` });
  expect(await g(page, '__game.settings.value.introSeen')).toBe(true);
  // skip at every second via the button, Esc, Space and tap (timeline runs 6× faster to keep the test short)
  await g(page, '__game.cinematic.timeScale = 5');
  for (let sec = 0; sec <= 29; sec++) {
    await g(page, '(void __game.playIntro(), 0)');
    await page.waitForFunction(() => (window as unknown as { __game: { stats(): { cineActive: boolean } } }).__game.stats().cineActive, null, { timeout: 10_000 });
    await page.waitForFunction((tt) => (window as unknown as { __game: { stats(): { cineTime: number } } }).__game.stats().cineTime >= tt, sec, { timeout: 60_000 });
    const mode = sec % 4;
    if (mode === 0) await g(page, 'document.getElementById("cine-skip").click()');
    else if (mode === 1) await page.keyboard.press('Escape');
    else if (mode === 2) await page.keyboard.press('Space');
    else await page.mouse.click(480, 270);
    await page.waitForFunction(() => !(window as unknown as { __game: { stats(): { cineActive: boolean } } }).__game.stats().cineActive, null, { timeout: 10_000 });
    expect(await page.locator('#pretrip').isVisible(), `pretrip after skip at ${sec}s`).toBe(true);
  }
  await g(page, '__game.cinematic.timeScale = 1');
  // start a run from pretrip
  await page.click('#pretrip-go');
  await page.waitForTimeout(500);
  expect(await page.locator('#hud').isVisible()).toBe(true);
  expect(errors).toEqual([]);
});

test('medium tier: frame time, draw calls, no errors; speed targets unchanged', async ({ page }) => {
  const errors = await boot(page, 'autostart=1&quality=medium&hour=11&view=chase');
  await g(page, '__game.autopilot = true; __game.input.override = { throttle: 1 }');
  await page.waitForTimeout(8000);
  const st = await g(page, '__game.stats()') as { avgFrame: number; worstFrame: number; drawCalls: number; people: number; fps: number };
  console.log('medium tier (SwiftShader software GL — real GPUs are far faster):', { avgFrameMs: (st.avgFrame * 1000).toFixed(1), worstMs: (st.worstFrame * 1000).toFixed(0), fps: st.fps.toFixed(1), drawCalls: st.drawCalls, people: st.people });
  expect(st.drawCalls, 'draw-call budget for 60 fps on mid-range mobile').toBeLessThan(260);
  expect(st.worstFrame).toBeLessThan(1.0);
  await g(page, '__game.input.override = null; __game.autopilot = false; __game.traffic.enabled = false; __game.teleport(4660); __game.debug.resetMeasure()');
  const p = await g(page, '__game.simulate(45, { throttle: 1, autopilot: true })') as { zeroToSixty: number; topSpeed: number };
  console.log('speed targets', p);
  expect(p.zeroToSixty).toBeGreaterThan(8.5); expect(p.zeroToSixty).toBeLessThan(11.5);
  expect(p.topSpeed).toBeGreaterThanOrEqual(115);
  expect(errors).toEqual([]);
});
