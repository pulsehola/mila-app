import { describe, expect, it } from 'vitest'
import { estimateSkew, recognizeScore, type GrayImage, binarize } from './omr'

/** Mini "impresora" de partituras sintéticas para probar el OMR. */
class Sheet {
  img: GrayImage
  constructor(w: number, h: number) {
    this.img = { w, h, px: new Uint8Array(w * h).fill(245) }
  }
  dot(x: number, y: number) {
    x = Math.round(x)
    y = Math.round(y)
    if (x >= 0 && y >= 0 && x < this.img.w && y < this.img.h) this.img.px[y * this.img.w + x] = 20
  }
  rect(x0: number, y0: number, x1: number, y1: number) {
    for (let y = Math.round(y0); y <= Math.round(y1); y++) for (let x = Math.round(x0); x <= Math.round(x1); x++) this.dot(x, y)
  }
  ellipse(cx: number, cy: number, rx: number, ry: number, filled: boolean) {
    const a = -0.35
    for (let y = -ry - 3; y <= ry + 3; y++)
      for (let x = -rx - 3; x <= rx + 3; x++) {
        const u = x * Math.cos(a) + y * Math.sin(a)
        const v = -x * Math.sin(a) + y * Math.cos(a)
        const d = (u / rx) ** 2 + (v / ry) ** 2
        if (filled ? d <= 1 : d <= 1 && d >= 0.45) this.dot(cx + x, cy + y)
      }
  }
}

const G = 14 // distancia entre líneas (px)

/** Dibuja un pentagrama y devuelve la y de la línea inferior. */
function staff(sh: Sheet, top: number, x0: number, x1: number) {
  for (let l = 0; l < 5; l++) sh.rect(x0, top + l * G, x1, top + l * G + 1)
  sh.rect(x0, top, x0 + 1, top + 4 * G + 1)
  sh.rect(x1 - 1, top, x1, top + 4 * G + 1)
  return top + 4 * G
}

/** Nota: posición `p` en medios espacios sobre la línea inferior (0 = Mi4). */
function note(sh: Sheet, x: number, bottom: number, p: number, kind: 'w' | 'h' | 'q' | '8', beamTo?: number) {
  const y = bottom - (p * G) / 2
  sh.ellipse(x, y, 0.62 * G, 0.42 * G, kind === 'q' || kind === '8')
  if (kind === 'w') return
  const sx = x + 0.55 * G
  const top = y - 3.4 * G
  sh.rect(sx, top, sx + 1, y)
  if (kind === '8') {
    if (beamTo !== undefined) sh.rect(sx, top, beamTo + 0.55 * G + 1, top + 0.45 * G)
    else sh.rect(sx, top, sx + 0.9 * G, top + 0.5 * G)
  }
}

function sample(): GrayImage {
  const sh = new Sheet(900, 560)
  // Sistema 1: | negra Sol4, negra Si4, blanca Mi5 | redonda Do5 |  (la clave ocupa el principio)
  let b = staff(sh, 60, 30, 870)
  sh.rect(450, 60, 451, b + 1) // barra de compás
  note(sh, 170, b, 2, 'q') // Sol4: segunda línea (p=2)
  note(sh, 260, b, 4, 'q') // Si4: línea central
  note(sh, 350, b, 7, 'h') // Mi5 (p=7)
  note(sh, 620, b, 5, 'w') // Do5
  // Sistema 2: corcheas unidas Mi4–Fa4 | negra La4
  b = staff(sh, 260, 30, 870)
  sh.rect(450, 260, 451, b + 1)
  note(sh, 150, b, 0, '8', 210)
  note(sh, 210, b, 1, '8', 150)
  note(sh, 600, b, 3, 'q')
  // Sistema 3: blanca Mi4 y redonda Si4, cabezas vacías SOBRE línea
  b = staff(sh, 440, 30, 870)
  note(sh, 200, b, 0, 'h')
  note(sh, 500, b, 4, 'w')
  return sh.img
}

describe('OMR: foto de partitura → notas editables', () => {
  it('encuentra los pentagramas, las barras y la altura/duración de cada nota', () => {
    const r = recognizeScore(sample())
    expect(r.staves).toHaveLength(3)
    expect(r.staves[0].gap).toBeCloseTo(G, 0)
    const s1 = r.staves[0].measures.map((m) => m.notes.map((n) => `${n.dur}:${n.step}`))
    // Pasos: Do4=0 → Sol4=4, Si4=6, Mi5=9, Do5=7
    expect(s1).toEqual([['q:4', 'q:6', 'h:9'], ['w:7']])
    const s2 = r.staves[1].measures.map((m) => m.notes.map((n) => `${n.dur}:${n.step}`))
    expect(s2).toEqual([['8:2', '8:3'], ['q:5']])
    const s3 = r.staves[2].measures.map((m) => m.notes.map((n) => `${n.dur}:${n.step}`))
    expect(s3).toEqual([['h:2', 'w:6']])
    expect(r.noteCount).toBe(9)
  })

  it('una página sin pentagramas no inventa notas', () => {
    const blank: GrayImage = { w: 400, h: 300, px: new Uint8Array(400 * 300).fill(240) }
    expect(recognizeScore(blank).staves).toHaveLength(0)
  })

  it('detecta una hoja torcida (para enderezarla antes de leerla)', () => {
    const sh = new Sheet(800, 300)
    const ang = (2 * Math.PI) / 180
    for (let l = 0; l < 5; l++) for (let x = 40; x < 760; x++) sh.dot(x, 100 + l * G + x * Math.tan(ang))
    const img = sh.img
    expect(estimateSkew(binarize(img), img.w, img.h)).toBeCloseTo(2, 0)
  })
})
