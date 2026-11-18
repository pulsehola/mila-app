import { describe, expect, it } from 'vitest'
import { fitSize, isPdf } from './importScan'
import { normalizeBackground, normalizeScore } from '../state/useScore'
import { imageIdsOf, parseMilaImages, toMilaFile } from '../state/library'

const bg = {
  imageId: 'img1',
  naturalW: 1200,
  naturalH: 1700,
  layoutWidth: 900,
  rowH: 150,
  perRow: 4,
  x: -12,
  y: 30,
  scale: 1.1,
  rotation: 1.5,
  opacity: 0.6,
  enhance: true,
}

describe('partitura escaneada de fondo', () => {
  it('reduce fotos grandes sin pasarse del límite de Safari', () => {
    const r = fitSize(4032, 3024) // foto de iPad
    expect(r.w).toBe(1600)
    expect(r.w * r.h).toBeLessThanOrEqual(12_000_000)
    const tall = fitSize(1600, 30000) // PDF de muchas páginas
    expect(tall.w * tall.h).toBeLessThanOrEqual(12_000_000)
    expect(tall.h / tall.w).toBeCloseTo(30000 / 1600, 1)
  })

  it('reconoce PDFs por tipo o extensión', () => {
    expect(isPdf(new File([''], 'cuarto de tula.pdf'))).toBe(true)
    expect(isPdf(new File([''], 'x', { type: 'application/pdf' }))).toBe(true)
    expect(isPdf(new File([''], 'foto.jpg', { type: 'image/jpeg' }))).toBe(false)
  })

  it('el fondo se guarda con la partitura y se valida al cargar', () => {
    const s = normalizeScore({ title: 't', measures: [[]], background: bg })!
    expect(s.background).toEqual(bg)
    expect(normalizeBackground({ ...bg, opacity: 9, perRow: 99, rotation: -90 })).toMatchObject({ opacity: 1, perRow: 6, rotation: -20 })
    expect(normalizeBackground({ ...bg, imageId: '' })).toBeUndefined()
    expect(normalizeScore({ measures: [[]], background: { basura: 1 } })!.background).toBeUndefined()
  })

  it('la copia en Archivos lleva la imagen del escaneo', () => {
    const items = [{ id: 'a', createdAt: 1, updatedAt: 1, score: { title: 't', bpm: 90, transposition: 'Bb' as const, measures: [[]], background: bg } }]
    expect(imageIdsOf(items)).toEqual(['img1'])
    const text = JSON.stringify(toMilaFile(items, { img1: 'data:image/jpeg;base64,AAAA' }))
    expect(parseMilaImages(text)).toEqual({ img1: 'data:image/jpeg;base64,AAAA' })
    expect(parseMilaImages(JSON.stringify({ images: { x: 'javascript:alert(1)' } }))).toEqual({})
  })
})
