import { chromium } from '@playwright/test';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.addInitScript(() => localStorage.setItem('cp-settings', JSON.stringify({ introSeen: true, tutorialSeen: true })));
const URL = 'http://localhost:5173/?quality=medium&hour=10&weather=clear&hazards=0&view=chase';
const boot = async () => { await page.goto(URL, { timeout: 180000, waitUntil: 'commit' }); await page.waitForFunction(() => window.__game?.ready === true, null, { timeout: 180000 }); await page.click('#menu-start', { timeout: 120000, force: true }); await page.waitForTimeout(400); await page.click('#pretrip-go', { timeout: 120000, force: true }); await page.waitForTimeout(300); };
const frame = async (n = 1) => { const f0 = await page.evaluate(() => __game.frames); await page.waitForFunction(([f0, n]) => __game.frames > f0 + n, [f0, n], { timeout: 180000 }); };
await boot();
await page.evaluate(() => { __game.traffic.enabled = false; __game.simulate(3, { throttle: 1, autopilot: true }); __game.teleport(__game.stats().world.bridgeEndS + 20); __game.simulate(60, { throttle: 1, autopilot: true }); }); await frame(2);
await boot();
// put the player a little behind where the ghost was at t = 6 s
await page.evaluate(() => { __game.traffic.enabled = false; __game.simulate(3, { throttle: 1, autopilot: true }); __game.teleport(__game.stats().world.bridgeEndS + 20); __game.simulate(3, { throttle: 0.6, autopilot: true }); });
await frame(1);
console.log(JSON.stringify(await page.evaluate(() => { const s = __game.stats().ghost; return { ...s, elapsed: __game.elapsed, s: __game.routeS, ghostZ: __game.ghost.mesh.position.toArray(), busZ: __game.bus.root.position.toArray() }; })));
await page.screenshot({ path: 'test-results/ghost-close.png' });
await browser.close();
