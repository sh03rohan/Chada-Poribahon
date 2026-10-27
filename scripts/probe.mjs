import { chromium } from '@playwright/test';
const query = process.argv[2] ?? 'autostart=1&quality=low&view=cockpit&hour=12';
const shot = process.argv[3] ?? null;
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
page.on('pageerror', (e) => console.log('PAGEERROR', e.message, '\n', e.stack));
page.on('console', (m) => { if (m.type() !== 'debug') console.log('CONSOLE', m.type(), m.text()); });
await page.goto('http://localhost:5173/?' + query);
await page.waitForFunction(() => window.__game?.ready === true, null, { timeout: 90000 });
await page.waitForTimeout(1500);
const evalJs = process.argv[4];
if (evalJs) { console.log('EVAL', JSON.stringify(await page.evaluate(evalJs))); await page.waitForTimeout(600); }
console.log('STATS', JSON.stringify(await page.evaluate(() => __game.stats())));
if (shot) { await page.screenshot({ path: shot }); console.log('shot', shot); }
await browser.close();
