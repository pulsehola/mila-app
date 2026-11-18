import {
  Accidental as VfAccidental,
  Articulation,
  Beam,
  Curve,
  Formatter,
  Modifier,
  Renderer,
  Stave,
  StaveNote,
  Voice,
} from 'vexflow'
import type { Measure, Meter } from '../types'
import { vexKey } from '../state/music'

export const ROW_H = 160
export const TOP_PAD = 54
export const SIDE_PAD = 22
const MIN_MEASURE_W = 200
const CLEF_W = 44
const TIME_W = 26

export interface NoteHit {
  id: string
  measure: number
  index: number
  kind: 'note' | 'rest'
  /** Centro de la cabeza (o del silencio). */
  x: number
  y: number
}

export interface MeasureBox {
  index: number
  row: number
  /** Posición dentro del sistema (0 = primer compás, con clave). */
  col: number
  x: number
  w: number
  yTop: number
  yBottom: number
  noteStartX: number
  noteEndX: number
}

export interface Layout {
  width: number
  height: number
  perRow: number
  rows: { yTop: number; yBottom: number }[]
  measures: MeasureBox[]
  notes: NoteHit[]
}

export interface RenderOptions {
  width: number
  /** Índice global del primer compás recibido (para numerar en PDF). */
  firstIndex?: number
  /** Compases por sistema; si se omite se calcula según el ancho. */
  perRow?: number
  /** Dibuja números de compás con VexFlow (PDF). En pantalla se usan insignias HTML. */
  measureNumbers?: boolean
  /** Muestra la métrica en el primer compás (false en páginas de continuación). */
  timeSig?: boolean
  /** Métrica de la partitura (4/4 por defecto). */
  meter?: Meter
  /** Separación entre sistemas (px); por defecto ROW_H. Con fondo escaneado se ajusta al papel. */
  rowH?: number
  /**
   * Anchos de compás por sistema (px), copiados de la partitura escaneada para que cada compás digital caiga
   * encima del de papel. Los sistemas que no estén aquí usan `perRow` compases iguales.
   */
  rowWidths?: number[][]
}

export function computePerRow(width: number): number {
  const inner = width - SIDE_PAD * 2
  return Math.max(1, Math.min(6, Math.floor((inner - CLEF_W - TIME_W) / MIN_MEASURE_W) + 0))
}

export function renderScore(container: HTMLElement, measures: Measure[], opts: RenderOptions): Layout {
  container.innerHTML = ''
  const width = opts.width
  const perRow = opts.perRow ?? computePerRow(width)
  const firstIndex = opts.firstIndex ?? 0
  const showTime = opts.timeSig ?? firstIndex === 0
  const inner = width - SIDE_PAD * 2
  const extras = CLEF_W + (showTime ? TIME_W : 0)
  const baseW = (inner - extras) / perRow
  // Reparto de compases en sistemas (con anchos del papel si los hay).
  const rowsSpec: number[][] = []
  for (let i = 0, r = 0; i < measures.length || r === 0; r++) {
    const given = opts.rowWidths?.[r]?.filter((v) => v > 20)
    const count = Math.max(1, given?.length || perRow)
    const n = Math.max(1, Math.min(count, measures.length - i))
    rowsSpec.push(given?.length ? given.slice(0, n) : Array.from({ length: n }, (_, c) => baseW + (c === 0 ? extras : 0)))
    i += n
    if (rowsSpec.length > 200) break
  }
  const rowCount = rowsSpec.length
  const rowH = opts.rowH ?? ROW_H
  const height = TOP_PAD + rowCount * rowH + 24

  const renderer = new Renderer(container as HTMLDivElement, Renderer.Backends.SVG)
  renderer.resize(width, height)
  const ctx = renderer.getContext()

  const layout: Layout = { width, height, perRow, rows: [], measures: [], notes: [] }

  let mi = -1
  for (let row = 0; row < rowCount; row++) {
    let x = SIDE_PAD
    const y = TOP_PAD - 40 + row * rowH // la línea superior queda 40 px por debajo
    let rowTop = 0
    let rowBottom = 0
    for (let c = 0; c < rowsSpec[row].length; c++) {
      mi++
      if (mi >= measures.length) break
      const first = c === 0
      const w = rowsSpec[row][c]
      const stave = new Stave(x, y, w)
      if (first) stave.addClef('treble')
      if (first && row === 0 && showTime) stave.addTimeSignature(opts.meter ?? '4/4')
      if (opts.measureNumbers) stave.setMeasure(firstIndex + mi + 1)
      stave.setContext(ctx).draw()
      rowTop = stave.getYForLine(0)
      rowBottom = stave.getYForLine(4)

      const box: MeasureBox = {
        index: mi,
        row,
        col: c,
        x,
        w,
        yTop: rowTop,
        yBottom: rowBottom,
        noteStartX: stave.getNoteStartX(),
        noteEndX: stave.getNoteEndX(),
      }
      layout.measures.push(box)

      const m = measures[mi]
      if (m.length > 0) drawNotes(ctx, stave, m, mi, layout, opts.meter ?? '4/4')
      x += w
    }
    layout.rows.push({ yTop: rowTop, yBottom: rowBottom })
  }
  return layout
}

