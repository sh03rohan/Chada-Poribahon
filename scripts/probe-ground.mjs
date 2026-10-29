import { chromium } from '@playwright/test';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
for (const [weather, name] of [['clear', 'dry'], ['rain', 'wet']]) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(() => localStorage.setItem('cp-settings', JSON.stringify({ introSeen: true, tutorialSeen: true })));
  const t0 = Date.now(); await page.goto(`http://localhost:5173/?quality=medium&hour=15&weather=${weather}&hazards=0`, { timeout: 180000 });
  await page.waitForFunction(() => window.__game?.ready === true, null, { timeout: 180000 }); console.log(name, 'load+ready s', Math.round((Date.now() - t0) / 1000));
  await page.click('#menu-start'); await page.waitForTimeout(400); await page.click('#pretrip-go'); await page.waitForTimeout(300);
  await page.evaluate(() => { __game.traffic.enabled = false; __game.teleport(2650); __game.simulate(0.3, { throttle: 0, handbrake: true }); __game.hud.show(false); document.getElementById('minimap').classList.add('hidden'); });
  await page.waitForTimeout(5000); await page.screenshot({ path: `test-results/ground-${name}-chase.png` });
  await page.evaluate(() => { __game.switchCamera('cockpit'); }); await page.waitForTimeout(5000); await page.screenshot({ path: `test-results/ground-${name}-cockpit.png` });
  console.log(name, await page.evaluate(() => { const t = __game.road.group.getObjectByName('tufts'), p = __game.road.group.getObjectByName('puddles'); return { tufts: t?.count, puddles: p?.count, puddleOpacity: p?.material.opacity, calls: __game.stats().drawCalls, wet: __game.stats().wet }; }), 'errors', errors.length);
  await page.close();
}
await browser.close();
