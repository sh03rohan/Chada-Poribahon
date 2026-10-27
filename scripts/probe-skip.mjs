import { chromium } from '@playwright/test';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
await page.goto('http://localhost:5173/?quality=low&hour=10');
await page.waitForFunction(() => window.__game?.ready === true, null, { timeout: 90000 });
await page.evaluate(() => { __game.cinematic.timeScale = 4; });
for (let sec = 0; sec <= 29; sec += 3) {
  const t0 = Date.now();
  await page.evaluate(() => { void __game.playIntro(); });
  try {
    await page.waitForFunction(() => __game.stats().cineActive, null, { timeout: 8000 });
    await page.waitForFunction((tt) => __game.stats().cineTime >= tt, sec, { timeout: 20000 });
  } catch (e) { console.log('sec', sec, 'HANG before skip:', JSON.stringify(await page.evaluate(() => { const s = __game.stats(); return { active: s.cineActive, t: s.cineTime, screen: s.screen, running: __game.running }; }))); break; }
  const mode = (sec / 3) % 4;
  if (mode === 0) await page.evaluate(() => document.getElementById('cine-skip').click());
  else if (mode === 1) await page.keyboard.press('Escape');
  else if (mode === 2) await page.keyboard.press('Space');
  else await page.mouse.click(480, 270);
  try { await page.waitForFunction(() => !__game.stats().cineActive, null, { timeout: 8000 }); }
  catch { console.log('sec', sec, 'HANG after skip mode', mode, JSON.stringify(await page.evaluate(() => ({ active: __game.stats().cineActive, t: __game.stats().cineTime })))); break; }
  const st = await page.evaluate(() => ({ pretrip: !document.getElementById('pretrip').classList.contains('hidden'), screen: __game.stats().screen }));
  console.log('sec', sec, 'mode', mode, 'ok', JSON.stringify(st), (Date.now() - t0) + 'ms');
}
await browser.close();
