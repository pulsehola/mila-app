/**
 * Importación de partituras en papel: foto de la cámara, imagen o PDF. Todo se convierte en una única imagen
 * JPEG de tamaño razonable que se guarda en el iPad como fondo de la hoja (y se analiza para sacar las notas).
 */

/** Ancho máximo de la imagen guardada (suficiente para leer bien la partitura sin llenar el iPad). */
const MAX_W = 1600
/** Tope de píxeles totales (Safari en iPad limita el tamaño de los canvas). */
const MAX_PIXELS = 12_000_000
/** Páginas de un PDF que se apilan como una hoja continua. */
export const MAX_PDF_PAGES = 4

export interface ScanResult {
  blob: Blob
  width: number
  height: number
  /** La imagen ya procesada, para el reconocimiento de notas (OMR) sin volver a decodificar. */
  canvas: HTMLCanvasElement
  /** Páginas del PDF original (si lo era) y cuántas se incluyeron. */
  pages?: { total: number; used: number }
  /** Nombre sugerido para la partitura (del archivo). */
  title: string
}

export function isPdf(file: File): boolean {
  return file.type === 'application/pdf' || /\.pdf$/i.test(file.name)
}

function titleFrom(file: File): string {
  const base = file.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim()
  // Las fotos de la cámara se llaman "image.jpg" / "IMG_1234": mejor un título genérico.
  return !base || /^(image|img|photo|foto|scan)\s*\d*$/i.test(base) ? 'Partitura escaneada' : base
}

function canvasToJpeg(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('No se pudo procesar la imagen'))), 'image/jpeg', 0.86),
  )
}

/** Tamaño final respetando proporción, ancho máximo y tope de píxeles. */
export function fitSize(w: number, h: number): { w: number; h: number } {
  let s = Math.min(1, MAX_W / w)
  if (w * s * h * s > MAX_PIXELS) s = Math.sqrt(MAX_PIXELS / (w * h))
  return { w: Math.max(1, Math.round(w * s)), h: Math.max(1, Math.round(h * s)) }
}

function whiteCanvas(w: number, h: number): { c: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const ctx = c.getContext('2d')
  if (!ctx) throw new Error('El iPad no tiene memoria suficiente para esta imagen. Prueba con una foto más pequeña.')
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, w, h)
  return { c, ctx }
}

/** Carga una imagen de forma tolerante: <img> (respeta la orientación EXIF del iPad) y, si falla, createImageBitmap. */
async function loadBitmap(file: File): Promise<{ src: CanvasImageSource; w: number; h: number; done: () => void }> {
  const url = URL.createObjectURL(file)
  try {
    const img = new Image()
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve()
      img.onerror = () => reject(new Error('img'))
      img.src = url
    })
    if (img.naturalWidth > 0) return { src: img, w: img.naturalWidth, h: img.naturalHeight, done: () => URL.revokeObjectURL(url) }
  } catch {
    /* se intenta otra vía */
  }
  URL.revokeObjectURL(url)
  if (typeof createImageBitmap === 'function') {
    try {
      const bmp = await createImageBitmap(file)
      return { src: bmp, w: bmp.width, h: bmp.height, done: () => bmp.close() }
    } catch {
      /* formato no soportado */
    }
  }
  throw new Error('No pude abrir esa imagen. Usa una foto JPG/PNG/HEIC o un PDF.')
}

async function imageToScan(file: File): Promise<ScanResult> {
  const bmp = await loadBitmap(file)
  try {
    const { w, h } = fitSize(bmp.w, bmp.h)
    const { c, ctx } = whiteCanvas(w, h)
    ctx.drawImage(bmp.src, 0, 0, w, h)
    return { blob: await canvasToJpeg(c), width: w, height: h, canvas: c, title: titleFrom(file) }
  } finally {
    bmp.done()
  }
}

/**
 * pdf.js en su versión "legacy": la normal usa funciones de JavaScript muy recientes que Safari del iPad aún no
 * tiene y fallaba con errores como "can't find iterator" u "Object not valid".
 */
async function loadPdfJs() {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const worker = (await import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url')).default
  pdfjs.GlobalWorkerOptions.workerSrc = worker
  return pdfjs
}

async function pdfToScan(file: File): Promise<ScanResult> {
  let pdfjs: Awaited<ReturnType<typeof loadPdfJs>>
  try {
    pdfjs = await loadPdfJs()
  } catch {
    throw new Error('No se pudo cargar el lector de PDF. Comprueba la conexión la primera vez y vuelve a intentarlo.')
  }
  const data = new Uint8Array(await file.arrayBuffer())
  const base = `${import.meta.env.BASE_URL}pdfjs/`
  const task = pdfjs.getDocument({
    data,
    useSystemFonts: true,
    // Decodificadores JPEG 2000 / JBIG2 (wasm): sin ellos no se dibujan las páginas escaneadas.
    wasmUrl: `${base}wasm/`,
    standardFontDataUrl: `${base}standard_fonts/`,
    cMapUrl: `${base}cmaps/`,
    cMapPacked: true,
    iccUrl: `${base}iccs/`,
    // Safari del iPad: OffscreenCanvas e ImageDecoder dan resultados irregulares; se usan los decodificadores
    // propios de pdf.js, más lentos pero fiables.
    isOffscreenCanvasSupported: false,
    isImageDecoderSupported: false,
  })
  let doc: Awaited<typeof task.promise>
  try {
    doc = await task.promise
  } catch (e) {
    void task.destroy()
    const msg = e instanceof Error ? e.message : ''
    throw new Error(/password/i.test(msg) ? 'Ese PDF tiene contraseña: ábrelo y expórtalo sin ella.' : 'No pude leer ese PDF. ¿Está completo?')
  }
  try {
    const total = doc.numPages
    const used = Math.min(total, MAX_PDF_PAGES)
    const pages: HTMLCanvasElement[] = []
    for (let i = 1; i <= used; i++) {
      const page = await doc.getPage(i)
      const base = page.getViewport({ scale: 1 })
      const target = fitSize(base.width * 4, base.height * 4) // alta resolución, dentro del tope
      const viewport = page.getViewport({ scale: target.w / base.width })
      const { c, ctx } = whiteCanvas(Math.round(viewport.width), Math.round(viewport.height))
      await page.render({ canvas: c, canvasContext: ctx, viewport }).promise
      page.cleanup()
      pages.push(c)
    }
    // Páginas apiladas en una hoja continua, dentro del tope de píxeles.
    const width = Math.max(...pages.map((p) => p.width))
    const rawH = pages.reduce((n, p) => n + Math.round((p.height * width) / p.width), 0)
    const { w, h } = fitSize(width, rawH)
    const k = w / width
    const { c: out, ctx } = whiteCanvas(w, h)
    let y = 0
    for (const p of pages) {
      const ph = (p.height * width) / p.width
      ctx.drawImage(p, 0, y * k, w, ph * k)
      y += ph
      p.width = p.height = 0 // libera memoria en Safari
    }
    return { blob: await canvasToJpeg(out), width: w, height: h, canvas: out, pages: { total, used }, title: titleFrom(file) }
  } finally {
    void task.destroy()
  }
}

export async function fileToScan(file: File): Promise<ScanResult> {
  try {
    return await (isPdf(file) ? pdfToScan(file) : imageToScan(file))
  } catch (e) {
    // Mensajes siempre comprensibles (nada de errores técnicos del navegador).
    if (e instanceof Error && /^(No |Ese |El iPad)/.test(e.message)) throw e
    console.error('[MILA] importación', e)
    throw new Error('No pude procesar ese archivo. Prueba con una foto JPG/PNG o con un PDF.')
  }
}
