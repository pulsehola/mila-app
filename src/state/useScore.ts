import { useCallback, useEffect, useRef, useState } from 'react'
import type { Annotation, Background, Measure, Note, Score } from '../types'
import { emptyScore } from './examples'
import { clampKey, isDynamic, isMeter, measureCapacity, measureUnits, newId } from './music'
import { useOnHide } from './pwa'

const KEY = 'mila:v1'
const MAX_MEASURES = 64
const HISTORY_LIMIT = 100

const clampNum = (v: unknown, lo: number, hi: number, dflt: number) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : dflt

/** Valida el fondo escaneado; sin imagen o con datos rotos se descarta. */
export function normalizeBackground(raw: unknown): Background | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const b = raw as Partial<Background>
  if (typeof b.imageId !== 'string' || !b.imageId) return undefined
  if (!(typeof b.naturalW === 'number' && b.naturalW > 0 && typeof b.naturalH === 'number' && b.naturalH > 0)) return undefined
  return {
    imageId: b.imageId,
    naturalW: b.naturalW,
    naturalH: b.naturalH,
    layoutWidth: clampNum(b.layoutWidth, 320, 2400, 900),
    rowH: clampNum(b.rowH, 90, 320, 160),
    perRow: Math.round(clampNum(b.perRow, 1, 6, 4)),
    ...(Array.isArray(b.rowWidths) &&
    b.rowWidths.length <= 64 &&
    b.rowWidths.every((r) => Array.isArray(r) && r.length >= 1 && r.length <= 12 && r.every((v) => typeof v === 'number' && v > 0 && v < 3000))
      ? { rowWidths: b.rowWidths }
      : {}),
    x: clampNum(b.x, -4000, 4000, 0),
    y: clampNum(b.y, -4000, 8000, 0),
    scale: clampNum(b.scale, 0.2, 4, 1),
    rotation: clampNum(b.rotation, -20, 20, 0),
    opacity: clampNum(b.opacity, 0.05, 1, 0.6),
    enhance: b.enhance !== false,
  }
}

export function normalizeScore(raw: unknown): Score | null {
  if (!raw || typeof raw !== 'object') return null
  const s = raw as Partial<Score>
  if (!Array.isArray(s.measures) || s.measures.length === 0) return null
  const okNote = (n: unknown) =>
    !!n &&
    typeof n === 'object' &&
    typeof (n as { id?: unknown }).id === 'string' &&
    ['w', 'h', 'q', '8', '16'].includes((n as { dur: string }).dur) &&
    ['note', 'rest'].includes((n as { kind: string }).kind)
  // Un matiz desconocido se descarta (la nota se conserva).
  const cleanNote = (n: Note): Note => {
    if (n.dyn === undefined || isDynamic(n.dyn)) return n
    const { dyn: _drop, ...rest } = n
    void _drop
    return rest
  }
  const measures = s.measures.slice(0, MAX_MEASURES).map((m) => (Array.isArray(m) ? m.filter(okNote).map(cleanNote) : []))
  const okAnnot = (a: unknown): a is Annotation =>
    !!a &&
    typeof a === 'object' &&
    typeof (a as Annotation).id === 'string' &&
    Number.isInteger((a as Annotation).measure) &&
    (a as Annotation).measure >= 0 &&
    (a as Annotation).measure < measures.length &&
    [(a as Annotation).ax, (a as Annotation).ay, (a as Annotation).w0].every((v) => typeof v === 'number' && Number.isFinite(v)) &&
    Array.isArray((a as Annotation).strokes)
  const annotations = Array.isArray(s.annotations) ? s.annotations.filter(okAnnot) : []
  const background = normalizeBackground(s.background)
  return {
    ...(background ? { background } : {}),
    annotations,
    title: typeof s.title === 'string' ? s.title : 'Sin título',
    bpm: typeof s.bpm === 'number' ? Math.max(30, Math.min(240, Math.round(s.bpm))) : 96,
    transposition: s.transposition === 'C' ? 'C' : 'Bb',
    ...(isMeter(s.meter) && s.meter !== '4/4' ? { meter: s.meter } : {}),
    ...(s.clef === 'bass' ? { clef: 'bass' as const } : {}),
    ...(clampKey(s.key) !== 0 ? { key: clampKey(s.key) } : {}),
    ...(s.sound === 'piano' ? { sound: 'piano' as const } : {}),
    measures: measures as Measure[],
  }
}

