import type { Accidental, Duration, Pt, Stroke } from '../types'
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
/** Trazos separados por menos de esto (ms) se consideran del mismo símbolo si están cerca. */
export const TIME_JOIN_MS = 450

/**
 * Cuánto del interior de una cabeza tiene tinta (0 = hueca, 1 = rellena). Se muestrea el centro de la cabeza
 * (la elipse reducida a la mitad) y se mira si hay trazo cerca: un círculo vacío deja el centro limpio aunque
 * sea pequeño o se haya repasado; una cabeza rellena (garabato, espiral, punto) lo cubre.
 */
/** ¿Hay tinta a menos de `reach` px del punto (x, y)? */
function inkProbe(strokes: Stroke[], reach: number): (x: number, y: number) => boolean {
  const segs: [Pt, Pt][] = []
  for (const s of strokes) {
    if (s.length === 1) segs.push([s[0], s[0]])
    for (let i = 1; i < s.length; i++) segs.push([s[i - 1], s[i]])
  }
  return (x, y) =>
    segs.some(([a, b]) => {
      const dx = b.x - a.x
      const dy = b.y - a.y
      const len2 = dx * dx + dy * dy
      const t = len2 ? Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / len2)) : 0
      return Math.hypot(x - (a.x + t * dx), y - (a.y + t * dy)) <= reach
    })
}

export function headFill(strokes: Stroke[], box: BBox): number {
  const rx = box.w / 2
  const ry = box.h / 2
  if (rx < 3.5 || ry < 3) return 1 // tan pequeña que solo puede ser un punto relleno
  const near = inkProbe(strokes, Math.max(1.6, Math.min(box.w, box.h) * 0.14))
  let inside = 0
  let covered = 0
  const N = 9
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < N; j++) {
      const u = (i / (N - 1)) * 2 - 1
      const v = (j / (N - 1)) * 2 - 1
      if (u * u + v * v > 1) continue
      inside++
      if (near(box.cx + u * rx * 0.5, box.cy + v * ry * 0.5)) covered++
    }
  }
  return inside ? covered / inside : 0
}

/** Umbral de "rellena" para headFill. */
export const FILLED = 0.4

