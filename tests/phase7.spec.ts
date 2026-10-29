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

test('radio: N cycles three stations and off, music schedules notes, ticker announces, choice persists in settings', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(() => { if (!localStorage.getItem('cp-settings')) localStorage.setItem('cp-settings', JSON.stringify({ introSeen: true, tutorialSeen: true })); });
  await page.goto('/?quality=low&hour=11&weather=rain&hazards=0');
  await page.waitForFunction(() => (window as unknown as { __game?: { ready: boolean } }).__game?.ready === true, null, { timeout: 120_000 });
  await page.click('#menu-start'); await page.waitForTimeout(400); await page.click('#pretrip-go'); await page.waitForTimeout(300);
  const st = () => g(page, '(() => { const r = __game.stats().radio; return { on: r.on, station: r.station, ticks: r.ticks, notes: r.notes, ticker: r.ticker, btnOn: document.getElementById("btn-radio").classList.contains("on"), setting: JSON.parse(localStorage.getItem("cp-settings")).radio }; })()') as Promise<{ on: boolean; station: number; ticks: number; notes: number; ticker: string; btnOn: boolean; setting: number }>;
  expect((await st()).on).toBe(false);
  await page.keyboard.press('KeyN');
  await page.waitForFunction(() => (window as unknown as { __game: { stats(): { radio: { notes: number } } } }).__game.stats().radio.notes > 3, null, { timeout: 15_000 });
  let s = await st(); expect(s).toMatchObject({ on: true, station: 0, btnOn: true, setting: 0 }); expect(s.ticker).toContain('রেডিও পদ্মা');
  await g(page, '__game.radio.tickIn = 0');
  await page.waitForFunction(() => (window as unknown as { __game: { stats(): { radio: { ticks: number } } } }).__game.stats().radio.ticks >= 1, null, { timeout: 15_000 });
  s = await st(); expect(s.ticker.length).toBeGreaterThan(8); expect(s.ticker).not.toContain('আপনি শুনছেন');
  await page.screenshot({ path: `${SHOTS}/radio.png` });
  await page.click('#btn-radio'); await page.waitForTimeout(200); expect((await st()).station).toBe(1);
  await page.click('#btn-radio'); await page.waitForTimeout(200); expect((await st()).station).toBe(2);
  await page.click('#btn-radio'); await page.waitForTimeout(200); s = await st(); expect(s.on).toBe(false); expect(s.setting).toBe(-1); expect(s.btnOn).toBe(false);
  // persisted station comes back after a reload
  await g(page, 'const c = JSON.parse(localStorage.getItem("cp-settings")); c.radio = 1; localStorage.setItem("cp-settings", JSON.stringify(c))');
  await page.reload(); await page.waitForFunction(() => (window as unknown as { __game?: { ready: boolean } }).__game?.ready === true, null, { timeout: 120_000 });
  await page.click('#menu-start'); await page.waitForTimeout(400); await page.click('#pretrip-go'); await page.waitForTimeout(300);
  await page.waitForFunction(() => (window as unknown as { __game: { stats(): { radio: { on: boolean } } } }).__game.stats().radio.on, null, { timeout: 15_000 });
  expect((await st()).station).toBe(1);
  expect(errors).toEqual([]);
});

const stopAt = (page: Page, s: number) => g(page, `(() => { __game.teleport(${s}); __game.simulate(1, { throttle: 0.5, autopilot: true }); for (let i = 0; i < 30 && __game.stats().kmh > 2; i++) __game.simulate(0.5, { throttle: 0, brake: 0.6, autopilot: true }); __game.simulate(1.5, { throttle: 0, handbrake: true, autopilot: true }); })()`);
const choiceOpen = (page: Page) => page.waitForFunction(() => (window as unknown as { __game: { stats(): { choiceOpen: boolean } } }).__game.stats().choiceOpen, null, { timeout: 15_000 });

