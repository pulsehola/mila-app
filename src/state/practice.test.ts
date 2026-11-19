import { describe, expect, it } from 'vitest'
import { buildEvents, makeNote, makeRest } from './music'
import { buildAccompaniment, clampSpeed, measureTimeline, orderedRange, pickChord, practiceBpm, tonicPc, voiceChord } from './practice'
import { playheadAt } from '../notation/playhead'
import type { Layout } from '../notation/renderScore'
import type { Measure } from '../types'

// Pasos diatónicos desde Do4: Do=0 Re=1 Mi=2 Fa=3 Sol=4 La=5 Si=6 Do5=7
const q = (step: number) => makeNote({ dur: 'q', step })
const h = (step: number) => makeNote({ dur: 'h', step })

describe('velocidad de práctica', () => {
  it('se limita a 40–100 % en pasos de 5 %', () => {
    expect(clampSpeed(0.1)).toBe(0.4)
    expect(clampSpeed(1.5)).toBe(1)
    expect(clampSpeed(0.73)).toBe(0.75)
    expect(clampSpeed('x')).toBe(1)
  })
  it('solo cambia el tempo; las alturas de los eventos son las mismas', () => {
    expect(practiceBpm(100, 0.5)).toBe(50)
    expect(practiceBpm(90, 0.4)).toBe(36)
    // Los eventos no dependen de la velocidad: misma altura MIDI a cualquier velocidad.
    const m: Measure[] = [[q(0), q(2), q(4), q(7)]]
    const a = buildEvents(m, 'C').events.map((e) => e.midi)
    expect(a).toEqual([60, 64, 67, 72])
  })
})

describe('línea de tiempo del cursor', () => {
  it('coincide con buildEvents (mismo inicio de cada nota)', () => {
    const m: Measure[] = [[q(0), q(2), h(4)], [makeRest('h'), q(1), q(3)], [h(0)]]
    const tl = measureTimeline(m, null, '4/4')
    expect(tl.map((s) => s.start)).toEqual([0, 16, 32])
    // El compás incompleto ocupa igualmente el compás entero.
    expect(tl[2].units).toBe(16)
    const ev = buildEvents(m, 'C', null, '4/4')
    for (const e of ev.events) {
      const at = tl.find((s) => s.measure === e.measure)!.notes[e.index].at
      expect(at).toBe(e.startUnits)
    }
    expect(ev.totalUnits).toBe(48)
  })
  it('con un fragmento empieza en 0 en el primer compás del bucle', () => {
    const m: Measure[] = [[h(0), h(2)], [h(4), h(7)], [h(0), h(0)]]
    const tl = measureTimeline(m, { start: 1, end: 2 }, '4/4')
    expect(tl.map((s) => [s.measure, s.start])).toEqual([[1, 0], [2, 16]])
  })
  it('el cursor pasa por cada cabeza justo cuando empieza la nota', () => {
    const m: Measure[] = [[q(0), q(2), h(4)]]
    const ids = m[0].map((n) => n.id)
    const layout: Layout = {
      width: 800,
      height: 200,
      perRow: 1,
      rows: [{ yTop: 50, yBottom: 110 }],
      measures: [{ index: 0, row: 0, col: 0, x: 0, w: 400, yTop: 50, yBottom: 110, noteStartX: 80, noteEndX: 380 }],
      notes: [
        { id: ids[0], measure: 0, index: 0, kind: 'note', x: 100, y: 0 },
        { id: ids[1], measure: 0, index: 1, kind: 'note', x: 180, y: 0 },
        { id: ids[2], measure: 0, index: 2, kind: 'note', x: 260, y: 0 },
      ],
    }
    const tl = measureTimeline(m, null, '4/4')
    expect(playheadAt(tl, layout, 0)!.x).toBe(100)
    expect(playheadAt(tl, layout, 4)!.x).toBe(180)
    expect(playheadAt(tl, layout, 2)!.x).toBe(140) // a mitad de la primera negra
    expect(playheadAt(tl, layout, 8)!.x).toBe(260)
    expect(playheadAt(tl, layout, 12)!.x).toBe(320) // a mitad de la blanca, camino del final
  })
})

