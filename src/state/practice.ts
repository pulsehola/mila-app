import type { LoopRange, Measure, Meter, Transposition } from '../types'
import {
  concertKey,
  effectiveAccidental,
  measureCapacity,
  meterParts,
  noteUnits,
  roundUnits,
  soundingMidi,
  writtenMidi,
  DEFAULT_METER,
} from './music'

/**
 * Modo práctica: velocidad, línea de tiempo para el cursor y acompañamiento automático.
 * Todo es puro (sin audio ni DOM) para poder probarlo en Node.
 */

// ---- Velocidad ---------------------------------------------------------------

export const MIN_SPEED = 0.4
export const MAX_SPEED = 1
export const SPEED_PRESETS = [0.5, 0.6, 0.75, 0.9, 1] as const

/** Velocidad de práctica entre 40 % y 100 %, redondeada a pasos de 5 %. */
export function clampSpeed(v: unknown): number {
  const n = typeof v === 'number' && Number.isFinite(v) ? v : 1
  return Math.max(MIN_SPEED, Math.min(MAX_SPEED, Math.round(n * 20) / 20))
}

/** Tempo real que suena: el de la partitura por la velocidad de práctica. La afinación no depende de esto. */
export function practiceBpm(bpm: number, speed: number): number {
  return Math.max(12, Math.round(bpm * clampSpeed(speed) * 100) / 100)
}

// ---- Línea de tiempo (para el cursor) ---------------------------------------

export interface MeasureSpan {
  measure: number
  /** Inicio del compás, en semicorcheas desde el principio de lo que suena. */
  start: number
  units: number
  /** Inicio de cada figura (notas y silencios) dentro de lo que suena. */
  notes: { id: string; at: number }[]
}

/**
 * Dónde empieza cada compás y cada figura en el tiempo de reproducción. Usa la misma regla que
 * `buildEvents` (cada compás ocupa al menos su capacidad), así el cursor y el audio coinciden.
 */
export function measureTimeline(
  measures: Measure[],
  range?: LoopRange | null,
  meter: Meter = DEFAULT_METER,
): MeasureSpan[] {
  const capacity = measureCapacity(meter)
  const first = range ? Math.max(0, range.start) : 0
  const last = range ? Math.min(measures.length - 1, range.end) : measures.length - 1
  const out: MeasureSpan[] = []
  let cursor = 0
  for (let mi = first; mi <= last; mi++) {
    const m = measures[mi] ?? []
    let t = cursor
    const notes = m.map((n) => {
      const at = t
      t += noteUnits(n)
      return { id: n.id, at }
    })
    const units = Math.max(capacity, roundUnits(t - cursor))
    out.push({ measure: mi, start: cursor, units, notes })
    cursor += units
  }
  return out
}

/** Compás que suena en la posición `units` (o null fuera de rango). */
export function spanAt(timeline: MeasureSpan[], units: number): MeasureSpan | null {
  if (timeline.length === 0) return null
  for (const s of timeline) if (units >= s.start && units < s.start + s.units) return s
  const last = timeline[timeline.length - 1]
  return units >= last.start + last.units ? last : timeline[0]
}

// ---- Bucle A–B ---------------------------------------------------------------

/** Ordena A y B (si B queda antes que A, se intercambian). */
export function orderedRange(a: number, b: number): LoopRange {
  return a <= b ? { start: a, end: b } : { start: b, end: a }
}

// ---- Acompañamiento ----------------------------------------------------------

export interface AccompEvent {
  startUnits: number
  durUnits: number
  /** MIDI de concierto (lo que suena). */
  midis: number[]
  measure: number
  /** Nombre del acorde en altura real, p. ej. "Fa", "Rem". */
  chord: string
}

const PC_NAME = ['Do', 'Do♯', 'Re', 'Mi♭', 'Mi', 'Fa', 'Fa♯', 'Sol', 'La♭', 'La', 'Si♭', 'Si']
/** Grados I ii iii IV V vi: intervalo de la fundamental, si es menor y preferencia de partida. */
const DEGREES = [
  { off: 0, minor: false, prior: 0.3 },
  { off: 2, minor: true, prior: 0.08 },
  { off: 4, minor: true, prior: 0 },
  { off: 5, minor: false, prior: 0.2 },
  { off: 7, minor: false, prior: 0.25 },
  { off: 9, minor: true, prior: 0.1 },
]

export interface Chord {
  root: number // clase de altura 0..11
  minor: boolean
}

export function chordPcs(c: Chord): number[] {
  return [c.root, (c.root + (c.minor ? 3 : 4)) % 12, (c.root + 7) % 12]
}

