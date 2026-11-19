import type { Annotation, Background, Score } from '../types'
import { MARGIN_TOP, MARGIN_X, PAGE_H, PAGE_W, planPages, pxPerPt, USABLE_W, type PagePlan } from './pages'
import { getImage } from '../state/library'
import { type Layout, renderScore, scoreRenderOpts } from '../notation/renderScore'
import { clampKey } from '../state/music'
import { drawAnnotations } from '../notation/annotations'

/** Ancho lógico del SVG (unidades de VexFlow); se escala al ancho útil de la página. */
const RENDER_W = 760
const PER_ROW = 4
/** Separación entre sistemas en papel: algo más compacta que en pantalla (8 sistemas por página A4). */
const PRINT_ROW_H = 128
/** Resolución de la música en el PDF (ppp): por encima de lo que da una impresora normal. */
const PDF_DPI = 450
/** Resolución de cada página PNG (ppp). A4 a 300 ppp = 2480 x 3508 px (cabe en el límite de canvas del iPad). */
export const PNG_DPI = 300
/** Las anotaciones salen en azul lápiz oscuro: se distinguen de la música incluso impresas en gris. */
const ANNOT_PRINT = '#1f3f8f'

let fontCss: Promise<string> | null = null

/**
 * Un SVG usado como <img> no puede ver las fuentes de la página, y VexFlow dibuja los símbolos como texto
 * (Bravura). Se incrustan como data-URI dentro del propio SVG para que el PDF muestre claves, notas y silencios.
 */
function loadFontCss(): Promise<string> {
  if (!fontCss) {
    fontCss = (async () => {
      // Ruta relativa: el paquete no exporta estos módulos, pero Vite los empaqueta bajo demanda.
      // @ts-expect-error módulo JS sin tipos
      const bravura = (await import('../../node_modules/vexflow/build/esm/src/fonts/bravura.js')) as { Bravura: string }
      // @ts-expect-error módulo JS sin tipos
      const academico = (await import('../../node_modules/vexflow/build/esm/src/fonts/academico.js')) as { Academico: string }
      return (
        `@font-face{font-family:'Bravura';src:url(${bravura.Bravura}) format('woff2');}` +
        `@font-face{font-family:'Academico';src:url(${academico.Academico}) format('woff2');}`
      )
    })()
  }
  return fontCss
}

/** Rasteriza la partitura (SVG de VexFlow) y pinta encima la capa de anotaciones. */
async function rasterize(
  svg: SVGElement,
  layout: Layout,
  scale: number,
  annotations: Annotation[],
  firstIndex: number,
  opts: { height?: number; underlay?: (c: CanvasRenderingContext2D) => void } = {},
): Promise<HTMLCanvasElement> {
  const { width: w, height: h } = layout
  const outH = opts.height ?? h
  const clone = svg.cloneNode(true) as SVGElement
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  clone.setAttribute('width', String(w))
  clone.setAttribute('height', String(h))
  clone.removeAttribute('style')
  const style = document.createElementNS('http://www.w3.org/2000/svg', 'style')
  style.textContent = await loadFontCss()
  clone.insertBefore(style, clone.firstChild)
  const xml = new XMLSerializer().serializeToString(clone)
  const url = URL.createObjectURL(new Blob([xml], { type: 'image/svg+xml;charset=utf-8' }))
  try {
    const img = new Image()
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve()
      img.onerror = () => reject(new Error('No se pudo rasterizar la partitura'))
      img.src = url
    })
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(w * scale)
    canvas.height = Math.round(outH * scale)
    const c = canvas.getContext('2d')!
    const paint = () => {
      c.setTransform(1, 0, 0, 1, 0, 0)
      c.fillStyle = '#ffffff'
      c.fillRect(0, 0, canvas.width, canvas.height)
      if (opts.underlay) {
        c.setTransform(scale, 0, 0, scale, 0, 0)
        opts.underlay(c)
        c.setTransform(1, 0, 0, 1, 0, 0)
      }
      c.drawImage(img, 0, 0, Math.round(w * scale), Math.round(h * scale))
      c.setTransform(scale, 0, 0, scale, 0, 0)
      drawAnnotations(c, annotations, layout, ANNOT_PRINT, firstIndex)
    }
    paint()
    // Safari decodifica las fuentes del SVG de forma asíncrona: se vuelve a pintar tras un instante.
    await new Promise((r) => setTimeout(r, 140))
    paint()
    return canvas
  } finally {
    URL.revokeObjectURL(url)
  }
}

