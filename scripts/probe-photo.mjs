import { chromium } from '@playwright/test';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.log('PAGEERROR', e.message, e.stack));
await page.addInitScript(() => localStorage.setItem('cp-settings', JSON.stringify({ introSeen: true, tutorialSeen: true })));
await page.goto('http://localhost:5173/?quality=medium&hour=16&weather=clear');
await page.waitForFunction(() => window.__game?.ready === true, null, { timeout: 120000 });
await page.click('#menu-start'); await page.waitForTimeout(400); await page.click('#pretrip-go'); await page.waitForTimeout(300);
await page.evaluate(() => { __game.traffic.enabled = false; __game.teleport(3400); __game.simulate(0.3, { throttle: 0, handbrake: true }); });
await page.keyboard.press('KeyP'); await page.waitForTimeout(300);
await page.click('#pause-photo'); await page.waitForTimeout(2500);
console.log('open', await page.evaluate(() => ({ on: __game.photo.on, paused: __game.paused, hudHidden: document.getElementById('hud').classList.contains('hidden'), pauseHidden: document.getElementById('pause').classList.contains('hidden'), minimapHidden: document.getElementById('minimap').classList.contains('hidden') })));
await page.screenshot({ path: 'test-results/photo-open.png' });
// drag to orbit + wheel zoom
await page.mouse.move(640, 360); await page.mouse.down(); await page.mouse.move(400, 300, { steps: 8 }); await page.mouse.up();
await page.mouse.wheel(0, -300); await page.waitForTimeout(2500);
console.log('orbit', await page.evaluate(() => ({ yaw: +__game.photo.yaw.toFixed(2), pitch: +__game.photo.pitch.toFixed(2), dist: +__game.photo.dist.toFixed(1) })));
await page.screenshot({ path: 'test-results/photo-orbit.png' });
const dl = page.waitForEvent('download', { timeout: 15000 }).catch(() => null);
await page.click('#photo-save');
const d = await dl; console.log('download', d ? d.suggestedFilename() : null, 'blob bytes', await page.evaluate(() => __game.photo.lastBlob?.size ?? null));
if (d) { await d.saveAs('test-results/photo-saved.png'); }
await page.click('#photo-close'); await page.waitForTimeout(300);
console.log('closed', await page.evaluate(() => ({ on: __game.photo.on, paused: __game.paused, hudHidden: document.getElementById('hud').classList.contains('hidden'), pauseHidden: document.getElementById('pause').classList.contains('hidden') })));
// from driving via F
await page.click('#pause-resume'); await page.waitForTimeout(200); await page.keyboard.press('KeyF'); await page.waitForTimeout(300);
console.log('F', await page.evaluate(() => ({ on: __game.photo.on, paused: __game.paused })));
await page.keyboard.press('Escape'); await page.waitForTimeout(300);
console.log('Esc', await page.evaluate(() => ({ on: __game.photo.on, paused: __game.paused, pauseHidden: document.getElementById('pause').classList.contains('hidden') })));
await browser.close();
