import { chromium } from '@playwright/test';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.addInitScript(() => localStorage.setItem('cp-settings', JSON.stringify({ introSeen: true, tutorialSeen: true })));
await page.goto('http://localhost:5173/?quality=low&hour=10&weather=clear&hazards=0');
await page.waitForFunction(() => window.__game?.ready === true, null, { timeout: 120000 });
async function measure(ms) { const f0 = await page.evaluate(() => __game.frames); const t0 = Date.now(); await page.waitForTimeout(ms); return page.evaluate(([f0, t0]) => { const n = __game.frames - f0; return { frames: n, msPerFrame: n ? Math.round((Date.now() - t0) / n) : null }; }, [f0, t0]); }
await page.click('#menu-start'); await page.waitForTimeout(600); await page.click('#pretrip-go'); await page.waitForTimeout(500);
console.log('driving, HUD on, stopped', JSON.stringify(await measure(8000)));
await page.evaluate(() => { __game.hud.show(false); document.getElementById('minimap').classList.add('hidden'); document.getElementById('hud-buttons').classList.add('hidden'); });
console.log('driving, HUD off, stopped', JSON.stringify(await measure(8000)));
await page.evaluate(() => { __game.hud.show(true); document.getElementById('minimap').classList.remove('hidden'); });
await page.evaluate(() => { __game.paused = true; });
console.log('driving, HUD on, paused (no physics)', JSON.stringify(await measure(8000)));
await page.evaluate(() => { __game.paused = false; __game.hud.show(false); document.getElementById('minimap').classList.add('hidden'); __game.input.override = { throttle: 1 }; __game.autopilot = true; });
console.log('driving, HUD off, moving', JSON.stringify(await measure(8000)));
await browser.close();
