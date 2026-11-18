import type { Accidental, Duration, Stroke } from '../types'
import {
  type BBox,
  bbox,
  boxesNear,
  corners,
  dist,
  findLoop,
  pathLength,
  reversals,
  straightness,
  unionBox,
} from './geometry'
import { clampStep } from '../state/music'

/** Geometría del pentagrama sobre el que se escribió (líneas superior e inferior). */
export interface StaffCtx {
  yTop: number
  yBottom: number
}

export const STAFF_GAP = 10

export type Recognized =
  | { kind: 'note'; dur: Duration; step: number; x: number; y: number; acc?: Accidental; reason: string }
  | { kind: 'rest'; dur: Duration; x: number; y: number; reason: string }
  /** Barra de compás dibujada a mano: se acepta sin hacer nada (los compases ya existen). */
  | { kind: 'barline'; x: number; reason: string }
  /** Alteración suelta (♯ ♭ ♮): se aplica a la nota que tenga a su derecha. */
  | { kind: 'accidental'; acc: Exclude<Accidental, ''>; x: number; y: number; reason: string }
  | { kind: 'unknown'; reason: string }

/** Paso diatónico (Do4 = 0) para una coordenada y. La línea inferior es Mi4 (paso 2). */
export function stepFromY(y: number, staff: StaffCtx): number {
  return clampStep(Math.round((staff.yBottom - y) / (STAFF_GAP / 2)) + 2)
}
export function yFromStep(step: number, staff: StaffCtx): number {
  return staff.yBottom - (step - 2) * (STAFF_GAP / 2)
}

/** Agrupa trazos cercanos (cabeza + plica + corchete = un símbolo). */
export function clusterStrokes(strokes: Stroke[], gap = 22): Stroke[][] {
  const boxes = strokes.map((s) => bbox(s))
  const parent = strokes.map((_, i) => i)
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])))
  for (let i = 0; i < strokes.length; i++) {
    for (let j = i + 1; j < strokes.length; j++) {
      if (boxesNear(boxes[i], boxes[j], gap)) parent[find(i)] = find(j)
    }
  }
  const groups = new Map<number, Stroke[]>()
  strokes.forEach((s, i) => {
    const r = find(i)
    if (!groups.has(r)) groups.set(r, [])
    groups.get(r)!.push(s)
  })
  return [...groups.values()].sort((a, b) => bbox(a.flat()).cx - bbox(b.flat()).cx)
}

/** Tachado en zig-zag: ≥3 cambios de dirección sobre el eje dominante y trazo largo respecto a su caja. */
export function isScratchOut(stroke: Stroke): boolean {
  if (stroke.length < 6) return false
  const b = bbox(stroke)
  const axis = b.w >= b.h ? 'x' : 'y'
  const extent = Math.max(b.w, b.h)
  if (extent < 16) return false
  const rev = reversals(stroke, axis, Math.max(4, extent * 0.12))
  return rev >= 3 && pathLength(stroke) >= extent * 2.4
}

interface Feat {
  s: Stroke
  box: BBox
  len: number
  straight: number
}
const feat = (s: Stroke): Feat => ({ s, box: bbox(s), len: pathLength(s), straight: straightness(s) })

function isStemLike(f: Feat): boolean {
  return f.box.h >= 18 && f.box.h / Math.max(f.box.w, 1) >= 2.4 && f.straight >= 0.82
}

/** Cabeza = trazo compacto y aproximadamente redondo (círculo vacío o garabato relleno). */
function isHeadLike(f: Feat): boolean {
  const { w, h } = f.box
  if (w < 5 || h < 4) return false
  if (w > 36 || h > 36) return false
  const aspect = w / h
  if (aspect < 0.55 || aspect > 2.2) return false
  // Una cabeza vuelve sobre sí misma (círculo o garabato); un trazo casi recto es plica o corchete.
  return f.straight < 0.7 || f.len < 9
}

