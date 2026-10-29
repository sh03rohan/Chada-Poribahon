import { test, expect, type Page } from '@playwright/test';
import fs from 'node:fs';

const SHOTS = 'test-results/screenshots';
fs.mkdirSync(SHOTS, { recursive: true });

async function boot(page: Page, query: string, errors: string[] = []) {
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(() => localStorage.setItem('cp-settings', JSON.stringify({ introSeen: true, tutorialSeen: true })));
  await page.goto(`/?${query}${query.includes('weather=') || query.includes('challenge=') ? '' : '&weather=clear'}`);
  await page.waitForFunction(() => (window as unknown as { __game?: { ready: boolean } }).__game?.ready === true, null, { timeout: 120_000 });
  await page.waitForTimeout(500);
  return errors;
}
const g = (page: Page, expr: string) => page.evaluate(expr);
const finished = (page: Page) => page.waitForFunction(() => (window as unknown as { __game: { finished: boolean } }).__game.finished === true, null, { timeout: 20_000 });

test('daily challenge: a dated seed fixes route/hour/weather/contract, the pre-trip locks them, the score is kept and shared', async ({ page }) => {
  // 2026-10-29 seeds: Dhaka → Sylhet, 06:30, fog, express (the seed is a pure function of the date)
  const errors = await boot(page, 'quality=low&challenge=2026-10-29');
  expect(await page.locator('#hud-route b').innerText()).toContain('সিলেট');
  expect(await page.locator('#menu-start').innerText()).toContain('চ্যালেঞ্জ');
  await page.click('#menu-start'); await page.waitForTimeout(400);
  const pre = await g(page, '(() => { const s = __game.stats(); return { screen: __game.screen, challenge: s.challenge, hour: s.fixedHour, weather: s.weather, routeSel: document.querySelector(".route-select").classList.contains("hidden"), contracts: document.getElementById("pretrip-contracts").classList.contains("hidden"), box: document.getElementById("pretrip-challenge").innerText }; })()') as { screen: string; challenge: string; hour: number; weather: string; routeSel: boolean; contracts: boolean; box: string };
  expect(pre).toMatchObject({ screen: 'pretrip', challenge: '2026-10-29', hour: 6.5, weather: 'fog', routeSel: true, contracts: true });
  expect(pre.box).toContain('এক্সপ্রেস');
  await page.screenshot({ path: `${SHOTS}/challenge-pretrip.png` });
  await page.click('#pretrip-go'); await page.waitForTimeout(300);
  expect(await g(page, '__game.stats().contract')).toBe('express');
  await g(page, '__game.traffic.enabled = false; __game.teleport(__game.road.length - 160); __game.simulate(30, { throttle: 1, autopilot: true })');
  await finished(page); await page.waitForTimeout(300);
  const last = await g(page, '__game.stats().lastChallenge') as { score: number; best: number; isBest: boolean; runs: number };
  expect(last.isBest).toBe(true); expect(last.runs).toBe(1); expect(last.score).toBe(last.best); expect(last.score).toBeGreaterThan(10000);
  await expect(page.locator('#res-challenge')).toContainText('নতুন সেরা');
  await page.click('#btn-chal-share'); await page.waitForTimeout(200);
  expect(await page.locator('#btn-chal-share').innerText()).toContain('কপি');
  const book = JSON.parse(await g(page, 'localStorage.getItem("cp-challenge")') as string) as Record<string, { best: number; runs: number }>;
  expect(book['2026-10-29'].best).toBe(last.score);
  // the main-menu panel lists today's best; a fresh page with the same seed gives the same conditions
  await g(page, '__game.goToLanding()'); await page.waitForTimeout(100);
  await page.click('#menu-challenge'); await page.waitForTimeout(200);
  await expect(page.locator('#challenge-body')).toContainText('২৯/১০/২০২৬');
  expect(errors).toEqual([]);
});
