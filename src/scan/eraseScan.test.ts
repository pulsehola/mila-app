import { describe, expect, it } from 'vitest'
import type { Background } from '../types'
import { layoutToImage, touchesImage } from './eraseScan'

const bg = (over: Partial<Background> = {}): Background => ({
  imageId: 'x',
  naturalW: 2000,
  naturalH: 1000,
  layoutWidth: 1000,
  rowH: 160,
  perRow: 4,
  x: 0,
  y: 0,
  scale: 1,
  rotation: 0,
  opacity: 1,
  enhance: false,
  ...over,
})

describe('goma sobre la foto: hoja → píxeles de la imagen', () => {
  it('sin desplazar ni girar escala por el tamaño real de la imagen', () => {
    expect(layoutToImage(bg(), 500, 250)).toEqual({ x: 1000, y: 500 })
    expect(layoutToImage(bg(), 0, 0)).toEqual({ x: 0, y: 0 })
  })

  it('tiene en cuenta la posición y la escala del fondo', () => {
    const p = layoutToImage(bg({ x: 100, y: 50, scale: 0.5 }), 100 + 250, 50 + 125)
    expect(p.x).toBeCloseTo(1000)
    expect(p.y).toBeCloseTo(500)
  })

  it('deshace el giro alrededor del centro de la imagen', () => {
    // Girada 90°: el centro sigue en su sitio y un punto a la derecha del centro corresponde a uno encima.
    const b = bg({ rotation: 90 })
    const c = layoutToImage(b, 500, 250)
    expect(c.x).toBeCloseTo(1000)
    expect(c.y).toBeCloseTo(500)
    const r = layoutToImage(b, 600, 250)
    expect(r.x).toBeCloseTo(1000)
    expect(r.y).toBeCloseTo(300)
  })

  it('solo toca la foto si la goma pasa por encima', () => {
    expect(touchesImage(bg(), [{ x: 10, y: 10 }], 16)).toBe(true)
    expect(touchesImage(bg(), [{ x: 10, y: 900 }], 16)).toBe(false)
  })
})