function offscreenHost(): HTMLDivElement {
  const host = document.createElement('div')
  host.style.cssText = 'position:fixed;left:-99999px;top:0;visibility:hidden'
  document.body.appendChild(host)
  return host
}

// ---- Exportar "como se ve": partitura escaneada + notas + anotaciones ------------

/** En la exportación el papel se ve claramente aunque en pantalla esté muy transparente. */
const SCAN_MIN_OPACITY = 0.8

async function loadScan(bg: Background): Promise<HTMLCanvasElement | null> {
  const blob = await getImage(bg.imageId).catch(() => undefined)
  if (!blob) return null
  const url = URL.createObjectURL(blob)
  try {
    const img = new Image()
    img.src = url
    await img.decode()
    const c = document.createElement('canvas')
    c.width = img.naturalWidth
    c.height = img.naturalHeight
    const ctx = c.getContext('2d')!
    ctx.drawImage(img, 0, 0)
    if (bg.enhance) {
      // Mismo efecto que en pantalla: blanco y negro con más contraste.
      const d = ctx.getImageData(0, 0, c.width, c.height)
      const px = d.data
      for (let i = 0; i < px.length; i += 4) {
        const g = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2]
        const v = Math.max(0, Math.min(255, ((g - 128) * 1.5 + 128) * 1.06))
        px[i] = px[i + 1] = px[i + 2] = v
      }
      ctx.putImageData(d, 0, 0)
    }
    return c
  } finally {
    URL.revokeObjectURL(url)
  }
}

interface AsSeen {
  canvas: HTMLCanvasElement
  /** Alturas (px del canvas) donde se puede cortar una página sin partir un pentagrama. */
  cuts: number[]
}

/** La hoja tal como la ve Mila: papel escaneado debajo, partitura digital y anotaciones encima. */
async function renderAsSeen(score: Score, scale: number): Promise<AsSeen> {
  const bg = score.background!
  const host = offscreenHost()
  try {
    const layout = renderScore(host, score.measures, { meter: score.meter, clef: score.clef, key: clampKey(score.key), width: bg.layoutWidth, perRow: bg.perRow, rowH: bg.rowH, rowWidths: bg.rowWidths })
    const dw = bg.layoutWidth * bg.scale
    const dh = dw * (bg.naturalH / bg.naturalW)
    const height = Math.ceil(Math.max(layout.height, bg.y + dh + 24))
    const scan = await loadScan(bg)
    const svg = host.querySelector('svg') as SVGElement
    const canvas = await rasterize(svg, layout, scale, score.annotations ?? [], 0, {
      height,
      underlay: (c) => {
        if (!scan) return
        c.save()
        c.globalAlpha = Math.max(bg.opacity, SCAN_MIN_OPACITY)
        c.translate(bg.x + dw / 2, bg.y + dh / 2)
        c.rotate((bg.rotation * Math.PI) / 180)
        c.drawImage(scan, -dw / 2, -dh / 2, dw, dh)
        c.restore()
      },
    })
    const cuts = layout.rows.slice(1).map((r, i) => Math.round(((layout.rows[i].yBottom + r.yTop) / 2) * scale))
    return { canvas, cuts }
  } finally {
    host.remove()
  }
}

function subtitle(score: Score): string {
  return `Trompeta ${score.transposition === 'Bb' ? 'en Sib · música escrita' : 'en Do · altura real'}`
}

