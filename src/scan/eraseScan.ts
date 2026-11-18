import type { Background } from '../types'

/**
 * Goma sobre la partitura escaneada: la foto es un calco editable, así que borrar una nota del papel es
 * pintar esa zona del color del papel. Se genera una imagen nueva (la anterior queda para Deshacer).
 */

/** Tamaño en pantalla (px de layout) con que se dibuja la imagen de fondo. */
export function displaySize(bg: Background): { w: number; h: number } {
  const w = bg.layoutWidth * bg.scale
  return { w, h: w * (bg.naturalH / bg.naturalW) }
}

/** Punto de la hoja (px de layout) → píxel de la imagen, deshaciendo posición, escala y giro. */
export function layoutToImage(bg: Background, x: number, y: number): { x: number; y: number } {
  const { w, h } = displaySize(bg)
  const cx = bg.x + w / 2
  const cy = bg.y + h / 2
  const t = (-(bg.rotation || 0) * Math.PI) / 180
  const dx = x - cx
  const dy = y - cy
  const ux = dx * Math.cos(t) - dy * Math.sin(t)
  const uy = dx * Math.sin(t) + dy * Math.cos(t)
  return { x: ((ux + w / 2) * bg.naturalW) / w, y: ((uy + h / 2) * bg.naturalH) / h }
}

/** ¿El trazo pasa por encima de la imagen? (si no, no hace falta tocarla). */
export function touchesImage(bg: Background, pts: { x: number; y: number }[], radius: number): boolean {
  const r = (radius * bg.naturalW) / displaySize(bg).w
  return pts.some((p) => {
    const q = layoutToImage(bg, p.x, p.y)
    return q.x >= -r && q.y >= -r && q.x <= bg.naturalW + r && q.y <= bg.naturalH + r
  })
}

/** Color del papel: mediana del borde de la imagen (las fotos casi nunca son blanco puro). */
function paperColor(ctx: CanvasRenderingContext2D, w: number, h: number): string {
  const band = Math.max(3, Math.round(Math.min(w, h) * 0.015))
  const parts = [
    ctx.getImageData(0, 0, w, band),
    ctx.getImageData(0, h - band, w, band),
    ctx.getImageData(0, 0, band, h),
    ctx.getImageData(w - band, 0, band, h),
  ]
  const lum: { l: number; i: number; d: Uint8ClampedArray }[] = []
  for (const p of parts) {
    for (let i = 0; i < p.data.length; i += 4 * 9) {
      lum.push({ l: p.data[i] * 0.3 + p.data[i + 1] * 0.59 + p.data[i + 2] * 0.11, i, d: p.data })
    }
  }
  lum.sort((a, b) => a.l - b.l)
  // Percentil alto: el papel, no las líneas ni las sombras de los bordes.
  const pick = lum[Math.floor(lum.length * 0.7)]
  if (!pick) return '#ffffff'
  return `rgb(${pick.d[pick.i]}, ${pick.d[pick.i + 1]}, ${pick.d[pick.i + 2]})`
}

/**
 * Borra en la imagen los trazos de la goma (en px de layout, con radio en px de layout).
 * Devuelve la imagen nueva en el mismo formato que tenía (JPEG/PNG) o null si no hubo nada que borrar.
 */
export async function eraseOnImage(
  blob: Blob,
  bg: Background,
  paths: { x: number; y: number }[][],
  radius: number,
): Promise<Blob | null> {
  const bmp = await createImageBitmap(blob)
  const canvas = document.createElement('canvas')
  canvas.width = bmp.width
  canvas.height = bmp.height
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  ctx.drawImage(bmp, 0, 0)
  bmp.close?.()
  const color = paperColor(ctx, canvas.width, canvas.height)
  const k = canvas.width / displaySize(bg).w
  ctx.strokeStyle = color
  ctx.fillStyle = color
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.lineWidth = radius * 2 * k
  let drew = false
  for (const path of paths) {
    const pts = path.map((p) => layoutToImage(bg, p.x, p.y))
    if (!pts.length) continue
    drew = true
    ctx.beginPath()
    if (pts.length === 1) {
      ctx.arc(pts[0].x, pts[0].y, radius * k, 0, Math.PI * 2)
      ctx.fill()
      continue
    }
    ctx.moveTo(pts[0].x, pts[0].y)
    for (const q of pts.slice(1)) ctx.lineTo(q.x, q.y)
    ctx.stroke()
  }
  if (!drew) return null
  const type = blob.type === 'image/png' ? 'image/png' : 'image/jpeg'
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), type, 0.92))
}
