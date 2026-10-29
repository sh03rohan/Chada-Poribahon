import { chromium } from '@playwright/test';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.log('PAGEERROR', e.message, e.stack));
await page.addInitScript(() => localStorage.setItem('cp-settings', JSON.stringify({ introSeen: true, tutorialSeen: true })));
await page.goto('http://localhost:5173/?quality=medium&hour=15&weather=clear');
await page.waitForFunction(() => window.__game?.ready === true, null, { timeout: 120000 });
await page.click('#menu-start'); await page.waitForTimeout(400); await page.click('#pretrip-go'); await page.waitForTimeout(300);
const st = () => page.evaluate(() => { const s = __game.stats(); return { signals: s.signals, redLights: s.redLights, fines: s.ledger.fines, s: Math.round(__game.routeS), kmh: Math.round(s.kmh), msg: document.getElementById('hud-msg').textContent }; });
console.log('start', await st());
// look at the first signal on red, from 30 m back
await page.evaluate(() => { __game.traffic.enabled = false; __game.signals.force(0, 'red'); const s = __game.stats().signals[0].s; __game.teleport(s - 30); __game.simulate(0.3, { throttle: 0, handbrake: true }); });
await page.waitForTimeout(2500); await page.screenshot({ path: 'test-results/signal-red.png' });
// run the red at speed
await page.evaluate(() => { const s = __game.stats().signals[0].s; __game.teleport(s - 80); __game.simulate(9, { throttle: 1, autopilot: true }); });
await page.waitForTimeout(300); console.log('ran red', await st());
// second signal: stop properly on red, then green
await page.evaluate(() => { __game.signals.force(1, 'red'); const s = __game.stats().signals[1].s; __game.teleport(s - 40); __game.simulate(1, { throttle: 0.5, autopilot: true }); for (let i = 0; i < 30 && __game.stats().kmh > 2; i++) __game.simulate(0.5, { throttle: 0, brake: 0.7, autopilot: true }); __game.simulate(1.5, { throttle: 0, handbrake: true, autopilot: true }); });
console.log('stopped at red', await st());
await page.waitForTimeout(2500); await page.screenshot({ path: 'test-results/signal-stopped.png' });
await page.evaluate(() => { __game.signals.force(1, 'green'); __game.simulate(6, { throttle: 1, autopilot: true }); });
console.log('went on green', await st());
// traffic obeys: a car ahead of a red signal must stop before the line
await page.evaluate(() => { __game.traffic.enabled = true; __game.signals.force(2, 'red'); const vs = __game.traffic.vehicles; for (const v of vs) v.s = 200 + Math.random() * 100; const c = vs.find((v) => v.type === 'car'); const s = __game.stats().signals[2].s; c.s = s - 60; c.dir = 1; c.lateral = -1.75; c.swerve = 0; c.speed = 15; c.maxSpeed = 20; c.overtake = 0; c.hitT = 0; __game.teleport(s - 110); __game.simulate(8, { throttle: 0, handbrake: true }); window.__car = { s: c.s, speed: c.speed, line: s + 2.6 }; });
console.log('car at red', await page.evaluate(() => window.__car));
await page.waitForTimeout(2500); await page.screenshot({ path: 'test-results/signal-traffic.png' });
await page.evaluate(() => { __game.signals.force(2, 'green'); __game.simulate(5, { throttle: 0, handbrake: true }); const c = __game.traffic.vehicles.find((v) => v.type === 'car'); window.__car = { s: c.s, speed: c.speed }; });
console.log('car after green', await page.evaluate(() => window.__car));
await browser.close();
