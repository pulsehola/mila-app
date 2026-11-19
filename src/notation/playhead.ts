import type { MeasureSpan } from '../state/practice'
import { spanAt } from '../state/practice'
import type { Layout } from './renderScore'

export interface PlayheadPos {
  x: number
  row: number
  measure: number
}

/**
 * Posición del cursor continuo para un instante de la música (en semicorcheas desde el inicio de lo que suena).
 * Dentro de cada compás se interpola entre puntos de anclaje: inicio del compás, cabeza de cada figura en el
 * momento en que empieza y final del compás. Así el cursor pasa por cada nota justo cuando suena, aunque las
 * notas no estén espaciadas en proporción a su duración.
 */
export function playheadAt(timeline: MeasureSpan[], layout: Layout, units: number): PlayheadPos | null {
  const span = spanAt(timeline, units)
  if (!span) return null
  const box = layout.measures.find((m) => m.index === span.measure)
  if (!box) return null
  const anchors: { u: number; x: number }[] = [{ u: span.start, x: box.noteStartX }]
  for (const n of span.notes) {
    const hit = layout.notes.find((h) => h.id === n.id)
    if (!hit) continue
    const last = anchors[anchors.length - 1]
    if (n.at <= last.u + 1e-6) last.x = hit.x // la figura empieza con el compás: el cursor arranca en ella
    else anchors.push({ u: n.at, x: hit.x })
  }
  anchors.push({ u: span.start + span.units, x: box.noteEndX })
  const u = Math.max(span.start, Math.min(span.start + span.units, units))
  for (let i = 0; i < anchors.length - 1; i++) {
    const a = anchors[i]
    const b = anchors[i + 1]
    if (u <= b.u) {
      const f = b.u > a.u ? (u - a.u) / (b.u - a.u) : 0
      return { x: a.x + (b.x - a.x) * f, row: box.row, measure: span.measure }
    }
  }
  return { x: box.noteEndX, row: box.row, measure: span.measure }
}
