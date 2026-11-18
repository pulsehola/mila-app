import { describe, expect, it } from 'vitest'
import { buildEvents, describeDiff, makeNote, measureCapacity, measureStatus } from './music'

describe('métrica', () => {
  it('capacidad en semicorcheas', () => {
    expect(measureCapacity('2/4')).toBe(8)
    expect(measureCapacity('3/4')).toBe(12)
    expect(measureCapacity('4/4')).toBe(16)
    expect(measureCapacity('6/8')).toBe(12)
  })
  it('un compás de 3 negras está completo en 3/4 y corto en 4/4', () => {
    const m = [makeNote({ dur: 'q' }), makeNote({ dur: 'q' }), makeNote({ dur: 'q' })]
    expect(measureStatus(m, '3/4').state).toBe('ok')
    expect(measureStatus(m, '4/4').state).toBe('short')
  })
  it('en 6/8 los tiempos que faltan se cuentan en corcheas', () => {
    expect(describeDiff(-2, '6/8')).toBe('falta 1 tiempo')
    expect(describeDiff(-4, '4/4')).toBe('falta 1 tiempo')
  })
  it('la reproducción avanza según la métrica', () => {
    const ms = [[makeNote({ dur: 'q' })], [makeNote({ dur: 'q' })]]
    expect(buildEvents(ms, 'C', null, '3/4').events[1].startUnits).toBe(12)
    expect(buildEvents(ms, 'C', null, '2/4').totalUnits).toBe(16)
  })
})