/** Hasta el último compás con notas o anotaciones (sin compases vacíos de cola); al menos un sistema. */
export function usedMeasureCount(score: Score): number {
  const lastUsed = Math.max(
    score.measures.reduce((acc, m, i) => (m.length ? i : acc), -1),
    ...(score.annotations ?? []).map((a) => a.measure),
  )
  return Math.min(score.measures.length, Math.max(lastUsed + 1, Math.min(PER_ROW, score.measures.length)))
}

// ---- Hoja: la partitura cortada en sistemas ----------------------------------------

interface Band {
  /** Recorte vertical en unidades de la hoja. */
  y0: number
  y1: number
}

interface Sheet {
  /** Ancho en unidades de la hoja (se escala a USABLE_W). */
  width: number
  bands: Band[]
  /** Dibuja varios sistemas a `pxPerUnit` y devuelve un canvas por sistema (fondo blanco, sin interfaz). */
  renderBands(indices: number[], pxPerUnit: number): Promise<HTMLCanvasElement[]>
  dispose(): void
}

/** Bordes de cada sistema: a medio camino entre pentagramas (así entran números de compás, líneas adicionales y anotaciones). */
function bandsFromRows(rows: { yTop: number; yBottom: number }[], height: number): Band[] {
  return rows.map((r, i) => ({
    y0: i === 0 ? Math.max(0, r.yTop - 52) : (rows[i - 1].yBottom + r.yTop) / 2,
    y1: i === rows.length - 1 ? Math.min(height, r.yBottom + 44) : (r.yBottom + rows[i + 1].yTop) / 2,
  }))
}

async function svgMarkup(svg: SVGElement): Promise<string> {
  const clone = svg.cloneNode(true) as SVGElement
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  clone.removeAttribute('style')
  clone.removeAttribute('width')
  clone.removeAttribute('height')
  clone.removeAttribute('viewBox')
  const style = document.createElementNS('http://www.w3.org/2000/svg', 'style')
  style.textContent = await loadFontCss()
  clone.insertBefore(style, clone.firstChild)
  return new XMLSerializer().serializeToString(clone)
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('No se pudo dibujar la partitura'))
    img.src = url
  })
}

function renderPrintLayout(host: HTMLElement, score: Score): Layout {
  return renderScore(host, score.measures.slice(0, usedMeasureCount(score)), {
    ...scoreRenderOpts(score),
    width: RENDER_W,
    perRow: PER_ROW,
    measureNumbers: true,
    timeSig: true,
    rowH: PRINT_ROW_H,
  })
}

/** Partitura digital: un único dibujo de VexFlow; cada sistema se rasteriza por separado recortando el SVG (viewBox). */
async function digitalSheet(score: Score): Promise<Sheet> {
  const host = offscreenHost()
  const layout = renderPrintLayout(host, score)
  const svg = host.querySelector('svg') as SVGElement
  const markup = await svgMarkup(svg)
  const bands = bandsFromRows(layout.rows, layout.height)
  const annotations = score.annotations ?? []
  const rowOf = new Map(layout.measures.map((m) => [m.index, m.row]))
  return {
    width: layout.width,
    bands,
    async renderBands(indices, s) {
      const urls: string[] = []
      try {
        const imgs = await Promise.all(
          indices.map((i) => {
            const b = bands[i]
            const h = b.y1 - b.y0
            // Un SVG por sistema, con su tamaño final: el navegador lo dibuja en vectorial a esa resolución.
            const attrs = `width="${Math.round(layout.width * s)}" height="${Math.round(h * s)}" viewBox="0 ${b.y0} ${layout.width} ${h}"`
            const xml = markup.replace('<svg', `<svg ${attrs}`)
            const url = URL.createObjectURL(new Blob([xml], { type: 'image/svg+xml;charset=utf-8' }))
            urls.push(url)
            return loadImage(url)
          }),
        )
        // Safari decodifica las fuentes del SVG de forma asíncrona: se espera un instante antes de pintar.
        await new Promise((r) => setTimeout(r, 160))
        return indices.map((i, k) => {
          const b = bands[i]
          const canvas = document.createElement('canvas')
          canvas.width = Math.round(layout.width * s)
          canvas.height = Math.round((b.y1 - b.y0) * s)
          const c = canvas.getContext('2d')!
          c.fillStyle = '#ffffff'
          c.fillRect(0, 0, canvas.width, canvas.height)
          c.drawImage(imgs[k], 0, 0, canvas.width, canvas.height)
          // Anotaciones a mano de los compases de este sistema (azul lápiz oscuro).
          const own = annotations.filter((a) => rowOf.get(a.measure) === i)
          if (own.length) {
            c.setTransform(s, 0, 0, s, 0, -b.y0 * s)
            drawAnnotations(c, own, layout, ANNOT_PRINT, 0)
            c.setTransform(1, 0, 0, 1, 0, 0)
          }
          return canvas
        })
      } finally {
        for (const u of urls) URL.revokeObjectURL(u)
      }
    },
    dispose: () => host.remove(),
  }
}