export type Recognized =
  | { kind: 'note'; dur: Duration; step: number; x: number; y: number; acc?: Accidental; dot?: boolean; reason: string }
  /** Punto suelto (puntillo escrito después): se aplica a la nota que tenga a su izquierda. */
  | { kind: 'dot'; x: number; y: number; reason: string }
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
  // Agrupado temporal: dos trazos seguidos en el tiempo (el lápiz apenas se levantó) y cercanos forman parte
  // del mismo símbolo aunque estén algo más separados (p.ej. una plica larga o un corchete abierto).
  for (let i = 1; i < strokes.length; i++) {
    const prev = strokes[i - 1]
    const cur = strokes[i]
    if (!prev.length || !cur.length) continue
    const pause = cur[0].t - prev[prev.length - 1].t
    if (pause >= 0 && pause < TIME_JOIN_MS && boxesNear(boxes[i - 1], boxes[i], gap + 12)) parent[find(i)] = find(i - 1)
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

/** Nota de un solo trazo: bucle (cabeza) que sigue en una plica. */
function isPaddle(f: Feat): boolean {
  if (f.box.h < 24 || f.box.w > 30 || f.box.h / Math.max(f.box.w, 1) < 1.5) return false
  return !!findLoop(f.s)
}

function isStemLike(f: Feat): boolean {
  return f.box.h >= 18 && f.box.h / Math.max(f.box.w, 1) >= 2.4 && f.straight >= 0.82
}

/** Plica a mano algo torcida o corta: más permisiva que isStemLike (solo para buscarla junto a una cabeza). */
function isLooseStem(f: Feat): boolean {
  return f.box.h >= 14 && f.box.h / Math.max(f.box.w, 1) >= 1.6 && f.straight >= 0.7
}

/** Punto pequeño (puntillo, staccato): no es una cabeza aunque sea redondo. */
function isDot(f: Feat): boolean {
  return Math.max(f.box.w, f.box.h) <= 6.5 && f.len <= 20
}

/**
 * Nota de un trazo sin bucle cerrado (cabeza + plica sin levantar el lápiz): separa la "cola" casi vertical
 * de uno de los extremos (la plica) del resto (la cabeza).
 */
export function splitTail(s: Stroke): { head: Stroke; stem: Stroke } | null {
  if (s.length < 8) return null
  const b = bbox(s)
  if (b.h < 22 || b.h / Math.max(b.w, 1) < 1.3) return null
  const runFrom = (pts: Pt[]) => {
    let k = 1
    for (; k < pts.length; k++) {
      const dx = Math.abs(pts[k].x - pts[0].x)
      const dy = Math.abs(pts[k].y - pts[0].y)
      if (dx > dy * 0.3 + 3) break
    }
    return k - 1
  }
  const a = runFrom(s)
  const z = runFrom([...s].reverse())
  const fromStart = Math.abs(s[a].y - s[0].y) >= Math.abs(s[s.length - 1 - z].y - s[s.length - 1].y)
  const stem = fromStart ? s.slice(0, a + 1) : s.slice(s.length - 1 - z)
  const head = fromStart ? s.slice(a) : s.slice(0, s.length - z)
  if (stem.length < 2 || head.length < 3) return null
  const hb = bbox(head)
  if (bbox(stem).h < Math.max(16, b.h * 0.45) || hb.w < 5 || hb.h < 4 || hb.h > b.h * 0.65) return null
  return { head, stem }
}

/**
 * Silencio de redonda / blanca dibujado como bloque (rectángulo relleno, contorno o barra gruesa): ancho, bajo
 * y con las esquinas entintadas (una cabeza elíptica deja las esquinas vacías). La redonda cuelga de la
 * 4ª línea (2ª desde arriba); la blanca se apoya sobre la 3ª (la central).
 */
function blockRest(feats: Feat[], all: BBox, staff: StaffCtx): Recognized | null {
  if (all.w < 8 || all.h > STAFF_GAP * 1.15 || all.w / Math.max(all.h, 1) < 1.6) return null
  if (feats.some((f) => f.box.h >= 14)) return null
  const near = inkProbe(
    feats.map((f) => f.s),
    Math.max(1.8, all.h * 0.22),
  )
  const ix = all.w * 0.18
  const iy = all.h * 0.22
  const cornersInked = [
    [all.x0 + ix, all.y0 + iy],
    [all.x1 - ix, all.y0 + iy],
    [all.x0 + ix, all.y1 - iy],
    [all.x1 - ix, all.y1 - iy],
  ].filter(([x, y]) => near(x, y)).length
  const thinBar = all.h <= 6
  if (!thinBar && cornersInked < 3 && all.w / Math.max(all.h, 1) < 2.2) return null
  const line4 = staff.yTop + STAFF_GAP
  const line3 = staff.yTop + STAFF_GAP * 2
  const dWhole = Math.abs(all.y0 - line4)
  const dHalf = Math.abs(all.y1 - line3)
  if (Math.min(dWhole, dHalf) > 6) return null
  const dur: Duration = dWhole <= dHalf ? 'w' : 'h'
  return {
    kind: 'rest',
    dur,
    x: all.cx,
    y: all.cy,
    reason: dur === 'w' ? 'bloque colgado de la 4ª línea (silencio de redonda)' : 'bloque sobre la 3ª línea (silencio de blanca)',
  }
}

/**
 * Silencio de corchea / semicorchea: trazo oblicuo que baja de arriba-derecha a abajo-izquierda, con uno o
 * dos ganchos (o puntos) a la izquierda de su parte alta. Cada gancho = un corchete: 1 → corchea, 2 → semicorchea.
 */
function flagRest(feats: Feat[], all: BBox): Recognized | null {
  const main = feats.reduce((a, b) => (b.box.h > a.box.h ? b : a))
  const h = main.box.h
  if (h < 14 || h > 48 || main.box.w > h * 1.1) return null
  const s = main.s
  const T = s.reduce((a, p) => (p.x - p.y > a.x - a.y ? p : a)) // extremo arriba-derecha
  const B = s.reduce((a, p) => (p.y > a.y ? p : a)) // extremo inferior
  const span = B.y - T.y
  if (span < h * 0.6 || T.x - B.x < span * 0.18) return null
  const xLine = (y: number) => B.x + ((T.x - B.x) * (B.y - y)) / span
  let hooks = 0
  let inHook = false
  let right = 0
  const thr = Math.max(3, h * 0.12)
  for (const p of s) {
    if (p.y >= T.y) right = Math.max(right, p.x - xLine(p.y))
    if (p.y > B.y - span * 0.3) {
      inHook = false
      continue
    }
    // Salida hacia la izquierda de la diagonal en su parte alta = un gancho.
    const left = (p.y < T.y ? T.x : xLine(p.y)) - p.x
    if (left > thr && !inHook) {
      hooks++
      inHook = true
    } else if (left < thr * 0.4) inHook = false
  }
  // Un zig-zag (silencio de negra) se sale mucho también hacia la derecha.
  if (right > Math.max(4, h * 0.2)) return null
  // Ganchos como trazos aparte (puntos o ganchitos) a la izquierda de la parte alta.
  for (const f of feats) {
    if (f === main) continue
    if (Math.max(f.box.w, f.box.h) > 13) return null
    const yRef = Math.min(Math.max(f.box.cy, T.y), B.y)
    if (f.box.cy > B.y - span * 0.35 || f.box.cx > xLine(yRef) + 2) return null
    hooks++
  }
  if (hooks < 1) return null
  const dur: Duration = hooks >= 2 ? '16' : '8'
  return {
    kind: 'rest',
    dur,
    x: all.cx,
    y: all.cy,
    reason: dur === '16' ? 'diagonal con dos ganchos (silencio de semicorchea)' : 'diagonal con gancho (silencio de corchea)',
  }
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
  if (strokes.length < 2) return [strokes]
  const feats = strokes.map(feat)
  // Cabeza = trazo de cabeza o nota hecha de un solo trazo (cabeza + plica sin levantar el lápiz).
  const heads = feats.filter((f) => (isHeadLike(f) && !isDot(f)) || isPaddle(f) || (f.box.h >= 22 && !!splitTail(f.s)))
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

  // Punto(s) sueltos: puntillo escrito después de la nota.
  if (feats.length <= 2 && feats.every(isDot)) {
    return { kind: 'dot', x: all.cx, y: all.cy, reason: 'punto pequeño (puntillo)' }
  }
  // Figura + punto(s): se reconoce la figura sin los puntos y el punto a su derecha es el puntillo
  // (un punto encima o debajo, como el staccato, no altera la figura).
  const dotFeats = feats.filter(isDot)
  if (dotFeats.length && dotFeats.length < feats.length) {
    const r = recognizeCluster(
      feats.filter((f) => !isDot(f)).map((f) => f.s),
      staff,
    )
    // Solo notas: en un silencio de corchea el "punto" es su gancho (lo resuelve flagRest más abajo).
    if (r.kind === 'note') {
      const dotted = dotFeats.some((f) => f.box.cx > r.x + 3 && f.box.cx - r.x <= 24 && Math.abs(f.box.cy - r.y) <= 9)
      return dotted ? { ...r, dot: true, reason: `${r.reason} + puntillo` } : r
    }
  }

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
      // Antes salía siempre blanca: una negra hecha de un trazo (garabato + plica) también tiene "bucle".
      const filled = headFill([f.s], loop.box) >= FILLED
      return {
        kind: 'note',
        dur: filled ? 'q' : 'h',
        step: stepFromY(cy, staff),
        x: loop.box.cx,
        y: cy,
        reason: filled ? 'cabeza rellena + plica en un trazo (negra)' : 'círculo+plica en un trazo (blanca)',
      }
    }
  }

  // 2) Silencios: bloque (redonda/blanca), diagonal con ganchos (corchea/semicorchea), zig-zag (negra).
  const block = blockRest(feats, all, staff)
  if (block) return block
  const flagged = flagRest(feats, all)
  if (flagged) return flagged
  if (feats.length === 1) {
    const rest = recognizeRest(feats[0], staff)
    if (rest) return rest
  }

  // 2b) Nota de un trazo sin bucle cerrado: cabeza + plica sin levantar el lápiz (la plica cuenta: blanca, no redonda).
  if (feats.length === 1) {
    const parts = splitTail(feats[0].s)
    if (parts) {
      const hb = bbox(parts.head)
      const filled = headFill([parts.head], hb) >= FILLED
      return {
        kind: 'note',
        dur: filled ? 'q' : 'h',
        step: stepFromY(hb.cy, staff),
        x: hb.cx,
        y: hb.cy,
        reason: filled ? 'cabeza rellena + plica en un trazo (negra)' : 'cabeza hueca + plica en un trazo (blanca)',
      }
    }
  }

  // 3) Notas: cabeza (+ plica) (+ corchete).
  const headCandidates = feats.filter((f) => isHeadLike(f) && !isDot(f))
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
    // Relleno por la tinta que hay DENTRO de la cabeza (lo largo del trazo solo ayuda en casos dudosos).
    const fill = headFill([headFeat.s, ...extraHeads.map((f) => f.s)], merged)
    const isFilled = tiny || extraHeads.length > 0 || fill >= FILLED || (ratio >= 2.3 && fill >= 0.22)

    let others = feats.filter((f) => f !== headFeat && !extraHeads.includes(f))
    // Puntillo: punto pequeño a la derecha inmediata de la cabeza, a su altura.
    const dots = others.filter(
      (f) => isDot(f) && f.box.cx > merged.x1 - 1 && f.box.x0 - merged.x1 <= 16 && Math.abs(f.box.cy - merged.cy) <= 8,
    )
    if (dots.length) others = others.filter((f) => !dots.includes(f))
    const dotPart = dots.length ? { dot: true } : {}
    // Alteración escrita a la izquierda de la cabeza (sin tocarla).
    const leftStrokes = others.filter((f) => f.box.x1 < merged.x0 - 2 && f.box.cy > merged.cy - 30 && f.box.cy < merged.cy + 30)
    const acc = leftStrokes.length ? recognizeAccidental(leftStrokes.map((f) => f.s)) : null
    if (acc) others = others.filter((f) => !leftStrokes.includes(f))
    const accPart = acc ? { acc } : {}
    // Plica: el trazo vertical más alto pegado a la cabeza (se admite algo torcido: sin ella sería redonda).
    const stem = others
      .filter(
        (f) =>
          (isStemLike(f) || isLooseStem(f)) &&
          f.box.cx >= merged.x0 - 14 &&
          f.box.cx <= merged.x1 + 14 &&
          f.box.y0 <= merged.y1 + 14 &&
          f.box.y1 >= merged.y0 - 14,
      )
      .sort((a, b) => b.box.h - a.box.h)[0]
    const cy = merged.cy
    const base = { x: merged.cx, y: cy, step: stepFromY(cy, staff), ...accPart, ...dotPart }

    // ♭ en dos trazos: palo alto a la IZQUIERDA de una panza pequeña y hueca que cierra abajo
    // (en una blanca con plica hacia arriba la plica va a la derecha de la cabeza).
    if (
      stem &&
      fill < FILLED &&
      !dots.length &&
      merged.w <= 16 &&
      stem.box.cx <= merged.x0 + merged.w * 0.3 &&
      stem.box.y0 < merged.y0 - merged.h &&
      Math.abs(stem.box.y1 - merged.y1) <= 6 &&
      others.length === 1
    ) {
      return { kind: 'accidental', acc: 'b', x: all.cx, y: all.cy, reason: 'palo a la izquierda + panza abajo (♭)' }
    }

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
    const flags = others.filter(
      (f) =>
        f !== stem &&
        !isHeadLike(f) &&
        f.box.w >= 4 &&
        (dist({ x: f.box.cx, y: f.box.cy }, free) <= 24 || (f.box.h >= 3 && boxesNear(f.box, stem.box, 8))),
    )
    // Dos corchetes (o uno solo con dos "olas" seguidas) = semicorchea.
    const doubleInOne = flags.length === 1 && reversals(flags[0].s, 'x', 3) >= 3 && flags[0].box.h >= 12
    if (isFilled && (flags.length >= 2 || doubleInOne)) {
      return { kind: 'note', dur: '16', ...base, reason: 'cabeza rellena + plica + 2 corchetes (semicorchea)' }
    }
    if (isFilled && flags.length === 1) {
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

/**
 * Barras de unión (corcheas/semicorcheas unidas): trazos casi rectos y poco inclinados que tocan el extremo
 * de 2 o más plicas. Devuelve las barras encontradas y, por cada plica, cuántas barras la cruzan
 * (1 = corchea, 2 o más = semicorchea).
 */
export function detectBeams(strokes: Stroke[]): { beams: Set<Stroke>; count: Map<Stroke, number> } {
  const feats = strokes.map(feat)
  const stems = feats.filter(isStemLike)
  const beams = new Set<Stroke>()
  const count = new Map<Stroke, number>()
  if (stems.length < 2) return { beams, count }
  for (const f of feats) {
    if (stems.includes(f)) continue
    const { w, h } = f.box
    if (w < 16 || f.straight < 0.9 || h > w * 0.6) continue
    const a = f.s[0]
    const b = f.s[f.s.length - 1]
    const [left, right] = a.x <= b.x ? [a, b] : [b, a]
    const yAt = (x: number) => left.y + ((right.y - left.y) * (x - left.x)) / Math.max(1, right.x - left.x)
    const touched = stems.filter((st) => {
      const x = st.box.cx
      if (x < f.box.x0 - 6 || x > f.box.x1 + 6) return false
      const y = yAt(x)
      // La barra va en el extremo libre de la plica (o un poco más adentro si es la 2ª barra).
      const nearTop = y >= st.box.y0 - 8 && y <= st.box.y0 + 14
      const nearBottom = y <= st.box.y1 + 8 && y >= st.box.y1 - 14
      return nearTop || nearBottom
    })
    if (touched.length < 2) continue
    beams.add(f.s)
    for (const st of touched) count.set(st.s, (count.get(st.s) ?? 0) + 1)
  }
  return { beams, count }
}

/**
 * Ligadura (de expresión o de prolongación): un arco suave y ancho, poco alto, con los extremos a una altura
 * parecida y la panza separada de la recta que los une. Devuelve sus extremos para buscar las dos notas.
 */
export function slurEnds(s: Stroke): { x0: number; y0: number; x1: number; y1: number } | null {
  if (s.length < 6) return null
  const f = feat(s)
  const { w, h } = f.box
  if (w < 24 || h < 3 || h > w * 0.45) return null
  if (f.straight < 0.6 || f.straight > 0.985) return null
  if (reversals(s, 'x', 4) > 0) return null // un arco no vuelve atrás en horizontal
  const a = s[0]
  const b = s[s.length - 1]
  if (Math.abs(a.y - b.y) > w * 0.35) return null
  // "Panza": distancia máxima de la curva a la recta entre extremos.
  const len = Math.hypot(b.x - a.x, b.y - a.y) || 1
  let sag = 0
  for (const p of s) sag = Math.max(sag, Math.abs((b.x - a.x) * (a.y - p.y) - (a.x - p.x) * (b.y - a.y)) / len)
  if (sag < 3 || sag > w * 0.5) return null
  const [l, r] = a.x <= b.x ? [a, b] : [b, a]
  return { x0: l.x, y0: l.y, x1: r.x, y1: r.y }
}
