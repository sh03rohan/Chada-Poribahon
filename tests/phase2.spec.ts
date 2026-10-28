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
  const rr = box.height * 0.37; // inside the rim at any wheel size (compact layout shrinks it)
  await page.mouse.move(cx, cy - rr); await page.mouse.down(); await page.mouse.move(cx + rr, cy, { steps: 12 });
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
  test.setTimeout(900_000); // software GL: the 30-skip loop alone runs ~5 min
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
  // skip at every second via the button, Esc, Space and tap (timeline runs 8× faster to keep the test short)
  await g(page, '__game.cinematic.timeScale = 8');
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

// ---------------------------------------------------------------------------------------------
// Phase 2: fares at every stop, chada, checkpoint, speed camera, alms, fuel, rickshaws/overtaking
// ---------------------------------------------------------------------------------------------
type P2 = {
  s: number; kmh: number; phase: string; chada: string[]; chadaRefused: boolean; checkpoint: string; cameraDone: boolean; almsDone: boolean;
  fuel: number; fuelState: string; refuels: number; ledger: { fares: number; fines: number; chada: number; fuel: number; charity: number; net: number };
  choiceOpen: boolean; passengers: number; stopsDone: number; stops: { done: boolean; boarded: number; alighted: number }[];
};
const sim = (page: Page, sec: number, inp: Record<string, unknown>) => page.evaluate(([sec, inp]) => (window as unknown as { __game: { simulate(s: number, i: unknown): P2 } }).__game.simulate(sec as number, inp), [sec, inp]) as Promise<P2>;
const stats = (page: Page) => g(page, '__game.stats()') as Promise<P2>;
async function driveTo(page: Page, target: number) { let st = await stats(page); for (let i = 0; i < 200 && st.s < target; i++) st = await sim(page, 0.5, { throttle: 1, autopilot: true }); return st; }
async function brakeToStop(page: Page) { let st = await stats(page); for (let i = 0; i < 60 && st.kmh > 2; i++) st = await sim(page, 0.5, { throttle: 0, brake: 1, autopilot: true }); return sim(page, 1.5, { throttle: 0, brake: 0, handbrake: true, autopilot: true }); } // brake, then handbrake (holding the brake while stopped reverses)

test('phase 2: fares at every stop — Faridpur boarding adds fares, alms visitor asks politely', async ({ page }) => {
  const errors = await boot(page, 'autostart=1&quality=low&hour=12&view=chase');
  await g(page, '__game.traffic.enabled = false; __game.teleport(3300)');
  const before = (await stats(page)).ledger.fares;
  await driveTo(page, 3412); let st = await brakeToStop(page);
  st = await sim(page, 1, { brake: 1, autopilot: true });
  expect(st.phase, 'dwelling at Faridpur').toBe('stop');
  await page.waitForTimeout(3200); // the visitor walks to the door, then asks
  st = await stats(page);
  expect(st.choiceOpen, 'alms prompt open').toBe(true);
  expect(await page.locator('#choice-title').textContent()).toMatch(/দোয়া|আল্লাহর/);
  await page.screenshot({ path: `${SHOTS}/alms-prompt.png` });
  await page.click('#choice-a');
  st = await sim(page, 7, { brake: 1, autopilot: true });
  expect(st.phase).toBe('driving');
  expect(st.stops[1].done).toBe(true); expect(st.stops[1].alighted).toBe(6); expect(st.stops[1].boarded).toBe(8);
  expect(st.ledger.fares - before).toBe(8 * 220);
  expect(st.ledger.charity).toBe(10);
  expect(errors).toEqual([]);
});

test('phase 2: chada — refusing blocks the bus for a while, paying costs ৳200', async ({ page }) => {
  const errors = await boot(page, 'autostart=1&quality=low&hour=12&view=chase');
  await g(page, '__game.traffic.enabled = false; __game.teleport(1040)');
  await driveTo(page, 1128); await brakeToStop(page);
  await page.waitForTimeout(300);
  let st = await stats(page);
  expect(st.chada[0]).toBe('asking'); expect(st.choiceOpen).toBe(true);
  await page.screenshot({ path: `${SHOTS}/chada-prompt.png` });
  await page.click('#choice-b'); // refuse
  st = await sim(page, 4, { throttle: 1, autopilot: true });
  expect(st.chada[0]).toBe('blocking'); expect(st.chadaRefused).toBe(true);
  const held = st.s;
  expect(st.kmh, 'held by the man standing in front').toBeLessThan(1);
  st = await sim(page, 9, { throttle: 1, autopilot: true });
  expect(st.chada[0]).toBe('done'); expect(st.s - held, 'released after the block timer').toBeGreaterThan(10);
  // second collector: pay
  await g(page, '__game.teleport(4200)');
  await driveTo(page, 4278); await brakeToStop(page); await page.waitForTimeout(300);
  st = await stats(page); expect(st.chada[1]).toBe('asking');
  await page.click('#choice-a');
  st = await sim(page, 3, { throttle: 1, autopilot: true });
  expect(st.chada[1]).toBe('done'); expect(st.ledger.chada).toBe(200);
  expect(errors).toEqual([]);
});

