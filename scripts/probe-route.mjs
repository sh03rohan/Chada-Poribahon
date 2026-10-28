import { chromium } from '@playwright/test';
const route = process.argv[2] ?? 'dhaka-sylhet';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.log('PAGEERROR', e.message, e.stack));
await page.addInitScript(() => localStorage.setItem('cp-settings', JSON.stringify({ introSeen: true, tutorialSeen: true })));
await page.goto(`http://localhost:5173/?quality=medium&hour=11&route=${route}`);
await page.waitForFunction(() => window.__game?.ready === true, null, { timeout: 120000 });
await page.waitForTimeout(600);
console.log('route', await page.evaluate(() => ({ label: document.querySelector('#hud-route b').textContent, finish: __game.road.length, stops: __game.stats().stops.length })));
await page.click('#menu-start'); await page.waitForTimeout(500);
await page.screenshot({ path: `test-results/route-${route}-pretrip.png` });
console.log('route buttons:', await page.evaluate(() => [...document.querySelectorAll('.route-select button')].map((b) => b.textContent.trim() + (b.classList.contains('on') ? ' [on]' : '') + (b.disabled ? ' [disabled]' : ''))));
await page.click('#pretrip-go'); await page.waitForTimeout(400);
const shots = route === 'dhaka-sylhet' ? [[60, 'start'], [1980, 'narsingdi'], [3100, 'bridge'], [3650, 'haor'], [5500, 'teahills'], [6100, 'sylhet']] : route === 'dhaka-chattogram' ? [[60, 'start'], [2440, 'fork'], [5500, 'hills'], [6150, 'sea']] : [[60, 'start'], [5000, 'bridge']];
for (const [s, name] of shots) {
  await page.evaluate((s) => { __game.traffic.enabled = false; __game.teleport(s); __game.simulate(0.3, { throttle: 0, handbrake: true }); }, s);
  await page.waitForTimeout(500);
  await page.screenshot({ path: `test-results/route-${route}-${name}.png` });
}
// full run by teleport: finish + results title
await page.evaluate(() => { __game.teleport(__game.road.length - 160); __game.simulate(30, { throttle: 1, autopilot: true }); });
await page.waitForFunction(() => __game.finished, null, { timeout: 20000 }).catch(() => console.log('did not finish'));
console.log('results title:', await page.locator('#res-title').innerText());
await page.evaluate(() => { document.getElementById('results').classList.add('hidden'); __game.toggleMap(true); }); await page.waitForTimeout(400);
await page.screenshot({ path: `test-results/route-${route}-map.png` });
await browser.close();
