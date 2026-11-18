import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import basicSsl from '@vitejs/plugin-basic-ssl'
import { defineConfig } from 'vitest/config'

// HTTPS en desarrollo: Safari en iPad solo permite micrófono (afinador) y
// navigator.share en contextos seguros. basicSsl genera un certificado local.
export default defineConfig({
  plugins: [react(), tailwindcss(), basicSsl()],
  server: { host: true },
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
})
