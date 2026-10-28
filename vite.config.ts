import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  server: { port: 5173, host: true },
  build: {
    target: 'es2022',
    sourcemap: false,
    chunkSizeWarningLimit: 1500,
  },
  plugins: [
    // Installable + offline: the build (js/css/html/fonts/icons) is precached by a Workbox service
    // worker; it updates itself in the background on the next visit.
    VitePWA({
      registerType: 'autoUpdate',
      manifest: false,                       // public/manifest.webmanifest is hand-written
      includeAssets: ['icon.svg', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png', 'fonts/*.woff2', 'manifest.webmanifest'],
      workbox: {
        globPatterns: ['**/*.{js,css,html,woff2,svg,png,webmanifest}'],
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
        navigateFallback: '/index.html',
      },
      devOptions: { enabled: false },
    }),
  ],
});