/**
 * Al escribir un compás entero los trazos quedan muy juntos y el agrupado por cercanía puede unir varias
 * notas. Aquí se separa: una cabeza = una nota; cada trazo restante (plica, corchete, alteración) va con la
 * cabeza más cercana en horizontal.
 */
export function splitByHeads(strokes: Stroke[]): Stroke[][] {
  if (strokes.length < 3) return [strokes]
  const feats = strokes.map(feat)
  const heads = feats.filter(isHeadLike)
  // Cabezas que se solapan (garabato de relleno en varios trazos) cuentan como una.
  const groups: { box: BBox; members: Feat[] }[] = []
  for (const hd of heads) {
    const g = groups.find((gg) => boxesNear(gg.box, hd.box, 3))
    if (g) {
      g.members.push(hd)
      g.box = unionBox([g.box, hd.box])
    } else groups.push({ box: hd.box, members: [hd] })
  }
  if (groups.length <= 1) return [strokes]
  const hDist = (b: BBox, g: BBox) => Math.max(0, g.x0 - b.x1, b.x0 - g.x1)
  for (const f of feats) {
    if (heads.includes(f)) continue
    let best = groups[0]
    let bestD = Infinity
    for (const g of groups) {
      const d = hDist(f.box, g.box) * 4 + Math.abs(f.box.cx - g.box.cx) * 0.01 + Math.abs(f.box.cy - g.box.cy) * 0.05
      if (d < bestD) {
        bestD = d
        best = g
      }
    }
    best.members.push(f)
  }
  return groups.sort((a, b) => a.box.cx - b.box.cx).map((g) => g.members.map((m) => m.s))
}

/**
 * Alteraciones escritas a mano:
 *  ♯ = dos trazos verticales + al menos uno horizontal/inclinado;  ♭ = trazo alto que se cierra en un bucle abajo;
 *  ♮ = trazos alto(s) con esquinas (forma de "L" + "L" invertida o un trazo en zig-zag de 2+ esquinas).
 */
export function recognizeAccidental(strokes: Stroke[]): Exclude<Accidental, ''> | null {
  if (!strokes.length || strokes.length > 5) return null
  const feats = strokes.map(feat)
  const box = unionBox(feats.map((f) => f.box))
  if (box.h < 12 || box.h > 50 || box.w > 32 || box.w < 3) return null
  const vertical = feats.filter((f) => f.box.h >= 1.8 * Math.max(f.box.w, 1) && f.straight >= 0.85 && f.box.h >= 0.5 * box.h)
  const horizontal = feats.filter((f) => f.box.w >= 1.2 * Math.max(f.box.h, 1) && f.straight >= 0.8)
  if (feats.length >= 3 && vertical.length >= 2 && horizontal.length >= 1) return '#'
  // ♭: un trazo (o plica + curva) con bucle en la mitad inferior.
  for (const f of feats) {
    const loop = findLoop(f.s)
    if (loop && f.box.h >= 1.4 * f.box.w && loop.box.cy > f.box.y0 + f.box.h * 0.5) return 'b'
  }
  if (feats.length === 2 && vertical.length === 1) {
    const other = feats.find((f) => f !== vertical[0])!
    if (other.straight < 0.8 && other.box.cy > vertical[0].box.cy && other.box.cx >= vertical[0].box.cx) return 'b'
  }
  // ♮: esquinas, alto y estrecho, sin bucle.
  const cornersTotal = feats.reduce((n, f) => n + corners(f.s, 60), 0)
  if (feats.length <= 2 && cornersTotal >= 2 && box.h >= 1.5 * box.w && !feats.some((f) => findLoop(f.s))) return 'n'
  return null
}