function load(): Score {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) {
      const s = normalizeScore(JSON.parse(raw))
      if (s) return s
    }
  } catch {
    /* almacenamiento no disponible o corrupto */
  }
  return emptyScore()
}

/** Añade un compás vacío al final si el último ya está completo (según la métrica). */
function withTrailingMeasure(measures: Measure[], capacity: number): Measure[] {
  const last = measures[measures.length - 1]
  if (last && measureUnits(last) >= capacity && measures.length < MAX_MEASURES) {
    return [...measures, []]
  }
  return measures
}

/** Instantánea del historial: deshacer cubre notas y anotaciones. */
interface Snap {
  measures: Measure[]
  annotations: Annotation[]
  background?: Background
}

export interface ScoreApi {
  score: Score
  canUndo: boolean
  canRedo: boolean
  /** Reemplaza los compases. `record=false` aplica un cambio transitorio (p.ej. arrastre) sin historial. */
  setMeasures: (fn: (m: Measure[]) => Measure[], record?: boolean) => void
  setAnnotations: (fn: (a: Annotation[]) => Annotation[], record?: boolean) => void
  patch: (p: Partial<Pick<Score, 'bpm' | 'transposition' | 'title' | 'meter' | 'clef' | 'key' | 'sound'>>) => void
  /**
   * Pega una copia de `measure` justo después del compás `after`: si el siguiente está vacío lo rellena; si no,
   * inserta un compás nuevo (las anotaciones de los compases siguientes se desplazan con ellos).
   */
  pasteMeasure: (after: number, measure: Measure) => { index: number; firstId: string | null } | null
  /** Fondo escaneado. `record` = guardar en deshacer (poner/quitar sí; mover un deslizador no). */
  setBackground: (bg: Background | undefined, record?: boolean) => void
  replace: (s: Score) => void
  /** Abre otra partitura (de la galería): empieza con historial de deshacer limpio. */
  open: (s: Score) => void
  undo: () => void
  redo: () => void
  addMeasure: () => void
  removeLastMeasure: () => void
  clear: () => void
  clearAll: () => void
}

