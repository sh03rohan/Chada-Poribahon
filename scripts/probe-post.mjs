import { chromium } from '@playwright/test';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const shots = process.argv[2] === 'all' ? [['medium', 'none', 'hour=15', 3400, 'day'], ['medium', 'basic', 'hour=15', 3400, 'day'], ['high', 'full', 'hour=15', 3400, 'day'], ['medium', 'none', 'hour=21', 1150, 'night'], ['medium', 'basic', 'hour=21', 1150, 'night'], ['high', 'full', 'hour=21', 1150, 'night']] : [['medium', 'basic', 'hour=15', 3400, 'day'], ['high', 'full', 'hour=15', 3400, 'day'], ['medium', 'basic', 'hour=21', 1150, 'night']];
for (const [q, post, hour, s, name] of shots) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(() => localStorage.setItem('cp-settings', JSON.stringify({ introSeen: true, tutorialSeen: true })));
  await page.goto(`http://localhost:5173/?quality=${q}&post=${post}&${hour}&weather=clear&hazards=0`);
  await page.waitForFunction(() => window.__game?.ready === true, null, { timeout: 180000 });
  await page.click('#menu-start'); await page.waitForTimeout(400); await page.click('#pretrip-go'); await page.waitForTimeout(300);
  await page.evaluate((s) => { __game.traffic.enabled = false; __game.teleport(s); __game.simulate(0.3, { throttle: 0, handbrake: true }); __game.hud.show(false); document.getElementById('minimap').classList.add('hidden'); }, s);
  await page.waitForTimeout(4000);
  const t0 = Date.now(); const f0 = await page.evaluate(() => __game.frames); await page.waitForTimeout(6000); const n = await page.evaluate((f0) => __game.frames - f0, f0);
  console.log(`${q}/${post} ${name}: post=${await page.evaluate(() => __game.stats().post)} msPerFrame=${n ? Math.round((Date.now() - t0) / n) : 'n/a'} errors=${errors.length}`);
  await page.screenshot({ path: `test-results/post-${name}-${q}-${post}.png` });
  await page.close();
}
await browser.close();
