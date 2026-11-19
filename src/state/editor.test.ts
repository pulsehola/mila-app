import { describe, expect, it } from 'vitest'
import type { Measure, Score } from '../types'
import {
  buildEvents,
  clampStep,
  concertKey,
  effectiveAccidental,
  keyAccidental,
  keyCount,
  keyLabel,
  makeNote,
  writtenMidi,
} from './music'
import { normalizeScore } from './useScore'
import { scoreToMusicXML } from '../export/musicxml'

// Pasos: C4 = 0, D4 = 1, E4 = 2, F4 = 3, G4 = 4, A4 = 5, B4 = 6, C5 = 7
const F4 = 3
const B4 = 6
const C5 = 7

describe('armaduras', () => {
  it('nombres y número de alteraciones', () => {
    expect(keyLabel(0)).toBe('Do mayor')
    expect(keyLabel(2)).toBe('Re mayor')
    expect(keyLabel(-2)).toBe('Si♭ mayor')
    expect(keyCount(2)).toBe('2 sostenidos')
    expect(keyCount(-1)).toBe('1 bemol')
  })
  it('la armadura altera las notas sin alteración propia', () => {
    expect(keyAccidental(F4, 2)).toBe('#') // Re mayor: Fa# y Do#
    expect(keyAccidental(C5, 2)).toBe('#')
    expect(keyAccidental(4, 2)).toBe('') // Sol natural
    expect(keyAccidental(B4, -1)).toBe('b') // Fa mayor: Sib
    expect(keyAccidental(B4 - 7 - 7, -1)).toBe('b') // en cualquier octava
  })
  it('el becuadro anula la armadura hasta el final del compás', () => {
    const m: Measure = [
      makeNote({ dur: 'q', step: F4 }),
      makeNote({ dur: 'q', step: F4, acc: 'n' }),
      makeNote({ dur: 'q', step: F4 }),
    ]
    expect(effectiveAccidental(m, 0, 2)).toBe('#')
    expect(effectiveAccidental(m, 1, 2)).toBe('n')
    expect(effectiveAccidental(m, 2, 2)).toBe('n')
    expect(writtenMidi(F4, effectiveAccidental(m, 0, 2))).toBe(66) // Fa#4
  })
  it('en Sib la armadura escrita suena 2 quintas más abajo (escrito ≠ real)', () => {
    expect(concertKey(2, 'Bb')).toBe(0) // Re mayor escrito = Do mayor real
    expect(concertKey(0, 'Bb')).toBe(-2) // Do escrito = Sib real
    expect(concertKey(2, 'C')).toBe(2)
    expect(concertKey(-6, 'Bb')).toBe(4) // Solb → Mi (enarmónica más sencilla)
  })
  it('la reproducción aplica armadura y transposición', () => {
    const m: Measure = [makeNote({ dur: 'q', step: F4 })]
    const { events } = buildEvents([m], 'Bb', null, '4/4', 2)
    expect(events[0].midi).toBe(66 - 2) // Fa#4 escrito suena Mi4
  })
})

describe('dinámicas', () => {
  it('el matiz se mantiene hasta el siguiente y el acento suma', () => {
    const ms: Measure[] = [
      [makeNote({ dur: 'q', step: 0 }), { ...makeNote({ dur: 'q', step: 1 }), dyn: 'pp' }, makeNote({ dur: 'q', step: 2 })],
      [{ ...makeNote({ dur: 'q', step: 3 }), dyn: 'ff' }, { ...makeNote({ dur: 'q', step: 4 }), accent: true }],
    ]
    const v = buildEvents(ms, 'C').events.map((e) => e.velocity)
    expect(v[0]).toBeCloseTo(0.72) // sin matiz: mf
    expect(v[1]).toBeLessThan(0.4)
    expect(v[2]).toBe(v[1]) // sigue en pp
    expect(v[3]).toBe(1)
    expect(v[4]).toBe(1) // ff + acento, con tope
    // Un fragmento (bucle) que empieza en el compás 2 hereda el matiz anterior.
    const loop = buildEvents(ms, 'C', { start: 1, end: 1 }).events
    expect(loop[0].velocity).toBe(1)
  })
})

describe('clave de Fa', () => {
  it('el rango del pentagrama baja 12 pasos', () => {
    expect(clampStep(-30)).toBe(-4)
    expect(clampStep(-30, 'bass')).toBe(-16)
    expect(clampStep(10, 'bass')).toBe(3)
  })
})

describe('partitura guardada', () => {
  it('conserva clave, armadura, sonido y matices; descarta valores raros', () => {
    const s = normalizeScore({
      title: 'x',
      bpm: 90,
      transposition: 'Bb',
      clef: 'bass',
      key: 3,
      sound: 'piano',
      measures: [[{ ...makeNote({ dur: 'q', step: 0 }), dyn: 'mf' }, { ...makeNote({ dur: 'q', step: 1 }), dyn: 'zz' }]],
    })!
    expect(s.clef).toBe('bass')
    expect(s.key).toBe(3)
    expect(s.sound).toBe('piano')
    expect(s.measures[0][0].dyn).toBe('mf')
    expect(s.measures[0][1].dyn).toBeUndefined()
    const old = normalizeScore({ title: 'x', bpm: 90, transposition: 'Bb', key: 99, clef: 'alto', measures: [[]] })!
    expect(old.key).toBe(7)
    expect(old.clef).toBeUndefined()
  })
})

describe('MusicXML', () => {
  const score: Score = {
    title: 'Prueba',
    bpm: 100,
    transposition: 'Bb',
    clef: 'bass',
    key: 2,
    measures: [[{ ...makeNote({ dur: 'q', step: F4 }), dyn: 'p' }]],
  }
  const xml = scoreToMusicXML(score)
  it('escribe divisiones, armadura y clave reales', () => {
    expect(xml).toContain('<divisions>120</divisions>')
    expect(xml).toContain('<key><fifths>2</fifths></key>')
    expect(xml).toContain('<clef><sign>F</sign><line>4</line></clef>')
  })
  it('el Fa de la armadura sale como Fa# y el matiz como <dynamics>', () => {
    expect(xml).toMatch(/<step>F<\/step>\s*<alter>1<\/alter>/)
    expect(xml).toContain('<dynamics><p/></dynamics>')
  })
})
