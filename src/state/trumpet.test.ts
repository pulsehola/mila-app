import { describe, expect, it } from 'vitest'
import type { Measure, Score } from '../types'
import { effectiveAccidental, makeNote, makeRest, writtenMidi } from './music'
import { intervalFor, semitoneLabel, transposeMeasures, transposedCopy } from './transpose'
import { fingeringFor, rangeState, writtenPitches } from './trumpet'

const pitches = (ms: Measure[], key: number) =>
  ms.flatMap((m) => m.map((n, i) => (n.kind === 'note' ? writtenMidi(n.step, effectiveAccidental(m, i, key)) : null)))
const names = (ms: Measure[], key: number) =>
  ms.flatMap((m) =>
    m.map((n, i) => (n.kind === 'note' ? `${'CDEFGAB'[((n.step % 7) + 7) % 7]}${effectiveAccidental(m, i, key) || ''}` : 'r')),
  )

// Do4 Re4 Mi4 Fa#4 | silencio Sol4
const melody: Measure[] = [
  [makeNote({ dur: 'q', step: 0 }), makeNote({ dur: 'q', step: 1 }), makeNote({ dur: 'q', step: 2 }), makeNote({ dur: 'q', step: 3, acc: '#' })],
  [makeRest('q'), makeNote({ dur: 'q', step: 4 })],
]

describe('transportar', () => {
  it('cada nota sube exactamente los semitonos pedidos (todas las distancias)', () => {
    const base = pitches(melody, 0)
    for (let s = -14; s <= 14; s++) {
      const t = transposeMeasures(melody, 0, s)
      expect(pitches(t.measures, t.key)).toEqual(base.map((p) => (p === null ? null : p + s)))
    }
  })
  it('elige la armadura más sencilla y escribe bien las notas', () => {
    const up = transposeMeasures(melody, 0, 2) // Do → Re mayor
    expect(up.key).toBe(2)
    expect(names(up.measures, up.key)).toEqual(['D', 'E', 'F#', 'G#', 'r', 'A'])
    expect(up.measures[0][2].acc).toBe('') // el Fa# lo da la armadura: no se escribe
    expect(up.measures[0][3].acc).toBe('#') // Sol# sí
    const down = transposeMeasures(melody, 0, -2) // Do → Sib mayor
    expect(down.key).toBe(-2)
    // Fa# baja a Mi natural: en Sib mayor (con Mib) necesita becuadro.
    expect(names(down.measures, down.key)).toEqual(['Bb', 'C', 'D', 'En', 'r', 'F'])
    expect(down.measures[0][3].acc).toBe('n')
    expect(intervalFor(1, 0).key).toBe(-5) // Re♭ mayor, no Do♯ mayor
  })
  it('una trompeta en Sib en Re mayor suena en Do mayor', () => {
    expect(transposeMeasures(melody, 2, -2).key).toBe(0)
  })
  it('la copia no toca el original y no lleva la foto escaneada', () => {
    const score: Score = { title: 'Orig', bpm: 90, transposition: 'Bb', measures: melody, key: 0 }
    const before = JSON.stringify(score)
    const copy = transposedCopy(score, 5, 'Orig (+5 st)')
    expect(JSON.stringify(score)).toBe(before)
    expect(copy.measures[0][0].id).not.toBe(melody[0][0].id)
    expect(copy.key).toBe(-1) // Fa mayor
    expect(copy.background).toBeUndefined()
  })
  it('describe el intervalo', () => {
    expect(semitoneLabel(2)).toBe('+2 semitonos (2ª mayor arriba)')
    expect(semitoneLabel(-12)).toBe('−12 semitonos (1 octava abajo)')
  })
})

describe('trompeta', () => {
  it('digitaciones de la tabla estándar (por nota escrita)', () => {
    expect(fingeringFor(60)?.valves).toBe('0') // Do4
    expect(fingeringFor(62)?.valves).toBe('13') // Re4
    expect(fingeringFor(54)?.valves).toBe('123') // Fa#3
    expect(fingeringFor(69)?.alt).toEqual(['3']) // La4: 12 o 3
    expect(fingeringFor(53)).toBeNull() // fuera de registro
  })
  it('avisa fuera de registro', () => {
    expect(rangeState(53)).toBe('low')
    expect(rangeState(54)).toBe('ok')
    expect(rangeState(84)).toBe('ok')
    expect(rangeState(85)).toBe('high')
  })
  it('la altura escrita tiene en cuenta la armadura', () => {
    const m: Measure[] = [[makeNote({ dur: 'q', step: 3 })]] // Fa4
    const id = m[0][0].id
    expect(writtenPitches(m, 0).get(id)).toBe(65)
    expect(writtenPitches(m, 1).get(id)).toBe(66) // Sol mayor: Fa#
  })
})
