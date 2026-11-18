import { describe, expect, it } from 'vitest'
import { scoreToMusicXML } from '../export/musicxml'
import type { Score } from '../types'
import { buildEvents, makeNote, makeRest, measureStatus, noteUnits } from './music'

describe('puntillo', () => {
  it('suma la mitad del valor', () => {
    expect(noteUnits({ dur: 'h', dot: true })).toBe(12) // 3 tiempos
    expect(noteUnits({ dur: 'q', dot: true })).toBe(6) // 1½ tiempos
    expect(noteUnits({ dur: '8', dot: true })).toBe(3)
  })
  it('blanca con puntillo llena un 3/4', () => {
    expect(measureStatus([makeNote({ dur: 'h', dot: true })], '3/4').state).toBe('ok')
  })
  it('negra con puntillo + corchea llena 2 tiempos en 2/4', () => {
    expect(measureStatus([makeNote({ dur: 'q', dot: true }), makeNote({ dur: '8' })], '2/4').state).toBe('ok')
  })
  it('6/8 con negras con puntillo', () => {
    expect(measureStatus([makeNote({ dur: 'q', dot: true }), makeRest('q'), makeNote({ dur: '8' })], '6/8').state).toBe('ok')
  })
})

describe('grupos de valoración especial', () => {
  const group = (n: 3 | 5 | 6, dur: '8' | '16', count = n) =>
    Array.from({ length: count }, () => makeNote({ dur, tuplet: { id: `g${n}${dur}`, n } }))
  it('tresillo de corcheas = 1 tiempo (3 en el tiempo de 2)', () => {
    const m = [...group(3, '8'), makeNote({ dur: 'h' }), makeNote({ dur: 'q' })]
    expect(measureStatus(m, '4/4')).toMatchObject({ state: 'ok', diff: 0 })
  })
  it('quintillo y seisillo de semicorcheas = 1 tiempo (en el tiempo de 4)', () => {
    expect(measureStatus([...group(5, '16'), makeNote({ dur: 'q' })], '2/4').state).toBe('ok')
    expect(measureStatus([...group(6, '16'), makeNote({ dur: 'q' })], '2/4').state).toBe('ok')
  })
  it('el audio reparte el tiempo en partes iguales', () => {
    const { events, totalUnits } = buildEvents([[...group(3, '8'), makeNote({ dur: 'q' })]], 'C', null, '2/4')
    expect(events.map((e) => Math.round(e.startUnits * 1000) / 1000)).toEqual([0, 1.333, 2.667, 4])
    expect(totalUnits).toBe(8)
  })
})

describe('MusicXML', () => {
  it('exporta puntillo y tresillo con duraciones enteras', () => {
    const score: Score = {
      title: 't',
      bpm: 90,
      transposition: 'C',
      measures: [
        [
          makeNote({ dur: 'q', dot: true }),
          makeNote({ dur: '8' }),
          ...Array.from({ length: 3 }, () => makeNote({ dur: '8', tuplet: { id: 'x', n: 3 } })),
          makeNote({ dur: 'q' }),
        ],
      ],
    }
    const xml = scoreToMusicXML(score)
    expect(xml).toContain('<dot/>')
    expect(xml).toContain('<actual-notes>3</actual-notes><normal-notes>2</normal-notes>')
    expect(xml).toContain('<tuplet type="start" bracket="yes"/>')
    expect(xml).toContain('<tuplet type="stop"/>')
    expect(xml).toMatch(/<duration>180<\/duration>/) // negra con puntillo (120 por negra)
    expect(xml).toMatch(/<duration>40<\/duration>/) // corchea de tresillo
  })
})
