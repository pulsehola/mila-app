import { useCallback, useEffect, useRef, useState } from 'react'
import type { Measure, Score } from '../types'
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
  return {
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

export interface ScoreApi {
  score: Score
  canUndo: boolean
  canRedo: boolean
  /** Reemplaza los compases. `record=false` aplica un cambio transitorio (p.ej. arrastre) sin historial. */
  setMeasures: (fn: (m: Measure[]) => Measure[], record?: boolean) => void
  patch: (p: Partial<Pick<Score, 'bpm' | 'transposition' | 'title'>>) => void
  replace: (s: Score) => void
  undo: () => void
  redo: () => void
  addMeasure: () => void
  removeLastMeasure: () => void
  clear: () => void
}

export function useScore(): ScoreApi {
  const [score, setScore] = useState<Score>(load)
  const undoRef = useRef<Measure[][]>([])
  const redoRef = useRef<Measure[][]>([])
  const [, force] = useState(0)
  const scoreRef = useRef(score)
  scoreRef.current = score

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
    if (record) {
      undoRef.current.push(prev)
      if (undoRef.current.length > HISTORY_LIMIT) undoRef.current.shift()
      redoRef.current = []
    }
    setScore((s) => ({ ...s, measures: next }))
    force((n) => n + 1)
  }, [])

  const patch = useCallback((p: Partial<Pick<Score, 'bpm' | 'transposition' | 'title'>>) => {
    setScore((s) => ({ ...s, ...p }))
  }, [])

  const replace = useCallback((s: Score) => {
    undoRef.current.push(scoreRef.current.measures)
    redoRef.current = []
    setScore(s)
    force((n) => n + 1)
  }, [])

  const undo = useCallback(() => {
    const prev = undoRef.current.pop()
    if (!prev) return
    redoRef.current.push(scoreRef.current.measures)
    setScore((s) => ({ ...s, measures: prev }))
    force((n) => n + 1)
  }, [])

  const redo = useCallback(() => {
    const next = redoRef.current.pop()
    if (!next) return
    undoRef.current.push(scoreRef.current.measures)
    setScore((s) => ({ ...s, measures: next }))
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

  return {
    score,
    canUndo: undoRef.current.length > 0,
    canRedo: redoRef.current.length > 0,
    setMeasures,
    patch,
    replace,
    undo,
    redo,
    addMeasure,
    removeLastMeasure,
    clear,
  }
}