describe('bucle A–B', () => {
  it('ordena A y B', () => {
    expect(orderedRange(3, 1)).toEqual({ start: 1, end: 3 })
    expect(orderedRange(2, 2)).toEqual({ start: 2, end: 2 })
  })
})

describe('acompañamiento automático', () => {
  it('tónica de cada armadura', () => {
    expect(tonicPc(0)).toBe(0) // Do
    expect(tonicPc(-2)).toBe(10) // Si♭
    expect(tonicPc(2)).toBe(2) // Re
    expect(tonicPc(-1)).toBe(5) // Fa
  })
  it('elige I, IV y V según la melodía (Do mayor, en Do)', () => {
    const m: Measure[] = [
      [q(0), q(2), q(4), q(2)], // Do Mi Sol Mi → Do
      [h(3), h(5)], // Fa | La → Fa
      [h(6), h(8)], // Si | Re5 → Sol
      [makeNote({ dur: 'w', step: 7 })], // Do5 → Do
    ]
    const acc = buildAccompaniment(m, 'C', null, '4/4', 0)
    const chords = [...new Set(acc.map((e) => `${e.measure}:${e.chord}`))]
    expect(chords).toEqual(['0:Do', '1:Fa', '2:Sol', '3:Do'])
  })
  it('trompeta en Sib: el acorde va en altura real (Re escrito = Do de concierto)', () => {
    const m: Measure[] = [[q(1), q(3), q(5), q(3)]] // Re Fa♯ La Fa♯ escrito con armadura de Re (2♯)
    const acc = buildAccompaniment(m, 'Bb', null, '4/4', 2)
    expect(acc[0].chord).toBe('Do')
    // Bajo en Do2… Si2 y acorde por debajo de la trompeta.
    expect(acc[0].midis).toEqual([48])
    for (const e of acc) for (const x of e.midis) expect(x).toBeLessThan(67)
  })
  it('bajo en el primer pulso y acorde en los demás, según la métrica', () => {
    const m44: Measure[] = [[h(0), h(0)]]
    const a = buildAccompaniment(m44, 'C', null, '4/4', 0)
    expect(a.map((e) => [e.startUnits, e.midis.length])).toEqual([[0, 1], [4, 3], [8, 1], [12, 3]])
    const m34: Measure[] = [[makeNote({ dur: 'h', step: 0, dot: true })]]
    const b = buildAccompaniment(m34, 'C', null, '3/4', 0)
    expect(b.map((e) => [e.startUnits, e.midis.length])).toEqual([[0, 1], [4, 3], [8, 3]])
    const m68: Measure[] = [[makeNote({ dur: 'q', step: 0, dot: true }), makeNote({ dur: 'q', step: 4, dot: true })]]
    const c = buildAccompaniment(m68, 'C', null, '6/8', 0)
    expect(c.map((e) => [e.startUnits, e.midis.length])).toEqual([[0, 1], [2, 3], [4, 3], [6, 1], [8, 3], [10, 3]])
  })
  it('un compás de silencio mantiene el acorde anterior; sin notas no hay acompañamiento', () => {
    const m: Measure[] = [[h(4), h(6)], [makeRest('w')]]
    const acc = buildAccompaniment(m, 'C', null, '4/4', 0)
    expect(acc.filter((e) => e.measure === 1).every((e) => e.chord === 'Sol')).toBe(true)
    expect(buildAccompaniment([[makeRest('w')]], 'C')).toEqual([])
  })
  it('pickChord y voiceChord', () => {
    expect(pickChord([{ start: 0, dur: 8, midi: 69 }], 0, 8, 0, null)).toEqual({ root: 5, minor: false }) // una La sola: Fa (IV) antes que Lam (vi)
    const v = voiceChord({ root: 7, minor: false })
    expect(v.bass).toBe(43) // Sol2
    expect(v.chord).toEqual([59, 62, 67].map((x) => (x >= 67 ? x - 12 : x)).sort((a, b) => a - b))
  })
})
