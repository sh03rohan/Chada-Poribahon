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
  await page.goto(`/?${query}${query.includes('weather=') ? '' : '&weather=clear'}&hazards=0`); // tests pin the weather and Phase 6 hazards (random otherwise)
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

test('damage: crashes add damage, cap speed and weaken brakes; repair is charged at Dhaka and the bus is fixed for the next run', async ({ page }) => {
  const errors = await boot(page, 'autostart=1&quality=low&view=chase&hour=21');
  const ram = () => g(page, `(() => { const g = __game; const vs = g.traffic.vehicles; const car = vs.find((v) => v.type === 'car');
    for (const v of vs) v.s = 5000 + Math.random() * 500; g.teleport(1480); car.s = 1560; car.dir = 1; car.lateral = -1.75; car.swerve = 0; car.speed = 0; car.maxSpeed = 0.01; car.hitT = 0;
    g.simulate(9, { throttle: 1, autopilot: true }); return g.stats().damage; })()`) as Promise<number>;
  // the crash is booked in the physics step; the damage/mood penalty is applied on the next rendered frame
  for (let i = 0; i < 3; i++) { await ram(); const f0 = await g(page, '__game.frames') as number; await page.waitForFunction((f0) => (window as unknown as { __game: { frames: number } }).__game.frames > f0, f0, { timeout: 60_000 }); }
  const st = await g(page, '(() => { const s = __game.stats(); return { damage: s.damage, mods: s.mods, crashes: s.crashes }; })()') as { damage: number; mods: { dmgBrake: number; speedCapKmh: number | null }; crashes: number };
  console.log('after 3 rams', st);
  expect(st.damage).toBeGreaterThanOrEqual(50); expect(st.mods.dmgBrake).toBeLessThan(1); expect(st.mods.speedCapKmh).not.toBeNull();
  expect(await page.locator('#hud-damage').isVisible()).toBe(true);
  await g(page, '__game.switchCamera("cockpit")');
  await expect(page.locator('#crack'), 'cracked windscreen in cockpit').toBeVisible({ timeout: 8000 });
  await page.screenshot({ path: `${SHOTS}/damage-cockpit.png` });
  await g(page, '__game.switchCamera("chase")');
  const top = await g(page, '(() => { __game.teleport(4660); return __game.simulate(40, { throttle: 1, autopilot: true }).topSpeed; })()') as number;
  console.log('top speed with damage', top, 'cap', st.mods.speedCapKmh);
  expect(top).toBeLessThan((st.mods.speedCapKmh ?? 120) + 3);
  await g(page, '__game.teleport(5900); __game.simulate(45, { throttle: 1, autopilot: true })');
  await finished(page); await page.waitForTimeout(200);
  const r = await g(page, '({ repair: __game.ledger.repair, net: __game.ledger.net })') as { repair: number; net: number };
  console.log('repair', r);
  expect(r.repair).toBeGreaterThan(1000); expect(r.net).toBe(10800 - r.repair);
  expect(await page.locator('#res-grid').innerText()).toContain('মেরামত');
  await g(page, '__game.startRun()'); await page.waitForTimeout(300);
  const after = await g(page, '(() => { const s = __game.stats(); return { damage: s.damage, cap: s.mods.speedCapKmh, brake: s.mods.dmgBrake }; })()') as { damage: number; cap: number | null; brake: number };
  expect(after.damage).toBe(0); expect(after.cap ?? Infinity).toBe(Infinity); expect(after.brake).toBe(1);
  await expect(page.locator('#hud-damage')).toBeHidden({ timeout: 8000 });
  expect(errors).toEqual([]);
});

const ev = (page: Page, sec: number, inp: Record<string, unknown>) => page.evaluate(([sec, inp]) => { const st = (window as unknown as { __game: { simulate(s: number, i: unknown): Record<string, unknown> } }).__game.simulate(sec as number, inp); return { s: st.s, kmh: st.kmh, toll: st.toll, rail: st.rail, accident: st.accident, train: st.trainActive, fines: (st.ledger as { fines: number; toll: number }).fines, tollPaid: (st.ledger as { toll: number }).toll, crashes: st.crashes }; }, [sec, inp]) as Promise<{ s: number; kmh: number; toll: string; rail: string; accident: string; train: boolean; fines: number; tollPaid: number; crashes: number }>;

