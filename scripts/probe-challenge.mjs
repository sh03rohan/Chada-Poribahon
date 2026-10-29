import { chromium } from '@playwright/test';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.log('PAGEERROR', e.message, e.stack));
await page.addInitScript(() => localStorage.setItem('cp-settings', JSON.stringify({ introSeen: true, tutorialSeen: true })));
await page.goto('http://localhost:5173/?quality=low');
await page.waitForFunction(() => window.__game?.ready === true, null, { timeout: 120000 });
await page.click('#menu-challenge'); await page.waitForTimeout(300);
console.log('panel:', (await page.locator('#challenge-body').innerText()).slice(0, 200).replace(/\n/g, ' | '));
await page.screenshot({ path: 'test-results/challenge-panel.png' });
const c = await page.evaluate(() => { const u = new URL(location.href); return { route: __game.stats().world ? document.querySelector('#hud-route b').textContent : null }; });
console.log('current route', c);
// play: may reload if the route differs
await Promise.all([page.waitForNavigation({ waitUntil: 'load', timeout: 20000 }).catch(() => null), page.click('#challenge-play')]);
await page.waitForFunction(() => window.__game?.ready === true, null, { timeout: 120000 });
const st = await page.evaluate(() => ({ screen: __game.screen, challenge: __game.stats().challenge, btn: document.getElementById('menu-start').textContent, route: document.querySelector('#hud-route b').textContent }));
console.log('after play', st);
if (st.screen !== 'pretrip') { await page.click('#menu-start'); await page.waitForTimeout(400); }
console.log('pretrip', await page.evaluate(() => ({ screen: __game.screen, challenge: __game.stats().challenge, fixedHour: __game.stats().fixedHour, weather: __game.stats().weather, box: document.getElementById('pretrip-challenge').innerText.slice(0, 160), routeSelHidden: document.querySelector('.route-select').classList.contains('hidden'), contractsHidden: document.getElementById('pretrip-contracts').classList.contains('hidden') })));
await page.screenshot({ path: 'test-results/challenge-pretrip.png' });
await page.click('#pretrip-go'); await page.waitForTimeout(300);
console.log('run', await page.evaluate(() => ({ contract: __game.stats().contract, hour: __game.sky.state.hour, weather: __game.stats().weather })));
await page.evaluate(() => { __game.traffic.enabled = false; __game.teleport(__game.road.length - 160); __game.simulate(30, { throttle: 1, autopilot: true }); });
await page.waitForFunction(() => __game.finished, null, { timeout: 20000 });
await page.waitForTimeout(300);
console.log('results', await page.evaluate(() => ({ last: __game.stats().lastChallenge, text: document.getElementById('res-challenge').innerText, book: localStorage.getItem('cp-challenge') })));
await page.screenshot({ path: 'test-results/challenge-results.png' });
await page.click('#btn-chal-share'); await page.waitForTimeout(300);
console.log('share btn', await page.locator('#btn-chal-share').innerText());
// second run: again → still challenge, score recorded as runs 2
await page.click('#btn-again'); await page.waitForTimeout(300);
console.log('again', await page.evaluate(() => ({ challenge: __game.stats().challenge, screen: __game.screen })));
await browser.close();
