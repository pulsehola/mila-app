import type { Stroke } from '../types'

/**
 * Reconocedor de plantillas personal ($P point-cloud, Vatavu/Anthony/Wobbrock 2012).
 * Trabaja con varios trazos sin importar su orden ni su dirección, que es justo lo que varía entre
 * músicos (hay quien hace la plica antes que la cabeza, o el ♯ en cualquier orden).
 *
 * Las plantillas salen del test de escritura inicial: cada símbolo dibujado por el usuario se guarda
 * y se compara contra lo que escribe después.
 */

export type SymbolLabel =
  | 'note:w'
  | 'note:h'
  | 'note:q'
  | 'note:8'
  | 'note:16'
  | 'rest:bar' // silencio de redonda / blanca: la altura decide cuál es
  | 'rest:q'
  | 'rest:8'
  | 'rest:16'
  | 'acc:#'
  | 'acc:b'
  | 'acc:n'

interface CloudPt {
  x: number
  y: number
  id: number
}

export interface Template {
  label: SymbolLabel
  points: CloudPt[]
  /** Proporción alto/ancho del original (la normalización la pierde y ayuda a desempatar). */
  aspect: number
  strokes: number
}

const N = 32

function pathLen(pts: CloudPt[]): number {
  let d = 0
  for (let i = 1; i < pts.length; i++) {
    if (pts[i].id === pts[i - 1].id) d += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y)
  }
  return d
}

function resample(pts: CloudPt[], n: number): CloudPt[] {
  const total = pathLen(pts)
  if (total === 0) {
    // Un punto (p.ej. un toque para una cabeza rellena): se replica.
    return Array.from({ length: n }, () => ({ ...pts[0] }))
  }
  const I = total / (n - 1)
  let D = 0
  const src = pts.map((p) => ({ ...p }))
  const out: CloudPt[] = [{ ...src[0] }]
  for (let i = 1; i < src.length; i++) {
    if (src[i].id !== src[i - 1].id) continue
    const d = Math.hypot(src[i].x - src[i - 1].x, src[i].y - src[i - 1].y)
    if (D + d >= I && d > 0) {
      const t = (I - D) / d
      const q = { x: src[i - 1].x + t * (src[i].x - src[i - 1].x), y: src[i - 1].y + t * (src[i].y - src[i - 1].y), id: src[i].id }
      out.push(q)
      src.splice(i, 0, q)
      D = 0
    } else D += d
  }
  while (out.length < n) out.push({ ...src[src.length - 1] })
  return out.slice(0, n)
}

function normalize(pts: CloudPt[]): CloudPt[] {
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  for (const p of pts) {
    x0 = Math.min(x0, p.x)
    y0 = Math.min(y0, p.y)
    x1 = Math.max(x1, p.x)
    y1 = Math.max(y1, p.y)
  }
  const size = Math.max(x1 - x0, y1 - y0, 1)
  const scaled = pts.map((p) => ({ x: (p.x - x0) / size, y: (p.y - y0) / size, id: p.id }))
  const cx = scaled.reduce((s, p) => s + p.x, 0) / scaled.length
  const cy = scaled.reduce((s, p) => s + p.y, 0) / scaled.length
  return scaled.map((p) => ({ x: p.x - cx, y: p.y - cy, id: p.id }))
}

function toCloud(strokes: Stroke[]): CloudPt[] {
  const pts: CloudPt[] = []
  strokes.forEach((s, id) => s.forEach((p) => pts.push({ x: p.x, y: p.y, id })))
  return pts
}

function aspectOf(strokes: Stroke[]): number {
  const all = strokes.flat()
  const xs = all.map((p) => p.x)
  const ys = all.map((p) => p.y)
  const w = Math.max(...xs) - Math.min(...xs)
  const h = Math.max(...ys) - Math.min(...ys)
  return Math.max(h, 1) / Math.max(w, 1)
}

export function makeTemplate(label: SymbolLabel, strokes: Stroke[]): Template | null {
  const usable = strokes.filter((s) => s.length > 0)
  if (usable.length === 0) return null
  return {
    label,
    points: normalize(resample(toCloud(usable), N)),
    aspect: aspectOf(usable),
    strokes: usable.length,
  }
}

function cloudDistance(a: CloudPt[], b: CloudPt[], start: number): number {
  const n = a.length
  const matched = new Array<boolean>(n).fill(false)
  let sum = 0
  let i = start
  do {
    let min = Infinity
    let index = -1
    for (let j = 0; j < n; j++) {
      if (matched[j]) continue
      const d = (a[i].x - b[j].x) ** 2 + (a[i].y - b[j].y) ** 2
      if (d < min) {
        min = d
        index = j
      }
    }
    matched[index] = true
    const weight = 1 - ((i - start + n) % n) / n
    sum += weight * Math.sqrt(min)
    i = (i + 1) % n
  } while (i !== start)
  return sum
}

function greedyMatch(a: CloudPt[], b: CloudPt[]): number {
  const step = Math.floor(Math.pow(a.length, 0.5))
  let min = Infinity
  for (let i = 0; i < a.length; i += step) {
    min = Math.min(min, cloudDistance(a, b, i), cloudDistance(b, a, i))
  }
  return min
}

export interface TemplateMatch {
  label: SymbolLabel
  /** 0..1, mayor = más parecido. */
  score: number
  /** Ventaja sobre la mejor etiqueta distinta (0..1). */
  margin: number
}

/** Compara contra todas las plantillas y devuelve la etiqueta más parecida (mejor muestra por etiqueta). */
export function matchTemplates(strokes: Stroke[], templates: Template[], only?: (l: SymbolLabel) => boolean): TemplateMatch | null {
  const pool = only ? templates.filter((t) => only(t.label)) : templates
  if (pool.length === 0) return null
  const cand = makeTemplate('note:q', strokes)
  if (!cand) return null
  const best = new Map<SymbolLabel, number>()
  for (const t of pool) {
    let d = greedyMatch(cand.points, t.points)
    // Penaliza proporciones muy distintas (una barra y un círculo normalizados pueden parecerse).
    const ar = Math.abs(Math.log(cand.aspect / t.aspect))
    d *= 1 + Math.min(1.2, ar * 0.35)
    if (!best.has(t.label) || d < best.get(t.label)!) best.set(t.label, d)
  }
  const ranked = [...best.entries()].sort((a, b) => a[1] - b[1])
  const toScore = (d: number) => Math.max(0, 1 - d / 8)
  const [label, d] = ranked[0]
  const score = toScore(d)
  const second = ranked[1] ? toScore(ranked[1][1]) : 0
  return { label, score, margin: score - second }
}