export function recognizeCluster(strokes: Stroke[], staff: StaffCtx): Recognized {
  if (strokes.length === 0) return { kind: 'unknown', reason: 'vacío' }
  const feats = strokes.map(feat)
  const all = unionBox(feats.map((f) => f.box))

  // 0) Barra de compás: un trazo recto y vertical que cruza casi todo el pentagrama.
  if (feats.length === 1) {
    const f = feats[0]
    const span = staff.yBottom - staff.yTop
    if (f.straight >= 0.9 && f.box.w <= 10 && f.box.h >= span * 0.8 && f.box.y0 <= staff.yTop + span * 0.25 && f.box.y1 >= staff.yBottom - span * 0.25) {
      return { kind: 'barline', x: f.box.cx, reason: 'trazo vertical que cruza el pentagrama' }
    }
  }

  // 1) Un solo trazo "paleta": círculo + plica continuada (blanca / negra dibujada de una vez).
  if (feats.length === 1) {
    const f = feats[0]
    const loop = findLoop(f.s)
    // ♭: el palo sube por la IZQUIERDA de un bucle que queda abajo (una blanca con plica arriba la lleva a la derecha).
    if (loop && loop.box.cy > f.box.y0 + f.box.h * 0.5) {
      const top = f.s.reduce((a, b) => (b.y < a.y ? b : a))
      if (top.x <= loop.box.cx - loop.box.w * 0.2 && f.box.w <= 22) {
        return { kind: 'accidental', acc: 'b', x: f.box.cx, y: f.box.cy, reason: 'palo a la izquierda + bucle abajo (♭)' }
      }
    }
    if (loop && f.box.h / Math.max(f.box.w, 1) >= 1.5 && f.box.h >= 24 && f.box.w <= 30) {
      const cy = loop.box.cy
      return {
        kind: 'note',
        dur: 'h',
        step: stepFromY(cy, staff),
        x: loop.box.cx,
        y: cy,
        reason: 'círculo+plica en un trazo',
      }
    }
  }

  // 2) Silencios (un solo trazo, forma característica).
  if (feats.length === 1) {
    const rest = recognizeRest(feats[0], staff)
    if (rest) return rest
  }

  // 3) Notas: cabeza (+ plica) (+ corchete).
  const headCandidates = feats.filter(isHeadLike)
  if (headCandidates.length > 0) {
    // Cabeza = el candidato de mayor caja (si hay dos círculos solapados cuentan como una).
    const headFeat = headCandidates.reduce((a, b) => (b.box.w * b.box.h > a.box.w * a.box.h ? b : a))
    const headBox = headFeat.box
    const extraHeads = headCandidates.filter((f) => f !== headFeat && boxesNear(f.box, headBox, 4))
    const merged = unionBox([headBox, ...extraHeads.map((f) => f.box)])
    const mergedLen = headFeat.len + extraHeads.reduce((s, f) => s + f.len, 0)
    const d = (merged.w + merged.h) / 2
    const ratio = mergedLen / (Math.PI * Math.max(d, 1))
    const tiny = merged.w < 10 && merged.h < 10
    const isFilled = tiny || ratio >= 2.3 || extraHeads.length > 0

    let others = feats.filter((f) => f !== headFeat && !extraHeads.includes(f))
    // Alteración escrita a la izquierda de la cabeza (sin tocarla).
    const leftStrokes = others.filter((f) => f.box.x1 < merged.x0 - 2 && f.box.cy > merged.cy - 30 && f.box.cy < merged.cy + 30)
    const acc = leftStrokes.length ? recognizeAccidental(leftStrokes.map((f) => f.s)) : null
    if (acc) others = others.filter((f) => !leftStrokes.includes(f))
    const accPart = acc ? { acc } : {}
    const stem = others.find(
      (f) =>
        isStemLike(f) &&
        f.box.cx >= merged.x0 - 14 &&
        f.box.cx <= merged.x1 + 14 &&
        f.box.y0 <= merged.y1 + 14 &&
        f.box.y1 >= merged.y0 - 14,
    )
    const cy = merged.cy
    const base = { x: merged.cx, y: cy, step: stepFromY(cy, staff), ...accPart }

    if (!stem) {
      // Atajo de escritura rápida: círculo vacío = redonda, punto/garabato relleno = negra.
      return isFilled
        ? { kind: 'note', dur: 'q', ...base, reason: 'cabeza rellena sin plica (negra)' }
        : { kind: 'note', dur: 'w', ...base, reason: 'círculo vacío (redonda)' }
    }

    // ¿Dónde está el extremo libre de la plica? Lejos de la cabeza.
    const stemTop = { x: stem.box.cx, y: stem.box.y0 }
    const stemBottom = { x: stem.box.cx, y: stem.box.y1 }
    const free = dist(stemTop, { x: merged.cx, y: merged.cy }) > dist(stemBottom, { x: merged.cx, y: merged.cy }) ? stemTop : stemBottom
    const flag = others.find(
      (f) => f !== stem && !isHeadLike(f) && dist({ x: f.box.cx, y: f.box.cy }, free) <= 20 && f.box.w >= 4,
    )
    const flagAlt = others.find(
      (f) => f !== stem && isHeadLike(f) === false && f.box.h >= 3 && boxesNear(f.box, stem.box, 8),
    )
    if (isFilled && (flag || flagAlt)) {
      return { kind: 'note', dur: '8', ...base, reason: 'cabeza rellena + plica + corchete (corchea)' }
    }
    return isFilled
      ? { kind: 'note', dur: 'q', ...base, reason: 'cabeza rellena + plica (negra)' }
      : { kind: 'note', dur: 'h', ...base, reason: 'cabeza vacía + plica (blanca)' }
  }

  // 4) Alteración suelta (escrita aparte de su nota).
  const lone = recognizeAccidental(strokes)
  if (lone) return { kind: 'accidental', acc: lone, x: all.cx, y: all.cy, reason: `alteración ${lone}` }

  // 5) Varios trazos que forman un silencio (p.ej. silencio de corchea con punto).
  if (feats.length >= 2) {
    const biggest = feats.reduce((a, b) => (b.len > a.len ? b : a))
    const r = recognizeRest(biggest, staff)
    if (r) return r
  }

  return { kind: 'unknown', reason: `sin forma reconocible (${all.w.toFixed(0)}×${all.h.toFixed(0)})` }
}

