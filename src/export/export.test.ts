// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { EXAMPLES } from '../state/examples'
import { scoreToMidi } from './midi'
import { scoreToMusicXML } from './musicxml'
import { fileNameFor } from './share'

const jazz = EXAMPLES[1].build()

describe('MIDI', () => {
  it('cabecera SMF válida y evento de tempo', () => {
    const b = scoreToMidi(jazz)
    expect(String.fromCharCode(...b.slice(0, 4))).toBe('MThd')
    expect(String.fromCharCode(...b.slice(14, 18))).toBe('MTrk')
    const us = Math.round(60_000_000 / 126)
    const idx = b.findIndex((v, i) => v === 0xff && b[i + 1] === 0x51)
    expect((b[idx + 3] << 16) | (b[idx + 4] << 8) | b[idx + 5]).toBe(us)
    // termina con fin de pista
    expect([...b.slice(-3)]).toEqual([0xff, 0x2f, 0x00])
  })
  it('la longitud de pista declarada coincide con los datos', () => {
    const b = scoreToMidi(jazz)
    const len = (b[18] << 24) | (b[19] << 16) | (b[20] << 8) | b[21]
    expect(b.length - 22).toBe(len)
  })
  it('cuenta tantos note-on como notas (sin silencios)', () => {
    const notes = jazz.measures.flat().filter((n) => n.kind === 'note').length
    const b = scoreToMidi(jazz)
    let on = 0
    for (let i = 22; i < b.length - 2; i++) if (b[i] === 0x90 && b[i + 2] > 0) on++
    expect(on).toBeGreaterThanOrEqual(notes)
  })
})

describe('MusicXML', () => {
  it('es XML bien formado con transposición Sib', () => {
    const xml = scoreToMusicXML(jazz)
    expect(xml).toContain('<score-partwise')
    expect(xml).toContain('<chromatic>-2</chromatic>')
    expect(xml.match(/<measure /g)).toHaveLength(jazz.measures.length)
    const doc = new DOMParser().parseFromString(xml, 'application/xml')
    expect(doc.querySelector('parsererror')).toBeNull()
    expect(doc.querySelectorAll('note').length).toBeGreaterThan(10)
  })
  it('en Do no transpone y hereda alteraciones en <alter>', () => {
    const s = { ...jazz, transposition: 'C' as const }
    const xml = scoreToMusicXML(s)
    expect(xml).not.toContain('<transpose>')
    expect(xml).toContain('<alter>1</alter>')
    expect(xml).toContain('<alter>-1</alter>')
  })
})

describe('nombres de archivo', () => {
  it('quita tildes y espacios', () => {
    expect(fileNameFor({ ...jazz, title: 'Fanfarria Épica!' }, 'pdf')).toBe('mila-fanfarria-epica.pdf')
  })
})
