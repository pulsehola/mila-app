import { describe, expect, it } from 'vitest'
import { EXAMPLES, emptyScore } from './examples'
import { fileSlug, isBlank, noteCount, parseMilaFile, toMilaFile, usedMeasures } from './library'

describe('galería de partituras', () => {
  const full = { ...EXAMPLES[0].build(), annotations: [] }

  it('distingue hojas vacías de partituras con contenido', () => {
    expect(isBlank(emptyScore())).toBe(true)
    expect(isBlank(full)).toBe(false)
    const soloAnotacion = { ...emptyScore(), annotations: [{ id: 'a', measure: 0, ax: 0.5, ay: -20, w0: 200, strokes: [[[0, 0, 0.5]]], pen: true }] }
    expect(isBlank(soloAnotacion as never)).toBe(false)
  })

  it('cuenta compases usados y notas', () => {
    expect(usedMeasures(full)).toBeGreaterThan(0)
    expect(noteCount(full)).toBeGreaterThan(0)
  })

  it('el archivo .mila.json guarda TODO y se vuelve a leer igual', () => {
    const item = {
      id: 'x1',
      createdAt: 1,
      updatedAt: 2,
      score: {
        ...full,
        title: 'Solo de Mila',
        bpm: 72,
        transposition: 'C' as const,
        annotations: [{ id: 'a1', measure: 1, ax: 0.3, ay: -18, w0: 210, strokes: [[[0, 0, 0.5], [12, 3, 0.6]]] as [number, number, number][][], pen: true }],
      },
    }
    const back = parseMilaFile(JSON.stringify(toMilaFile([item])))
    expect(back).toHaveLength(1)
    expect(back[0].id).toBe('x1')
    expect(back[0].createdAt).toBe(1)
    expect(back[0].score.title).toBe('Solo de Mila')
    expect(back[0].score.bpm).toBe(72)
    expect(back[0].score.transposition).toBe('C')
    expect(back[0].score.measures).toEqual(item.score.measures)
    expect(back[0].score.annotations).toEqual(item.score.annotations)
  })

  it('rechaza archivos que no son de MILA', () => {
    expect(() => parseMilaFile('hola')).toThrow()
    expect(() => parseMilaFile('{"foo":1}')).toThrow()
  })

  it('nombres de archivo seguros', () => {
    expect(fileSlug('Canción ñ #1')).toBe('Cancion-n-1')
    expect(fileSlug('')).toBe('partitura')
  })
})
