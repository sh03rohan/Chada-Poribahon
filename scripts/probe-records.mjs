import { chromium } from '@playwright/test';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on('pageerror', (e) => console.log('PAGEERROR', e.message, e.stack));
await page.addInitScript(() => localStorage.setItem('cp-settings', JSON.stringify({ introSeen: true, tutorialSeen: true })));
await page.goto('http://localhost:5173/?quality=low&hour=22');
await page.waitForFunction(() => window.__game?.ready === true, null, { timeout: 90000 });
await page.waitForTimeout(500);
await page.click('#menu-records'); await page.waitForTimeout(300);
await page.screenshot({ path: 'test-results/records-empty.png' });
await page.click('#records-close');
for (let i = 0; i < 2; i++) {
  if (i === 0) { await page.click('#menu-start'); await page.waitForTimeout(400); await page.click('#pretrip-go'); } else await page.evaluate(() => __game.startRun());
  await page.waitForTimeout(300);
  await page.evaluate(() => { __game.traffic.enabled = false; __game.teleport(5900); __game.simulate(25, { throttle: 1, autopilot: true }); });
  await page.waitForFunction(() => __game.finished, null, { timeout: 20000 }); await page.waitForTimeout(300);
  console.log('run', i + 1, JSON.stringify(await page.evaluate(() => { const s = __game.stats(); return { badges: s.lastBadges, rank: s.rank, all: s.career.achievements, best: s.career.bestRuns.length }; })));
  console.log('res-badges:', await page.locator('#res-badges').innerText().catch(() => '(hidden)'));
}
await page.screenshot({ path: 'test-results/records-results.png' });
await page.evaluate(() => { document.getElementById('results').classList.add('hidden'); __game.openRecords('badges'); }); await page.waitForTimeout(300);
await page.screenshot({ path: 'test-results/records-badges.png' });
await page.evaluate(() => __game.openRecords('runs')); await page.waitForTimeout(300);
await page.screenshot({ path: 'test-results/records-runs.png' });
await browser.close();
