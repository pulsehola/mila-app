/**
 * Reconocimiento óptico de partituras (OMR) heurístico, sin servidor, para partes de trompeta sencillas
 * (una voz, clave de Sol). A partir de la foto o el PDF produce un BORRADOR editable:
 *   pentagramas → barras de compás → cabezas de nota (rellenas/vacías) → plica → corchete/barra de unión.
 * No reconoce silencios, alteraciones, puntillos ni ligaduras: Mila los corrige o añade encima.
 *
 * Todo trabaja sobre una imagen en escala de grises (0 = negro, 255 = blanco) y es puro (testeable en Node).
 */
import type { Duration } from '../types'
import { clampStep } from '../state/music'

export interface GrayImage {
  w: number
  h: number
  /** Luminancia por píxel, fila a fila. */
  px: Uint8Array | Uint8ClampedArray
}

export interface OmrNote {
  dur: Duration
  step: number
  x: number
  y: number
}

export interface OmrMeasure {
  x0: number
  x1: number
  notes: OmrNote[]
}

export interface OmrStaff {
  /** y de las 5 líneas (de arriba abajo). */
  lines: number[]
  /** Distancia entre líneas (px). */
  gap: number
  x0: number
  x1: number
  barlines: number[]
  measures: OmrMeasure[]
}

export interface OmrResult {
  staves: OmrStaff[]
  noteCount: number
}

// ---- Utilidades de imagen ---------------------------------------------------

/** Umbral de Otsu: separa tinta y papel aunque la foto tenga poca luz. */
export function otsu(px: GrayImage['px']): number {
  const hist = new Array<number>(256).fill(0)
  for (let i = 0; i < px.length; i++) hist[px[i]]++
  const total = px.length
  let sum = 0
  for (let t = 0; t < 256; t++) sum += t * hist[t]
  let sumB = 0
  let wB = 0
  let best = 0
  let thr = 128
  for (let t = 0; t < 256; t++) {
    wB += hist[t]
    if (!wB) continue
    const wF = total - wB
    if (!wF) break
    sumB += t * hist[t]
    const mB = sumB / wB
    const mF = (sum - sumB) / wF
    const between = wB * wF * (mB - mF) ** 2
    if (between > best) {
      best = between
      thr = t
    }
  }
  return thr
}

export function binarize(img: GrayImage): Uint8Array {
  const thr = Math.min(otsu(img.px), 200)
  const out = new Uint8Array(img.w * img.h)
  for (let i = 0; i < out.length; i++) out[i] = img.px[i] <= thr ? 1 : 0
  return out
}

/**
 * Inclinación de la hoja (grados): el ángulo que hace más "nítida" la proyección horizontal
 * (las líneas del pentagrama se apilan en pocas filas). Rango ±4°.
 */
export function estimateSkew(dark: Uint8Array, w: number, h: number): number {
  const pts: number[] = []
  const step = Math.max(1, Math.round(Math.sqrt((w * h) / 400_000)))
  for (let y = 0; y < h; y += step) for (let x = 0; x < w; x += step) if (dark[y * w + x]) pts.push(x, y)
  if (pts.length < 200) return 0
  let best = 0
  let bestScore = -1
  const hist = new Float64Array(h + 2 * w)
  for (let deg = -4; deg <= 4.0001; deg += 0.2) {
    const t = Math.tan((deg * Math.PI) / 180)
    hist.fill(0)
    for (let i = 0; i < pts.length; i += 2) {
      const yy = Math.round(pts[i + 1] - pts[i] * t) + w
      if (yy >= 0 && yy < hist.length) hist[yy]++
    }
    let score = 0
    for (let i = 0; i < hist.length; i++) score += hist[i] * hist[i]
    if (score > bestScore * 1.0005) {
      bestScore = score
      best = deg
    }
  }
  return Math.round(best * 10) / 10
}

class Integral {
  private s: Int32Array
  private W: number
  constructor(bin: Uint8Array, w: number, h: number) {
    this.W = w + 1
    this.s = new Int32Array((w + 1) * (h + 1))
    for (let y = 0; y < h; y++) {
      let row = 0
      for (let x = 0; x < w; x++) {
        row += bin[y * w + x]
        this.s[(y + 1) * this.W + x + 1] = this.s[y * this.W + x + 1] + row
      }
    }
    this.w = w
    this.h = h
  }
  w: number
  h: number
  /** Fracción de tinta en el rectángulo [x0,x1)×[y0,y1). */
  ratio(x0: number, y0: number, x1: number, y1: number): number {
    x0 = Math.max(0, Math.min(this.w, Math.round(x0)))
    x1 = Math.max(0, Math.min(this.w, Math.round(x1)))
    y0 = Math.max(0, Math.min(this.h, Math.round(y0)))
    y1 = Math.max(0, Math.min(this.h, Math.round(y1)))
    const area = (x1 - x0) * (y1 - y0)
    if (area <= 0) return 0
    const S = this.s
    const W = this.W
    return (S[y1 * W + x1] - S[y0 * W + x1] - S[y1 * W + x0] + S[y0 * W + x0]) / area
  }
}

