import { getStroke } from 'perfect-freehand'
import type { Stroke } from '../types'

function pathFromOutline(points: number[][]): Path2D {
  const path = new Path2D()
  if (points.length < 3) return path
  path.moveTo(points[0][0], points[0][1])
  for (let i = 0; i < points.length; i++) {
    const [x0, y0] = points[i]
    const [x1, y1] = points[(i + 1) % points.length]
    path.quadraticCurveTo(x0, y0, (x0 + x1) / 2, (y0 + y1) / 2)
  }
  path.closePath()
  return path
}

/**
 * Dibuja un trazo con grosor dinámico (presión del Pencil; en ratón simula presión por velocidad).
 * Punta de estilográfica: los extremos se afinan (sin "gota" redonda que tape la línea del pentagrama) y el
 * trazo sigue la punta casi sin retraso, para que empiece y acabe en el píxel exacto donde se apoya el lápiz.
 * `taper = false` para la goma (grosor uniforme).
 */
export function drawStroke(
  ctx: CanvasRenderingContext2D,
  stroke: Stroke,
  pressure: boolean,
  done: boolean,
  size?: number,
  taper = true,
): void {
  if (stroke.length === 0) return
  const base = size ?? (pressure ? 4.6 : 4)
  const outline = getStroke(
    stroke.map((p) => [p.x, p.y, p.p]),
    {
      size: base,
      thinning: taper ? 0.6 : 0,
      smoothing: 0.4,
      // Poco retraso: con el Pencil el trazo va pegado a la punta.
      streamline: pressure ? 0.18 : 0.3,
      simulatePressure: !pressure,
      start: taper ? { taper: base * 1.6, cap: true } : { cap: true },
      end: taper ? { taper: base * 2.2, cap: true } : { cap: true },
      last: done,
    },
  )
  ctx.fill(pathFromOutline(outline))
}
