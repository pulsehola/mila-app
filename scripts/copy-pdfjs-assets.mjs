// Copia a public/pdfjs/ los recursos que pdf.js descarga en tiempo de ejecución:
//  - wasm/: decodificadores JPEG 2000 (OpenJPEG) y JBIG2. Los PDF escaneados casi siempre guardan la imagen
//    así; sin ellos pdf.js no puede dibujar la página (la importación fallaba en el iPad).
//  - standard_fonts/, cmaps/, iccs/: fuentes no incrustadas, mapas de caracteres y perfiles de color.
// Se ejecuta antes de `dev` y `build` (scripts predev/prebuild), así nunca queda desfasado con la versión.
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const src = join(root, 'node_modules', 'pdfjs-dist')
const out = join(root, 'public', 'pdfjs')

if (!existsSync(src)) {
  console.error('[pdfjs] falta node_modules/pdfjs-dist: ejecuta npm install')
  process.exit(1)
}
rmSync(out, { recursive: true, force: true })
mkdirSync(out, { recursive: true })
for (const dir of ['wasm', 'standard_fonts', 'cmaps', 'iccs']) {
  cpSync(join(src, dir), join(out, dir), { recursive: true })
}
console.log('[pdfjs] recursos copiados a public/pdfjs/')