function recognizeRest(f: Feat, staff: StaffCtx): Recognized | null {
  const { w, h, cx, cy } = f.box
  // Barra horizontal: silencio de redonda (cuelga de la 4ª línea) o de blanca (sobre la 3ª).
  if (w >= 12 && h <= 9 && w / Math.max(h, 1) >= 2.2 && f.len <= w * 5) {
    const line2 = staff.yTop + STAFF_GAP // 2ª línea desde arriba
    const line3 = staff.yTop + STAFF_GAP * 2 // línea central
    const dur: Duration = Math.abs(cy - line2) < Math.abs(cy - line3) ? 'w' : 'h'
    return { kind: 'rest', dur, x: cx, y: cy, reason: dur === 'w' ? 'barra bajo 2ª línea' : 'barra sobre línea central' }
  }
  if (h >= 14 && isHeadLike(f) === false && f.straight < 0.9) {
    const c = corners(f.s, 55)
    const rev = reversals(f.s, 'x', 3)
    if (h / Math.max(w, 1) >= 1.6 && h >= 20 && (c >= 2 || rev >= 2) && f.straight < 0.8) {
      return { kind: 'rest', dur: 'q', x: cx, y: cy, reason: 'zig-zag vertical (silencio de negra)' }
    }
    if (c >= 1 && h <= 34 && h / Math.max(w, 1) >= 0.9) {
      return { kind: 'rest', dur: '8', x: cx, y: cy, reason: 'forma de 7 (silencio de corchea)' }
    }
  }
  return null
}
