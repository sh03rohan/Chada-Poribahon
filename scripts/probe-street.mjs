import { chromium } from '@playwright/test';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.log('PAGEERROR', e.message, e.stack));
await page.addInitScript(() => localStorage.setItem('cp-settings', JSON.stringify({ introSeen: true, tutorialSeen: true })));
await page.goto('http://localhost:5173/?quality=medium&hour=8&weather=clear&hazards=0');
await page.waitForFunction(() => window.__game?.ready === true, null, { timeout: 120000 });
await page.click('#menu-start'); await page.waitForTimeout(400); await page.click('#pretrip-go'); await page.waitForTimeout(300);
const st = () => page.evaluate(() => { const s = __game.stats(); return { bands: s.street.bands, counts: s.street.counts, people: __game.people.people.length }; });
await page.evaluate(() => { __game.traffic.enabled = false; });
const shots = [[8, 1975, 'school'], [12, 1150, 'haat'], [17, 2720, 'cricket'], [21, 1150, 'tea']];
for (const [h, s, name] of shots) {
  await page.evaluate(([h, s]) => { __game.sky.setTime(h); __game.applyNight(); __game.teleport(s); __game.simulate(0.3, { throttle: 0, handbrake: true }); }, [h, s]);
  await page.waitForTimeout(2500);
  console.log(name, await st());
  await page.screenshot({ path: `test-results/street-${name}.png` });
}
await browser.close();
