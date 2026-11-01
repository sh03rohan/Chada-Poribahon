import { chromium } from '@playwright/test';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
await page.addInitScript(() => localStorage.setItem('cp-settings', JSON.stringify({ introSeen: true, tutorialSeen: true })));
await page.goto('http://localhost:5173/?quality=medium&hour=10&weather=clear', { timeout: 180000, waitUntil: 'commit' });
await page.waitForFunction(() => window.__game?.ready === true, null, { timeout: 180000 });
await page.click('#menu-start', { timeout: 120000, force: true }); await page.waitForTimeout(400); await page.click('#pretrip-go', { timeout: 120000, force: true }); await page.waitForTimeout(300);
const st = () => page.evaluate(() => { const s = __game.stats(); return { breakers: s.surface.breakers, potholes: s.surface.potholes, crossed: s.surface.crossed, fast: s.surface.fast, potholeHits: s.surface.potholeHits, log: s.surface.log, damage: +s.damage.toFixed(1), mood: Math.round(__game.passengers.mood), kmh: Math.round(s.kmh), s: Math.round(__game.routeS) }; });
const s0 = await st(); console.log('layout', JSON.stringify({ breakers: s0.breakers, potholes: s0.potholes }));
const b0 = s0.breakers[0];
// look at the sign + hump from the shoulder
await page.evaluate((b0) => { __game.traffic.enabled = false; __game.teleport(b0 - 30); __game.simulate(0.3, { throttle: 0, handbrake: true }); }, b0);
await page.waitForTimeout(2500); await page.screenshot({ path: 'test-results/surface-breaker.png' });
// 1) fast crossing: approach at full throttle from 160 m back
await page.evaluate((b0) => { __game.teleport(b0 - 120); __game.cur.v = __game.prev.v = 16; __game.simulate(10, { throttle: 1, autopilot: false }); }, b0);
console.log('fast', JSON.stringify(await st()));
// 2) slow crossing of the second breaker: creep at ~15 km/h
const b1 = s0.breakers[1];
await page.evaluate((b1) => { __game.teleport(b1 - 30); __game.simulate(4, { throttle: 0.25 }); __game.simulate(6, { throttle: 0.12 }); }, b1);
console.log('slow', JSON.stringify(await st()));
// 3) pothole: put a wheel track onto the first pothole at 50 km/h
const ph = await page.evaluate(() => __game.surface.potholes[0]);
await page.evaluate((ph) => { __game.teleport(ph.s - 120); const f = __game.road.sample(ph.s - 120); const lat = ph.lat - 1.05; __game.cur.x = f.x + f.rx * lat; __game.cur.z = f.z + f.rz * lat; __game.prev.x = __game.cur.x; __game.prev.z = __game.cur.z; __game.cur.v = __game.prev.v = 14; __game.simulate(9, { throttle: 0.9 }); }, ph);
console.log('pothole', JSON.stringify({ ph, ...(await st()) }));
// 4) autopilot eases off for a breaker: full throttle through it from 200 m back
const b2 = s0.breakers[1];
await page.evaluate((b2) => { __game.teleport(b2 - 160); __game.cur.v = __game.prev.v = 15; __game.simulate(12, { throttle: 1, autopilot: true }); }, b2);
console.log('autopilot', JSON.stringify(await st()));
await browser.close();
