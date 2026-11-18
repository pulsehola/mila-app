/**
 * Importación de partituras en papel: foto de la cámara, imagen o PDF. Todo se convierte en una única imagen
 * JPEG de tamaño razonable que se guarda en el iPad como fondo de la hoja.
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

async function imageToScan(file: File): Promise<ScanResult> {
  const url = URL.createObjectURL(file)
  try {
    const img = new Image()
    img.decoding = 'async'
    img.src = url
    // <img> aplica la orientación EXIF de las fotos del iPad.
    await img.decode().catch(() => {
      throw new Error('No pude abrir esa imagen. Prueba con una foto JPG/PNG o un PDF.')
    })
    const { w, h } = fitSize(img.naturalWidth, img.naturalHeight)
    const c = document.createElement('canvas')
    c.width = w
    c.height = h
    const ctx = c.getContext('2d')!
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, w, h)
    ctx.drawImage(img, 0, 0, w, h)
    return { blob: await canvasToJpeg(c), width: w, height: h, title: titleFrom(file) }
  } finally {
    URL.revokeObjectURL(url)
  }
}

async function pdfToScan(file: File): Promise<ScanResult> {
  // pdf.js se carga solo al importar un PDF (y queda disponible sin conexión gracias al service worker).
  const pdfjs = await import('pdfjs-dist')
  const worker = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default
  pdfjs.GlobalWorkerOptions.workerSrc = worker
  const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) })
  const doc = await task.promise
  try {
    const total = doc.numPages
    const used = Math.min(total, MAX_PDF_PAGES)
    const pages: HTMLCanvasElement[] = []
    for (let i = 1; i <= used; i++) {
      const page = await doc.getPage(i)
      const base = page.getViewport({ scale: 1 })
      const target = fitSize(base.width * 4, base.height * 4) // alta resolución, luego se ajusta al tope
      const viewport = page.getViewport({ scale: target.w / base.width })
      const c = document.createElement('canvas')
      c.width = Math.round(viewport.width)
      c.height = Math.round(viewport.height)
      const ctx = c.getContext('2d')!
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, c.width, c.height)
      await page.render({ canvas: c, canvasContext: ctx, viewport }).promise
      pages.push(c)
    }
    // Páginas apiladas en una hoja continua, dentro del tope de píxeles.
    const width = Math.max(...pages.map((p) => p.width))
    const rawH = pages.reduce((n, p) => n + Math.round((p.height * width) / p.width), 0)
    const { w, h } = fitSize(width, rawH)
    const k = w / width
    const out = document.createElement('canvas')
    out.width = w
    out.height = h
    const ctx = out.getContext('2d')!
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, w, h)
    let y = 0
    for (const p of pages) {
      const ph = (p.height * width) / p.width
      ctx.drawImage(p, 0, y * k, w, ph * k)
      y += ph
    }
    return { blob: await canvasToJpeg(out), width: w, height: h, pages: { total, used }, title: titleFrom(file) }
  } finally {
    void task.destroy()
  }
}

export function fileToScan(file: File): Promise<ScanResult> {
  return isPdf(file) ? pdfToScan(file) : imageToScan(file)
}
