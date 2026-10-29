import { chromium } from '@playwright/test';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
await page.addInitScript(() => localStorage.setItem('cp-settings', JSON.stringify({ introSeen: true, tutorialSeen: true })));
await page.goto('http://localhost:5173/?quality=medium&hour=21&weather=clear&hazards=0', { timeout: 180000, waitUntil: 'commit' });
await page.waitForFunction(() => window.__game?.ready === true, null, { timeout: 180000 });
await page.click('#menu-start'); await page.waitForTimeout(400); await page.click('#pretrip-go'); await page.waitForTimeout(300);
const st = () => page.evaluate(() => { const s = __game.stats(); return { rearHits: s.rearHits, crashes: s.crashes, damage: s.damage, kmh: Math.round(s.kmh), s: Math.round(s.s ?? __game.routeS) }; });
console.log('start', await st());
// 1) natural: sit at the start with the handbrake on for 60 s
await page.evaluate(() => __game.simulate(60, { throttle: 0, handbrake: true }));
console.log('after 60 s idle at start', await st());
// 2) line up fast same-direction vehicles right behind the stopped bus
const lineup = await page.evaluate(() => {
  __game.teleport(1000); const vs = __game.traffic.vehicles; const ps = __game.routeS;
  for (const v of vs) { v.s = ps + 400 + Math.random() * 200; v.overtake = 0; v.swerve = 0; v.hitT = 0; }
  const pick = (t) => vs.find((v) => v.type === t);
  const set = (v, back, lat) => { v.dir = 1; v.s = ps - back; v.lateral = lat; v.swerve = 0; v.speed = v.maxSpeed; v.overtake = 0; };
  set(pick('car'), 70, -1.75); set(pick('truck'), 110, -1.75); set(pick('bike'), 150, -1.75); set(pick('rickshaw'), 40, -3.05); set(pick('bus'), 190, -1.75);
  // one oncoming car far away so the overtake lane is free, then one close so some must queue
  const oc = vs.filter((v) => v.type === 'car')[1]; oc.dir = -1; oc.s = ps + 700; oc.lateral = 1.75; oc.speed = oc.maxSpeed;
  return vs.filter((v) => v.s < ps + 300).map((v) => ({ t: v.type, d: Math.round(v.s - ps), v: Math.round(v.speed * 3.6), dir: v.dir }));
});
console.log('lineup', JSON.stringify(lineup));
const snap = () => page.evaluate(() => { const vs = __game.traffic.vehicles; const ps = __game.routeS; return vs.filter((v) => Math.abs(v.s - ps) < 320).map((v) => ({ t: v.type, d: Math.round(v.s - ps), v: Math.round(v.speed * 3.6), ot: v.overtake, lat: +(v.lateral + v.swerve).toFixed(1), dir: v.dir })); });
for (let k = 1; k <= 5; k++) { await page.evaluate(() => __game.simulate(5, { throttle: 0, handbrake: true })); console.log(`t=${k * 5}s`, JSON.stringify(await snap()), JSON.stringify(await st())); }
// 3) now drive off slowly and stop again (a car stuck behind should follow, not shove)
await page.evaluate(() => __game.simulate(8, { throttle: 0.5, autopilot: true }));
await page.evaluate(() => __game.simulate(12, { throttle: 0, brake: 1, handbrake: true }));
console.log('after drive+stop', JSON.stringify(await snap()), JSON.stringify(await st()));
await page.waitForTimeout(1500); await page.screenshot({ path: 'test-results/traffic-queue-night.png' });
await browser.close();
