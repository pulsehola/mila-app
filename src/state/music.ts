import type { Accidental, Duration, Measure, Meter, Note, Transposition, TupletKind } from '../types'

/** Unidades de semicorchea por compás 4/4. */
export const MEASURE_UNITS = 16

export const METERS: Meter[] = ['2/4', '3/4', '4/4', '6/8']
export const DEFAULT_METER: Meter = '4/4'

export function isMeter(v: unknown): v is Meter {
  return typeof v === 'string' && (METERS as string[]).includes(v)
}

/** Capacidad de un compás en semicorcheas: 2/4 = 8, 3/4 = 12, 4/4 = 16, 6/8 = 12. */
export function measureCapacity(meter: Meter = DEFAULT_METER): number {
  const [n, d] = meter.split('/').map(Number)
  return (n * 16) / d
}

/** Numerador y denominador de la métrica. */
export function meterParts(meter: Meter = DEFAULT_METER): { beats: number; beatType: number } {
  const [beats, beatType] = meter.split('/').map(Number)
  return { beats, beatType }
}
export const MIN_STEP = -4 // La3
export const MAX_STEP = 15 // Re6

export const DUR_UNITS: Record<Duration, number> = { w: 16, h: 8, q: 4, '8': 2, '16': 1 }
export const DUR_LABEL: Record<Duration, string> = {
  w: 'Redonda',
  h: 'Blanca',
  q: 'Negra',
  '8': 'Corchea',
  '16': 'Semicorchea',
}

export const LETTERS = ['c', 'd', 'e', 'f', 'g', 'a', 'b'] as const
const SEMITONES = [0, 2, 4, 5, 7, 9, 11]

let counter = 0
export function newId(): string {
  counter += 1
  return `n${Date.now().toString(36)}${counter.toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`
}

export function clampStep(step: number): number {
  return Math.max(MIN_STEP, Math.min(MAX_STEP, step))
}

export function letterOf(step: number): (typeof LETTERS)[number] {
  return LETTERS[((step % 7) + 7) % 7]
}
export function octaveOf(step: number): number {
  return 4 + Math.floor(step / 7)
}

/** Clave VexFlow: "c/4", "f/5"... */
export function vexKey(step: number): string {
  return `${letterOf(step)}/${octaveOf(step)}`
}

export function makeNote(partial: Partial<Note> & Pick<Note, 'dur'>): Note {
  return {
    id: newId(),
    kind: 'note',
    step: 4,
    acc: '',
    staccato: false,
    accent: false,
    slur: false,
    ...partial,
  }
}

export function makeRest(dur: Duration): Note {
  return makeNote({ dur, kind: 'rest', step: 6 })
}

/** Cuántas figuras "normales" ocupa un grupo especial: tresillo 3 en 2; quintillo y seisillo en 4. */
export const TUPLET_NORMAL: Record<TupletKind, number> = { 3: 2, 5: 4, 6: 4 }
export const TUPLET_LABEL: Record<TupletKind, string> = { 3: 'Tresillo', 5: 'Quintillo', 6: 'Seisillo' }

/** Redondeo para que 3 corcheas de tresillo (4/3 + 4/3 + 4/3) sumen exactamente 4. */
export const roundUnits = (u: number) => Math.round(u * 1000) / 1000

/** Duración real de una nota en semicorcheas (con puntillo y grupo especial; puede ser fraccionaria). */
export function noteUnits(n: Pick<Note, 'dur' | 'dot' | 'tuplet'>): number {
  let u = DUR_UNITS[n.dur] * (n.dot ? 1.5 : 1)
  if (n.tuplet) u = (u * TUPLET_NORMAL[n.tuplet.n]) / n.tuplet.n
  return u
}

export function measureUnits(m: Measure): number {
  return roundUnits(m.reduce((sum, n) => sum + noteUnits(n), 0))
}

export interface MeasureStatus {
  units: number
  diff: number // unidades de semicorchea (negativo = faltan)
  state: 'empty' | 'ok' | 'short' | 'long'
}

export function measureStatus(m: Measure, meter: Meter = DEFAULT_METER): MeasureStatus {
  const units = measureUnits(m)
  const diff = roundUnits(units - measureCapacity(meter))
  if (m.length === 0) return { units, diff, state: 'empty' }
  if (diff === 0) return { units, diff, state: 'ok' }
  return { units, diff, state: diff < 0 ? 'short' : 'long' }
}