/** Partitura escaneada: la hoja tal como se ve (papel + notas + anotaciones), cortada entre pentagramas. */
async function scannedSheet(score: Score): Promise<Sheet> {
  const SCALE = 2.5
  const { canvas, cuts } = await renderAsSeen(score, SCALE)
  const edges = [0, ...cuts, canvas.height]
  const bands: Band[] = edges.slice(1).map((e, i) => ({ y0: edges[i] / SCALE, y1: e / SCALE }))
  return {
    width: canvas.width / SCALE,
    bands,
    async renderBands(indices, s) {
      return indices.map((i) => {
        const b = bands[i]
        const out = document.createElement('canvas')
        out.width = Math.round((canvas.width / SCALE) * s)
        out.height = Math.max(1, Math.round((b.y1 - b.y0) * s))
        const c = out.getContext('2d')!
        c.imageSmoothingQuality = 'high'
        c.drawImage(canvas, 0, b.y0 * SCALE, canvas.width, (b.y1 - b.y0) * SCALE, 0, 0, out.width, out.height)
        return out
      })
    },
    dispose: () => {},
  }
}

async function prepare(score: Score): Promise<{ sheet: Sheet; k: number; pages: PagePlan[] }> {
  const sheet = score.background ? await scannedSheet(score) : await digitalSheet(score)
  const k = USABLE_W / sheet.width // pt por unidad de la hoja
  const pages = planPages(sheet.bands.map((b) => ({ height: (b.y1 - b.y0) * k })), { justify: !score.background })
  return { sheet, k, pages }
}

/** Número de páginas A4 que ocupa la partitura (para elegir qué página exportar). */
export async function pageCount(score: Score): Promise<number> {
  if (score.background) {
    const { pages, sheet } = await prepare(score)
    sheet.dispose()
    return pages.length
  }
  const host = offscreenHost()
  try {
    const layout = renderPrintLayout(host, score)
    const k = USABLE_W / layout.width
    return planPages(bandsFromRows(layout.rows, layout.height).map((b) => ({ height: (b.y1 - b.y0) * k }))).length
  } finally {
    host.remove()
  }
}

const FONT = '"Plus Jakarta Sans Variable", "Plus Jakarta Sans", system-ui, sans-serif'

function footerText(score: Score, page: number, total: number): string {
  return `${score.title || 'Sin título'} · página ${page + 1} de ${total} · MILA`
}

