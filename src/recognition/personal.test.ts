import { describe, expect, it } from 'vitest'
import type { Pt, Stroke } from '../types'
import { recognizePersonal } from './personal'
import { recognizeCluster, type StaffCtx, yFromStep } from './recognize'
import { makeTemplate, matchTemplates, type Template } from './templates'

const staff: StaffCtx = { yTop: 100, yBottom: 140 }
let t = 0
const pt = (x: number, y: number): Pt => ({ x, y, p: 0.5, t: (t += 8) })
const line = (x0: number, y0: number, x1: number, y1: number, n = 14): Stroke =>
  Array.from({ length: n + 1 }, (_, i) => pt(x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * i) / n))
const ellipse = (cx: number, cy: number, rx: number, ry: number): Stroke =>
  Array.from({ length: 45 }, (_, i) => {
    const a = (i / 40) * Math.PI * 2
    return pt(cx + Math.cos(a) * rx, cy + Math.sin(a) * ry)
  })
const scribble = (cx: number, cy: number, rx: number, ry: number): Stroke =>
  Array.from({ length: 14 }, (_, i) => pt(cx + (i % 2 ? rx : -rx), cy - ry + (i / 13) * ry * 2))
const sharp = (cx: number, cy: number): Stroke[] => [
  line(cx - 3, cy - 14, cx - 3, cy + 14),
  line(cx + 3, cy - 16, cx + 3, cy + 12),
  line(cx - 7, cy - 3, cx + 7, cy - 6),
  line(cx - 7, cy + 5, cx + 7, cy + 2),
]
/** Una «x»: forma que las reglas no entienden como nota. */
const cross = (cx: number, cy: number, s = 9): Stroke[] => [line(cx - s, cy - s, cx + s, cy + s), line(cx + s, cy - s, cx - s, cy + s)]

describe('plantillas ($P)', () => {
  it('reconoce la misma forma sin importar el orden de los trazos', () => {
    const tpl: Template[] = [makeTemplate('note:w', [ellipse(0, 0, 10, 7)])!, makeTemplate('acc:#', sharp(0, 0))!]
    expect(matchTemplates([ellipse(50, 60, 11, 7.5)], tpl)?.label).toBe('note:w')
    expect(matchTemplates(sharp(200, 80).reverse(), tpl)?.label).toBe('acc:#')
  })
})

describe('reconocimiento personal', () => {
  it('sin test hecho se comporta igual que las reglas', () => {
    const y = yFromStep(6, staff)
    const g = [scribble(60, y, 6, 4), line(66, y, 66, y - 34)]
    expect(recognizePersonal(g, staff, [])).toEqual(recognizeCluster(g, staff))
  })

  it('aprende una forma propia: quien escribe la negra como una «x»', () => {
    const y = yFromStep(6, staff)
    expect(recognizeCluster(cross(60, y), staff).kind).not.toBe('note')
    const tpl = [makeTemplate('note:q', cross(0, 0))!, makeTemplate('note:w', [ellipse(0, 0, 10, 7)])!]
    expect(recognizePersonal(cross(80, y, 8), staff, tpl)).toMatchObject({ kind: 'note', dur: 'q', step: 6 })
  })

  it('semicorchea: cabeza rellena + plica + dos corchetes', () => {
    const y = yFromStep(4, staff)
    const g = [scribble(60, y, 6, 4), line(66, y, 66, y - 34), line(66, y - 34, 76, y - 24, 6), line(66, y - 26, 76, y - 16, 6)]
    expect(recognizeCluster(g, staff)).toMatchObject({ kind: 'note', dur: '16' })
  })
})
