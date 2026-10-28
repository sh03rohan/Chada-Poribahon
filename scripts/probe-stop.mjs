import { chromium } from '@playwright/test';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
await page.addInitScript(() => localStorage.setItem('cp-settings', JSON.stringify({ introSeen: true, tutorialSeen: true })));
await page.goto('http://localhost:5173/?quality=low&hour=11');
await page.waitForFunction(() => window.__game?.ready === true, null, { timeout: 120000 });
await page.click('#menu-start'); await page.waitForTimeout(400); await page.click('#pretrip-go'); await page.waitForTimeout(300);
const st = () => page.evaluate(() => ({ s: +__game.routeS.toFixed(1), kmh: +__game.stats().kmh.toFixed(1), phase: __game.events.phase, lat: +__game.lateral.toFixed(2) }));
await page.evaluate(() => { __game.traffic.enabled = false; __game.teleport(1960); __game.simulate(0.2, { throttle: 0, handbrake: true }); }); console.log('tp', await st());
await page.evaluate(() => __game.simulate(2, { throttle: 0.6, autopilot: true })); console.log('acc', await st());
for (let i = 0; i < 12; i++) { await page.evaluate(() => __game.simulate(0.5, { throttle: 0, brake: 0.6, autopilot: true })); console.log('brk', await st()); }
await page.evaluate(() => __game.simulate(1.5, { throttle: 0, handbrake: true, autopilot: true })); console.log('hb', await st());
await browser.close();
