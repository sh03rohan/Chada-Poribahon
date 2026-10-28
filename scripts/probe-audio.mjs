import { chromium } from '@playwright/test';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.log('PAGEERROR', e.message, e.stack));
await page.addInitScript(() => localStorage.setItem('cp-settings', JSON.stringify({ introSeen: true, tutorialSeen: true })));
await page.goto('http://localhost:5173/?quality=low&hour=11&weather=clear');
await page.waitForFunction(() => window.__game?.ready === true, null, { timeout: 120000 });
await page.click('#menu-start'); await page.waitForTimeout(400); await page.click('#pretrip-go'); await page.waitForTimeout(300);
const lv = async (label) => console.log(label, JSON.stringify(await page.evaluate(() => { const s = __game.stats(); const L = __game.audio.levels; return { crowd: +L.crowd.toFixed(2), bell: +L.bell.toFixed(2), train: +L.train.toFixed(2), siren: +L.siren.toFixed(2), water: +L.water.toFixed(2), rail: s.rail, trainActive: s.trainActive, s: Math.round(__game.routeS) }; })));
await page.evaluate(() => { __game.traffic.enabled = false; });
await lv('start');
// near Rajbari stand (waiting crowd)
await page.evaluate(() => { __game.teleport(1950); __game.simulate(0.3, { throttle: 0, handbrake: true }); }); await page.waitForTimeout(2500); await lv('near stop');
// rail: approach from 150 m out so the gates close, then let the train come
await page.evaluate(() => { __game.teleport(__game.stats().world.railS - 150); __game.simulate(0.5, { throttle: 0.3, autopilot: true }); for (let i = 0; i < 20 && __game.stats().kmh > 2; i++) __game.simulate(0.5, { throttle: 0, brake: 0.8, autopilot: true }); __game.simulate(1, { throttle: 0, handbrake: true }); }); await page.waitForTimeout(2500); await lv('gates');
await page.evaluate(() => __game.simulate(6, { throttle: 0, handbrake: true })); await page.waitForTimeout(2500); await lv('train near');
// blockade police siren
await page.evaluate(() => { __game.teleport(__game.stats().world.andolonS - 60); __game.simulate(0.3, { throttle: 0, handbrake: true }); __game.blockade.startWaiting(); __game.blockade.forcePolice(); __game.simulate(0.5, { throttle: 0, handbrake: true }); }); await page.waitForTimeout(2500); await lv('police');
// bridge water
await page.evaluate(() => { __game.teleport(__game.stats().world.bridgeStartS + 200); __game.simulate(0.3, { throttle: 0, handbrake: true }); }); await page.waitForTimeout(2500); await lv('bridge');
// sting on fine: bump ledger
await page.evaluate(() => { __game.ledger.fines += 500; }); await page.waitForTimeout(2500); await lv('fine sting');
await browser.close();
