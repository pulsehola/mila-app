import { beforeEach, describe, expect, it } from 'vitest'
import type { Stroke } from '../types'
import {
  __resetProfileCache,
  addSamples,
  importProfile,
  isCalibrated,
  loadProfile,
  MAX_PER_SYMBOL,
  mergeSamples,
  parseProfile,
  userTemplates,
} from './profile'

const sample = (k: number): Stroke[] => [
  Array.from({ length: 12 }, (_, i) => ({ x: 10 + k + Math.cos(i / 2) * 6, y: 20 + Math.sin(i / 2) * 4, p: 0.5, t: i })),
]

beforeEach(() => __resetProfileCache())

describe('resultados de varios tests', () => {
  it('las muestras de un test nuevo se SUMAN a las anteriores (antes se reemplazaban)', () => {
    addSamples({ 'note:q': [sample(1), sample(2)] }, true)
    addSamples({ 'note:q': [sample(3), sample(4)], 'note:h': [sample(5)] }, true)
    const p = loadProfile()
    expect(p.samples['note:q']).toHaveLength(4)
    expect(p.samples['note:h']).toHaveLength(1)
    expect(isCalibrated()).toBe(true)
    expect(userTemplates().length).toBe(5)
  })
  it('se guardan las más recientes de cada símbolo, sin duplicados', () => {
    const many = Array.from({ length: MAX_PER_SYMBOL + 5 }, (_, i) => sample(i))
    const merged = mergeSamples({ 'note:w': many.slice(0, 8) }, { 'note:w': [...many.slice(5), many[6]] })
    expect(merged['note:w']).toHaveLength(MAX_PER_SYMBOL)
    expect(merged['note:w']!.at(-1)).toEqual(mergeSamples({}, { 'note:w': [many.at(-1)!] })['note:w']![0])
  })
  it('un test cerrado a medias también aporta sus muestras, sin darlo por hecho', () => {
    addSamples({ 'rest:q': [sample(1)] }, false)
    expect(loadProfile().samples['rest:q']).toHaveLength(1)
    expect(isCalibrated()).toBe(false)
  })
  it('la letra guardada en la copia de la galería se recupera al abrir el archivo', () => {
    const file = { version: 1, completedAt: 123, samples: { 'acc:b': [sample(1), sample(2)] } }
    expect(importProfile(file)).toBe(true)
    expect(isCalibrated()).toBe(true)
    expect(loadProfile().samples['acc:b']).toHaveLength(2)
  })
  it('descarta datos que no son un perfil', () => {
    expect(parseProfile({ version: 2 })).toBeNull()
    expect(parseProfile({ version: 1, samples: { 'note:q': [[{ x: 'a' }]] } })?.samples).toEqual({})
    expect(importProfile(null)).toBe(false)
  })
})