// ---- Pentagramas -----------------------------------------------------------

interface Line {
  y: number
  t: number
}

function findLines(dark: Uint8Array, w: number, h: number): Line[] {
  const counts = new Int32Array(h)
  for (let y = 0; y < h; y++) {
    let c = 0
    const o = y * w
    for (let x = 0; x < w; x++) c += dark[o + x]
    counts[y] = c
  }
  let max = 0
  for (let y = 0; y < h; y++) max = Math.max(max, counts[y])
  const thr = Math.max(w * 0.22, max * 0.45)
  const lines: Line[] = []
  let start = -1
  for (let y = 0; y <= h; y++) {
    const on = y < h && counts[y] >= thr
    if (on && start < 0) start = y
    if (!on && start >= 0) {
      lines.push({ y: (start + y - 1) / 2, t: y - start })
      start = -1
    }
  }
  return lines
}

function groupStaves(lines: Line[]): Line[][] {
  const staves: Line[][] = []
  let i = 0
  while (i + 4 < lines.length) {
    const five = lines.slice(i, i + 5)
    const gaps = five.slice(1).map((l, k) => l.y - five[k].y)
    const med = [...gaps].sort((a, b) => a - b)[2]
    const ok = med >= 4 && med <= 80 && gaps.every((g) => Math.abs(g - med) <= med * 0.3) && five.every((l) => l.t < med * 0.6)
    if (ok) {
      staves.push(five)
      i += 5
    } else i++
  }
  return staves
}

/** Extensión horizontal del pentagrama: columnas con tinta en al menos 4 de las 5 líneas. */
function staffExtent(dark: Uint8Array, w: number, lines: Line[], gap: number): { x0: number; x1: number } {
  const on = new Uint8Array(w)
  for (let x = 0; x < w; x++) {
    let n = 0
    for (const l of lines) {
      let hit = 0
      for (let dy = -Math.ceil(l.t / 2) - 1; dy <= Math.ceil(l.t / 2) + 1 && !hit; dy++) hit = dark[Math.round(l.y + dy) * w + x]
      n += hit
    }
    on[x] = n >= 4 ? 1 : 0
  }
  // Segmento más largo permitiendo pequeños huecos.
  let best = { x0: 0, x1: w - 1, len: 0 }
  let s = -1
  let lastOn = -1
  for (let x = 0; x <= w; x++) {
    if (x < w && on[x]) {
      if (s < 0) s = x
      lastOn = x
    } else if (s >= 0 && (x === w || x - lastOn > gap)) {
      if (lastOn - s > best.len) best = { x0: s, x1: lastOn, len: lastOn - s }
      s = -1
    }
  }
  return { x0: best.x0, x1: best.x1 }
}

/** Borra las líneas del pentagrama salvo donde cruzan un símbolo (tinta justo encima o debajo). */
function removeLines(clean: Uint8Array, w: number, lines: Line[], x0: number, x1: number) {
  for (const l of lines) {
    // Las filas de la línea + 1 de margen (en fotos la línea tiene bordes borrosos), no más:
    // un margen mayor recortaría las cabezas que la rozan.
    const yTop = Math.round(l.y - (l.t - 1) / 2) - 1
    const yBot = Math.round(l.y - (l.t - 1) / 2) + l.t
    for (let x = x0; x <= x1; x++) {
      // Se conserva solo donde un símbolo la cruza (tinta justo encima Y justo debajo).
      const above = clean[(yTop - 1) * w + x]
      const below = clean[(yBot + 1) * w + x]
      if (above && below) continue
      for (let y = yTop; y <= yBot; y++) clean[y * w + x] = 0
    }
  }
}

// ---- Símbolos ----------------------------------------------------------------

function verticalRun(clean: Uint8Array, w: number, h: number, x: number, y: number, dir: 1 | -1, maxGap: number): number {
  let len = 0
  let miss = 0
  let yy = y
  while (yy >= 0 && yy < h) {
    if (clean[yy * w + x]) {
      len += 1 + miss
      miss = 0
    } else if (++miss > maxGap) break
    yy += dir
  }
  return len
}

interface Head {
  x: number
  y: number
  filled: boolean
  score: number
}

