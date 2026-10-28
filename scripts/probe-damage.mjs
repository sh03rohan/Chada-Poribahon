import { chromium } from '@playwright/test';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.log('PAGEERROR', e.message, e.stack));
await page.goto('http://localhost:5173/?autostart=1&quality=low&view=chase&hour=21');
await page.waitForFunction(() => window.__game?.ready === true, null, { timeout: 90000 });
await page.waitForTimeout(600);
// ram a parked car three times at ~50 km/h
const ram = async () => page.evaluate(() => {
  const g = __game; const vs = g.traffic.vehicles; const car = vs.find((v) => v.type === 'car');
  for (const v of vs) v.s = 5000 + Math.random() * 500;
  g.teleport(1480); car.s = 1560; car.dir = 1; car.lateral = -1.75; car.swerve = 0; car.speed = 0; car.maxSpeed = 0.01; car.hitT = 0;
  g.simulate(9, { throttle: 1, autopilot: true });
  const st = g.stats(); return { damage: +st.damage.toFixed(1), crashes: st.crashes, mods: st.mods, mood: +st.mood.toFixed(0) };
});
for (let i = 0; i < 5; i++) { console.log('ram', i + 1, JSON.stringify(await ram())); await page.waitForTimeout(400); }
console.log('hud damage pill:', await page.locator('#hud-damage').isVisible(), await page.locator('#hud-damage-val').innerText());
// front view: bent bumper + dead left lamp (night)
await page.evaluate(() => { __game.teleport(2000); __game.simulate(0.3, { handbrake: true }); __game.setFreeCamera([3.5, 1.6, -11], [0, 1.0, -4]); });
await page.waitForTimeout(500);
await page.screenshot({ path: 'test-results/damage-front.png' });
await page.evaluate(() => { __game.setFreeCamera([-5, 2.2, 9], [0, 1.6, 2]); });
await page.waitForTimeout(500);
await page.screenshot({ path: 'test-results/damage-smoke.png' });
await page.evaluate(() => { __game.setFreeCamera(null); __game.switchCamera('cockpit'); });
await page.waitForTimeout(900);
await page.screenshot({ path: 'test-results/damage-cockpit.png' });
// speed cap: full throttle on the bridge
const cap = await page.evaluate(() => { __game.switchCamera('chase'); __game.teleport(4660); const st = __game.simulate(40, { throttle: 1, autopilot: true }); return { kmh: +st.kmh.toFixed(1), top: +st.topSpeed.toFixed(1) }; });
console.log('damaged top speed', cap);
// finish → repair on results
await page.evaluate(() => { __game.teleport(5900); __game.simulate(40, { throttle: 1, autopilot: true }); });
await page.waitForFunction(() => __game.finished, null, { timeout: 20000 });
await page.waitForTimeout(300);
console.log('results grid has repair:', (await page.locator('#res-grid').innerText()).includes('মেরামত'), JSON.stringify(await page.evaluate(() => ({ repair: __game.ledger.repair, net: __game.ledger.net, outcome: __game.stats().lastOutcome }))));
await page.screenshot({ path: 'test-results/damage-results.png' });
await page.evaluate(() => __game.startRun());
await page.waitForTimeout(300);
console.log('after restart', JSON.stringify(await page.evaluate(() => ({ damage: __game.stats().damage, mods: __game.stats().mods }))));
await browser.close();
