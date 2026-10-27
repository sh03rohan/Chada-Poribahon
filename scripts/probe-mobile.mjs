// Mobile-viewport smoke check: start screen, then HUD + touch controls after tapping start.
import { chromium, devices } from '@playwright/test';
const out = process.argv[2] ?? 'test-results/screenshots/mobile';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ ...devices['Pixel 7'], viewport: { width: 851, height: 393 }, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
await page.goto('http://localhost:5173/?quality=low&hour=15');
await page.waitForFunction(() => window.__game?.ready === true, null, { timeout: 90000 });
await page.waitForTimeout(500);
await page.screenshot({ path: `${out}-start.png` });
await page.tap('#btn-start');
await page.waitForTimeout(800);
// press gas via touch for 2.5 s
const gas = page.locator('.tbtn[data-act="gas"]');
const box = await gas.boundingBox();
await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
await page.evaluate(() => { __game.input.override = { throttle: 1 }; });
await page.waitForTimeout(2500);
await page.evaluate(() => { __game.input.override = null; });
await page.screenshot({ path: `${out}-hud.png` });
console.log('STATS', JSON.stringify(await page.evaluate(() => __game.stats())));
console.log('touch visible', await page.locator('#touch').isVisible(), 'audio', await page.evaluate(() => __game.audio.ready));
await browser.close();
