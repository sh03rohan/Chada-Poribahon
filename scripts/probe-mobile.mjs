// Mobile-viewport smoke check: landing → pretrip → driving HUD with touch controls, at phone sizes.
import { chromium, devices } from '@playwright/test';
const out = process.argv[2] ?? 'test-results/mobile';
const sizes = [[851, 393, 'pixel7'], [812, 375, 'iphone']];
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
for (const [w, h, name] of sizes) {
  const ctx = await browser.newContext({ ...devices['Pixel 7'], viewport: { width: w, height: h }, isMobile: true, hasTouch: true });
  await ctx.addInitScript(() => localStorage.setItem('cp-settings', JSON.stringify({ introSeen: true, tutorialSeen: true, steering: 'buttons' })));
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
  await page.goto('http://localhost:5173/?quality=low&hour=15&touch=1');
  await page.waitForFunction(() => window.__game?.ready === true, null, { timeout: 90000 });
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${out}-${name}-landing.png` });
  await page.tap('#menu-start'); await page.waitForTimeout(600);
  await page.screenshot({ path: `${out}-${name}-pretrip.png` });
  await page.tap('#pretrip-go'); await page.waitForTimeout(600);
  await page.evaluate(() => { __game.autopilot = true; __game.input.override = { throttle: 1 }; });
  await page.waitForTimeout(3500);
  await page.screenshot({ path: `${out}-${name}-hud.png` });
  await page.evaluate(() => { __game.settings.set('steering', 'wheel'); });
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${out}-${name}-wheel.png` });
  await page.evaluate(() => { __game.input.override = null; __game.toggleMap(true); });
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${out}-${name}-map.png` });
  await page.evaluate(() => __game.toggleMap(false));
  await page.tap('#btn-pause').catch(() => {}); await page.waitForTimeout(400);
  await page.screenshot({ path: `${out}-${name}-pause.png` });
  await ctx.close();
}
await browser.close();
