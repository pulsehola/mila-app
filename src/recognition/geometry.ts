import type { Pt, Stroke } from '../types'

export interface BBox {
  x0: number
  y0: number
  x1: number
  y1: number
  w: number
  h: number
  cx: number
  cy: number
}

export function bbox(pts: Pt[]): BBox {
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  for (const p of pts) {
    if (p.x < x0) x0 = p.x
    if (p.x > x1) x1 = p.x
    if (p.y < y0) y0 = p.y
    if (p.y > y1) y1 = p.y
  }
  return { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 }
}

export function unionBox(boxes: BBox[]): BBox {
  const x0 = Math.min(...boxes.map((b) => b.x0))
  const y0 = Math.min(...boxes.map((b) => b.y0))
  const x1 = Math.max(...boxes.map((b) => b.x1))
  const y1 = Math.max(...boxes.map((b) => b.y1))
  return { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 }
}

export function dist(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

export function pathLength(pts: Pt[]): number {
  let L = 0
  for (let i = 1; i < pts.length; i++) L += dist(pts[i - 1], pts[i])
  return L
}

/** Distancia extremo a extremo / longitud total. 1 = recta. */
export function straightness(pts: Pt[]): number {
  const L = pathLength(pts)
  if (L === 0) return 1
  return dist(pts[0], pts[pts.length - 1]) / L
}

/** Remuestrea a puntos equidistantes (para ángulos y bucles estables con cualquier velocidad). */
export function resample(pts: Pt[], step = 3): Pt[] {
  if (pts.length < 2) return pts.slice()
  const out: Pt[] = [pts[0]]
  let carried = 0
  let prev = pts[0]
  for (let i = 1; i < pts.length; i++) {
    let cur = pts[i]
    let d = dist(prev, cur)
    while (carried + d >= step) {
      const t = (step - carried) / d
      const np: Pt = {
        x: prev.x + (cur.x - prev.x) * t,
        y: prev.y + (cur.y - prev.y) * t,
        p: prev.p + (cur.p - prev.p) * t,
        t: prev.t + (cur.t - prev.t) * t,
      }
      out.push(np)
      prev = np
      d = dist(prev, cur)
      carried = 0
    }
    carried += d
    prev = cur
    cur = pts[i]
  }
  const last = pts[pts.length - 1]
  if (dist(out[out.length - 1], last) > 0.5) out.push(last)
  return out
}

/** Cambios de dirección (con histéresis) a lo largo de un eje. Detecta zig-zag. */
export function reversals(pts: Pt[], axis: 'x' | 'y', threshold = 5): number {
  if (pts.length < 2) return 0
  let dir = 0
  let extreme = pts[0][axis]
  let count = 0
  for (let i = 1; i < pts.length; i++) {
    const v = pts[i][axis]
    if (dir >= 0 && v > extreme) {
      extreme = v
      if (dir === 0 && v - pts[0][axis] > threshold) dir = 1
    } else if (dir <= 0 && v < extreme) {
      extreme = v
      if (dir === 0 && pts[0][axis] - v > threshold) dir = -1
    }
    if (dir === 1 && extreme - v > threshold) {
      count++
      dir = -1
      extreme = v
    } else if (dir === -1 && v - extreme > threshold) {
      count++
      dir = 1
      extreme = v
    }
  }
  return count
}

/** Esquinas pronunciadas (giro > minAngle grados) sobre el trazo remuestreado. */
export function corners(pts: Pt[], minAngleDeg = 60, span = 3): number {
  const r = resample(pts, 3)
  if (r.length < span * 2 + 1) return 0
  let count = 0
  let lastIdx = -100
  for (let i = span; i < r.length - span; i++) {
    const a = Math.atan2(r[i].y - r[i - span].y, r[i].x - r[i - span].x)
    const b = Math.atan2(r[i + span].y - r[i].y, r[i + span].x - r[i].x)
    let d = Math.abs(b - a)
    if (d > Math.PI) d = 2 * Math.PI - d
    if ((d * 180) / Math.PI >= minAngleDeg && i - lastIdx > span * 2) {
      count++
      lastIdx = i
    }
  }
  return count
}

export interface LoopInfo {
  i: number
  j: number
  box: BBox
}

/**
 * Busca un bucle cerrado (el trazo vuelve a pasar por un punto previo tras recorrer distancia).
 * Sirve para distinguir una cabeza de nota (círculo) de una línea y para "paleta + plica" en un trazo.
 */
export function findLoop(pts: Pt[]): LoopInfo | null {
  const r = resample(pts, 2.5)
  const minGap = 10
  let best: LoopInfo | null = null
  for (let i = 0; i < r.length; i++) {
    for (let j = i + minGap; j < r.length; j++) {
      if (dist(r[i], r[j]) < 4.5) {
        const box = bbox(r.slice(i, j + 1))
        if (box.w >= 6 && box.h >= 5 && box.w <= 40 && box.h <= 40) {
          if (!best || j - i > best.j - best.i) best = { i, j, box }
        }
      }
    }
  }
  return best
}

export function boxesNear(a: BBox, b: BBox, gap: number): boolean {
  return a.x0 - gap <= b.x1 && b.x0 - gap <= a.x1 && a.y0 - gap <= b.y1 && b.y0 - gap <= a.y1
}

export function strokeDuration(s: Stroke): number {
  return s.length > 1 ? s[s.length - 1].t - s[0].t : 0
}
