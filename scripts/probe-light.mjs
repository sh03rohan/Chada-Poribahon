import { chromium } from '@playwright/test';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const all = [['high', 'hour=6.6&weather=clear', 2650, 'sunrise-csm'], ['high', 'hour=6.6&weather=clear&csm=0', 2650, 'sunrise-nocsm'], ['medium', 'hour=21&weather=clear', 1990, 'night-lamps'], ['medium', 'hour=11&weather=fog', 2650, 'fog-cones'], ['high', 'hour=6.6&weather=clear&photo=1', 2650, 'sunrise-rays']];
const shots = process.argv[2] ? all.filter((x) => process.argv.slice(2).includes(x[3])) : all;
for (const [q, qs, s, name] of shots) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(() => localStorage.setItem('cp-settings', JSON.stringify({ introSeen: true, tutorialSeen: true })));
  await page.goto(`http://localhost:5173/?quality=${q}&${qs}&hazards=0`, { timeout: 240000 });
  await page.waitForFunction(() => window.__game?.ready === true, null, { timeout: 240000 });
  await page.click('#menu-start'); await page.waitForTimeout(400); await page.click('#pretrip-go'); await page.waitForTimeout(300);
  await page.evaluate((s) => { __game.traffic.enabled = false; __game.teleport(s); __game.simulate(0.3, { throttle: 0, handbrake: true }); __game.hud.show(false); document.getElementById('minimap').classList.add('hidden'); }, s);
  if (qs.includes('photo=1')) await page.evaluate(() => { __game.openPhoto(); __game.photo.yaw = -1.57; __game.photo.pitch = 0.08; __game.photo.dist = 15; });
  const f0 = await page.evaluate(() => __game.frames);
  await page.waitForFunction((f0) => __game.frames > f0 + 1, f0, { timeout: 180000 }).catch(() => console.log(name, 'no second frame in 180 s'));
  console.log(name, await page.evaluate(() => { const s = __game.stats(); return { csm: s.csm, rays: +s.raysOpacity.toFixed(2), sunI: +__game.sky.sunIntensity.toFixed(2), calls: s.drawCalls, cones: __game.bus.body.children.filter((c) => c.visible && c.geometry?.type === 'ConeGeometry').length }; }), 'errors', errors.length, errors[0] ?? '');
  await page.screenshot({ path: `test-results/light-${name}.png` });
  await page.close();
}
await browser.close();