function detectHeads(
  I: Integral,
  /** Integral de la imagen ORIGINAL (con líneas): para los bordes superior/inferior de cabezas en un espacio. */
  Io: Integral,
  s: number,
  lines: number[],
  x0: number,
  x1: number,
  skip: number,
  yMin: number,
  yMax: number,
): Head[] {
  const bottom = lines[4]
  const cands: Head[] = []
  const xs = Math.round(x0 + skip)
  for (let p = -5; p <= 13; p++) {
    const y = bottom - (p * s) / 2
    // Sin invadir el pentagrama vecino (sus notas no son de este).
    if (y < yMin || y > yMax) continue
    for (let x = xs; x <= x1 - 0.4 * s; x++) {
      const inner = I.ratio(x - 0.45 * s, y - 0.3 * s, x + 0.45 * s, y + 0.3 * s)
      // Una cabeza está acotada en horizontal (las barras de unión no).
      const left = I.ratio(x - 1.05 * s, y - 0.18 * s, x - 0.75 * s, y + 0.18 * s)
      const right = I.ratio(x + 0.75 * s, y - 0.18 * s, x + 1.05 * s, y + 0.18 * s)
      const bounded = Math.min(left, right) <= 0.35 && Math.max(left, right) <= 0.65
      if (!bounded) continue
      if (inner >= 0.68) {
        cands.push({ x, y, filled: true, score: inner })
        continue
      }
      // Cabeza vacía: anillo con tinta y centro blanco.
      const core = I.ratio(x - 0.2 * s, y - 0.12 * s, x + 0.2 * s, y + 0.12 * s)
      if (core > 0.2) continue
      const outer = I.ratio(x - 0.62 * s, y - 0.45 * s, x + 0.62 * s, y + 0.45 * s)
      // Lados medidos en una franja alta: si la cabeza está sobre una línea, el borrado le quita unas filas.
      const sideL = I.ratio(x - 0.66 * s, y - 0.3 * s, x - 0.36 * s, y + 0.3 * s)
      const sideR = I.ratio(x + 0.36 * s, y - 0.3 * s, x + 0.66 * s, y + 0.3 * s)
      // Arriba/abajo en la imagen original: en un espacio, esos bordes coinciden con las líneas y se borran con ellas.
      const topB = Io.ratio(x - 0.2 * s, y - 0.5 * s, x + 0.2 * s, y - 0.25 * s)
      const botB = Io.ratio(x - 0.2 * s, y + 0.25 * s, x + 0.2 * s, y + 0.5 * s)
      // (arriba/abajo pueden haber perdido algo de tinta al borrar las líneas del pentagrama)
      if (outer >= 0.22 && sideL >= 0.22 && sideR >= 0.22 && topB >= 0.12 && botB >= 0.12) {
        // Centrada de verdad: tinta equilibrada arriba/abajo e izquierda/derecha (desplazada medio espacio, no).
        cands.push({ x, y, filled: false, score: 0.2 + 0.4 * Math.min(topB, botB) + 0.3 * Math.min(sideL, sideR) - core })
      }
    }
  }
  // Supresión de no-máximos: una sola voz → una cabeza por columna.
  cands.sort((a, b) => b.score - a.score)
  const out: Head[] = []
  for (const c of cands) if (!out.some((o) => Math.abs(o.x - c.x) < 1.0 * s)) out.push(c)
  return out.sort((a, b) => a.x - b.x)
}

function detectBarlines(dark: Uint8Array, w: number, lines: number[], x0: number, x1: number, s: number, heads: Head[]): number[] {
  const top = Math.round(lines[0])
  const bot = Math.round(lines[4])
  const span = bot - top
  const cols: number[] = []
  for (let x = x0; x <= x1; x++) {
    let n = 0
    // Una barra es una línea CONTINUA de la primera a la última línea (una plica no llega a las dos).
    let gapRun = 0
    let maxGap = 0
    for (let y = top - 1; y <= bot + 1; y++) {
      const d = dark[y * w + x]
      n += d
      gapRun = d ? 0 : gapRun + 1
      maxGap = Math.max(maxGap, gapRun)
    }
    if (n >= (span + 3) * 0.92 && maxGap <= 2) cols.push(x)
  }
  const bars: number[] = []
  let g: number[] = []
  const flush = () => {
    if (!g.length) return
    const cx = (g[0] + g[g.length - 1]) / 2
    const width = g[g.length - 1] - g[0] + 1
    // Fina, y no es la plica de una nota (cabeza pegada).
    const isStem = heads.some((hd) => Math.abs(hd.x - cx) < 1.0 * s)
    if (width <= Math.max(3, 0.7 * s) && !isStem) bars.push(cx)
    g = []
  }
  for (const x of cols) {
    if (g.length && x - g[g.length - 1] > 1) flush()
    g.push(x)
  }
  flush()
  // Barras dobles / finales: se funden.
  const merged: number[] = []
  for (const b of bars) if (!merged.length || b - merged[merged.length - 1] > 1.2 * s) merged.push(b)
  return merged
}

