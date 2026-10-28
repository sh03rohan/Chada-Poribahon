// Render public/icon.svg to the PNG sizes a PWA install needs (Playwright, system Chromium).
import { chromium } from '@playwright/test';
import fs from 'node:fs';
const svg = fs.readFileSync('public/icon.svg', 'utf8');
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
for (const size of [192, 512]) {
  const page = await browser.newPage({ viewport: { width: size, height: size } });
  await page.setContent(`<html><body style="margin:0;background:#1b1b1b">${svg.replace('<svg', `<svg width="${size}" height="${size}"`)}</body></html>`);
  await page.screenshot({ path: `public/icon-${size}.png`, clip: { x: 0, y: 0, width: size, height: size } });
  await page.close();
}
// maskable: same art on a padded background
const page = await browser.newPage({ viewport: { width: 512, height: 512 } });
await page.setContent(`<html><body style="margin:0;background:#d8262c;display:flex;align-items:center;justify-content:center;width:512px;height:512px">${svg.replace('<svg', '<svg width="400" height="400"')}</body></html>`);
await page.screenshot({ path: 'public/icon-maskable-512.png' });
await browser.close();
console.log('icons written');
