import { describe, expect, it } from 'vitest'
import type { Stroke } from '../types'
import { normalizeScore } from '../state/useScore'
import {
  annotationBox,
  annotationsHit,
  appendStroke,
  createAnnotation,
  inkInside,
  nearestMeasure,
  placeAnnotation,
  shouldJoin,
} from './annotations'
import type { Layout } from './renderScore'

/** Layout sintético: 2 sistemas × 2 compases de 200 px. */
function layout(measureW = 200, perRow = 2, rows = 2): Layout {
  const l: Layout = { width: perRow * measureW + 44, height: 54 + rows * 160, perRow, rows: [], measures: [], notes: [] }
  for (let r = 0; r < rows; r++) {
    const yTop = 54 + r * 160
    l.rows.push({ yTop, yBottom: yTop + 40 })
    for (let c = 0; c < perRow; c++) {
      l.measures.push({
        index: r * perRow + c,
        row: r,
        x: 22 + c * measureW,
        w: measureW,
        yTop,
        yBottom: yTop + 40,
        noteStartX: 22 + c * measureW + 10,
        noteEndX: 22 + (c + 1) * measureW - 10,
      })
    }
  }
  return l
}

const line = (x0: number, y0: number, x1: number, y1: number, n = 8): Stroke =>
  Array.from({ length: n }, (_, i) => ({ x: x0 + ((x1 - x0) * i) / (n - 1), y: y0 + ((y1 - y0) * i) / (n - 1), p: 0.5, t: i }))

describe('anotaciones a mano alzada', () => {
  it('se anclan al compás más cercano, también por encima del pentagrama', () => {
    const l = layout()
    expect(nearestMeasure(l, 300, 20)?.index).toBe(1) // texto encima del sistema 1, compás 2
    expect(nearestMeasure(l, 60, 250)?.index).toBe(2) // sistema 2, primer compás
    const a = createAnnotation('a1', line(250, 20, 330, 20), true, l)!
    expect(a.measure).toBe(1)
    expect(a.ay).toBeLessThan(0) // queda por encima de la primera línea
  })

  it('siguen a su compás cuando cambia el ancho (reflujo) y conservan la forma', () => {
    const narrow = layout(200)
    const a = createAnnotation('a1', line(250, 20, 330, 20), false, narrow)!
    const before = annotationBox(a, narrow)!
    const wide = layout(300)
    const p = placeAnnotation(a, wide)!
    expect(p.k).toBeCloseTo(1.5)
    const after = annotationBox(a, wide)!
    // Mismo compás → se desplaza con él y escala uniformemente.
    expect(after.x0).toBeGreaterThan(wide.measures[1].x)
    expect(after.x1 - after.x0).toBeCloseTo((before.x1 - before.x0) * 1.5, 0)
  })

  it('en el PDF se colocan según el índice global del compás', () => {
    const l = layout()
    const a = createAnnotation('a1', line(60, 250, 120, 250), false, l)! // compás 3 (índice 2)
    const page = layout(200, 2, 1) // página que empieza en el compás 3
    expect(placeAnnotation(a, page, 2)).not.toBeNull()
    expect(placeAnnotation(a, page, 0)).toBeNull()
  })

  it('agrupa trazos cercanos en una sola anotación (una palabra) y separa los lejanos', () => {
    const l = layout()
    const a = createAnnotation('a1', line(40, 20, 60, 20), true, l)!
    expect(shouldJoin(a, line(70, 18, 90, 22), l)).toBe(true)
    expect(shouldJoin(a, line(380, 250, 400, 250), l)).toBe(false)
    const joined = appendStroke(a, line(70, 18, 90, 22), l)!
    expect(joined.strokes).toHaveLength(2)
    expect(annotationBox(joined, l)!.x1).toBeCloseTo(90, 0)
  })

  it('detecta qué anotaciones toca un tachado', () => {
    const l = layout()
    const a = createAnnotation('a1', line(40, 20, 80, 20), true, l)!
    const b = createAnnotation('b1', line(300, 250, 340, 250), true, l)!
    const hit = annotationsHit([a, b], l, { x0: 30, y0: 10, x1: 90, y1: 30 })
    expect(hit.map((h) => h.id)).toEqual(['a1'])
  })

  it('un tachado sobre el borde de un recuadro lo alcanza; en su interior vacío, no', () => {
    const l = layout()
    const box = [line(40, 60, 200, 60), line(200, 60, 200, 120), line(200, 120, 40, 120), line(40, 120, 40, 60)].flat()
    const a = createAnnotation('r1', box, true, l)!
    expect(inkInside(a, l, { x0: 150, y0: 50, x1: 230, y1: 90 })).toBe(true) // esquina superior derecha
    expect(inkInside(a, l, { x0: 80, y0: 75, x1: 160, y1: 105 })).toBe(false) // hueco del recuadro
  })

  it('se guardan y se recuperan; las de compases inexistentes se descartan', () => {
    const l = layout()
    const a = createAnnotation('a1', line(40, 20, 80, 20), true, l)!
    const s = normalizeScore({
      title: 'x',
      bpm: 90,
      transposition: 'Bb',
      measures: [[], []],
      annotations: [a, { ...a, id: 'fuera', measure: 9 }, { basura: true }],
    })!
    expect(s.annotations?.map((x) => x.id)).toEqual(['a1'])
    expect(normalizeScore({ measures: [[]] })!.annotations).toEqual([])
  })
})
