import { chromium, devices } from '@playwright/test';
// HUD layout check: every overlay at once (message, banner, bubbles, toast, choice prompt) on desktop and phone.
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
for (const [w, h, mobile] of [[1280, 800, false], [851, 393, true]]) {
  const ctx = await browser.newContext(mobile ? { ...devices['Pixel 7'], viewport: { width: w, height: h }, isMobile: true, hasTouch: true } : { viewport: { width: w, height: h } });
  await ctx.addInitScript(() => localStorage.setItem('cp-settings', JSON.stringify({ introSeen: true, tutorialSeen: true, steering: 'buttons' })));
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
  await page.goto(`http://localhost:5173/?quality=low&hour=15&autostart=1${mobile ? '&touch=1' : ''}`);
  await page.waitForFunction(() => window.__game?.ready === true, null, { timeout: 90000 });
  await page.waitForTimeout(600);
  await page.evaluate(() => { __game.traffic.enabled = false; __game.teleport(1900); __game.simulate(4, { throttle: 1, autopilot: true }); __game.hud.message('সামনে অবরোধ! রাস্তা বন্ধ — থামুন', false, 9000); __game.hud.setBanner('পুলিশ চেকপোস্ট সামনে', '৩০ কিমি/ঘ-এর নিচে নামুন'); __game.passengers.shout('wait', true); __game.passengers.shout('brake', true); void __game.choice.askMany('“ভাই, রাস্তার চাঁদাটা দিয়ে যান”', '৳২০০ চাইছে। দিলে ঝামেলা নেই, না দিলে রাস্তা আটকাবে।', ['৳২০০ দিন', 'দেব না'], 30, 1); });
  await page.waitForTimeout(900);
  await page.screenshot({ path: `test-results/hud-layout-${w}.png` });
  await ctx.close();
}
await browser.close();
