import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import { defineConfig } from 'vite'

// Port of the local backend (see server/). Override with QLCN_API_PORT when it is not the default.
const apiPort = process.env.QLCN_API_PORT ?? '8686'
const apiTarget = `http://127.0.0.1:${apiPort}`

// https://vite.dev/config/
export default defineConfig({
  server: {
    proxy: {
      // The backend only accepts requests that look like they come from its own origin (it guards
      // against other web pages talking to it), so the proxy presents itself as that origin.
      '/api': {
        target: apiTarget,
        changeOrigin: true,
        configure: (proxy) => {
          proxy.on('proxyReq', (proxyReq) => proxyReq.setHeader('origin', apiTarget))
        },
      },
    },
  },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg'],
      // API calls are never answered by the cached app shell.
      workbox: { navigateFallbackDenylist: [/^\/api\//] },
      manifest: {
        name: 'Quản lý công nợ khách hàng',
        short_name: 'Công nợ',
        description: 'Theo dõi công nợ khách hàng, đơn hàng, hàng trả và thanh toán',
        lang: 'vi',
        start_url: '/',
        display: 'standalone',
        background_color: '#f8fafc',
        theme_color: '#4F46E5',
        icons: [
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          { src: 'maskable-icon-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
    }),
  ],
  test: {
    environment: 'node',
    include: ['src/**/*.test.js'],
  },
})