test('events: level crossing holds the bus while the train passes; accident lane clears after waiting; toll plaza takes ৳1,500', async ({ page }) => {
  const errors = await boot(page, 'autostart=1&quality=low&view=chase&hour=12');
  await g(page, '__game.traffic.enabled = false; __game.teleport(1400)');
  let st = await ev(page, 9, { throttle: 1, autopilot: true });
  expect(st.rail, 'gates down, train launched').toBe('closed'); expect(st.train).toBe(true);
  st = await ev(page, 9, { throttle: 1, autopilot: true });
  expect(st.kmh, 'held at the gate').toBeLessThan(1); expect(st.s).toBeLessThan(1645);
  await page.screenshot({ path: `${SHOTS}/event-rail.png` });
  for (let i = 0; i < 6 && st.rail !== 'cleared'; i++) st = await ev(page, 3, { throttle: 1, autopilot: true });
  expect(st.rail).toBe('cleared');
  st = await ev(page, 6, { throttle: 1, autopilot: true });
  expect(st.s, 'drove across after the train').toBeGreaterThan(1700);
  // accident: stop before the wreck, wait, lane clears
  await g(page, '__game.incidents.reset(); __game.teleport(3060)');
  st = await ev(page, 8, { throttle: 1, autopilot: true });
  expect(st.accident).toBe('approach');
  for (let i = 0; i < 60 && st.s < 3195; i++) st = await ev(page, 0.5, { throttle: 0.4, autopilot: true });
  for (let i = 0; i < 20 && st.kmh > 2; i++) st = await ev(page, 0.5, { throttle: 0, brake: 1, autopilot: true });
  st = await ev(page, 1.5, { throttle: 0, handbrake: true, autopilot: true });
  expect(st.accident).toBe('waiting');
  await page.screenshot({ path: `${SHOTS}/event-accident.png` });
  st = await ev(page, 27, { throttle: 0, handbrake: true, autopilot: true });
  expect(st.accident).toBe('cleared');
  const c0 = st.crashes;
  st = await ev(page, 8, { throttle: 1, autopilot: true });
  expect(st.s).toBeGreaterThan(3270); expect(st.crashes, 'no collision with the towed wreck').toBe(c0);
  // toll
  await g(page, '__game.incidents.reset(); __game.teleport(4380)');
  st = await ev(page, 20, { throttle: 1, autopilot: true });
  expect(st.toll).toBe('asking'); expect(st.kmh).toBeLessThan(1); expect(st.s).toBeLessThan(4600);
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${SHOTS}/event-toll.png` });
  await page.click('#choice-a'); await page.waitForTimeout(1200);
  st = await ev(page, 6, { throttle: 1, autopilot: true });
  expect(st.toll).toBe('paid'); expect(st.tollPaid).toBe(1500); expect(st.s).toBeGreaterThan(4605);
  expect(errors).toEqual([]);
});

test('events: ferry at Daulatdia ghat crosses to the Dhaka side for ৳1,200 and the wait', async ({ page }) => {
  const errors = await boot(page, 'autostart=1&quality=low&view=chase&hour=12');
  await g(page, '__game.traffic.enabled = false; __game.teleport(2380); __game.autopilotRoad = __game.fork.branch');
  await g(page, '(() => { const len = __game.fork.branch.length; let b = 0; for (let i = 0; i < 120 && b < len - 120; i++) { __game.simulate(1, { throttle: b > len - 220 ? 0.25 : 0.8, autopilot: true }); b = __game.stats().branchS; } for (let i = 0; i < 30 && __game.stats().kmh > 2; i++) __game.simulate(0.5, { throttle: 0, brake: 1, autopilot: true }); __game.simulate(1.5, { throttle: 0, handbrake: true, autopilot: true }); })()');
  await page.waitForFunction(() => (window as unknown as { __game: { choice: { open: boolean } } }).__game.choice.open, null, { timeout: 15_000 });
  expect(await page.locator('#choice-title').innerText()).toContain('ফেরি');
  await page.screenshot({ path: `${SHOTS}/event-ferry.png` });
  const t0 = await g(page, '__game.elapsed') as number;
  await page.click('#choice-a'); await page.waitForTimeout(1800);
  const st = await g(page, '(() => { const s = __game.stats(); return { s: s.s, onBranch: s.onBranch, ferry: s.ferryTaken, toll: s.ledger.toll, elapsed: __game.elapsed, wrong: s.wrongBranch }; })()') as { s: number; onBranch: boolean; ferry: boolean; toll: number; elapsed: number; wrong: boolean };
  console.log('ferry', st);
  expect(st.ferry).toBe(true); expect(st.onBranch).toBe(false); expect(st.s).toBeGreaterThan(5400); expect(st.toll).toBe(1200); expect(st.elapsed - t0).toBeGreaterThan(85); expect(st.wrong).toBe(false);
  expect(errors).toEqual([]);
});

test('events: roof passengers at Rajbari pay extra, cap speed, and are fined off at the checkpoint', async ({ page }) => {
  const errors = await boot(page, 'autostart=1&quality=low&view=chase&hour=12');
  await g(page, '(() => { __game.traffic.enabled = false; __game.teleport(1880); let st = __game.stats(); for (let i = 0; i < 60 && st.s < 1972; i++) st = __game.simulate(0.5, { throttle: 1, autopilot: true }); for (let i = 0; i < 40 && st.kmh > 2; i++) st = __game.simulate(0.5, { throttle: 0, brake: 1, autopilot: true }); __game.simulate(1.5, { throttle: 0, handbrake: true, autopilot: true }); __game.simulate(6, { throttle: 0, handbrake: true, autopilot: true }); })()');
  await page.waitForFunction(() => (window as unknown as { __game: { choice: { open: boolean } } }).__game.choice.open, null, { timeout: 15_000 });
  expect(await page.locator('#choice-title').innerText()).toContain('ছাদে');
  await page.click('#choice-a'); await page.waitForTimeout(400);
  let st = await g(page, '(() => { const s = __game.stats(); return { roof: s.roof, fares: s.ledger.fares, cap: s.mods.roofCapKmh, grip: s.mods.roofGrip, fines: s.ledger.fines, cp: s.checkpoint }; })()') as { roof: number; fares: number; cap: number; grip: number; fines: number; cp: string };
  expect(st.roof).toBe(8); expect(st.fares).toBe(10800 + 12 * 300 + 8 * 300); expect(st.cap).toBe(90); expect(st.grip).toBeCloseTo(0.9, 2);
  await expect(page.locator('#hud-pass')).toContainText('ছাদে', { timeout: 8000 });
  await page.screenshot({ path: `${SHOTS}/event-roof.png` });
  const top = await g(page, '(() => { __game.teleport(2200); return __game.simulate(30, { throttle: 1, autopilot: true }).topSpeed; })()') as number;
  expect(top).toBeLessThan(93);
  await g(page, '__game.teleport(2820); __game.simulate(16, { throttle: 1, autopilot: true })');
  await page.waitForTimeout(300);
  st = await g(page, '(() => { const s = __game.stats(); return { roof: s.roof, fares: s.ledger.fares, cap: s.mods.roofCapKmh, grip: s.mods.roofGrip, fines: s.ledger.fines, cp: s.checkpoint }; })()') as typeof st;
  console.log('checkpoint with roof load', st);
  expect(st.cp).toBe('stopped'); expect(st.fines).toBe(1000); expect(st.roof).toBe(0); expect(st.cap ?? Infinity).toBe(Infinity);
  expect(errors).toEqual([]);
});
