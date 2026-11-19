import type { Measure } from '../types'
import { effectiveAccidental, writtenMidi } from './music'

/**
 * Datos de la trompeta de 3 pistones. Todo va por altura ESCRITA: la digitación de una nota escrita es la
 * misma en trompeta en Sib y en Do.
 */

/** Nota escrita más grave de la trompeta (Fa#3) y límite de lo habitual por arriba (Do6). */
export const TRUMPET_LOW = 54
export const TRUMPET_HIGH = 84

export interface Fingering {
  /** Pistones pulsados: "0" (al aire), "1", "12", "123"… */
  valves: string
  /** Digitaciones alternativas habituales. */
  alt?: string[]
  /** Consejo de afinación. */
  hint?: string
}

// Tabla estándar por MIDI escrito, de Fa#3 a Do6.
const TABLE: Record<number, Fingering> = {
  54: { valves: '123', hint: 'Saca la bomba del 3º para que no quede alta' },
  55: { valves: '13' },
  56: { valves: '23' },
  57: { valves: '12' },
  58: { valves: '1' },
  59: { valves: '2' },
  60: { valves: '0' },
  61: { valves: '123', hint: 'Saca la bomba del 3º para que no quede alta' },
  62: { valves: '13', hint: 'Saca un poco la bomba del 3º' },
  63: { valves: '23' },
  64: { valves: '12', alt: ['3'] },
  65: { valves: '1' },
  66: { valves: '2' },
  67: { valves: '0' },
  68: { valves: '23' },
  69: { valves: '12', alt: ['3'] },
  70: { valves: '1' },
  71: { valves: '2' },
  72: { valves: '0' },
  73: { valves: '12' },
  74: { valves: '1', alt: ['13'] },
  75: { valves: '2', alt: ['23'] },
  76: { valves: '0', alt: ['12'] },
  77: { valves: '1' },
  78: { valves: '2' },
  79: { valves: '0' },
  80: { valves: '23', alt: ['3'] },
  81: { valves: '12', alt: ['3'] },
  82: { valves: '1' },
  83: { valves: '2' },
  84: { valves: '0' },
}

export function fingeringFor(written: number): Fingering | null {
  return TABLE[written] ?? null
}

/** "0", "1 2", "1 2 3": como se escribe encima de la nota. */
export function valvesText(v: string): string {
  return v === '0' ? '0' : v.split('').join(' ')
}

export type RangeState = 'ok' | 'low' | 'high'

export function rangeState(written: number): RangeState {
  if (written < TRUMPET_LOW) return 'low'
  if (written > TRUMPET_HIGH) return 'high'
  return 'ok'
}

export const RANGE_TEXT: Record<Exclude<RangeState, 'ok'>, string> = {
  low: 'Más grave que el Fa#3: la trompeta no llega',
  high: 'Más aguda que el Do6: registro muy exigente',
}

/** Altura escrita (MIDI) de cada nota de la partitura, con armadura y alteraciones del compás. */
export function writtenPitches(measures: Measure[], key: number): Map<string, number> {
  const out = new Map<string, number>()
  measures.forEach((m) =>
    m.forEach((n, i) => {
      if (n.kind === 'note') out.set(n.id, writtenMidi(n.step, effectiveAccidental(m, i, key)))
    }),
  )
  return out
}
