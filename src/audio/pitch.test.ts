import { describe, expect, it } from 'vitest'
import { detectPitch, noteLabel, readingFromFreq } from './pitch'
import { buildEvents, DUR_UNITS, midiToFreq, writtenMidi, soundingMidi } from '../state/music'
import { parseMeasure, EXAMPLES } from '../state/examples'

function sine(freq: number, sr = 44100, n = 4096, harmonics = 1): Float32Array {
  const b = new Float32Array(n)
  for (let h = 1; h <= harmonics; h++) {
    for (let i = 0; i < n; i++) b[i] += Math.sin((2 * Math.PI * freq * h * i) / sr) / h
  }
  return b
}

describe('afinador (YIN)', () => {
  it('detecta La4 440 Hz', () => {
    const f = detectPitch(sine(440), 44100)!
    expect(f).toBeGreaterThan(438)
    expect(f).toBeLessThan(442)
  })
  it('detecta un Sib3 grave con armónicos (timbre de metal)', () => {
    const f = detectPitch(sine(233.08, 48000, 4096, 5), 48000)!
    expect(Math.abs(f - 233.08)).toBeLessThan(1.5)
  })
  it('silencio devuelve null', () => {
    expect(detectPitch(new Float32Array(4096), 44100)).toBeNull()
  })
  it('calcula cents y nombre', () => {
    const r = readingFromFreq(446)
    expect(r.midi).toBe(69)
    expect(r.cents).toBeGreaterThan(20)
    expect(noteLabel(69)).toBe('La4')
  })
})

describe('transposición', () => {
  it('Do4 escrito suena Sib3 en trompeta Sib', () => {
    const written = writtenMidi(0, '')
    expect(written).toBe(60)
    expect(soundingMidi(written, 'Bb')).toBe(58)
    expect(soundingMidi(written, 'C')).toBe(60)
    expect(midiToFreq(58)).toBeCloseTo(233.08, 1)
  })
  it('los eventos aplican la transposición y heredan alteraciones en el compás', () => {
    const m = parseMeasure('f#4/q f4/q g4/q g4/q')
    const bb = buildEvents([m], 'Bb').events
    const c = buildEvents([m], 'C').events
    expect(c[0].midi).toBe(66) // Fa#4
    expect(c[1].midi).toBe(66) // hereda el sostenido
    expect(bb[0].midi).toBe(64)
    expect(bb[2].midi).toBe(65)
  })
})

describe('ejemplos', () => {
  it('todos los compases de los ejemplos suman 4/4 salvo que sea intencional', () => {
    for (const ex of EXAMPLES) {
      const s = ex.build()
      for (const [i, m] of s.measures.entries()) {
        const units = m.reduce((a, n) => a + DUR_UNITS[n.dur], 0)
        expect(units, `${ex.name} compás ${i + 1}`).toBe(16)
      }
    }
  })
})
