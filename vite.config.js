import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  base: '/gym-tracker/',
  plugins: [
    react(),
    VitePWA({
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
          { src: '/gym-tracker/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/gym-tracker/icon-512.png', sizes: '512x512', type: 'image/png' }
        ]
      }
    })
  ]
});