test('phase 2: police checkpoint — speeding earns a ৳500 fine + hold, slow pass is waved through; speed camera ৳300', async ({ page }) => {
  const errors = await boot(page, 'autostart=1&quality=low&hour=12&view=chase');
  await g(page, '__game.traffic.enabled = false; __game.teleport(2820)');
  let st = await sim(page, 16, { throttle: 1, autopilot: true });
  expect(st.checkpoint, 'held at the boom').toBe('stopped');
  expect(st.ledger.fines).toBe(500);
  expect(st.s, 'stopped before the boom').toBeLessThan(3000);
  await page.screenshot({ path: `${SHOTS}/checkpoint-fine.png` });
  st = await sim(page, 14, { throttle: 1, autopilot: true });
  expect(st.checkpoint).toBe('cleared'); expect(st.s).toBeGreaterThan(3000);
  // slow pass
  await g(page, '__game.incidents.reset(); __game.ledger.fines = 0; __game.teleport(2900)');
  await driveTo(page, 2940); await brakeToStop(page);
  for (let i = 0; i < 40; i++) { st = await sim(page, 0.5, { throttle: 0.3, autopilot: true }); if (st.kmh > 20) st = await sim(page, 0.5, { throttle: 0, autopilot: true }); if (st.s > 3010) break; }
  expect(st.checkpoint).toBe('cleared'); expect(st.ledger.fines).toBe(0);
  // speed camera on the bridge
  await g(page, '__game.teleport(4560)'); // 340 m run-up: the bus is past 80 km/h at the gantry
  st = await sim(page, 28, { throttle: 1, autopilot: true });
  expect(st.cameraDone).toBe(true); expect(st.ledger.fines).toBe(300);
  expect(errors).toEqual([]);
});

test('phase 2: fuel — tank starts part-full, burns under load, pump refuels for money, results ledger', async ({ page }) => {
  const errors = await boot(page, 'autostart=1&quality=low&hour=12&view=chase');
  await g(page, '__game.traffic.enabled = false');
  let st = await stats(page);
  expect(st.fuel).toBeGreaterThan(0.29); expect(st.fuel).toBeLessThan(0.39);
  await g(page, '__game.teleport(4660)');
  const f0 = (await stats(page)).fuel;
  st = await sim(page, 40, { throttle: 1, autopilot: true });
  const used = (f0 - st.fuel) * 120;
  console.log('fuel used in 40 s full throttle (L)', used.toFixed(2));
  expect(used).toBeGreaterThan(1.5); expect(used).toBeLessThan(6);
  // pull into the pump lay-by and stop
  await g(page, '__game.teleport(2690); const f = __game.road.sample(2690); __game.cur.x -= f.rx * 2.4; __game.cur.z -= f.rz * 2.4; __game.prev.x = __game.cur.x; __game.prev.z = __game.cur.z');
  await sim(page, 2, { brake: 1 });
  await page.waitForTimeout(400);
  st = await stats(page);
  expect(st.choiceOpen, 'pump prompt').toBe(true);
  await page.screenshot({ path: `${SHOTS}/pump-prompt.png` });
  await page.click('#choice-a');
  await page.waitForTimeout(300);
  st = await stats(page);
  expect(st.refuels).toBe(1); expect(st.ledger.fuel).toBe(40 * 65);
  // finish: results card shows the ledger
  await g(page, '__game.teleport(5900)');
  st = await sim(page, 25, { throttle: 1, autopilot: true });
  expect(st.phase).toBe('finished');
  await page.waitForTimeout(500);
  const grid = await page.locator('#res-grid').textContent();
  expect(grid).toContain('ভাড়া আদায়'); expect(grid).toContain('জরিমানা'); expect(grid).toContain('তেল'); expect(grid).toContain('স্টপ');
  await page.screenshot({ path: `${SHOTS}/results-ledger.png` });
  expect(errors).toEqual([]);
});

test('phase 2: traffic has rickshaws/vans and overtakes slow vehicles', async ({ page }) => {
  const errors = await boot(page, 'autostart=1&quality=low&hour=12&view=chase');
  const r = await g(page, `(() => {
    const kinds = new Set(__game.traffic.vehicles.map(v => v.type));
    const seen = new Set(); let maxOT = 0;
    for (let i = 0; i < 120; i++) { __game.simulate(0.5, { throttle: 0.6, autopilot: true }); let n = 0; for (const v of __game.traffic.vehicles) if (v.overtake) { n++; seen.add(v); } maxOT = Math.max(maxOT, n); }
    return { kinds: [...kinds], overtakers: seen.size, maxOT };
  })()`) as { kinds: string[]; overtakers: number; maxOT: number };
  console.log('traffic', r);
  expect(r.kinds).toEqual(expect.arrayContaining(['rickshaw', 'van', 'auto', 'car', 'bus', 'truck', 'bike']));
  expect(r.overtakers, 'some vehicle overtook during 60 s').toBeGreaterThan(0);
  expect(errors).toEqual([]);
});