export function useScore(): ScoreApi {
  const [score, setScore] = useState<Score>(load)
  const undoRef = useRef<Snap[]>([])
  const redoRef = useRef<Snap[]>([])
  const [, force] = useState(0)
  const scoreRef = useRef(score)
  scoreRef.current = score

  const snap = (): Snap => ({
    measures: scoreRef.current.measures,
    annotations: scoreRef.current.annotations ?? [],
    background: scoreRef.current.background,
  })
  const push = (s: Snap) => {
    undoRef.current.push(s)
    if (undoRef.current.length > HISTORY_LIMIT) undoRef.current.shift()
    redoRef.current = []
  }

  // Autoguardado con debounce.
  useEffect(() => {
    const id = window.setTimeout(() => {
      try {
        localStorage.setItem(KEY, JSON.stringify(score))
      } catch {
        /* cuota o modo privado */
      }
    }, 250)
    return () => window.clearTimeout(id)
  }, [score])

  // Al cerrar MILA o cambiar de app: se guarda ya, sin esperar al retraso del autoguardado.
  useOnHide(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(scoreRef.current))
    } catch {
      /* cuota o modo privado */
    }
  })

  const setMeasures = useCallback((fn: (m: Measure[]) => Measure[], record = true) => {
    const prev = scoreRef.current.measures
    const next = withTrailingMeasure(fn(prev), measureCapacity(scoreRef.current.meter))
    if (next === prev) return
    if (record) push(snap())
    // Las anotaciones de compases que desaparecen se descartan.
    const ann = scoreRef.current.annotations ?? []
    const keep = ann.every((a) => a.measure < next.length) ? ann : ann.filter((a) => a.measure < next.length)
    scoreRef.current = { ...scoreRef.current, measures: next, annotations: keep }
    setScore((s) => ({ ...s, measures: next, annotations: keep }))
    force((n) => n + 1)
  }, [])

  const setAnnotations = useCallback((fn: (a: Annotation[]) => Annotation[], record = true) => {
    const prev = scoreRef.current.annotations ?? []
    const next = fn(prev)
    if (next === prev) return
    if (record) push(snap())
    scoreRef.current = { ...scoreRef.current, annotations: next }
    setScore((s) => ({ ...s, annotations: next }))
    force((n) => n + 1)
  }, [])

  const setBackground = useCallback((bg: Background | undefined, record = false) => {
    if (record) push(snap())
    const next = { ...scoreRef.current, background: bg }
    if (!bg) delete next.background
    scoreRef.current = next
    setScore(next)
    force((n) => n + 1)
  }, [])

  const patch = useCallback((p: Partial<Pick<Score, 'bpm' | 'transposition' | 'title' | 'meter' | 'clef' | 'key' | 'sound'>>) => {
    scoreRef.current = { ...scoreRef.current, ...p }
    setScore((s) => ({ ...s, ...p }))
  }, [])

  const pasteMeasure = useCallback((after: number, measure: Measure): { index: number; firstId: string | null } | null => {
    const cur = scoreRef.current
    const target = after + 1
    // Copia con ids nuevos (también los de tresillos) para no chocar con el original.
    const tupletIds = new Map<string, string>()
    const copy: Measure = measure.map((n) => ({
      ...n,
      id: newId(),
      ...(n.tuplet ? { tuplet: { ...n.tuplet, id: tupletIds.get(n.tuplet.id) ?? (tupletIds.set(n.tuplet.id, newId()), tupletIds.get(n.tuplet.id)!) } } : {}),
    }))
    const fill = target < cur.measures.length && cur.measures[target].length === 0
    if (!fill && cur.measures.length >= MAX_MEASURES) return null
    push(snap())
    const measures = fill
      ? cur.measures.map((m, i) => (i === target ? copy : m))
      : [...cur.measures.slice(0, target), copy, ...cur.measures.slice(target)]
    const annotations = fill
      ? (cur.annotations ?? [])
      : (cur.annotations ?? []).map((a) => (a.measure >= target ? { ...a, measure: a.measure + 1 } : a))
    const next = { ...cur, measures: withTrailingMeasure(measures, measureCapacity(cur.meter)), annotations }
    scoreRef.current = next
    setScore(next)
    force((n) => n + 1)
    return { index: target, firstId: copy[0]?.id ?? null }
  }, [])

  const replace = useCallback((s: Score) => {
    push(snap())
    scoreRef.current = s
    setScore(s)
    force((n) => n + 1)
  }, [])

  const open = useCallback((s: Score) => {
    undoRef.current = []
    redoRef.current = []
    scoreRef.current = s
    setScore(s)
    force((n) => n + 1)
  }, [])

  const undo = useCallback(() => {
    const prev = undoRef.current.pop()
    if (!prev) return
    redoRef.current.push(snap())
    scoreRef.current = { ...scoreRef.current, ...prev }
    setScore((s) => ({ ...s, ...prev }))
    force((n) => n + 1)
  }, [])

  const redo = useCallback(() => {
    const next = redoRef.current.pop()
    if (!next) return
    undoRef.current.push(snap())
    scoreRef.current = { ...scoreRef.current, ...next }
    setScore((s) => ({ ...s, ...next }))
    force((n) => n + 1)
  }, [])

  const addMeasure = useCallback(() => {
    setMeasures((m) => (m.length >= MAX_MEASURES ? m : [...m, []]))
  }, [setMeasures])

  const removeLastMeasure = useCallback(() => {
    setMeasures((m) => (m.length <= 1 ? m : m.slice(0, -1)))
  }, [setMeasures])

  const clear = useCallback(() => {
    setMeasures((m) => m.map(() => []))
  }, [setMeasures])

  /** Borra toda la partitura (notas, anotaciones y compases extra). Se puede deshacer. */
  const clearAll = useCallback(() => {
    const cur = scoreRef.current
    if (cur.measures.every((m) => m.length === 0) && !(cur.annotations ?? []).length && cur.measures.length <= 4) return
    push(snap())
    const next = { ...cur, measures: [[], [], [], []] as Measure[], annotations: [] }
    scoreRef.current = next
    setScore(next)
    force((n) => n + 1)
  }, [])

  return {
    score,
    canUndo: undoRef.current.length > 0,
    canRedo: redoRef.current.length > 0,
    setMeasures,
    setAnnotations,
    patch,
    setBackground,
    replace,
    open,
    undo,
    redo,
    addMeasure,
    removeLastMeasure,
    pasteMeasure,
    clear,
    clearAll,
  }
}
