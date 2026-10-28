import { chromium, devices } from '@playwright/test';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
for (const [w, h, mobile] of [[1280, 800, false], [851, 393, true]]) {
  const ctx = await browser.newContext(mobile ? { ...devices['Pixel 7'], viewport: { width: w, height: h }, isMobile: true, hasTouch: true } : { viewport: { width: w, height: h } });
  await ctx.addInitScript(() => { localStorage.setItem('cp-settings', JSON.stringify({ introSeen: true, tutorialSeen: true })); if (!localStorage.getItem('cp-career')) localStorage.setItem('cp-career', JSON.stringify({ balance: 5000, xp: 2500, trips: 3 })); });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('PAGEERROR', e.message, e.stack));
  await page.goto('http://localhost:5173/?quality=low&hour=11');
  await page.waitForFunction(() => window.__game?.ready === true, null, { timeout: 90000 });
  await page.waitForTimeout(400);
  await page.click('#menu-start'); await page.waitForTimeout(500);
  await page.screenshot({ path: `test-results/contracts-pretrip-${w}.png` });
  const offers = await page.evaluate(() => [...document.querySelectorAll('#pretrip-contracts .contract')].map((b) => b.dataset.id));
  console.log(w, 'offers', offers);
  if (!mobile) {
    // pick the first real contract, finish instantly (teleport): time-based ones pass, stop-based ones fail
    await page.click(`#pretrip-contracts .contract[data-id="${offers[1]}"]`);
    await page.click('#pretrip-go'); await page.waitForTimeout(300);
    console.log('toast:', await page.locator('#hud-msg').innerText());
    await page.evaluate(() => { __game.traffic.enabled = false; __game.teleport(5900); __game.simulate(25, { throttle: 1, autopilot: true }); });
    await page.waitForTimeout(600);
    const st = await page.evaluate(() => { const s = __game.stats(); return { contract: s.contract, lastContract: s.lastContract, outcome: s.lastOutcome, balance: s.career.balance }; });
    console.log(JSON.stringify(st));
    console.log('results contract line:', await page.locator('#res-career .contract').innerText().catch(() => '(none)'));
    await page.screenshot({ path: 'test-results/contracts-results.png' });
  }
  await ctx.close();
}
await browser.close();