/** Texto en tiempos: "falta 1 tiempo", "sobra ½ tiempo" (en 6/8 el tiempo es la corchea). */
export function describeDiff(diff: number, meter: Meter = DEFAULT_METER): string {
  const beats = Math.abs(diff) / (meterParts(meter).beatType === 8 ? 2 : 4)
  const whole = Math.floor(beats)
  const frac = beats - whole
  let txt = ''
  if (whole > 0) txt += String(whole)
  if (frac >= 0.5) txt += (whole > 0 ? ' ' : '') + '½'
  else if (frac > 0) txt += (whole > 0 ? ' ' : '') + '¼'
  const plural = beats > 1 ? 'tiempos' : 'tiempo'
  return `${diff < 0 ? 'falta' : 'sobra'} ${txt} ${plural}`
}

/**
 * Alteración efectiva de la nota `index` dentro de su compás:
 * una alteración escrita afecta a las notas siguientes del mismo paso hasta el final del compás.
 */
export function effectiveAccidental(m: Measure, index: number): Accidental {
  const n = m[index]
  if (!n || n.kind === 'rest') return ''
  if (n.acc) return n.acc
  for (let i = index - 1; i >= 0; i--) {
    const p = m[i]
    if (p.kind === 'note' && p.step === n.step && p.acc) return p.acc
  }
  return ''
}

export function accidentalOffset(acc: Accidental): number {
  return acc === '#' ? 1 : acc === 'b' ? -1 : 0
}

/** MIDI escrito (la altura que ve el trompetista en la partitura). */
export function writtenMidi(step: number, acc: Accidental): number {
  const octave = octaveOf(step)
  const sem = SEMITONES[((step % 7) + 7) % 7]
  return 12 * (octave + 1) + sem + accidentalOffset(acc)
}

/** La trompeta en Sib suena una segunda mayor más grave que lo escrito. */
export function transposeOffset(t: Transposition): number {
  return t === 'Bb' ? -2 : 0
}

export function soundingMidi(written: number, t: Transposition): number {
  return written + transposeOffset(t)
}

export function midiToFreq(midi: number, a4 = 440): number {
  return a4 * Math.pow(2, (midi - 69) / 12)
}

const NAMES_SHARP = ['Do', 'Do#', 'Re', 'Re#', 'Mi', 'Fa', 'Fa#', 'Sol', 'Sol#', 'La', 'La#', 'Si']
export function midiName(midi: number): string {
  return NAMES_SHARP[((midi % 12) + 12) % 12]
}
export function midiOctave(midi: number): number {
  return Math.floor(midi / 12) - 1
}

export interface PlayEvent {
  noteId: string
  measure: number
  index: number
  startUnits: number
  durUnits: number
  /** MIDI sonoro ya transpuesto; null para silencios. */
  midi: number | null
  staccato: boolean
  accent: boolean
  slurToNext: boolean
}

/** Convierte la partitura en eventos de reproducción (cada compás ocupa al menos su capacidad según la métrica). */
export function buildEvents(
  measures: Measure[],
  transposition: Transposition,
  range?: { start: number; end: number } | null,
  meter: Meter = DEFAULT_METER,
): { events: PlayEvent[]; totalUnits: number } {
  const capacity = measureCapacity(meter)
  const first = range ? Math.max(0, range.start) : 0
  const last = range ? Math.min(measures.length - 1, range.end) : measures.length - 1
  const events: PlayEvent[] = []
  let cursor = 0
  for (let mi = first; mi <= last; mi++) {
    const m = measures[mi]
    let t = cursor
    m.forEach((n, index) => {
      const dur = noteUnits(n)
      if (n.kind === 'note') {
        const acc = effectiveAccidental(m, index)
        events.push({
          noteId: n.id,
          measure: mi,
          index,
          startUnits: t,
          durUnits: dur,
          midi: soundingMidi(writtenMidi(n.step, acc), transposition),
          staccato: n.staccato,
          accent: n.accent,
          slurToNext: n.slur && index < m.length - 1 && m[index + 1].kind === 'note',
        })
      }
      t += dur
    })
    // Cada compás ocupa al menos un compás completo para que el cursor y el metrónomo no se desfasen.
    cursor += Math.max(capacity, roundUnits(t - cursor))
  }
  return { events, totalUnits: cursor }
}
