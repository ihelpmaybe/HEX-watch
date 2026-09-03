import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// GitHub project pages need /<repo>/ ; set BASE_PATH in CI.
const base = process.env.BASE_PATH || '/'

export default defineConfig({
  base,
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['brand/HEXagon.svg', 'icons/apple-touch-icon.png'],
      manifest: {
        name: 'HEX Watch',
        short_name: 'HEX Watch',
        description:
          'Unofficial watch-only HEX stake tracker for Ethereum and PulseChain. Public addresses only.',
        theme_color: '#111111',
        background_color: '#111111',
        display: 'standalone',
        orientation: 'portrait-primary',
        start_url: './',
        scope: './',
        lang: 'en',
        categories: ['finance', 'utilities'],
        icons: [
          {
            src: 'icons/pwa-192.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: 'icons/pwa-512.png',
            sizes: '512x512',
            type: 'image/png',
          },
          {
            src: 'icons/pwa-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        // App shell + static assets. Chain reads always go to the network.
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
        navigateFallback: 'index.html',
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts-css',
              expiration: { maxEntries: 4, maxAgeSeconds: 60 * 60 * 24 * 365 },
            },
          },
          {
            urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts-webfonts',
              expiration: { maxEntries: 8, maxAgeSeconds: 60 * 60 * 24 * 365 },
            },
          },
        ],
      },
      devOptions: {
        enabled: false,
      },
    }),
  ],
})
