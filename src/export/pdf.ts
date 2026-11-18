import type { Annotation, Background, Score } from '../types'
import { getImage } from '../state/library'
import { type Layout, renderScore } from '../notation/renderScore'
import { drawAnnotations } from '../notation/annotations'

const PAGE_W = 595.28
const PAGE_H = 841.89
const MARGIN = 36
const RENDER_W = 760 // ancho lógico del SVG; se escala al ancho útil de la página
const PER_ROW = 4
const ROWS_FIRST_PAGE = 6
const ROWS_OTHER = 7
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
    const layout = renderScore(host, score.measures, { meter: score.meter, width: bg.layoutWidth, perRow: bg.perRow, rowH: bg.rowH, rowWidths: bg.rowWidths })
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

function sliceCanvas(src: HTMLCanvasElement, y0: number, y1: number): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = src.width
  c.height = Math.max(1, y1 - y0)
  c.getContext('2d')!.drawImage(src, 0, y0, src.width, c.height, 0, 0, src.width, c.height)
  return c
}

function subtitle(score: Score): string {
  return `Trompeta ${score.transposition === 'Bb' ? 'en Sib (música escrita)' : 'en Do (altura real)'}  -  negra = ${score.bpm}`
}

/** PDF A4 con la partitura en negro sobre blanco, título, numeración de compases y anotaciones. */
export async function scoreToPdf(score: Score): Promise<Blob> {
  const { jsPDF } = await import('jspdf') // carga bajo demanda: solo pesa al exportar
  const pdf = new jsPDF({ unit: 'pt', format: 'a4' })
  if (score.background) return asSeenPdf(pdf, score)
  const host = offscreenHost()
  const annotations = score.annotations ?? []

  try {
    const perPage = [ROWS_FIRST_PAGE * PER_ROW]
    const rest = ROWS_OTHER * PER_ROW
    let used = perPage[0]
    while (used < score.measures.length) {
      perPage.push(rest)
      used += rest
    }

    let cursor = 0
    const usableW = PAGE_W - MARGIN * 2
    for (let page = 0; page < perPage.length; page++) {
      const slice = score.measures.slice(cursor, cursor + perPage[page])
      if (slice.length === 0 && page > 0) break
      if (page > 0) pdf.addPage()

      let y = MARGIN
      if (page === 0) {
        pdf.setFont('helvetica', 'bold')
        pdf.setFontSize(22)
        pdf.text(score.title || 'Sin título', PAGE_W / 2, y + 14, { align: 'center' })
        pdf.setFont('helvetica', 'normal')
        pdf.setFontSize(10)
        pdf.text(subtitle(score), PAGE_W / 2, y + 32, { align: 'center' })
        y += 46
      }

      const layout = renderScore(host, slice, {
        meter: score.meter,
        width: RENDER_W,
        perRow: PER_ROW,
        firstIndex: cursor,
        measureNumbers: true,
        timeSig: cursor === 0,
      })
      const svg = host.querySelector('svg') as SVGElement
      const canvas = await rasterize(svg, layout, 2.4, annotations, cursor)
      const scale = usableW / layout.width
      pdf.addImage(canvas.toDataURL('image/png'), 'PNG', MARGIN, y, usableW, layout.height * scale, undefined, 'MEDIUM')

      pdf.setFontSize(8)
      pdf.setTextColor(140)
      pdf.text(`MILA · página ${page + 1}`, PAGE_W / 2, PAGE_H - 20, { align: 'center' })
      pdf.setTextColor(0)
      cursor += perPage[page]
      if (cursor >= score.measures.length) break
    }
  } finally {
    host.remove()
  }
  return pdf.output('blob')
}

