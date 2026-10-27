// Plays the intro and screenshots it at given seconds; prints cinematic state. Usage: node scripts/probe-intro.mjs out-prefix [quality]
import { chromium } from '@playwright/test';
const out = process.argv[2] ?? 'test-results/screenshots/intro';
const quality = process.argv[3] ?? 'medium';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
await page.goto(`http://localhost:5173/?quality=${quality}&screen=intro&hour=10`);
await page.waitForFunction(() => window.__game?.ready === true, null, { timeout: 90000 });
const times = [3, 10, 16, 21, 26];
for (const t of times) {
  await page.waitForFunction((tt) => __game.stats().cineTime >= tt || !__game.stats().cineActive, t, { timeout: 120000 });
  const st = await page.evaluate(() => { const s = __game.stats(); return { cineTime: +s.cineTime.toFixed(1), active: s.cineActive, screen: s.screen, caption: document.getElementById('cine-caption').textContent, skipVisible: !document.getElementById('cine-skip').closest('.hidden') }; });
  console.log('t=' + t, JSON.stringify(st));
  await page.screenshot({ path: `${out}-${t}s.png` });
}
await page.waitForFunction(() => !__game.stats().cineActive, null, { timeout: 60000 });
console.log('after', JSON.stringify(await page.evaluate(() => ({ screen: __game.stats().screen, pretripVisible: !document.getElementById('pretrip').classList.contains('hidden'), introSeen: __game.settings.value.introSeen }))));
await browser.close();
