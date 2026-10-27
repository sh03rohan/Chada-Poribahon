import { defineConfig } from '@playwright/test';
import fs from 'node:fs';

// Use a system Chromium when one is provided (CI images that pre-install a browser), else Playwright's own.
const SYSTEM_CHROMIUM = process.env.PW_CHROMIUM ?? '/opt/pw-browsers/chromium';
const executablePath = fs.existsSync(SYSTEM_CHROMIUM) ? SYSTEM_CHROMIUM : undefined;

export default defineConfig({
  testDir: './tests',
  timeout: 180_000,
  retries: 0,
  workers: 1,
  reporter: [['list']],
  outputDir: 'test-results/artifacts',
  use: {
    baseURL: 'http://localhost:5173',
    viewport: { width: 960, height: 540 },
    launchOptions: {
      executablePath,
      // WebGL in headless Chromium via SwiftShader.
      args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--autoplay-policy=no-user-gesture-required'],
    },
  },
  webServer: {
    command: 'npx vite --port 5173 --strictPort',
    url: 'http://localhost:5173',
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
