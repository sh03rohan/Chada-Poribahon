import { chromium } from '@playwright/test';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.log('PAGEERROR', e.message, e.stack));
await page.goto('http://localhost:5173/?autostart=1&quality=low&view=chase&hour=12');
await page.waitForFunction(() => window.__game?.ready === true, null, { timeout: 90000 });
await page.waitForTimeout(600);
const which = (process.argv[2] ?? 'roof,ferry').split(',');
const stats = () => page.evaluate(() => { const s = __game.stats(); return { s: +s.s.toFixed(1), kmh: +s.kmh.toFixed(1), phase: s.phase, pax: s.passengers, roof: s.roof, mods: { grip: s.mods.roofGrip, cap: s.mods.roofCapKmh }, fares: s.ledger.fares, fines: s.ledger.fines, cp: s.checkpoint, choice: s.choiceOpen, onBranch: s.onBranch, ferry: s.ferryTaken, elapsed: +__game.elapsed.toFixed(0), toll: s.ledger.toll, stops: s.stops.map((x) => (x.done ? 'D' : x.missed ? 'M' : '-')).join('') }; });
if (which.includes('roof')) {
  console.log('=== ROOF at Rajbari ===');
  await page.evaluate(() => { __game.traffic.enabled = false; __game.teleport(1880); let st = __game.stats(); for (let i = 0; i < 60 && st.s < 1972; i++) st = __game.simulate(0.5, { throttle: 1, autopilot: true }); for (let i = 0; i < 40 && st.kmh > 2; i++) st = __game.simulate(0.5, { throttle: 0, brake: 1, autopilot: true }); __game.simulate(1.5, { throttle: 0, handbrake: true, autopilot: true }); });
  console.log('at stop', JSON.stringify(await stats()));
  // the stop dwell runs in real time frames too; drive the dwell with simulate then wait for the prompt
  await page.evaluate(() => __game.simulate(6, { throttle: 0, handbrake: true, autopilot: true }));
  await page.waitForFunction(() => __game.choice.open, null, { timeout: 15000 }).catch(() => console.log('no roof prompt!'));
  console.log('prompt', await page.locator('#choice-title').innerText().catch(() => '(none)'));
  await page.click('#choice-a'); await page.waitForTimeout(400);
  console.log('after accept', JSON.stringify(await stats()));
  await page.evaluate(() => __game.setFreeCamera([9, 4.5, 4], [0, 3.2, 0]));
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'test-results/event-roof.png' });
  await page.evaluate(() => __game.setFreeCamera(null));
  const top = await page.evaluate(() => { __game.teleport(2200); return +__game.simulate(30, { throttle: 1, autopilot: true }).topSpeed.toFixed(1); });
  console.log('top speed with roof load', top);
  await page.evaluate(() => { __game.teleport(2820); __game.simulate(16, { throttle: 1, autopilot: true }); });
  await page.waitForTimeout(300);
  console.log('checkpoint', JSON.stringify(await stats()));
}
if (which.includes('ferry')) {
  console.log('=== FERRY ===');
  await page.evaluate(() => { __game.incidents.reset(); __game.teleport(2380); __game.autopilotRoad = __game.fork.branch; });
  let st = await page.evaluate(() => { const len = __game.fork.branch.length; let b = 0; for (let i = 0; i < 120 && b < len - 120; i++) { __game.simulate(1, { throttle: b > len - 220 ? 0.25 : 0.8, autopilot: true }); b = __game.stats().branchS; } return b; });
  console.log('branchS', st, 'len', await page.evaluate(() => __game.fork.branch.length));
  await page.evaluate(() => { for (let i = 0; i < 30 && __game.stats().kmh > 2; i++) __game.simulate(0.5, { throttle: 0, brake: 1, autopilot: true }); __game.simulate(1.5, { throttle: 0, handbrake: true, autopilot: true }); });
  console.log('stopped', JSON.stringify(await stats()), 'branchS', await page.evaluate(() => __game.stats().branchS));
  await page.waitForFunction(() => __game.choice.open, null, { timeout: 15000 }).catch(() => console.log('no ferry prompt!'));
  console.log('prompt', await page.locator('#choice-title').innerText().catch(() => '(none)'), JSON.stringify(await stats()));
  await page.screenshot({ path: 'test-results/event-ferry.png' });
  await page.click('#choice-a');
  await page.waitForTimeout(1800);
  console.log('after ferry', JSON.stringify(await stats()));
  await page.screenshot({ path: 'test-results/event-ferry-after.png' });
}
await browser.close();
