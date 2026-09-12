import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5301,
    strictPort: true,
    proxy: {
      '/api': {
        target: process.env.GAMMA_BACKEND ?? 'http://127.0.0.1:3301',
        changeOrigin: true,
      },
      '/__preview': {
        target: process.env.GAMMA_BACKEND ?? 'http://127.0.0.1:3301',
        changeOrigin: true,
      },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
  },
})
