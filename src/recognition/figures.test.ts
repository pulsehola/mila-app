import { describe, expect, it } from 'vitest'
import type { Pt, Stroke } from '../types'
import { recognizePersonal } from './personal'
import { makeTemplate } from './templates'
import { recognizeCluster, splitByHeads, STAFF_GAP, type StaffCtx, yFromStep } from './recognize'

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
const spiral = (cx: number, cy: number, rx: number, ry: number): Stroke =>
  Array.from({ length: 121 }, (_, i) => {
    const a = (i / 20) * Math.PI * 2
    const k = 1 - i / 130
    return pt(cx + Math.cos(a) * rx * k, cy + Math.sin(a) * ry * k)
  })
const poly = (pts: [number, number][], per = 6): Stroke => {
  const out: Stroke = []
  for (let k = 1; k < pts.length; k++) {
    for (let i = 0; i < per; i++) {
      out.push(pt(pts[k - 1][0] + ((pts[k][0] - pts[k - 1][0]) * i) / per, pts[k - 1][1] + ((pts[k][1] - pts[k - 1][1]) * i) / per))
    }
  }
  out.push(pt(...pts[pts.length - 1]))
  return out
}
/** Puntito: dos o tres muestras casi en el mismo sitio. */
const dot = (x: number, y: number): Stroke => [pt(x, y), pt(x + 1, y + 0.5), pt(x + 1.5, y + 1)]
/** Bloque relleno a mano (zig-zag horizontal apretado). */
const block = (x0: number, y0: number, w: number, h: number): Stroke => {
  const out: Stroke = []
  for (let i = 0; i <= 8; i++) {
    const y = y0 + (h * i) / 8
    out.push(...line(i % 2 ? x0 + w : x0, y, i % 2 ? x0 : x0 + w, y, 6))
  }
  return out
}

const line4 = staff.yTop + STAFF_GAP
const line3 = staff.yTop + STAFF_GAP * 2

describe('blanca vs redonda: la plica decide', () => {
  it('círculo hueco sin plica = redonda', () => {
    expect(recognizeCluster([ellipse(60, yFromStep(6, staff), 7, 5)], staff)).toMatchObject({ kind: 'note', dur: 'w' })
  })
  it('círculo hueco + plica algo torcida = blanca (no redonda)', () => {
    const y = yFromStep(4, staff)
    const stem = poly([
      [67, y],
      [68.5, y - 12],
      [66.5, y - 22],
      [68, y - 30],
    ])
    expect(recognizeCluster([ellipse(60, y, 7, 5), stem], staff)).toMatchObject({ kind: 'note', dur: 'h' })
  })
  it('cabeza hueca + plica de un trazo sin cerrar el círculo = blanca', () => {
    const y = yFromStep(4, staff)
    // Arco de casi una vuelta (sin cerrar) que sigue hacia arriba en la plica.
    const arc = Array.from({ length: 31 }, (_, i) => {
      const a = Math.PI * 0.1 + (i / 30) * Math.PI * 1.7
      return pt(60 + Math.cos(a) * 7, y + Math.sin(a) * 5)
    })
    const s = [...arc, ...line(67, y, 67, y - 32)]
    expect(recognizeCluster([s], staff)).toMatchObject({ kind: 'note', dur: 'h' })
  })
  it('las muestras del test de escritura no convierten una blanca en redonda', () => {
    const y = yFromStep(4, staff)
    const strokes = [ellipse(60, y, 7, 5), line(67, y, 67, y - 32)]
    const tpl = [makeTemplate('note:w', strokes)!, makeTemplate('note:w', strokes)!]
    // Aunque la plantilla sea idéntica, la plica manda.
    expect(recognizePersonal(strokes, staff, tpl)).toMatchObject({ kind: 'note', dur: 'h' })
  })
})

describe('silencios', () => {
  it('bloque colgado de la 4ª línea = silencio de redonda', () => {
    expect(recognizeCluster([block(55, line4, 14, 5)], staff)).toMatchObject({ kind: 'rest', dur: 'w' })
  })
  it('bloque sobre la 3ª línea = silencio de blanca', () => {
    expect(recognizeCluster([block(55, line3 - 5, 14, 5)], staff)).toMatchObject({ kind: 'rest', dur: 'h' })
  })
  it('una cabeza rellena en el mismo sitio sigue siendo nota', () => {
    expect(recognizeCluster([spiral(62, line4 + 5, 6, 4.5)], staff)).toMatchObject({ kind: 'note' })
  })
  it('diagonal con un punto-gancho arriba a la izquierda = silencio de corchea', () => {
    const diag = line(70, 112, 60, 136)
    expect(recognizeCluster([dot(62, 113), diag], staff)).toMatchObject({ kind: 'rest', dur: '8' })
  })
  it('diagonal con gancho en un solo trazo = silencio de corchea', () => {
    const s = poly([
      [60, 116],
      [62, 112],
      [66, 114],
      [70, 111],
      [60, 136],
    ])
    expect(recognizeCluster([s], staff)).toMatchObject({ kind: 'rest', dur: '8' })
  })
  it('diagonal con dos ganchos = silencio de semicorchea (no negra)', () => {
    const diag = line(72, 108, 60, 140)
    expect(recognizeCluster([dot(63, 110), dot(60, 120), diag], staff)).toMatchObject({ kind: 'rest', dur: '16' })
  })
})

describe('bemol', () => {
  it('palo a la izquierda + panza cerrada abajo (dos trazos) = ♭, no blanca', () => {
    const bowl = poly([
      [60, 128],
      [66, 125],
      [68, 129],
      [63, 134],
      [60, 134],
    ])
    expect(recognizeCluster([line(60, 104, 60, 134), bowl], staff)).toMatchObject({ kind: 'accidental', acc: 'b' })
  })
})

describe('puntillo', () => {
  it('negra + punto a su derecha = negra con puntillo', () => {
    const y = yFromStep(4, staff)
    expect(recognizeCluster([spiral(60, y, 6, 4.5), line(66, y, 66, y - 32), dot(73, y)], staff)).toMatchObject({
      kind: 'note',
      dur: 'q',
      dot: true,
    })
  })
  it('blanca + punto = blanca con puntillo', () => {
    const y = yFromStep(4, staff)
    expect(recognizeCluster([ellipse(60, y, 7, 5), line(67, y, 67, y - 32), dot(74, y)], staff)).toMatchObject({
      kind: 'note',
      dur: 'h',
      dot: true,
    })
  })
  it('un punto encima de la nota (staccato) no es puntillo', () => {
    const y = yFromStep(4, staff)
    const r = recognizeCluster([spiral(60, y, 6, 4.5), line(66, y, 66, y - 32), dot(59, y + 10)], staff)
    expect(r).toMatchObject({ kind: 'note', dur: 'q' })
    expect((r as { dot?: boolean }).dot).toBeFalsy()
  })
  it('un punto solo (escrito después) se reconoce como puntillo suelto', () => {
    expect(recognizeCluster([dot(80, 125)], staff)).toMatchObject({ kind: 'dot' })
  })
  it('el puntillo no se separa como una nota más al escribir el compás seguido', () => {
    const y = yFromStep(4, staff)
    const groups = splitByHeads([spiral(60, y, 6, 4.5), line(66, y, 66, y - 32), dot(73, y), spiral(95, y, 6, 4.5), line(101, y, 101, y - 32)])
    expect(groups).toHaveLength(2)
  })
})