export function chordName(c: Chord): string {
  return PC_NAME[c.root] + (c.minor ? 'm' : '')
}

/** Tónica (clase de altura) de la tonalidad mayor con `fifths` alteraciones. */
export function tonicPc(fifths: number): number {
  return (((fifths * 7) % 12) + 12) % 12
}

interface MelodyNote {
  start: number
  dur: number
  midi: number
}

/**
 * Elige el acorde diatónico (I ii iii IV V vi) que mejor encaja con las notas de la melodía en un tramo:
 * cuenta cuánto tiempo suenan notas del acorde, penaliza las que no lo son y premia la nota del tiempo fuerte.
 * Si no hay melodía, se mantiene el acorde anterior.
 */
export function pickChord(notes: MelodyNote[], from: number, to: number, tonic: number, prev: Chord | null): Chord {
  const sounding = notes.filter((n) => n.start < to && n.start + n.dur > from)
  if (sounding.length === 0) return prev ?? { root: tonic, minor: false }
  let best: Chord = { root: tonic, minor: false }
  let bestScore = -Infinity
  for (const d of DEGREES) {
    const c: Chord = { root: (tonic + d.off) % 12, minor: d.minor }
    const pcs = chordPcs(c)
    let score = d.prior
    for (const n of sounding) {
      const overlap = Math.min(to, n.start + n.dur) - Math.max(from, n.start)
      const inChord = pcs.includes(((n.midi % 12) + 12) % 12)
      score += (overlap / (to - from)) * (inChord ? 1 : -0.35)
      if (inChord && n.start <= from + 0.001 && n.start + n.dur > from) score += 0.4
    }
    if (prev && prev.root === c.root && prev.minor === c.minor) score += 0.12
    if (score > bestScore + 1e-9) {
      bestScore = score
      best = c
    }
  }
  return best
}

/** Bajo entre Mi2 y Re♯3; acorde cerrado entre Sol3 y Fa♯4 (por debajo de la trompeta). */
export function voiceChord(c: Chord): { bass: number; chord: number[] } {
  const bass = 40 + ((c.root - 4 + 12) % 12)
  const chord = chordPcs(c)
    .map((pc) => 55 + ((pc - 7 + 12) % 12))
    .sort((a, b) => a - b)
  return { bass, chord }
}

/**
 * Acompañamiento automático: un acorde por tramo (medio compás en 4/4 y 6/8; el compás entero en 2/4 y 3/4)
 * tocado como «bajo + acorde»: el bajo en el primer pulso del tramo y el acorde en los demás pulsos.
 * Las alturas son de concierto, así que se calculan con la armadura y la transposición reales.
 */
export function buildAccompaniment(
  measures: Measure[],
  transposition: Transposition,
  range?: LoopRange | null,
  meter: Meter = DEFAULT_METER,
  key = 0,
): AccompEvent[] {
  const timeline = measureTimeline(measures, range, meter)
  const melody: MelodyNote[] = []
  for (const span of timeline) {
    const m = measures[span.measure] ?? []
    m.forEach((n, i) => {
      if (n.kind !== 'note') return
      const midi = soundingMidi(writtenMidi(n.step, effectiveAccidental(m, i, key)), transposition)
      melody.push({ start: span.notes[i].at, dur: noteUnits(n), midi })
    })
  }
  // Sin ninguna nota no hay nada que acompañar.
  if (melody.length === 0) return []

  const tonic = tonicPc(concertKey(key, transposition))
  const { beats, beatType } = meterParts(meter)
  const beat = beatType === 8 ? 2 : 4 // pulso de la rejilla, en semicorcheas
  const beatsPerSpan = meter === '4/4' ? 2 : meter === '6/8' ? 3 : beats
  const spanUnits = beat * beatsPerSpan

  const out: AccompEvent[] = []
  let prev: Chord | null = null
  for (const span of timeline) {
    const end = span.start + span.units
    for (let from = span.start; from < end - 0.001; from += spanUnits) {
      // El último tramo se queda con lo que sobre si el compás es más largo que su métrica.
      const to = from + spanUnits * 2 > end + 0.001 ? end : from + spanUnits
      const chord = pickChord(melody, from, to, tonic, prev)
      prev = chord
      const v = voiceChord(chord)
      const name = chordName(chord)
      out.push({ startUnits: from, durUnits: Math.min(beat, to - from), midis: [v.bass], measure: span.measure, chord: name })
      for (let t = from + beat; t < to - 0.001; t += beat) {
        out.push({ startUnits: t, durUnits: Math.min(beat, to - t), midis: v.chord, measure: span.measure, chord: name })
      }
      if (to >= end) break
    }
  }
  return out
}
