import { chromium } from '@playwright/test';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
page.on('pageerror', (e) => console.log('PAGEERROR', e.message, '\n', e.stack));
const which = (process.argv[2] ?? 'all').split(',');
const run = (k) => which.includes('all') || which.includes(k);
const boot = async () => {
  await page.goto('http://localhost:5173/?autostart=1&quality=low&view=chase&hour=12');
  await page.waitForFunction(() => window.__game?.ready === true, null, { timeout: 90000 });
  await page.waitForTimeout(800);
  await page.evaluate(() => { __game.traffic.enabled = false; });
};
const sim = (sec, inp) => page.evaluate(([sec, inp]) => __game.simulate(sec, inp), [sec, inp]);
const stats = () => page.evaluate(() => __game.stats());
const pick = (s) => ({ s: +s.s.toFixed(1), kmh: +s.kmh.toFixed(1), phase: s.phase, chada: s.chada, refused: s.chadaRefused, cp: s.checkpoint, cam: s.cameraDone, alms: s.almsDone, fuel: +s.fuel.toFixed(3), fuelState: s.fuelState, refuels: s.refuels, ledger: s.ledger, choice: s.choiceOpen, pax: s.passengers, stopsDone: s.stopsDone });
const driveTo = async (target, step = 0.5) => { let st = await stats(); for (let i = 0; i < 200 && st.s < target; i++) st = await sim(step, { throttle: 1, autopilot: true }); return st; };
const stop = async () => { let st = await stats(); for (let i = 0; i < 60 && st.kmh > 2; i++) st = await sim(0.5, { throttle: 0, brake: 1, autopilot: true }); return sim(1.5, { throttle: 0, brake: 0, handbrake: true, autopilot: true }); };

await boot();
if (run('chada')) {
  console.log('=== CHADA (refuse) ===');
  await page.evaluate(() => __game.teleport(1040));
  await driveTo(1128); let st = await stop();
  await page.waitForTimeout(300); st = await stats(); console.log('stopped at man', JSON.stringify(JSON.stringify(pick(st))));
  await page.click('#choice-b'); await page.waitForTimeout(300);
  st = await sim(4, { throttle: 1, autopilot: true }); console.log('after refuse, 4 s full throttle', JSON.stringify(pick(st)));
  const held = st.s;
  st = await sim(8, { throttle: 1, autopilot: true }); console.log('after block timeout', JSON.stringify(pick(st)));
  console.log('RESULT chada held:', held, '→ moved after:', st.s - held);
  await page.screenshot({ path: 'test-results/p2-chada.png' });
  console.log('=== CHADA (pay) ===');
  await page.evaluate(() => __game.teleport(4200));
  await driveTo(4278); st = await stop(); await page.waitForTimeout(300); st = await stats(); console.log('stopped at man 2', JSON.stringify(pick(st)));
  await page.click('#choice-a'); await page.waitForTimeout(300);
  st = await sim(4, { throttle: 1, autopilot: true }); console.log('after pay', JSON.stringify(pick(st)));
}
if (run('checkpoint')) {
  console.log('=== CHECKPOINT (fast) ===');
  await page.evaluate(() => { __game.incidents.reset(); __game.teleport(2820); });
  let st = await sim(14, { throttle: 1, autopilot: true }); console.log('fast approach 14 s', JSON.stringify(pick(st)));
  st = await sim(14, { throttle: 1, autopilot: true }); console.log('after hold', JSON.stringify(pick(st)));
  await page.screenshot({ path: 'test-results/p2-checkpoint.png' });
  console.log('=== CHECKPOINT (slow) ===');
  await page.evaluate(() => { __game.incidents.reset(); __game.teleport(2900); });
  await driveTo(2960); st = await stop();
  for (let i = 0; i < 40; i++) { st = await sim(0.5, { throttle: 0.35, autopilot: true }); if (st.kmh > 22) st = await sim(0.5, { throttle: 0, autopilot: true }); if (st.s > 3010) break; }
  console.log('slow pass', JSON.stringify(pick(st)));
}
if (run('camera')) {
  console.log('=== SPEED CAMERA ===');
  await page.evaluate(() => { __game.incidents.reset(); __game.ledger.fines = 0; __game.teleport(4560); });
  let st = await sim(26, { throttle: 1, autopilot: true }); console.log('after camera', JSON.stringify(pick(st)));
  await page.screenshot({ path: 'test-results/p2-camera.png' });
}
if (run('faridpur')) {
  console.log('=== FARIDPUR STOP + ALMS ===');
  await page.evaluate(() => { __game.incidents.reset(); __game.teleport(3300); });
  await driveTo(3412); let st = await stop(); console.log('at Faridpur', JSON.stringify(pick(st)));
  st = await sim(1, { brake: 1, autopilot: true }); console.log('phase', st.phase);
  await page.waitForTimeout(3200); st = await stats(); console.log('alms prompt', JSON.stringify(pick(st)));
  await page.screenshot({ path: 'test-results/p2-alms.png' });
  if (st.choiceOpen) await page.click('#choice-a');
  await page.waitForTimeout(300);
  st = await sim(7, { brake: 1, autopilot: true }); console.log('after dwell', JSON.stringify(pick(st)));
}
if (run('fuel')) {
  console.log('=== FUEL PUMP ===');
  await page.evaluate(() => { __game.fuel.litres = 30; __game.teleport(2690); const f = __game.road.sample(2690); __game.cur.x -= f.rx * 2.4; __game.cur.z -= f.rz * 2.4; __game.prev.x = __game.cur.x; __game.prev.z = __game.cur.z; });
  let st = await sim(2, { brake: 1 }); console.log('beside pump', pick(st), 'lateral', st.lateral);
  await page.waitForTimeout(400); st = await stats(); console.log('pump prompt open:', st.choiceOpen);
  await page.screenshot({ path: 'test-results/p2-pump.png' });
  if (st.choiceOpen) await page.click('#choice-a');
  await page.waitForTimeout(300); st = await stats(); console.log('after refuel', JSON.stringify(pick(st)));
  console.log('=== FUEL BURN ===');
  await page.evaluate(() => { __game.fuel.litres = 120; __game.teleport(4660); });
  st = await sim(60, { throttle: 1, autopilot: true }); console.log('after 60 s full throttle, fuel', st.fuel, 'litres used', (120 * (1 - st.fuel)).toFixed(2));
}
await browser.close();
