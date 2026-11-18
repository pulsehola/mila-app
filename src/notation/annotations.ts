import type { Annotation, Stroke } from '../types'
import type { Layout, MeasureBox } from './renderScore'
import { drawStroke } from '../components/ink'

/** Distancia máxima (px) para que un trazo nuevo se sume a la anotación anterior (una palabra, un recuadro...). */
const JOIN_GAP = 46
/** Tiempo máximo entre trazos de una misma anotación. */
export const JOIN_MS = 1400

interface Placement {
  ox: number
  oy: number
  k: number
}

/** Compás más cercano a un punto: primero el sistema (fila) más próximo, luego el compás en x. */
export function nearestMeasure(l: Layout, x: number, y: number): MeasureBox | null {
  if (l.measures.length === 0) return null
  let row = 0
  let best = Infinity
  l.rows.forEach((r, i) => {
    const d = Math.abs(y - (r.yTop + r.yBottom) / 2)
    if (d < best) {
      best = d
      row = i
    }
  })
  const inRow = l.measures.filter((m) => m.row === row)
  return (
    inRow.find((m) => x >= m.x && x < m.x + m.w) ??
    (x < inRow[0].x ? inRow[0] : inRow[inRow.length - 1])
  )
}

/**
 * Dónde se dibuja una anotación en un layout concreto. `firstIndex` es el índice global del primer compás del
 * layout (páginas del PDF). Devuelve null si su compás no aparece en este layout.
 */
export function placeAnnotation(a: Annotation, l: Layout, firstIndex = 0): Placement | null {
  const m = l.measures.find((b) => b.index + firstIndex === a.measure)
  if (!m) return null
  const k = Math.max(0.55, Math.min(1.6, m.w / (a.w0 || m.w)))
  return { ox: m.x + a.ax * m.w, oy: m.yTop + a.ay, k }
}

function absStrokes(a: Annotation, p: Placement): Stroke[] {
  return a.strokes.map((s) => s.map(([dx, dy, pr]) => ({ x: p.ox + dx * p.k, y: p.oy + dy * p.k, p: pr, t: 0 })))
}

/** Caja (en coordenadas del layout) de una anotación colocada. */
export function annotationBox(a: Annotation, l: Layout, firstIndex = 0) {
  const p = placeAnnotation(a, l, firstIndex)
  if (!p) return null
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  for (const s of a.strokes)
    for (const [dx, dy] of s) {
      const x = p.ox + dx * p.k
      const y = p.oy + dy * p.k
      if (x < x0) x0 = x
      if (y < y0) y0 = y
      if (x > x1) x1 = x
      if (y > y1) y1 = y
    }
  return { x0, y0, x1, y1 }
}

/** Crea una anotación nueva anclada al compás más cercano al centro del trazo. */
export function createAnnotation(id: string, stroke: Stroke, pen: boolean, l: Layout): Annotation | null {
  const xs = stroke.map((p) => p.x)
  const ys = stroke.map((p) => p.y)
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2
  const cy = (Math.min(...ys) + Math.max(...ys)) / 2
  const m = nearestMeasure(l, cx, cy)
  if (!m) return null
  const ann: Annotation = { id, measure: m.index, ax: (cx - m.x) / m.w, ay: cy - m.yTop, w0: m.w, strokes: [], pen }
  return appendStroke(ann, stroke, l) ?? null
}

/** Añade un trazo a una anotación existente (en sus coordenadas relativas). */
export function appendStroke(a: Annotation, stroke: Stroke, l: Layout): Annotation | null {
  const p = placeAnnotation(a, l)
  if (!p) return null
  const rel = stroke.map((pt) => [
    Math.round(((pt.x - p.ox) / p.k) * 10) / 10,
    Math.round(((pt.y - p.oy) / p.k) * 10) / 10,
    Math.round(pt.p * 100) / 100,
  ]) as [number, number, number][]
  return { ...a, strokes: [...a.strokes, rel] }
}

/** ¿El trazo nuevo pertenece a la última anotación (misma palabra / mismo dibujo)? */
export function shouldJoin(last: Annotation | undefined, stroke: Stroke, l: Layout): boolean {
  if (!last) return false
  const b = annotationBox(last, l)
  if (!b) return false
  const xs = stroke.map((p) => p.x)
  const ys = stroke.map((p) => p.y)
  const gx = Math.max(0, b.x0 - Math.max(...xs), Math.min(...xs) - b.x1)
  const gy = Math.max(0, b.y0 - Math.max(...ys), Math.min(...ys) - b.y1)
  return Math.hypot(gx, gy) <= JOIN_GAP
}

/** Anotación que toca un rectángulo (para borrarla con un tachado en zig-zag). */
export function annotationsHit(
  list: Annotation[],
  l: Layout,
  box: { x0: number; y0: number; x1: number; y1: number },
): Annotation[] {
  return list.filter((a) => {
    const b = annotationBox(a, l)
    return !!b && b.x0 <= box.x1 && b.x1 >= box.x0 && b.y0 <= box.y1 && b.y1 >= box.y0
  })
}

/** ¿Pasa el rectángulo por encima de la tinta de la anotación? (no basta con rozar su caja: un recuadro está hueco) */
export function inkInside(a: Annotation, l: Layout, box: { x0: number; y0: number; x1: number; y1: number }): boolean {
  const p = placeAnnotation(a, l)
  if (!p) return false
  let hits = 0
  for (const s of a.strokes)
    for (const [dx, dy] of s) {
      const x = p.ox + dx * p.k
      const y = p.oy + dy * p.k
      if (x >= box.x0 && x <= box.x1 && y >= box.y0 && y <= box.y1 && ++hits >= 3) return true
    }
  return false
}

/** Dibuja la capa de anotaciones en un canvas 2D (pantalla, PDF o imagen). */
export function drawAnnotations(
  ctx: CanvasRenderingContext2D,
  list: Annotation[],
  l: Layout,
  color: string,
  firstIndex = 0,
): void {
  ctx.save()
  ctx.fillStyle = color
  for (const a of list) {
    const p = placeAnnotation(a, l, firstIndex)
    if (!p) continue
    for (const s of absStrokes(a, p)) drawStroke(ctx, s, a.pen, true, 4.6 * p.k)
  }
  ctx.restore()
}
