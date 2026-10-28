import { chromium } from '@playwright/test';
// Traffic/collision behaviour probe: (a) rear-end a slow van → bus keeps moving, van is shoved and pulls over;
// (b) park in the oncoming lane → oncoming vehicles queue (or squeeze along the kerb if there is room).
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
page.on('pageerror', (e) => console.log('PAGEERROR', e.message, e.stack));
await page.goto('http://localhost:5173/?autostart=1&quality=low&view=chase&hour=12');
await page.waitForFunction(() => window.__game?.ready === true, null, { timeout: 90000 });
await page.waitForTimeout(800);
const which = process.argv[2] ?? 'all';
if (which === 'all' || which === 'hit') {
  console.log('=== REAR-END a car at ~50 km/h ===');
  const r = await page.evaluate(() => {
    const g = __game; const T = g.traffic; const vs = T.vehicles;
    // park a car 60 m ahead in our lane, stopped
    const car = vs.find((v) => v.type === 'car'); g.teleport(1500);
    car.s = 1560; car.dir = 1; car.lateral = -1.75; car.swerve = 0; car.speed = 0; car.maxSpeed = 0.01; car.hitT = 0;
    // freeze everything else far away
    for (const v of vs) if (v !== car) { v.s = 5000 + Math.random() * 500; }
    const log = [];
    for (let i = 0; i < 24; i++) { const st = g.simulate(0.5, { throttle: 1, autopilot: true }); log.push({ t: (i + 1) * 0.5, bus: +st.s.toFixed(1), kmh: +st.kmh.toFixed(1), car: +car.s.toFixed(1), carV: +(car.speed * 3.6).toFixed(1), carLat: +(car.lateral + car.swerve).toFixed(2), hitT: +car.hitT.toFixed(1) }); }
    return log;
  });
  for (const l of r) console.log(JSON.stringify(l));
  await page.screenshot({ path: 'test-results/traffic-hit.png' });
}
if (which === 'all' || which === 'queue') {
  console.log('=== PARK IN THE ONCOMING LANE ===');
  const r = await page.evaluate(() => {
    const g = __game; const T = g.traffic; const vs = T.vehicles;
    g.teleport(1500);
    // move the bus into the oncoming lane centre (lateral +1.75)
    const f = g.road.sample(1500); g.cur.x += f.rx * 3.5; g.cur.z += f.rz * 3.5; g.prev.x = g.cur.x; g.prev.z = g.cur.z;
    // three oncoming cars + a truck coming toward us, everything else far away
    const on = vs.filter((v) => v.type === 'car' || v.type === 'truck').slice(0, 4);
    for (const v of vs) v.s = 5000 + Math.random() * 500;
    on.forEach((v, i) => { v.dir = -1; v.lateral = 1.75; v.swerve = 0; v.s = 1600 + i * 40; v.speed = 14; v.maxSpeed = 16; v.hitT = 0; v.overtake = 0; });
    const log = [];
    for (let i = 0; i < 30; i++) { const st = g.simulate(0.5, { throttle: 0, brake: 0, handbrake: true }); if (i % 3 === 2) log.push({ t: (i + 1) * 0.5, bus: +st.s.toFixed(1), lat: +st.lateral.toFixed(2), cars: on.map((v) => `${v.type[0]}@${v.s.toFixed(0)} ${(v.speed * 3.6).toFixed(0)}km/h lat${(v.lateral + v.swerve).toFixed(1)}`) }); }
    return log;
  });
  for (const l of r) console.log(JSON.stringify(l));
  await page.evaluate(() => __game.setFreeCamera([-6, 4, 6], [3, 1, -25]));
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'test-results/traffic-queue.png' });
  console.log('=== STRADDLE the centre line (room to squeeze) ===');
  const r2 = await page.evaluate(() => {
    const g = __game; const vs = g.traffic.vehicles;
    g.teleport(1500); const f = g.road.sample(1500); g.cur.x += f.rx * 1.75; g.cur.z += f.rz * 1.75; g.prev.x = g.cur.x; g.prev.z = g.cur.z;
    const on = vs.filter((v) => v.type === 'car' || v.type === 'bike').slice(0, 3);
    for (const v of vs) v.s = 5000 + Math.random() * 500;
    on.forEach((v, i) => { v.dir = -1; v.lateral = 1.75; v.swerve = 0; v.s = 1580 + i * 30; v.speed = 12; v.maxSpeed = 14; v.hitT = 0; v.overtake = 0; });
    const log = [];
    for (let i = 0; i < 40; i++) { const st = g.simulate(0.5, { handbrake: true }); if (i % 4 === 3) log.push({ t: (i + 1) * 0.5, lat: +st.lateral.toFixed(2), cars: on.map((v) => `${v.type[0]}@${v.s.toFixed(0)} ${(v.speed * 3.6).toFixed(0)}km/h lat${(v.lateral + v.swerve).toFixed(1)}`) }); }
    return log;
  });
  for (const l of r2) console.log(JSON.stringify(l));
}
await browser.close();
