import { chromium } from '@playwright/test';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const shots = [
  ['hour=12&weather=rain', 'cockpit', 2650, 'rain-cockpit', 'wet'],
  ['hour=15&weather=clear', 'chase', 2650, 'dust', 'offroad'],
  ['hour=12&weather=clear', 'chase', 2650, 'exhaust', 'throttle'],
  ['hour=21&weather=clear', 'chase', 1150, 'tea-smoke', 'idle'],
];
for (const [qs, cam, s, name, mode] of shots) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(() => localStorage.setItem('cp-settings', JSON.stringify({ introSeen: true, tutorialSeen: true })));
  await page.goto(`http://localhost:5173/?quality=high&${qs}&hazards=0&csm=0`, { timeout: 240000 });
  await page.waitForFunction(() => window.__game?.ready === true, null, { timeout: 240000 });
  await page.click('#menu-start'); await page.waitForTimeout(400); await page.click('#pretrip-go'); await page.waitForTimeout(300);
  await page.evaluate(([s, cam, mode]) => { __game.traffic.enabled = false; __game.teleport(s); __game.switchCamera(cam); __game.hud.show(false); document.getElementById('minimap').classList.add('hidden');
    if (mode === 'offroad') __game.simulate(3, { throttle: 1, steer: -0.6 }); else if (mode === 'throttle' || mode === 'wet') __game.simulate(4, { throttle: 1, autopilot: true }); else __game.simulate(0.3, { throttle: 0, handbrake: true });
    __game.input.override = mode === 'idle' ? null : { throttle: 1, steer: mode === 'offroad' ? -0.2 : 0 }; __game.autopilot = mode !== 'offroad' && mode !== 'idle'; }, [s, cam, mode]);
  const f0 = await page.evaluate(() => __game.frames); await page.waitForFunction((f0) => __game.frames > f0 + 2, f0, { timeout: 180000 });
  console.log(name, await page.evaluate(() => { const st = __game.stats(); return { particles: st.particles, glass: st.glassRain, kmh: Math.round(st.kmh), onRoad: __game.cur.onRoad, lat: +__game.lateral.toFixed(1), wet: +st.wet.toFixed(2) }; }), 'errors', errors.length, errors[0] ?? '');
  await page.screenshot({ path: `test-results/particles-${name}.png` });
  await page.close();
}
await browser.close();
