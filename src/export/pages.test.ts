import { describe, expect, it } from 'vitest'
import { HEADER_H, MARGIN_BOTTOM, MARGIN_TOP, PAGE_H, planPages } from './pages'

const bands = (n: number, h = 86) => Array.from({ length: n }, () => ({ height: h }))

describe('páginas A4', () => {
  it('ningún sistema se parte ni sale del margen', () => {
    const pages = planPages(bands(30))
    const all = pages.flatMap((p) => p.bands.map((b) => b.band))
    expect(all).toEqual(Array.from({ length: 30 }, (_, i) => i))
    for (const p of pages) for (const b of p.bands) expect(b.y + b.height).toBeLessThanOrEqual(PAGE_H - MARGIN_BOTTOM + 1e-6)
  })
  it('la primera página deja sitio al título', () => {
    const [first, second] = planPages(bands(30))
    expect(first.header).toBe(true)
    expect(first.bands[0].y).toBe(MARGIN_TOP + HEADER_H)
    expect(second.header).toBe(false)
    expect(second.bands[0].y).toBe(MARGIN_TOP)
    expect(second.bands.length).toBeGreaterThanOrEqual(first.bands.length)
  })
  it('las páginas llenas reparten el sobrante; la última queda natural', () => {
    const pages = planPages(bands(20))
    const last = pages[pages.length - 1]
    const gaps = (p: (typeof pages)[number]) => p.bands.slice(1).map((b, i) => b.y - (p.bands[i].y + p.bands[i].height))
    expect(gaps(pages[0]).every((g) => g > 0 && g <= 22)).toBe(true)
    expect(gaps(last).every((g) => Math.abs(g) < 1e-9)).toBe(true)
  })
  it('una partitura corta es una sola página; un sistema enorme va solo', () => {
    expect(planPages(bands(2))).toHaveLength(1)
    const p = planPages([{ height: 900 }, { height: 80 }])
    expect(p[0].bands).toHaveLength(1)
    expect(planPages([])).toHaveLength(1)
  })
  it('escaneada: sistemas seguidos, sin huecos que corten el papel', () => {
    const p = planPages(bands(20), { justify: false })[0]
    p.bands.slice(1).forEach((b, i) => expect(b.y).toBeCloseTo(p.bands[i].y + p.bands[i].height))
  })
})
