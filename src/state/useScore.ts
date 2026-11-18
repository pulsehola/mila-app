import { useCallback, useEffect, useRef, useState } from 'react'
import type { Annotation, Measure, Score } from '../types'
import { emptyScore } from './examples'
import { MEASURE_UNITS, measureUnits } from './music'

const KEY = 'mila:v1'
const MAX_MEASURES = 64
const HISTORY_LIMIT = 100

export function normalizeScore(raw: unknown): Score | null {
  if (!raw || typeof raw !== 'object') return null
  const s = raw as Partial<Score>
  if (!Array.isArray(s.measures) || s.measures.length === 0) return null
  const okNote = (n: unknown) =>
    !!n &&
    typeof n === 'object' &&
    typeof (n as { id?: unknown }).id === 'string' &&
    ['w', 'h', 'q', '8'].includes((n as { dur: string }).dur) &&
    ['note', 'rest'].includes((n as { kind: string }).kind)
  const measures = s.measures.slice(0, MAX_MEASURES).map((m) => (Array.isArray(m) ? m.filter(okNote) : []))
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
  return {
    annotations,
    title: typeof s.title === 'string' ? s.title : 'Sin título',
    bpm: typeof s.bpm === 'number' ? Math.max(30, Math.min(240, Math.round(s.bpm))) : 96,
    transposition: s.transposition === 'C' ? 'C' : 'Bb',
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

/** Añade un compás vacío al final si el último ya está completo. */
function withTrailingMeasure(measures: Measure[]): Measure[] {
  const last = measures[measures.length - 1]
  if (last && measureUnits(last) >= MEASURE_UNITS && measures.length < MAX_MEASURES) {
    return [...measures, []]
  }
  return measures
}

/** Instantánea del historial: deshacer cubre notas y anotaciones. */
interface Snap {
  measures: Measure[]
  annotations: Annotation[]
}

export interface ScoreApi {
  score: Score
  canUndo: boolean
  canRedo: boolean
  /** Reemplaza los compases. `record=false` aplica un cambio transitorio (p.ej. arrastre) sin historial. */
  setMeasures: (fn: (m: Measure[]) => Measure[], record?: boolean) => void
  setAnnotations: (fn: (a: Annotation[]) => Annotation[], record?: boolean) => void
  patch: (p: Partial<Pick<Score, 'bpm' | 'transposition' | 'title'>>) => void
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

  const snap = (): Snap => ({ measures: scoreRef.current.measures, annotations: scoreRef.current.annotations ?? [] })
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

  const setMeasures = useCallback((fn: (m: Measure[]) => Measure[], record = true) => {
    const prev = scoreRef.current.measures
    const next = withTrailingMeasure(fn(prev))
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

  const patch = useCallback((p: Partial<Pick<Score, 'bpm' | 'transposition' | 'title'>>) => {
    setScore((s) => ({ ...s, ...p }))
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
    replace,
    open,
    undo,
    redo,
    addMeasure,
    removeLastMeasure,
    clear,
    clearAll,
  }
}
