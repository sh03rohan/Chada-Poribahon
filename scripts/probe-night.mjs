import { chromium } from '@playwright/test';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.log('PAGEERROR', e.message, e.stack));
await page.addInitScript(() => localStorage.setItem('cp-settings', JSON.stringify({ introSeen: true, tutorialSeen: true })));
await page.goto('http://localhost:5173/?quality=medium&hour=21&weather=clear');
await page.waitForFunction(() => window.__game?.ready === true, null, { timeout: 120000 });
await page.click('#menu-start'); await page.waitForTimeout(400); await page.click('#pretrip-go'); await page.waitForTimeout(300);
const st = () => page.evaluate(() => { const s = __game.stats(); return { highBeam: s.highBeam, unlit: s.unlit, cattle: s.cattle, cowHits: s.cowHits, fines: s.ledger.fines, beamBtn: document.getElementById('btn-beam').className }; });
console.log('night start', await st());
// line up an unlit truck ahead in our lane + a lit oncoming car, then look
await page.evaluate(() => { const vs = __game.traffic.vehicles; for (const v of vs) v.s = 5000 + Math.random() * 500; const t = vs.find((v) => v.type === 'truck'); t.unlit = true; __game.traffic.setNight(true); __game.teleport(1000); t.s = 1060; t.dir = 1; t.lateral = -1.75; t.swerve = 0; t.speed = 0; t.maxSpeed = 0.01; const c = vs.find((v) => v.type === 'car'); c.s = 1090; c.dir = -1; c.lateral = 1.75; c.speed = 0; c.maxSpeed = 0.01; c.unlit = false; __game.simulate(0.3, { throttle: 0, handbrake: true }); });
await page.waitForTimeout(2500); await page.screenshot({ path: 'test-results/night-lowbeam.png' });
await page.keyboard.press('KeyL'); await page.evaluate(() => __game.simulate(0.3, { throttle: 0, handbrake: true })); await page.waitForTimeout(2500);
console.log('high beam', (await st()).highBeam, (await st()).beamBtn);
await page.screenshot({ path: 'test-results/night-highbeam.png' });
// cattle: approach the first spot
await page.evaluate(() => { __game.toggleHighBeam(false); __game.traffic.enabled = false; const s = __game.stats().cattle[0].s; __game.teleport(s - 200); __game.simulate(0.5, { throttle: 0, handbrake: true }); });
console.log('cattle after approach', (await st()).cattle);
await page.evaluate(() => { const s = __game.stats().cattle[0].s; __game.teleport(s - 45); __game.simulate(6, { throttle: 0, handbrake: true }); });
await page.waitForTimeout(2500); await page.screenshot({ path: 'test-results/night-cattle.png' });
console.log('cattle mid', (await st()).cattle);
// drive into the cows: put the lead cow in our lane and go
await page.evaluate(() => { const sp = __game.cattle.spots[0]; sp.cows.forEach((c, i) => { c.lat = -1.75 - i * 0.9; c.speed = 0.05; }); __game.teleport(sp.s - 25); __game.simulate(5, { throttle: 1, autopilot: true }); });
await page.waitForTimeout(500);
console.log('after ram', await st());
await page.screenshot({ path: 'test-results/night-cattle-hit.png' });
await browser.close();
