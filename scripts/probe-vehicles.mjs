import { chromium } from '@playwright/test';
// Line up one of each traffic vehicle beside the bus and photograph them.
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.log('PAGEERROR', e.message, e.stack));
await page.goto('http://localhost:5173/?autostart=1&quality=medium&view=chase&hour=11');
await page.waitForFunction(() => window.__game?.ready === true, null, { timeout: 90000 });
await page.waitForTimeout(800);
await page.evaluate(() => {
  const g = __game; const vs = g.traffic.vehicles; g.traffic.enabled = true;
  for (const v of vs) v.s = 5000 + Math.random() * 500;
  const order = ['car', 'bike', 'auto', 'bus', 'truck', 'rickshaw', 'van'];
  let s = 1520;
  for (const type of order) { const v = vs.find((x) => x.type === type); v.dir = 1; v.lateral = -1.75; v.swerve = 0; v.speed = 0; v.maxSpeed = 0.01; v.hitT = 0; v.s = s; s += v.len + 3; }
  g.teleport(1500); g.simulate(0.2, { handbrake: true });
  g.setFreeCamera([-9, 3.2, -22], [0, 1.2, -38]);
});
await page.waitForTimeout(700);
await page.screenshot({ path: 'test-results/vehicles-lineup.png' });
await page.evaluate(() => __game.setFreeCamera([6, 2.0, -16], [-2, 1.0, -22]));
await page.waitForTimeout(500);
await page.screenshot({ path: 'test-results/vehicles-front.png' });
await browser.close();
