import { chromium } from '@playwright/test';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = []; page.on('pageerror', (e) => errors.push(e.message));
await page.addInitScript(() => localStorage.setItem('cp-settings', JSON.stringify({ introSeen: true, tutorialSeen: true })));
await page.goto('http://localhost:5173/?quality=medium&hour=16&weather=clear&hazards=0', { timeout: 240000 });
await page.waitForFunction(() => window.__game?.ready === true, null, { timeout: 240000 });
await page.click('#menu-start'); await page.waitForTimeout(400); await page.click('#pretrip-go'); await page.waitForTimeout(300);
for (const [s, name] of [[2600, 'fields'], [3550, 'town']]) {
  await page.evaluate((s) => { __game.traffic.enabled = false; __game.teleport(s); __game.simulate(0.3, { throttle: 0, handbrake: true }); __game.hud.show(false); document.getElementById('minimap').classList.add('hidden'); }, s);
  const f0 = await page.evaluate(() => __game.frames); await page.waitForFunction((f0) => __game.frames > f0 + 1, f0, { timeout: 120000 });
  await page.screenshot({ path: `test-results/scenery-${name}.png` });
}
console.log(await page.evaluate(() => ({ birds: __game.skylife.group.children[0].visible, kites: __game.skylife.group.children.filter((c) => c.isSprite && c.visible).length, uTime: +__game.props.uTime.value.toFixed(1), horizon: __game.sky.horizon?.visible ?? 'n/a', calls: __game.stats().drawCalls })), 'errors', errors.length, errors[0] ?? '');
await browser.close();
