import { test, expect, type Page } from '@playwright/test';
import fs from 'node:fs';

const SHOTS = 'test-results/screenshots';
fs.mkdirSync(SHOTS, { recursive: true });

async function boot(page: Page, query: string, errors: string[] = []) {
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(() => localStorage.setItem('cp-settings', JSON.stringify({ introSeen: true, tutorialSeen: true })));
  await page.goto(`/?${query}${query.includes('weather=') || query.includes('story=') ? '' : '&weather=clear'}&hazards=0`);
  await page.waitForFunction(() => (window as unknown as { __game?: { ready: boolean } }).__game?.ready === true, null, { timeout: 120_000 });
  await page.waitForTimeout(500);
  return errors;
}
const g = (page: Page, expr: string) => page.evaluate(expr);
const finished = (page: Page) => page.waitForFunction(() => (window as unknown as { __game: { finished: boolean } }).__game.finished === true, null, { timeout: 20_000 });
const finishRun = async (page: Page) => { await g(page, '__game.traffic.enabled = false; __game.teleport(__game.road.length - 160); __game.simulate(30, { throttle: 1, autopilot: true })'); await finished(page); await page.waitForTimeout(300); };

test('story mode: day 1 locks route/hour/weather, target judged and saved, next day chains, day 7 gives the verdict', async ({ page }) => {
  test.setTimeout(480_000); // three boots + three finished runs under software GL
  const errors = await boot(page, 'quality=low');
  await page.click('#menu-story'); await page.waitForTimeout(200);
  expect(await page.locator('.sday').count()).toBe(7);
  expect(await page.locator('.sday.today').innerText()).toContain('দিন ১');
  await page.screenshot({ path: `${SHOTS}/story-panel.png` });
  await page.click('#story-play'); await page.waitForTimeout(400);
  const pre = await g(page, '(() => { const s = __game.stats(); return { screen: __game.screen, story: s.story, hour: s.fixedHour, weather: s.weather, crowd: s.crowd, routeSel: document.querySelector(".route-select").classList.contains("hidden") }; })()');
  expect(pre).toMatchObject({ screen: 'pretrip', story: 1, hour: 7, weather: 'clear', crowd: 1.5, routeSel: true });
  await expect(page.locator('#pretrip-story')).toContainText('মালিক');
  await page.click('#pretrip-go'); await page.waitForTimeout(300);
  await finishRun(page);
  const d1 = await g(page, '__game.stats().lastStory') as { day: number; met: boolean; points: number };
  expect(d1.day).toBe(1); expect(d1.met).toBe(true); expect(d1.points).toBeGreaterThanOrEqual(1);
  await expect(page.locator('#res-challenge')).toContainText('কাল দিন ২');
  expect(await page.locator('#btn-again').innerText()).toContain('পরের দিন');
  expect(JSON.parse(await g(page, 'localStorage.getItem("cp-story")') as string).day).toBe(2);
  await page.click('#btn-again'); await page.waitForTimeout(400);
  expect(await g(page, '(() => ({ s: __game.screen, d: __game.stats().story, c: __game.stats().crowd }))()')).toEqual({ s: 'pretrip', d: 2, c: 2.7 });
  // day 4: instalment is deducted by the owner; day 6: inspector bonus for a clean trip
  await g(page, 'const p = JSON.parse(localStorage.getItem("cp-story")); p.day = 4; p.results = [1,2,3].map(() => ({ net: 9000, stars: 4, met: true, points: 2, note: "ok" })); localStorage.setItem("cp-story", JSON.stringify(p))');
  await page.goto('/?quality=low&hazards=0&story=4');
  await page.waitForFunction(() => (window as unknown as { __game?: { ready: boolean } }).__game?.ready === true, null, { timeout: 120_000 });
  expect(await page.locator('#menu-start').innerText()).toContain('দিন ৪');
  await page.click('#menu-start'); await page.waitForTimeout(400); await page.click('#pretrip-go'); await page.waitForTimeout(300);
  await finishRun(page);
  const d4 = await g(page, '(() => { const s = __game.stats(); return { owner: s.owner, net: s.ledger.net, met: s.lastStory.met }; })()') as { owner: number; net: number; met: boolean };
  expect(d4.owner).toBe(-5000); expect(d4.net).toBe(10800 - 5000); expect(d4.met).toBe(false);
  expect(await page.locator('#res-grid').innerText()).toContain('মালিকের হিসাব');
  // day 7 → verdict (all earlier days strong → partner ending)
  await g(page, 'const p = JSON.parse(localStorage.getItem("cp-story")); p.day = 7; p.results = [1,2,3,4,5,6].map(() => ({ net: 9000, stars: 4, met: true, points: 2, note: "ok" })); localStorage.setItem("cp-story", JSON.stringify(p))');
  await page.goto('/?quality=low&hazards=0&story=7');
  await page.waitForFunction(() => (window as unknown as { __game?: { ready: boolean } }).__game?.ready === true, null, { timeout: 120_000 });
  await page.click('#menu-start'); await page.waitForTimeout(400);
  expect((await g(page, '__game.stats().weather'))).toBe('fog');
  await page.click('#pretrip-go'); await page.waitForTimeout(300);
  await finishRun(page);
  await expect(page.locator('#res-challenge')).toContainText('মালিক বললেন');
  expect(JSON.parse(await g(page, 'localStorage.getItem("cp-story")') as string).finished).toBe(true);
  await page.screenshot({ path: `${SHOTS}/story-verdict.png` });
  await page.click('#btn-again'); await page.waitForTimeout(300);
  expect(await page.locator('#story').isVisible()).toBe(true);
  await expect(page.locator('#story-body')).toContainText('অর্ধেক তোমার');
  expect(errors).toEqual([]);
});
