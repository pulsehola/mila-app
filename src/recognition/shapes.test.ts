import { describe, expect, it } from 'vitest'
import type { Pt, Stroke } from '../types'
import { bbox } from './geometry'
import { detectBeams, headFill, recognizeCluster, slurEnds, type StaffCtx, yFromStep } from './recognize'

const staff: StaffCtx = { yTop: 100, yBottom: 140 }
let t = 0
const pt = (x: number, y: number): Pt => ({ x, y, p: 0.5, t: (t += 8) })
const line = (x0: number, y0: number, x1: number, y1: number, n = 14): Stroke =>
  Array.from({ length: n + 1 }, (_, i) => pt(x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * i) / n))
const ellipse = (cx: number, cy: number, rx: number, ry: number, turns = 1.1): Stroke =>
  Array.from({ length: Math.round(40 * turns) + 1 }, (_, i) => {
    const a = (i / 40) * Math.PI * 2
    return pt(cx + Math.cos(a) * rx, cy + Math.sin(a) * ry)
  })
/** Relleno a mano: espiral hacia dentro, como cuando se pinta la cabeza con el lápiz. */
const spiral = (cx: number, cy: number, rx: number, ry: number): Stroke =>
  Array.from({ length: 121 }, (_, i) => {
    const a = (i / 20) * Math.PI * 2
    const k = 1 - i / 130
    return pt(cx + Math.cos(a) * rx * k, cy + Math.sin(a) * ry * k)
  })

describe('cabeza rellena o vacía (tinta dentro de la cabeza)', () => {
  it('un círculo vacío, aunque se repase, es hueco', () => {
    const s = ellipse(60, 120, 7, 5, 2.2)
    expect(headFill([s], bbox(s))).toBeLessThan(0.25)
  })
  it('una espiral de relleno cuenta como rellena', () => {
    const s = spiral(60, 120, 7, 5)
    expect(headFill([s], bbox(s))).toBeGreaterThan(0.5)
  })
  it('negra dibujada de un solo trazo (relleno + plica) ya no sale blanca', () => {
    const y = yFromStep(6, staff)
    const s = [...spiral(60, y, 7, 5), ...line(67, y, 67, y - 34)]
    expect(recognizeCluster([s], staff)).toMatchObject({ kind: 'note', dur: 'q' })
  })
  it('blanca dibujada de un solo trazo (círculo + plica) sigue siendo blanca', () => {
    const y = yFromStep(6, staff)
    const s = [...ellipse(60, y, 7, 5), ...line(67, y, 67, y - 34)]
    expect(recognizeCluster([s], staff)).toMatchObject({ kind: 'note', dur: 'h' })
  })
  it('negra en dos trazos (relleno + plica)', () => {
    const y = yFromStep(4, staff)
    expect(recognizeCluster([spiral(60, y, 7, 5), line(67, y, 67, y - 34)], staff)).toMatchObject({ kind: 'note', dur: 'q', step: 4 })
  })
})

describe('barras de unión', () => {
  const stemUp = (x: number, step: number) => line(x, yFromStep(step, staff), x, yFromStep(step, staff) - 34)
  it('una barra que une dos plicas: ambas cuentan 1 barra', () => {
    const s1 = stemUp(66, 4)
    const s2 = stemUp(96, 5)
    const beam = line(66, yFromStep(4, staff) - 34, 96, yFromStep(5, staff) - 34)
    const { beams, count } = detectBeams([s1, s2, beam])
    expect(beams.has(beam)).toBe(true)
    expect(count.get(s1)).toBe(1)
    expect(count.get(s2)).toBe(1)
  })
  it('dos barras = semicorcheas', () => {
    const s1 = stemUp(66, 4)
    const s2 = stemUp(96, 4)
    const top = yFromStep(4, staff) - 34
    const { count } = detectBeams([s1, s2, line(66, top, 96, top), line(66, top + 7, 96, top + 7)])
    expect(count.get(s1)).toBe(2)
  })
  it('una línea suelta sin plicas no es una barra', () => {
    expect(detectBeams([line(10, 90, 60, 90)]).beams.size).toBe(0)
  })
})

describe('ligaduras', () => {
  const arc = (x0: number, x1: number, y: number, depth: number): Stroke =>
    Array.from({ length: 25 }, (_, i) => {
      const u = i / 24
      return pt(x0 + (x1 - x0) * u, y + Math.sin(u * Math.PI) * depth)
    })
  it('un arco ancho y poco alto es una ligadura', () => {
    expect(slurEnds(arc(60, 110, 150, 8))).toMatchObject({ x0: 60, x1: 110 })
  })
  it('una recta (barra) o un zig-zag no lo son', () => {
    expect(slurEnds(line(60, 150, 110, 150))).toBeNull()
    const zig = [pt(60, 150), pt(70, 158), pt(80, 150), pt(70, 142), pt(90, 150), pt(100, 158), pt(110, 150)]
    expect(slurEnds(zig)).toBeNull()
  })
})

describe('notas de un solo trazo escritas seguidas', () => {
  it('tres negras de un trazo, rápidas y cercanas, son tres notas', async () => {
    const { clusterStrokes, splitByHeads } = await import('./recognize')
    const notes = [4, 5, 6].map((st, i) => {
      const x = 60 + i * 30
      const y = yFromStep(st, staff)
      return [...spiral(x, y, 7, 5), ...line(x + 7, y, x + 7, y - 34)]
    })
    const groups = clusterStrokes(notes).flatMap(splitByHeads)
    expect(groups).toHaveLength(3)
    expect(groups.map((g) => recognizeCluster(g, staff))).toMatchObject([
      { kind: 'note', dur: 'q', step: 4 },
      { kind: 'note', dur: 'q', step: 5 },
      { kind: 'note', dur: 'q', step: 6 },
    ])
  })
})
