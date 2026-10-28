import { chromium } from '@playwright/test';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.log('PAGEERROR', e.message, e.stack));
await page.goto('http://localhost:5173/?autostart=1&quality=low&view=chase&hour=12');
await page.waitForFunction(() => window.__game?.ready === true, null, { timeout: 90000 });
await page.waitForTimeout(600);
const sim = (sec, inp) => page.evaluate(([sec, inp]) => { const st = __game.simulate(sec, inp); return { s: +st.s.toFixed(1), kmh: +st.kmh.toFixed(1), toll: st.toll, rail: st.rail, accident: st.accident, train: st.trainActive, ledger: st.ledger, fines: st.ledger.fines }; }, [sec, inp]);
const which = (process.argv[2] ?? 'rail,accident,toll').split(',');
if (which.includes('rail')) {
  console.log('=== RAIL ===');
  await page.evaluate(() => { __game.traffic.enabled = false; __game.teleport(1400); });
  for (let i = 0; i < 6; i++) console.log(JSON.stringify(await sim(3, { throttle: 1, autopilot: true })));
  await page.evaluate(() => __game.setFreeCamera([-9, 3, 14], [4, 2, -8]));
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'test-results/event-rail.png' });
  await page.evaluate(() => __game.setFreeCamera(null));
  for (let i = 0; i < 5; i++) console.log(JSON.stringify(await sim(3, { throttle: 1, autopilot: true })));
}
if (which.includes('accident')) {
  console.log('=== ACCIDENT ===');
  await page.evaluate(() => { __game.incidents.reset(); __game.traffic.enabled = false; __game.teleport(3060); });
  let st = await sim(8, { throttle: 1, autopilot: true }); console.log('approach', JSON.stringify(st));
  for (let i = 0; i < 60 && st.s < 3195; i++) st = await sim(0.5, { throttle: 0.4, autopilot: true });
  for (let i = 0; i < 20 && st.kmh > 2; i++) st = await sim(0.5, { throttle: 0, brake: 1, autopilot: true });
  st = await sim(1.5, { throttle: 0, handbrake: true, autopilot: true }); console.log('stopped', JSON.stringify(st));
  await page.evaluate(() => { const f = __game.road.sample(3236); __game.setFreeCamera([f.x + f.rx * 6, 3.2, f.z + f.rz * 6], [f.x - f.tx * 14 + f.rx * -2, 0.8, f.z - f.tz * 14 + f.rz * -2]); });
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'test-results/event-accident.png' });
  await page.evaluate(() => __game.setFreeCamera(null));
  st = await sim(27, { throttle: 0, handbrake: true, autopilot: true }); console.log('after wait', JSON.stringify(st));
  st = await sim(8, { throttle: 1, autopilot: true }); console.log('drove on', JSON.stringify(st), 'crashes', await page.evaluate(() => __game.stats().crashes));
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'test-results/event-accident-cleared.png' });
}
if (which.includes('toll')) {
  console.log('=== TOLL ===');
  await page.evaluate(() => { __game.incidents.reset(); __game.traffic.enabled = false; __game.teleport(4380); });
  let st = await sim(20, { throttle: 1, autopilot: true }); console.log('at plaza', JSON.stringify(st));
  await page.waitForTimeout(300);
  console.log('choice open', await page.evaluate(() => __game.choice.open));
  await page.evaluate(() => __game.setFreeCamera([-8, 3.5, 6], [1, 2, -10]));
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'test-results/event-toll.png' });
  await page.evaluate(() => __game.setFreeCamera(null));
  await page.click('#choice-a'); await page.waitForTimeout(1200);
  st = await sim(6, { throttle: 1, autopilot: true }); console.log('after paying', JSON.stringify(st));
}
await browser.close();
