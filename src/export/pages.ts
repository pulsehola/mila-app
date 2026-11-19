/**
 * Maquetación en páginas A4, común al PDF y a las imágenes PNG (así cada PNG es exactamente la página del PDF).
 * Todo en puntos tipográficos (1 pt = 1/72 pulgada). Puro: se prueba en Node.
 */

export const PAGE_W = 595.28
export const PAGE_H = 841.89
/** Márgenes: 15 mm a los lados, 14 mm arriba y 16 mm abajo (deja sitio al pie de página). */
export const MARGIN_X = 42.5
export const MARGIN_TOP = 40
export const MARGIN_BOTTOM = 46
/** Título + subtítulo en la primera página. */
export const HEADER_H = 54
/** Separación extra máxima entre sistemas al repartir el sobrante de una página llena. */
const MAX_EXTRA_GAP = 22

export const USABLE_W = PAGE_W - MARGIN_X * 2

/** Un sistema (pentagrama con sus compases) recortado de la partitura: alto en pt ya escalado. */
export interface BandBox {
  height: number
}

export interface PlacedBand {
  band: number
  /** Arriba del sistema en la página (pt). */
  y: number
  height: number
}

export interface PagePlan {
  index: number
  header: boolean
  bands: PlacedBand[]
}

/**
 * Reparte los sistemas en páginas sin partir ninguno. En las páginas llenas, el espacio que sobra se reparte
 * entre sistemas (con tope) para que la hoja quede equilibrada; la última página queda con su separación natural.
 * Con `justify: false` (partitura escaneada) los sistemas van seguidos para que la foto del papel no se corte.
 */
export function planPages(bands: BandBox[], opts: { justify?: boolean } = {}): PagePlan[] {
  const justify = opts.justify ?? true
  const pages: PagePlan[] = []
  let i = 0
  while (i < bands.length || pages.length === 0) {
    const header = pages.length === 0
    const top = MARGIN_TOP + (header ? HEADER_H : 0)
    const avail = PAGE_H - MARGIN_BOTTOM - top
    const chosen: number[] = []
    let used = 0
    while (i < bands.length && (chosen.length === 0 || used + bands[i].height <= avail)) {
      used += bands[i].height
      chosen.push(i)
      i++
    }
    const last = i >= bands.length
    const extra = justify && !last && chosen.length > 1 ? Math.min(MAX_EXTRA_GAP, (avail - used) / (chosen.length - 1)) : 0
    let y = top
    const placed = chosen.map((b) => {
      const p = { band: b, y, height: bands[b].height }
      y += bands[b].height + extra
      return p
    })
    pages.push({ index: pages.length, header, bands: placed })
    if (bands.length === 0) break
  }
  return pages
}

/** Píxeles por punto para una resolución en ppp. */
export const pxPerPt = (dpi: number) => dpi / 72