test('passenger interaction: haggle at boarding, no-change adds dwell, mid-way drop pays a tip when the bus stops', async ({ page }) => {
  const errors = await boot(page, 'quality=low&hour=11');
  await page.click('#menu-start'); await page.waitForTimeout(400); await page.click('#pretrip-go'); await page.waitForTimeout(300);
  const st = () => g(page, '(() => { const s = __game.stats(); return { log: s.riders.log, pendingDrop: s.riders.pendingDrop, fares: s.ledger.fares, tips: s.ledger.tips, pax: s.passengers, extraDwell: __game.events.extraDwell, title: document.getElementById("choice-title").textContent }; })()') as Promise<{ log: { kind: string; choice: number; outcome: string }[]; pendingDrop: boolean; fares: number; tips: number; pax: number; extraDwell: number; title: string }>;
  await g(page, '__game.traffic.enabled = false; __game.riders.force("haggle")');
  await stopAt(page, 1990);
  await g(page, '__game.simulate(10, { throttle: 0, handbrake: true, autopilot: true })');
  await choiceOpen(page);
  let s = await st(); expect(s.title).toContain('ভাড়া একটু কম'); const faresBefore = s.fares;
  await g(page, 'document.getElementById("choice-a").click()'); await page.waitForTimeout(300);
  s = await st(); expect(s.log[0]).toMatchObject({ kind: 'haggle', choice: 0 }); expect(s.fares).toBe(faresBefore - 60);
  await page.screenshot({ path: `${SHOTS}/riders-haggle.png` });
  await g(page, 'if (__game.choice.open) __game.choice.cancel()');
  // no change → helper gets change at the next stop (+15 s dwell)
  await g(page, '__game.riders.legEvent = "nochange"; __game.riders.legTimer = 0.5; __game.teleport(2300); __game.simulate(3, { throttle: 1, autopilot: true })');
  await choiceOpen(page); expect((await st()).title).toContain('খুচরা');
  await g(page, 'document.getElementById("choice-a").click()'); await page.waitForTimeout(300);
  s = await st(); expect(s.extraDwell).toBe(15); expect(s.log[1].kind).toBe('nochange');
  // mid-way drop → stop within 20 s → one passenger off, ৳20 tip
  await g(page, '__game.riders.legEvent = "drop"; __game.riders.legTimer = 0.5; __game.simulate(3, { throttle: 1, autopilot: true })');
  await choiceOpen(page); expect((await st()).title).toContain('এখানেই নামব');
  const paxBefore = (await st()).pax;
  await g(page, 'document.getElementById("choice-a").click()'); await page.waitForTimeout(300);
  expect((await st()).pendingDrop).toBe(true);
  await g(page, 'for (let i = 0; i < 30 && __game.stats().kmh > 1; i++) __game.simulate(0.5, { throttle: 0, brake: 1, autopilot: true }); __game.simulate(1, { throttle: 0, handbrake: true })');
  await page.waitForFunction(() => !(window as unknown as { __game: { stats(): { riders: { pendingDrop: boolean } } } }).__game.stats().riders.pendingDrop, null, { timeout: 15_000 });
  s = await st(); expect(s.pax).toBe(paxBefore - 1); expect(s.tips).toBe(20); expect(s.log[2].outcome).toContain('বকশিশ');
  expect(errors).toEqual([]);
});

test('street life follows the clock: school kids at 8, haat stalls at 12, cricket at 17, lit tea stalls at 21', async ({ page }) => {
  const errors = await boot(page, 'quality=low&hour=8');
  await page.click('#menu-start'); await page.waitForTimeout(400); await page.click('#pretrip-go'); await page.waitForTimeout(300);
  const st = () => g(page, '(() => { const s = __game.stats(); return { bands: s.street.bands, counts: s.street.counts, people: __game.people.people.length }; })()') as Promise<{ bands: string[]; counts: Record<string, number>; people: number }>;
  await g(page, '__game.traffic.enabled = false');
  let s = await st(); expect(s.bands).toEqual(['school']); expect(s.counts.school).toBeGreaterThanOrEqual(10); const base = s.people - s.counts.school;
  const shots: [number, number, string, number][] = [[12, 1150, 'haat', 12], [17, 2720, 'cricket', 7], [21, 1150, 'tea', 12]];
  for (const [h, pos, band, min] of shots) {
    await g(page, `__game.sky.setTime(${h}); __game.applyNight(); __game.teleport(${pos}); __game.simulate(0.3, { throttle: 0, handbrake: true })`);
    s = await st(); expect(s.bands).toEqual([band]); expect(s.counts[band]).toBeGreaterThanOrEqual(min); expect(s.people).toBe(base + s.counts[band]);
    await page.waitForTimeout(2500); await page.screenshot({ path: `${SHOTS}/street-${band}.png` });
  }
  await g(page, '__game.sky.setTime(3); __game.applyNight()');
  s = await st(); expect(s.bands).toEqual([]); expect(s.people).toBe(base);
  expect(errors).toEqual([]);
});
