import { chromium } from '@playwright/test';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = []; page.on('pageerror', (e) => errors.push(e.message));
await page.addInitScript(() => localStorage.setItem('cp-settings', JSON.stringify({ introSeen: true, tutorialSeen: true })));
await page.goto('http://localhost:5173/?quality=medium&hour=15&weather=clear&hazards=0', { timeout: 240000 });
await page.waitForFunction(() => window.__game?.ready === true, null, { timeout: 240000 });
await page.click('#menu-start'); await page.waitForTimeout(400); await page.click('#pretrip-go'); await page.waitForTimeout(300);
await page.evaluate(() => { __game.traffic.enabled = false; __game.teleport(3400); __game.simulate(0.3, { throttle: 0, handbrake: true }); });
for (const [yaw, pitch, dist, name] of [[1.1, 0.12, 11, 'side'], [2.6, 0.2, 10, 'rear'], [-0.6, 0.05, 9, 'front']]) {
  await page.evaluate(([yaw, pitch, dist]) => { if (!__game.photo.on) __game.openPhoto(); __game.photo.yaw = yaw; __game.photo.pitch = pitch; __game.photo.dist = dist; }, [yaw, pitch, dist]);
  const f0 = await page.evaluate(() => __game.frames); await page.waitForFunction((f0) => __game.frames > f0 + 1, f0, { timeout: 120000 });
  await page.screenshot({ path: `test-results/bus-${name}.png` });
}
console.log('rivets', await page.evaluate(() => __game.bus.body.getObjectByName('rivets')?.count), 'calls', await page.evaluate(() => __game.stats().drawCalls), 'errors', errors.length, errors[0] ?? '');
await browser.close();
