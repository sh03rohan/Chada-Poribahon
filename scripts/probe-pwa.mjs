// PWA check against `vite preview` (port 4173): service worker installs, then the page boots offline.
import { chromium } from '@playwright/test';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ viewport: { width: 960, height: 540 } });
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
await page.goto('http://localhost:4173/?quality=low&hour=11');
await page.waitForFunction(() => window.__game?.ready === true, null, { timeout: 90000 });
const reg = await page.waitForFunction(async () => { const r = await navigator.serviceWorker.getRegistration(); return r && (r.active ? 'active' : r.installing ? 'installing' : r.waiting ? 'waiting' : 'none'); }, null, { timeout: 30000 }).then((h) => h.jsonValue());
console.log('sw registration:', reg);
await page.waitForFunction(async () => { const r = await navigator.serviceWorker.getRegistration(); return !!r?.active; }, null, { timeout: 30000 });
await page.waitForTimeout(1500);
const manifest = await page.evaluate(async () => (await (await fetch('/manifest.webmanifest')).json()).icons.length);
console.log('manifest icons:', manifest);
await ctx.setOffline(true);
await page.reload();
await page.waitForFunction(() => window.__game?.ready === true, null, { timeout: 90000 }).then(() => console.log('OFFLINE boot: ok'), (e) => console.log('OFFLINE boot failed', e.message));
console.log('offline title:', await page.title(), 'landing visible:', await page.locator('#landing').isVisible());
await browser.close();