function drawNotes(
  ctx: ReturnType<Renderer['getContext']>,
  stave: Stave,
  m: Measure,
  mi: number,
  layout: Layout,
  meter: Meter,
): void {
  const vfNotes = m.map((n) => {
    const isRest = n.kind === 'rest'
    const stemUp = n.step < 6
    const note = new StaveNote({
      keys: [isRest ? 'b/4' : vexKey(n.step)],
      duration: isRest ? `${n.dur}r` : n.dur,
      clef: 'treble',
      ...(isRest || n.dur === 'w' ? {} : { stemDirection: stemUp ? 1 : -1 }),
    })
    note.setAttribute('id', n.id)
    if (!isRest) {
      if (n.acc) note.addModifier(new VfAccidental(n.acc), 0)
      const pos = stemUp ? Modifier.Position.BELOW : Modifier.Position.ABOVE
      if (n.staccato) note.addModifier(new Articulation('a.').setPosition(pos), 0)
      if (n.accent) note.addModifier(new Articulation('a>').setPosition(pos), 0)
    }
    return note
  })

  const [numBeats, beatValue] = meter.split('/').map(Number)
  const voice = new Voice({ numBeats, beatValue }).setMode(Voice.Mode.SOFT)
  voice.addTickables(vfNotes)
  const fmt = new Formatter().joinVoices([voice])
  fmt.format([voice], Math.max(40, stave.getNoteEndX() - stave.getNoteStartX() - 18))
  const beams = Beam.generateBeams(vfNotes)
  voice.draw(ctx, stave)
  beams.forEach((b) => b.setContext(ctx).draw())

  // Ligaduras de expresión hacia la nota siguiente (dentro del mismo compás).
  m.forEach((n, i) => {
    if (!n.slur || n.kind !== 'note' || i >= m.length - 1 || m[i + 1].kind !== 'note') return
    new Curve(vfNotes[i], vfNotes[i + 1], { cps: [{ x: 0, y: 10 }, { x: 0, y: 10 }], thickness: 2 })
      .setContext(ctx)
      .draw()
  })

  vfNotes.forEach((vn, index) => {
    const bx = (vn.getNoteHeadBeginX() + vn.getNoteHeadEndX()) / 2
    layout.notes.push({
      id: m[index].id,
      measure: mi,
      index,
      kind: m[index].kind,
      x: bx,
      y: vn.getYs()[0],
    })
  })
}

/** Elemento SVG de una nota ya renderizada (para animaciones). */
export function noteElement(container: HTMLElement, id: string): SVGElement | null {
  return container.querySelector<SVGElement>(`#vf-${CSS.escape(id)}`)
}
