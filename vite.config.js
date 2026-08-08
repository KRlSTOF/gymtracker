import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

function capacitorServiceWorkerCleanup() {
  return {
    name: 'capacitor-service-worker-cleanup',
    apply: 'build',
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'sw.js',
        source: `self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map(key => caches.delete(key)));
    await self.registration.unregister();
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    await Promise.all(windows.map(client => client.navigate(client.url)));
  })());
});
`
      });
    }
  };
}

export default defineConfig(({ mode }) => {
  const isCapacitorBuild = mode === 'capacitor';

  return {
    base: './',
    plugins: [
      react(),
      VitePWA({
        disable: isCapacitorBuild,
        registerType: 'autoUpdate',
        manifest: {
          name: 'Gym Tracker',
          short_name: 'Gym',
          description: 'Block periodization gym tracker',
          theme_color: '#0a0a0a',
          background_color: '#0a0a0a',
          display: 'standalone',
          orientation: 'portrait',
          icons: [
            { src: './icon-192.png', sizes: '192x192', type: 'image/png' },
            { src: './icon-512.png', sizes: '512x512', type: 'image/png' }
          ]
        }
      }),
      isCapacitorBuild && capacitorServiceWorkerCleanup()
    ].filter(Boolean)
  };
});