function classify(clean: Uint8Array, I: Integral, w: number, h: number, head: Head, s: number): Duration {
  const gap = Math.max(2, Math.round(0.25 * s))
  let best = { len: 0, x: 0, dir: -1 as 1 | -1 }
  // Plica hacia arriba (a la derecha) o hacia abajo (a la izquierda).
  for (const [from, to, dir] of [
    [head.x + 0.3 * s, head.x + 0.9 * s, -1],
    [head.x - 0.9 * s, head.x - 0.3 * s, 1],
  ] as [number, number, 1 | -1][]) {
    for (let x = Math.round(from); x <= Math.round(to); x++) {
      const len = verticalRun(clean, w, h, x, Math.round(head.y), dir, gap)
      if (len > best.len) best = { len, x, dir }
    }
  }
  const hasStem = best.len >= 2.3 * s
  if (!head.filled) return hasStem ? 'h' : 'w'
  if (!hasStem) return 'q'
  // Corchete o barra de unión junto al extremo libre de la plica.
  const end = head.y + best.dir * best.len
  const yA = Math.min(end, end - best.dir * 1.1 * s)
  const yB = Math.max(end, end - best.dir * 1.1 * s)
  const right = I.ratio(best.x + 0.2 * s, yA, best.x + 1.1 * s, yB)
  const left = I.ratio(best.x - 1.1 * s, yA, best.x - 0.2 * s, yB)
  return Math.max(right, left) >= 0.3 ? '8' : 'q'
}

/** Analiza una imagen (ya enderezada) y devuelve pentagramas, compases y notas. */
export function recognizeScore(img: GrayImage): OmrResult {
  const { w, h } = img
  const dark = binarize(img)
  const staves = groupStaves(findLines(dark, w, h))
  const clean = dark.slice()
  const out: OmrStaff[] = []
  staves.forEach((five) => {
    const ys = five.map((l) => l.y)
    const gap = (ys[4] - ys[0]) / 4
    const { x0, x1 } = staffExtent(dark, w, five, gap)
    if (x1 - x0 < gap * 8) return
    removeLines(clean, w, five, x0, x1)
  })
  const I = new Integral(clean, w, h)
  const Io = new Integral(dark, w, h)
  staves.forEach((five, si) => {
    const ys = five.map((l) => l.y)
    const gap = (ys[4] - ys[0]) / 4
    const { x0, x1 } = staffExtent(dark, w, five, gap)
    if (x1 - x0 < gap * 8) return
    // Clave (+ armadura + compás en el primer pentagrama) al principio: se salta.
    const skip = (si === 0 ? 6 : 4.5) * gap
    const prev = staves[si - 1]
    const next = staves[si + 1]
    const yMin = prev ? (prev[4].y + ys[0]) / 2 : -Infinity
    const yMax = next ? (ys[4] + next[0].y) / 2 : Infinity
    const heads = detectHeads(I, Io, gap, ys, x0, x1, skip, yMin, yMax)
    // Las barras se buscan en la imagen original: al borrar líneas se recortan sus extremos.
    const bars = detectBarlines(dark, w, ys, x0, x1, gap, heads).filter((b) => b > x0 + gap * 1.2 && b < x1 - gap * 1.2)
    const bounds = [x0, ...bars, x1]
    const measures: OmrMeasure[] = bounds.slice(1).map((b, k) => ({ x0: bounds[k], x1: b, notes: [] }))
    for (const hd of heads) {
      const m = measures.find((mm) => hd.x >= mm.x0 && hd.x < mm.x1) ?? measures[measures.length - 1]
      m.notes.push({
        dur: classify(clean, I, w, h, hd, gap),
        step: clampStep(2 + Math.round((ys[4] - hd.y) / (gap / 2))),
        x: hd.x,
        y: hd.y,
      })
    }
    out.push({ lines: ys, gap, x0, x1, barlines: bars, measures })
  })
  return { staves: out, noteCount: out.reduce((n, st) => n + st.measures.reduce((k, m) => k + m.notes.length, 0), 0) }
}

/** Solo para pruebas/diagnóstico. */
export const _internals = { findLines, groupStaves, staffExtent, removeLines, Integral }
