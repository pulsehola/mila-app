import type { Duration, Stroke } from '../types'
import { bbox, straightness } from './geometry'
import { userTemplates } from './profile'
import { type Recognized, recognizeCluster, STAFF_GAP, type StaffCtx, stepFromY } from './recognize'
import { matchTemplates, type SymbolLabel, type Template } from './templates'

/**
 * Reconocimiento adaptado a la letra de quien escribe: las reglas geométricas de `recognizeCluster` más las
 * muestras del test de escritura (plantillas $P). Si una muestra propia encaja con claridad, gana; si no,
 * mandan las reglas (que además dan mejor la posición de la cabeza).
 */

const TPL_ACCEPT = 0.6
const TPL_OVERRIDE = 0.68
const TPL_MARGIN = 0.03

export function labelOf(r: Recognized): SymbolLabel | null {
  if (r.kind === 'note') return `note:${r.dur}` as SymbolLabel
  if (r.kind === 'rest') return r.dur === 'w' || r.dur === 'h' ? 'rest:bar' : (`rest:${r.dur}` as SymbolLabel)
  if (r.kind === 'accidental') return `acc:${r.acc}` as SymbolLabel
  return null
}

/** Cabeza probable: el trazo más "enroscado"; si no lo hay, el extremo con más tinta. */
function findHead(strokes: Stroke[]): { x: number; y: number } {
  let best: Stroke | null = null
  let bestS = Infinity
  for (const s of strokes) {
    const b = bbox(s)
    if (b.w > 40 || b.h > 40) continue
    const st = s.length < 3 ? 0 : straightness(s)
    if (st < bestS) {
      bestS = st
      best = s
    }
  }
  if (best && bestS < 0.75) {
    const b = bbox(best)
    return { x: b.cx, y: b.cy }
  }
  const all = strokes.flat()
  const b = bbox(all)
  // Sin plica (forma compacta): la cabeza es el propio símbolo.
  if (b.h < b.w * 1.8) return { x: b.cx, y: b.cy }
  const lower = all.filter((p) => p.y > b.cy).length >= all.length / 2
  return { x: b.cx, y: lower ? b.y1 - Math.min(6, b.h / 4) : b.y0 + Math.min(6, b.h / 4) }
}

function fromLabel(label: SymbolLabel, strokes: Stroke[], staff: StaffCtx, score: number): Recognized {
  const box = bbox(strokes.flat())
  const reason = `tu letra (${Math.round(score * 100)}%)`
  const [kind, v] = label.split(':') as ['note' | 'rest' | 'acc', string]
  if (kind === 'note') {
    const head = findHead(strokes)
    return { kind: 'note', dur: v as Duration, step: stepFromY(head.y, staff), x: head.x, y: head.y, reason }
  }
  if (kind === 'rest') {
    if (v === 'bar') {
      const line2 = staff.yTop + STAFF_GAP
      const line3 = staff.yTop + STAFF_GAP * 2
      const dur: Duration = Math.abs(box.cy - line2) < Math.abs(box.cy - line3) ? 'w' : 'h'
      return { kind: 'rest', dur, x: box.cx, y: box.cy, reason }
    }
    return { kind: 'rest', dur: v as Duration, x: box.cx, y: box.cy, reason }
  }
  return { kind: 'accidental', acc: v as '#' | 'b' | 'n', x: box.cx, y: box.cy, reason }
}

/** Como `recognizeCluster`, pero usando también las muestras de la persona (si hizo el test). */
export function recognizePersonal(strokes: Stroke[], staff: StaffCtx, templates: Template[] = userTemplates()): Recognized {
  const heur = recognizeCluster(strokes, staff)
  if (templates.length === 0 || heur.kind === 'barline') return heur
  const tm = matchTemplates(strokes, templates)
  if (!tm || tm.score < TPL_ACCEPT || tm.margin < TPL_MARGIN) return heur
  if (labelOf(heur) === tm.label) return heur
  // Rellena o hueca lo decide la tinta medida dentro de la cabeza, nunca la plantilla: una plantilla no
  // distingue bien un garabato relleno de un círculo, y así una negra no puede leerse como blanca.
  if (heur.kind === 'note' && tm.label.startsWith('note:')) {
    const hollow = (d: string) => d === 'w' || d === 'h'
    if (hollow(heur.dur) !== hollow(tm.label.slice(5))) return heur
  }
  if (heur.kind === 'unknown' || tm.score >= TPL_OVERRIDE) {
    const r = fromLabel(tm.label, strokes, staff, tm.score)
    // Conserva la alteración que las reglas hubieran separado a la izquierda de la cabeza.
    if (r.kind === 'note' && heur.kind === 'note' && heur.acc) return { ...r, acc: heur.acc }
    return r
  }
  return heur
}
