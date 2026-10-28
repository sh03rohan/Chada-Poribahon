import { chromium } from '@playwright/test';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.log('PAGEERROR', e.message, e.stack));
await page.addInitScript(() => localStorage.setItem('cp-settings', JSON.stringify({ introSeen: true, tutorialSeen: true })));
await page.goto('http://localhost:5173/?quality=medium&hour=11&weather=fog');
await page.waitForFunction(() => window.__game?.ready === true, null, { timeout: 120000 });
await page.waitForTimeout(500);
await page.click('#menu-start'); await page.waitForTimeout(400);
console.log('forecast:', await page.locator('#pretrip-weather').innerText());
await page.screenshot({ path: 'test-results/weather-pretrip.png' });
await page.click('#pretrip-go'); await page.waitForTimeout(400);
await page.evaluate(() => { __game.teleport(1500); __game.simulate(0.3, { throttle: 0, handbrake: true }); });
await page.waitForTimeout(500);
const st = () => page.evaluate(() => { const s = __game.stats(); return { weather: s.weather, wet: +s.wet.toFixed(2), fog: +s.fogDensity.toFixed(5), lightning: s.lightning, btn: document.getElementById('btn-weather').textContent }; });
console.log('fog:', await st());
await page.screenshot({ path: 'test-results/weather-fog.png' });
for (const k of ['storm', 'rain', 'clear']) {
  await page.evaluate((k) => __game.applyWeather(k, true), k); await page.waitForTimeout(400);
  if (k === 'storm') {
    // drive for a while so a lightning strike happens; catch the flash frame
    await page.evaluate(() => { __game.lightningIn = 0.2; });
    await page.evaluate(() => __game.simulate(0.5, { throttle: 0.3 }));
    await page.waitForTimeout(100);
    await page.screenshot({ path: 'test-results/weather-storm-flash.png' });
    await page.waitForTimeout(1500);
  }
  console.log(k + ':', await st());
  await page.screenshot({ path: `test-results/weather-${k}.png` });
}
// cycle button
await page.click('#btn-weather'); await page.waitForTimeout(300);
console.log('after button:', await st(), 'msg:', await page.locator('#hud-msg').innerText().catch(() => '?'));
// night fog
await page.evaluate(() => { __game.sky.setTime(21); __game.applyNight(); __game.applyWeather('fog', true); }); await page.waitForTimeout(500);
await page.screenshot({ path: 'test-results/weather-fog-night.png' });
console.log('night fog:', await st());
await browser.close();
