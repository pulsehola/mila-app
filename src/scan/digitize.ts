/**
 * De la foto escaneada a una partitura digital editable: endereza la hoja, ejecuta el OMR y calcula cómo
 * colocar la foto para que sus pentagramas queden exactamente bajo los digitales.
 */
import type { Background, Measure } from '../types'
import { makeNote } from '../state/music'
import { SIDE_PAD, TOP_PAD } from '../notation/renderScore'
import { binarize, estimateSkew, type GrayImage, type OmrResult, recognizeScore } from './omr'

/** Distancia entre líneas del pentagrama digital (VexFlow). */
const DIGITAL_GAP = 10
const MAX_MEASURES = 64

export interface Digitized {
  result: OmrResult
  /** Inclinación detectada (grados) de la foto. */
  skew: number
  measures: Measure[]
  /** Colocación de la foto y de la hoja digital para que coincidan (sin imageId). */
  placement: Omit<Background, 'imageId' | 'naturalW' | 'naturalH' | 'opacity' | 'enhance'>
}

function toGray(c: HTMLCanvasElement): GrayImage {
  const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data
  const px = new Uint8Array(c.width * c.height)
  for (let i = 0, j = 0; i < px.length; i++, j += 4) px[i] = (d[j] * 299 + d[j + 1] * 587 + d[j + 2] * 114) / 1000
  return { w: c.width, h: c.height, px }
}

/** Gira la imagen alrededor de su centro (mismo giro que aplica la hoja en pantalla con CSS). */
function rotated(src: HTMLCanvasElement, deg: number): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = src.width
  c.height = src.height
  const ctx = c.getContext('2d')!
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, c.width, c.height)
  ctx.translate(c.width / 2, c.height / 2)
  ctx.rotate((deg * Math.PI) / 180)
  ctx.drawImage(src, -src.width / 2, -src.height / 2)
  return c
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b)
  return s.length ? s[Math.floor(s.length / 2)] : 0
}

/** Analiza la foto. Cede el hilo antes de cada paso pesado para que la interfaz siga respondiendo. */
export async function digitize(src: HTMLCanvasElement): Promise<Digitized | null> {
  const tick = () => new Promise((r) => setTimeout(r, 0))
  await tick()
  let gray = toGray(src)
  const skew = estimateSkew(binarize(gray), gray.w, gray.h)
  // Las líneas bajan `skew` grados hacia la derecha: se gira al revés para enderezarlas.
  const rotation = Math.abs(skew) >= 0.3 ? -skew : 0
  if (rotation) {
    await tick()
    gray = toGray(rotated(src, rotation))
  }
  await tick()
  const result = recognizeScore(gray)
  if (!result.staves.length) return null

  // Escala: el hueco entre líneas del papel debe medir lo mismo que el digital.
  const gap = median(result.staves.map((s) => s.gap))
  const f = DIGITAL_GAP / gap // px de layout por px de foto
  const staffW = median(result.staves.map((s) => s.x1 - s.x0))
  const x0 = median(result.staves.map((s) => s.x0))
  const layoutWidth = Math.round(Math.max(320, Math.min(2400, staffW * f + SIDE_PAD * 2)))
  const tops = result.staves.map((s) => s.lines[0])
  const rowH = tops.length > 1 ? Math.max(90, Math.min(320, median(tops.slice(1).map((t, i) => t - tops[i])) * f)) : 160

  // Compases: uno digital por cada compás del papel, con su mismo ancho.
  const measures: Measure[] = []
  const rowWidths: number[][] = []
  for (const st of result.staves) {
    if (measures.length >= MAX_MEASURES) break
    const widths: number[] = []
    for (const m of st.measures) {
      if (measures.length >= MAX_MEASURES) break
      measures.push(m.notes.map((n) => makeNote({ dur: n.dur, step: n.step })))
      widths.push(Math.max(30, (m.x1 - m.x0) * f))
    }
    if (widths.length) rowWidths.push(widths)
  }

  return {
    result,
    skew,
    measures,
    placement: {
      layoutWidth,
      rowH: Math.round(rowH * 10) / 10,
      perRow: Math.max(1, Math.min(6, Math.round(median(rowWidths.map((r) => r.length))))),
      rowWidths,
      scale: (src.width * f) / layoutWidth,
      x: Math.round(SIDE_PAD - x0 * f),
      // La primera línea del primer pentagrama del papel, sobre la del digital.
      y: Math.round(TOP_PAD - tops[0] * f),
      rotation,
    },
  }
}
