import { chromium } from '@playwright/test';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.log('PAGEERROR', e.message, e.stack));
await page.addInitScript(() => localStorage.setItem('cp-settings', JSON.stringify({ introSeen: true, tutorialSeen: true })));
await page.goto('http://localhost:5173/?quality=medium&hour=11');
await page.waitForFunction(() => window.__game?.ready === true, null, { timeout: 120000 });
await page.click('#menu-start'); await page.waitForTimeout(400); await page.click('#pretrip-go'); await page.waitForTimeout(300);
// force the 'dadi' special at Rajbari (stop 0): drive into the stop zone and dwell
const stopAt = (s) => page.evaluate((s) => { __game.teleport(s); __game.simulate(1, { throttle: 0.5, autopilot: true }); for (let i = 0; i < 30 && __game.stats().kmh > 2; i++) __game.simulate(0.5, { throttle: 0, brake: 0.6, autopilot: true }); __game.simulate(1.5, { throttle: 0, handbrake: true, autopilot: true }); }, s);
await page.evaluate(() => { __game.traffic.enabled = false; __game.forceSpecial('dadi'); });
await stopAt(1990);
await page.waitForTimeout(300);
console.log('phase', await page.evaluate(() => __game.events.phase), 'stats', await page.evaluate(() => { const s = __game.stats(); return { special: s.special, done: s.specialsDone, tips: s.tips }; }));
await page.evaluate(() => __game.simulate(10, { throttle: 0, handbrake: true }));
await page.waitForTimeout(300);
console.log('after dwell', await page.evaluate(() => { const s = __game.stats(); return { phase: __game.events.phase, special: s.special, done: s.specialsDone, tips: s.tips, goal: document.getElementById('hud-goal').textContent, hidden: document.getElementById('hud-goal').classList.contains('hidden') }; }));
await page.screenshot({ path: 'test-results/special-boarded.png' });
// ride smoothly to Faridpur (3440): teleport near and stop gently
await stopAt(3430);
await page.waitForTimeout(300);
console.log('at faridpur', await page.evaluate(() => { const s = __game.stats(); return { phase: __game.events.phase, special: s.special, done: s.specialsDone, tips: s.tips, hidden: document.getElementById('hud-goal').classList.contains('hidden') }; }));
await page.screenshot({ path: 'test-results/special-settled.png' });
await browser.close();
