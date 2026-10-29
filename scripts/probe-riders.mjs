import { chromium } from '@playwright/test';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.log('PAGEERROR', e.message, e.stack));
await page.addInitScript(() => localStorage.setItem('cp-settings', JSON.stringify({ introSeen: true, tutorialSeen: true })));
await page.goto('http://localhost:5173/?quality=low&hour=11&weather=clear&hazards=0');
await page.waitForFunction(() => window.__game?.ready === true, null, { timeout: 120000 });
await page.click('#menu-start'); await page.waitForTimeout(400); await page.click('#pretrip-go'); await page.waitForTimeout(300);
const stopAt = (s) => page.evaluate((s) => { __game.teleport(s); __game.simulate(1, { throttle: 0.5, autopilot: true }); for (let i = 0; i < 30 && __game.stats().kmh > 2; i++) __game.simulate(0.5, { throttle: 0, brake: 0.6, autopilot: true }); __game.simulate(1.5, { throttle: 0, handbrake: true, autopilot: true }); }, s);
const st = () => page.evaluate(() => { const s = __game.stats(); return { log: s.riders.log, pendingDrop: s.riders.pendingDrop, fares: s.ledger.fares, tips: s.ledger.tips, pax: s.passengers, mood: Math.round(s.mood), choiceOpen: s.choiceOpen, title: document.getElementById('choice-title')?.textContent, extraDwell: __game.events.extraDwell }; });
// haggle at Rajbari
await page.evaluate(() => { __game.traffic.enabled = false; __game.riders.force('haggle'); });
await stopAt(1990);
await page.evaluate(() => __game.simulate(10, { throttle: 0, handbrake: true, autopilot: true })); await page.waitForTimeout(600);
console.log('haggle prompt', await st());
await page.screenshot({ path: 'test-results/riders-haggle.png' });
await page.evaluate(() => document.getElementById('choice-a').click()); await page.waitForTimeout(400);
console.log('after accept', await st());
await page.evaluate(() => { if (__game.choice.open) __game.choice.cancel(); });
// no change mid-leg
await page.evaluate(() => { __game.riders.force('nochange'); __game.riders.legEvent = 'nochange'; __game.riders.legTimer = 0.5; __game.teleport(2300); __game.simulate(3, { throttle: 1, autopilot: true }); });
await page.waitForTimeout(2500); console.log('nochange prompt', await st());
await page.evaluate(() => document.getElementById('choice-a').click()); await page.waitForTimeout(400); console.log('after nochange', await st());
// drop mid-leg: stop within 20 s
await page.evaluate(() => { __game.riders.legEvent = 'drop'; __game.riders.legTimer = 0.5; __game.simulate(3, { throttle: 1, autopilot: true }); });
await page.waitForTimeout(2500); console.log('drop prompt', await st());
await page.evaluate(() => document.getElementById('choice-a').click()); await page.waitForTimeout(400);
await page.evaluate(() => { for (let i = 0; i < 30 && __game.stats().kmh > 1; i++) __game.simulate(0.5, { throttle: 0, brake: 1, autopilot: true }); __game.simulate(1, { throttle: 0, handbrake: true }); });
await page.waitForTimeout(2500); console.log('after drop stop', await st());
await browser.close();
