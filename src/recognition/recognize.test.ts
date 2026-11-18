import { describe, expect, it } from 'vitest'
import type { Pt, Stroke } from '../types'
import { clusterStrokes, isScratchOut, recognizeCluster, stepFromY, yFromStep, type StaffCtx } from './recognize'

const staff: StaffCtx = { yTop: 100, yBottom: 140 }

let t = 0
const pt = (x: number, y: number): Pt => ({ x, y, p: 0.5, t: (t += 8) })

function ellipse(cx: number, cy: number, rx: number, ry: number, turns = 1.1): Stroke {
  const out: Stroke = []
  const n = Math.round(40 * turns)
  for (let i = 0; i <= n; i++) {
    const a = (i / 40) * Math.PI * 2
    out.push(pt(cx + Math.cos(a) * rx, cy + Math.sin(a) * ry))
  }
  return out
}
function scribbleFill(cx: number, cy: number, rx: number, ry: number): Stroke {
  const out: Stroke = []
  for (let i = 0; i < 14; i++) {
    const side = i % 2 === 0 ? -1 : 1
    out.push(pt(cx + side * rx, cy - ry + (i / 13) * ry * 2))
  }
  return out
}
function line(x0: number, y0: number, x1: number, y1: number, n = 14): Stroke {
  return Array.from({ length: n + 1 }, (_, i) => pt(x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * i) / n))
}
function poly(pts: [number, number][], per = 6): Stroke {
  const out: Stroke = []
  for (let k = 1; k < pts.length; k++) {
    for (let i = 0; i < per; i++) {
      out.push(pt(pts[k - 1][0] + ((pts[k][0] - pts[k - 1][0]) * i) / per, pts[k - 1][1] + ((pts[k][1] - pts[k - 1][1]) * i) / per))
    }
  }
  out.push(pt(...pts[pts.length - 1]))
  return out
}

describe('altura sobre la clave de sol', () => {
  it('mapea líneas y espacios', () => {
    expect(stepFromY(140, staff)).toBe(2) // Mi4, línea inferior
    expect(stepFromY(135, staff)).toBe(3) // Fa4, primer espacio
    expect(stepFromY(120, staff)).toBe(6) // Si4, línea central
    expect(stepFromY(100, staff)).toBe(10) // Fa5, línea superior
    expect(stepFromY(145, staff)).toBe(1) // Re4, bajo la pauta
    expect(yFromStep(stepFromY(127, staff), staff)).toBeCloseTo(125, 5)
  })
})

describe('figuras', () => {
  it('círculo vacío = redonda', () => {
    const r = recognizeCluster([ellipse(200, 130, 7, 5)], staff)
    expect(r).toMatchObject({ kind: 'note', dur: 'w', step: 4 })
  })
  it('círculo vacío + plica = blanca', () => {
    const r = recognizeCluster([ellipse(200, 120, 7, 5), line(207, 120, 207, 90)], staff)
    expect(r).toMatchObject({ kind: 'note', dur: 'h', step: 6 })
  })
  it('cabeza rellena + plica = negra', () => {
    const r = recognizeCluster([scribbleFill(200, 125, 6, 4.5), line(206, 125, 206, 92)], staff)
    expect(r).toMatchObject({ kind: 'note', dur: 'q', step: 5 })
  })
  it('cabeza rellena + plica + corchete = corchea', () => {
    const r = recognizeCluster(
      [scribbleFill(200, 125, 6, 4.5), line(206, 125, 206, 92), line(206, 92, 216, 104, 6)],
      staff,
    )
    expect(r).toMatchObject({ kind: 'note', dur: '8' })
  })
  it('punto relleno = negra (atajo)', () => {
    const r = recognizeCluster([scribbleFill(200, 135, 4, 3)], staff)
    expect(r).toMatchObject({ kind: 'note', dur: 'q', step: 3 })
  })
  it('círculo con plica en un solo trazo = blanca', () => {
    const loop = ellipse(200, 130, 7, 5, 1.0)
    const stem = line(207, 130, 207, 98)
    const r = recognizeCluster([[...loop, ...stem]], staff)
    expect(r).toMatchObject({ kind: 'note', dur: 'h' })
  })
})

describe('silencios', () => {
  it('barra bajo 2ª línea = silencio de redonda', () => {
    const r = recognizeCluster([line(190, 113, 214, 113, 8), line(190, 108, 214, 108, 8)], staff)
    expect(r.kind).toBe('rest')
    // trazo único grueso
    const one = recognizeCluster([poly([[190, 112], [214, 112], [214, 116], [190, 116]])], staff)
    expect(one).toMatchObject({ kind: 'rest', dur: 'w' })
  })
  it('barra sobre línea central = silencio de blanca', () => {
    const r = recognizeCluster([poly([[190, 114], [214, 114], [214, 119], [190, 119]])], staff)
    expect(r).toMatchObject({ kind: 'rest', dur: 'h' })
  })
  it('zig-zag vertical = silencio de negra', () => {
    const r = recognizeCluster([poly([[205, 100], [213, 108], [203, 118], [214, 128], [206, 136]])], staff)
    expect(r).toMatchObject({ kind: 'rest', dur: 'q' })
  })
  it('forma de 7 = silencio de corchea', () => {
    const r = recognizeCluster([poly([[200, 108], [212, 108], [204, 130]])], staff)
    expect(r).toMatchObject({ kind: 'rest', dur: '8' })
  })
  it('una raya recta suelta no es nada', () => {
    expect(recognizeCluster([line(200, 100, 201, 130)], staff).kind).toBe('unknown')
  })
})

describe('gestos', () => {
  it('detecta tachado en zig-zag', () => {
    const z = poly([[190, 120], [225, 126], [190, 132], [225, 138], [190, 144], [225, 148]])
    expect(isScratchOut(z)).toBe(true)
  })
  it('un círculo o una plica no son tachado', () => {
    expect(isScratchOut(ellipse(200, 130, 7, 5))).toBe(false)
    expect(isScratchOut(line(207, 120, 207, 90))).toBe(false)
  })
  it('agrupa cabeza y plica pero separa notas lejanas', () => {
    const a = [ellipse(100, 130, 7, 5), line(107, 130, 107, 100)]
    const b = [ellipse(220, 130, 7, 5)]
    const groups = clusterStrokes([...b, ...a])
    expect(groups).toHaveLength(2)
    expect(groups[0]).toHaveLength(2)
  })
})
