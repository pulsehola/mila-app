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

/** Dibuja un trazo con grosor dinámico (presión del Pencil; en ratón simula presión por velocidad). */
export function drawStroke(ctx: CanvasRenderingContext2D, stroke: Stroke, pressure: boolean, done: boolean): void {
  if (stroke.length === 0) return
  const outline = getStroke(
    stroke.map((p) => [p.x, p.y, p.p]),
    {
      size: pressure ? 7 : 5.5,
      thinning: 0.62,
      smoothing: 0.55,
      streamline: 0.42,
      simulatePressure: !pressure,
      last: done,
    },
  )
  ctx.fill(pathFromOutline(outline))
}
