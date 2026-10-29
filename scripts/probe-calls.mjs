import { chromium } from '@playwright/test';
const port = process.argv[2] ?? '5173';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.addInitScript(() => localStorage.setItem('cp-settings', JSON.stringify({ introSeen: true, tutorialSeen: true })));
await page.goto(`http://localhost:${port}/?quality=low&hour=10&weather=clear&hazards=0`);
await page.waitForFunction(() => window.__game?.ready === true, null, { timeout: 120000 });
await page.waitForTimeout(2000);
async function measure(ms) {
  const f0 = await page.evaluate(() => __game.frames ?? 0);
  const t0 = Date.now();
  await page.waitForTimeout(ms);
  return page.evaluate(([f0, t0]) => { const g = __game; const n = (g.frames ?? 0) - f0; return { calls: g.renderer.info.render.calls, tris: g.renderer.info.render.triangles, frames: n, msPerFrame: n ? Math.round((Date.now() - t0) / n) : null, kmh: Math.round(Math.abs(g.cur.v) * 3.6) }; }, [f0, t0]);
}
console.log(`port ${port} landing`, JSON.stringify(await measure(8000)));
await page.click('#menu-start'); await page.waitForTimeout(600); await page.click('#pretrip-go'); await page.waitForTimeout(500);
await page.evaluate(() => { __game.input.override = { throttle: 1 }; __game.autopilot = true; });
console.log(`port ${port} driving`, JSON.stringify(await measure(10000)));
await browser.close();
