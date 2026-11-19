import { createHash } from 'node:crypto'
import { existsSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import basicSsl from '@vitejs/plugin-basic-ssl'
import type { Plugin } from 'vite'
import { defineConfig } from 'vitest/config'

/**
 * Service worker sin dependencias: en el build se genera `sw.js` con la lista exacta de archivos (JS, CSS,
 * fuentes, iconos) para que MILA funcione sin conexión desde la primera visita completa.
 */
function offlineServiceWorker(): Plugin {
  return {
    name: 'mila-offline-sw',
    apply: 'build',
    // Tras escribir: solo se precachean archivos que existen de verdad (Vite incrusta los recursos pequeños
    // en el CSS y no los escribe; un solo 404 haría fallar toda la instalación).
    writeBundle(options, bundle) {
      const outDir = options.dir ?? 'dist'
      const publicDir = fileURLToPath(new URL('./public', import.meta.url))
      const files = [
        '/',
        ...Object.keys(bundle).filter((f) => !f.endsWith('.map') && f !== 'index.html' && existsSync(join(outDir, f))),
        // Solo archivos sueltos de public/ (una carpeta como pdfjs/ daría 404 y rompería toda la instalación;
        // sus recursos se guardan en caché la primera vez que se usan).
        ...readdirSync(publicDir).filter((f) => !f.startsWith('.') && statSync(join(publicDir, f)).isFile()),
      ].map((f) => (f.startsWith('/') ? f : `/${f}`))
      const version = createHash('sha256').update(files.join('|')).digest('hex').slice(0, 10)
      writeFileSync(
        join(outDir, 'sw.js'),
        `/* MILA · generado en el build */
const CACHE = 'mila-${version}'
const PRECACHE = ${JSON.stringify(files)}

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()))
})

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('mila-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (e) => {
  const req = e.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  if (url.origin !== self.location.origin) return
  if (req.mode === 'navigate') {
    // Red primero (para recibir versiones nuevas); sin conexión, la app guardada.
    e.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone()
          caches.open(CACHE).then((c) => c.put('/', copy))
          return res
        })
        .catch(() => caches.match('/')),
    )
    return
  }
  e.respondWith(
    caches.match(req).then(
      (hit) =>
        hit ||
        fetch(req).then((res) => {
          if (res.ok) {
            const copy = res.clone()
            caches.open(CACHE).then((c) => c.put(req, copy))
          }
          return res
        }),
    ),
  )
})
`,
      )
    },
  }
}

// HTTPS en desarrollo: Safari en iPad solo permite micrófono (afinador) y
// navigator.share en contextos seguros. basicSsl genera un certificado local.
export default defineConfig({
  plugins: [react(), tailwindcss(), basicSsl(), offlineServiceWorker()],
  server: { host: true },
  // execArgv: los tests con jsdom necesitan zlib.createZstdDecompress, que falta en Node < 22.15 (ver el script).
  test: { environment: 'node', include: ['src/**/*.test.ts'], execArgv: ['--require', './scripts/zstd-shim.cjs'] },
})
