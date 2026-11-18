import type { Score } from '../types'
import { renderScore } from '../notation/renderScore'

const PAGE_W = 595.28
const PAGE_H = 841.89
const MARGIN = 36
const RENDER_W = 760 // ancho lógico del SVG; se escala al ancho útil de la página
const PER_ROW = 4
const ROWS_FIRST_PAGE = 6
const ROWS_OTHER = 7

let fontCss: Promise<string> | null = null

/**
 * Un SVG usado como <img> no puede ver las fuentes de la página, y VexFlow dibuja los símbolos como texto
 * (Bravura). Se incrustan como data-URI dentro del propio SVG para que el PDF muestre claves, notas y silencios.
 */
function loadFontCss(): Promise<string> {
  if (!fontCss) {
    fontCss = (async () => {
      // Ruta relativa: el paquete no exporta estos módulos, pero Vite los empaqueta bajo demanda.
      // @ts-expect-error módulo JS sin tipos
      const bravura = (await import('../../node_modules/vexflow/build/esm/src/fonts/bravura.js')) as { Bravura: string }
      // @ts-expect-error módulo JS sin tipos
      const academico = (await import('../../node_modules/vexflow/build/esm/src/fonts/academico.js')) as { Academico: string }
      return (
        `@font-face{font-family:'Bravura';src:url(${bravura.Bravura}) format('woff2');}` +
        `@font-face{font-family:'Academico';src:url(${academico.Academico}) format('woff2');}`
      )
    })()
  }
  return fontCss
}

async function svgToPng(svg: SVGElement, w: number, h: number, scale = 2.4): Promise<string> {
  const clone = svg.cloneNode(true) as SVGElement
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  clone.setAttribute('width', String(w))
  clone.setAttribute('height', String(h))
  clone.removeAttribute('style')
  const style = document.createElementNS('http://www.w3.org/2000/svg', 'style')
  style.textContent = await loadFontCss()
  clone.insertBefore(style, clone.firstChild)
  const xml = new XMLSerializer().serializeToString(clone)
  const url = URL.createObjectURL(new Blob([xml], { type: 'image/svg+xml;charset=utf-8' }))
  try {
    const img = new Image()
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve()
      img.onerror = () => reject(new Error('No se pudo rasterizar la partitura'))
      img.src = url
    })
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(w * scale)
    canvas.height = Math.round(h * scale)
    const c = canvas.getContext('2d')!
    const paint = () => {
      c.fillStyle = '#ffffff'
      c.fillRect(0, 0, canvas.width, canvas.height)
      c.drawImage(img, 0, 0, canvas.width, canvas.height)
    }
    paint()
    // Safari decodifica las fuentes del SVG de forma asíncrona: se vuelve a pintar tras un instante.
    await new Promise((r) => setTimeout(r, 140))
    paint()
    return canvas.toDataURL('image/png')
  } finally {
    URL.revokeObjectURL(url)
  }
}

/** PDF A4 con la partitura en negro sobre blanco, título y numeración de compases. */
export async function scoreToPdf(score: Score): Promise<Blob> {
  const { jsPDF } = await import('jspdf') // carga bajo demanda: solo pesa al exportar
  const pdf = new jsPDF({ unit: 'pt', format: 'a4' })
  const host = document.createElement('div')
  host.style.cssText = 'position:fixed;left:-99999px;top:0;visibility:hidden'
  document.body.appendChild(host)

  try {
    const perPage = [ROWS_FIRST_PAGE * PER_ROW]
    const rest = ROWS_OTHER * PER_ROW
    let used = perPage[0]
    while (used < score.measures.length) {
      perPage.push(rest)
      used += rest
    }

    let cursor = 0
    const usableW = PAGE_W - MARGIN * 2
    for (let page = 0; page < perPage.length; page++) {
      const slice = score.measures.slice(cursor, cursor + perPage[page])
      if (slice.length === 0 && page > 0) break
      if (page > 0) pdf.addPage()

      let y = MARGIN
      if (page === 0) {
        pdf.setFont('helvetica', 'bold')
        pdf.setFontSize(22)
        pdf.text(score.title || 'Sin título', PAGE_W / 2, y + 14, { align: 'center' })
        pdf.setFont('helvetica', 'normal')
        pdf.setFontSize(10)
        const sub = `Trompeta ${score.transposition === 'Bb' ? 'en Sib (música escrita)' : 'en Do (altura real)'}  -  negra = ${score.bpm}`
        pdf.text(sub, PAGE_W / 2, y + 32, { align: 'center' })
        y += 46
      }

      const layout = renderScore(host, slice, {
        width: RENDER_W,
        perRow: PER_ROW,
        firstIndex: cursor,
        measureNumbers: true,
        timeSig: cursor === 0,
      })
      const svg = host.querySelector('svg') as SVGElement
      const png = await svgToPng(svg, layout.width, layout.height)
      const scale = usableW / layout.width
      pdf.addImage(png, 'PNG', MARGIN, y, usableW, layout.height * scale, undefined, 'MEDIUM')

      pdf.setFontSize(8)
      pdf.setTextColor(140)
      pdf.text(`MILA · página ${page + 1}`, PAGE_W / 2, PAGE_H - 20, { align: 'center' })
      pdf.setTextColor(0)
      cursor += perPage[page]
      if (cursor >= score.measures.length) break
    }
  } finally {
    host.remove()
  }
  return pdf.output('blob')
}