/** PDF de una partitura escaneada: la hoja tal como se ve, repartida en páginas A4 sin partir pentagramas. */
async function asSeenPdf(pdf: import('jspdf').jsPDF, score: Score): Promise<Blob> {
  const { canvas, cuts } = await renderAsSeen(score, 2)
  const usableW = PAGE_W - MARGIN * 2
  const k = usableW / canvas.width // pt por px del canvas
  let y = 0
  let page = 0
  while (y < canvas.height - 2) {
    if (page > 0) pdf.addPage()
    let top = MARGIN
    if (page === 0) {
      pdf.setFont('helvetica', 'bold')
      pdf.setFontSize(20)
      pdf.text(score.title || 'Sin título', PAGE_W / 2, top + 12, { align: 'center' })
      pdf.setFont('helvetica', 'normal')
      pdf.setFontSize(9)
      pdf.text(subtitle(score), PAGE_W / 2, top + 28, { align: 'center' })
      top += 40
    }
    const room = (PAGE_H - top - MARGIN) / k // px que caben en esta página
    let end = Math.min(canvas.height, y + room)
    if (end < canvas.height) {
      // Cortar entre dos pentagramas (el último corte que quepa).
      const fit = cuts.filter((c) => c > y + 40 && c <= end)
      if (fit.length) end = fit[fit.length - 1]
    }
    const part = sliceCanvas(canvas, Math.round(y), Math.round(end))
    pdf.addImage(part.toDataURL('image/jpeg', 0.9), 'JPEG', MARGIN, top, usableW, part.height * k, undefined, 'MEDIUM')
    pdf.setFontSize(8)
    pdf.setTextColor(140)
    pdf.text(`MILA · página ${page + 1}`, PAGE_W / 2, PAGE_H - 20, { align: 'center' })
    pdf.setTextColor(0)
    y = end
    page++
    if (page > 40) break
  }
  return pdf.output('blob')
}

/** Imagen PNG nítida de toda la partitura (ideal para enviar por WhatsApp). */
export async function scoreToPng(score: Score): Promise<Blob> {
  const host = offscreenHost()
  try {
    const W = 1000
    const SCALE = 2
    const HEADER = 92
    // Hasta el último compás con notas o anotaciones (sin compases vacíos de cola).
    const lastUsed = Math.max(
      score.measures.reduce((acc, m, i) => (m.length ? i : acc), 0),
      ...(score.annotations ?? []).map((a) => a.measure),
    )
    const measures = score.measures.slice(0, Math.max(lastUsed + 1, 4))
    const sheet = score.background
      ? (await renderAsSeen(score, (SCALE * W) / score.background.layoutWidth)).canvas
      : await (async () => {
          const layout = renderScore(host, measures, { meter: score.meter, width: W, perRow: PER_ROW, measureNumbers: true })
          const svg = host.querySelector('svg') as SVGElement
          return rasterize(svg, layout, SCALE, score.annotations ?? [], 0)
        })()

    const out = document.createElement('canvas')
    out.width = sheet.width
    out.height = sheet.height + HEADER * SCALE
    const c = out.getContext('2d')!
    c.fillStyle = '#ffffff'
    c.fillRect(0, 0, out.width, out.height)
    c.drawImage(sheet, 0, HEADER * SCALE)
    c.scale(SCALE, SCALE)
    c.fillStyle = '#1d1a2e'
    c.textAlign = 'center'
    const font = '"Plus Jakarta Sans Variable", "Plus Jakarta Sans", system-ui, sans-serif'
    c.font = `800 30px ${font}`
    c.fillText(score.title || 'Sin título', W / 2, 46)
    c.font = `500 13px ${font}`
    c.fillStyle = '#6b6478'
    c.fillText(subtitle(score).replace('  -  ', ' · '), W / 2, 70)
    // Firma de marca: MI (menta) + LA (latón), discreta en la esquina.
    c.textAlign = 'right'
    c.font = `800 13px ${font}`
    const laW = c.measureText('LA').width
    c.fillStyle = '#d99a1e'
    c.fillText('LA', W - 18, 26)
    c.fillStyle = '#10b88a'
    c.fillText('MI', W - 18 - laW, 26)

    return await new Promise<Blob>((resolve, reject) =>
      out.toBlob((b) => (b ? resolve(b) : reject(new Error('No se pudo crear la imagen'))), 'image/png'),
    )
  } finally {
    host.remove()
  }
}