/** PDF A4: título, subtítulo, música nítida (450 ppp), márgenes de 15 mm y número de página. Sin nada de la interfaz. */
export async function scoreToPdf(score: Score): Promise<Blob> {
  const { jsPDF } = await import('jspdf') // carga bajo demanda: solo pesa al exportar
  const pdf = new jsPDF({ unit: 'pt', format: 'a4', compress: true })
  pdf.setProperties({ title: score.title || 'Partitura', creator: 'MILA' })
  const { sheet, k, pages } = await prepare(score)
  try {
    const s = k * pxPerPt(PDF_DPI)
    for (const page of pages) {
      if (page.index > 0) pdf.addPage()
      if (page.header) {
        pdf.setFont('helvetica', 'bold')
        pdf.setFontSize(22)
        pdf.text(score.title || 'Sin título', PAGE_W / 2, MARGIN_TOP + 16, { align: 'center' })
        pdf.setFont('helvetica', 'normal')
        pdf.setFontSize(10)
        pdf.setTextColor(90)
        pdf.text(subtitle(score), PAGE_W / 2, MARGIN_TOP + 34, { align: 'center' })
        pdf.setTextColor(0)
      }
      const canvases = await sheet.renderBands(page.bands.map((b) => b.band), s)
      page.bands.forEach((b, i) => {
        // JPEG de alta calidad a 450 ppp: a 8 aumentos se ve igual que PNG y se genera 4 veces más rápido
        // (el PNG lo comprime jsPDF en JavaScript; el JPEG lo codifica el navegador). Importa en el iPad.
        pdf.addImage(canvases[i].toDataURL('image/jpeg', 0.92), 'JPEG', MARGIN_X, b.y, USABLE_W, b.height)
        canvases[i].width = canvases[i].height = 0 // libera memoria (Safari en iPad)
      })
      pdf.setFontSize(8)
      pdf.setTextColor(140)
      pdf.text(footerText(score, page.index, pages.length), PAGE_W / 2, PAGE_H - 22, { align: 'center' })
      pdf.setTextColor(0)
    }
  } finally {
    sheet.dispose()
  }
  return pdf.output('blob')
}

/**
 * Cada página A4 como imagen PNG (300 ppp), idéntica a la del PDF. `only` = número de página (desde 0) para
 * exportar solo esa; sin él, todas.
 */
export async function scoreToPngPages(score: Score, only?: number): Promise<Blob[]> {
  const { sheet, k, pages } = await prepare(score)
  const ppt = pxPerPt(PNG_DPI)
  const out: Blob[] = []
  try {
    for (const page of pages) {
      if (only !== undefined && page.index !== only) continue
      const canvas = document.createElement('canvas')
      canvas.width = Math.round(PAGE_W * ppt)
      canvas.height = Math.round(PAGE_H * ppt)
      const c = canvas.getContext('2d')!
      c.fillStyle = '#ffffff'
      c.fillRect(0, 0, canvas.width, canvas.height)
      const bands = await sheet.renderBands(page.bands.map((b) => b.band), k * ppt)
      c.imageSmoothingQuality = 'high'
      page.bands.forEach((b, i) => {
        c.drawImage(bands[i], MARGIN_X * ppt, b.y * ppt, USABLE_W * ppt, b.height * ppt)
        bands[i].width = bands[i].height = 0
      })
      c.setTransform(ppt, 0, 0, ppt, 0, 0)
      c.textAlign = 'center'
      if (page.header) {
        c.fillStyle = '#1d1a2e'
        c.font = `800 22px ${FONT}`
        c.fillText(score.title || 'Sin título', PAGE_W / 2, MARGIN_TOP + 16)
        c.fillStyle = '#5a5566'
        c.font = `500 10px ${FONT}`
        c.fillText(subtitle(score), PAGE_W / 2, MARGIN_TOP + 34)
      }
      c.fillStyle = '#8c8796'
      c.font = `500 8px ${FONT}`
      c.fillText(footerText(score, page.index, pages.length), PAGE_W / 2, PAGE_H - 22)
      out.push(
        await new Promise<Blob>((resolve, reject) =>
          canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('No se pudo crear la imagen'))), 'image/png'),
        ),
      )
      canvas.width = canvas.height = 0
    }
  } finally {
    sheet.dispose()
  }
  return out
}
