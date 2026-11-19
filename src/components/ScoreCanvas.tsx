import { animate, AnimatePresence, motion } from 'framer-motion'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { Annotation, Background, Clef, EditMode, LoopRange, Measure, Meter, Note, Pt, Stroke, Transposition } from '../types'
import { engine } from '../audio/engine'
import { bbox } from '../recognition/geometry'
import { clusterStrokes, detectBeams, isScratchOut, slurEnds, splitByHeads, STAFF_GAP } from '../recognition/recognize'
import { boxesNear } from '../recognition/geometry'
import { recognizePersonal } from '../recognition/personal'
import {
  clampStep,
  clefShift,
  keyAccidental,
  describeDiff,
  effectiveAccidental,
  makeNote,
  makeRest,
  measureCapacity,
  measureStatus,
  measureUnits,
  noteUnits,
  newId,
  soundingMidi,
  writtenMidi,
} from '../state/music'
import { type Layout, noteElement, renderScore } from '../notation/renderScore'
import {
  annotationsHit,
  appendStroke,
  createAnnotation,
  drawAnnotations,
  inkInside,
  inkNear,
  JOIN_MS,
  shouldJoin,
} from '../notation/annotations'
import { drawStroke } from './ink'
import { usePenSurface } from '../input/pen'
import { eraseOnImage, touchesImage } from '../scan/eraseScan'
import { getImage, putImage } from '../state/library'
import { ELASTIC } from './springs'
import { Camera } from 'lucide-react'

/** Pausa natural del lápiz antes de comprobar el compás: da tiempo a cabeza + plica + corchete o barra. */
const RECOGNIZE_DELAY = 1000
/** Si el Pencil sigue flotando sobre la pantalla se espera algo más, pero nunca más de esto. */
const MAX_WAIT = 2200
/** Radio de la goma (px). */
const ERASE_R = 16
const DRAG_THRESHOLD = 7
const NOTE_HIT_X = 15
const NOTE_HIT_Y = 17

interface Props {
  measures: Measure[]
  transposition: Transposition
  selectedId: string | null
  cursorId: string | null
  loopMode: boolean
  loopRange: LoopRange | null
  fingerDraw: boolean
  mode: EditMode
  annotations: Annotation[]
  setMeasures: (fn: (m: Measure[]) => Measure[], record?: boolean) => void
  setAnnotations: (fn: (a: Annotation[]) => Annotation[], record?: boolean) => void
  onSelect: (id: string | null) => void
  onBadge: (measure: number) => void
  onToast: (msg: string, tone?: 'info' | 'warn') => void
  onEdit: () => void
  /** Partitura escaneada de fondo y su imagen (object URL). */
  background?: Background
  bgUrl: string | null
  /** Modo "mover fondo": arrastrar desplaza la imagen en vez de dibujar. */
  adjustBg: boolean
  onBackground: (bg: Background, record?: boolean) => void
  /** Abre el escaneo/importación (botón de la hoja vacía). */
  onScan: () => void
  /** Métrica de la partitura: decide cuándo un compás está completo. */
  meter: Meter
  /** Clave: en Fa, la misma línea es una nota más grave (12 pasos). */
  clef: Clef
  /** Armadura escrita (quintas): decide cómo suena una nota sin alteración. */
  keySig: number
  /** Tempo para la indicación ♩ = bpm (no se dibuja sobre una partitura escaneada). */
  bpm: number
  /** Trompeta: digitaciones encima de las notas y notas fuera de registro en rojo. */
  fingerings: boolean
  rangeWarnings: boolean
  /** Zoom de Mila (pellizco): 1 = hoja ajustada al ancho. */
  userZoom: number
  onUserZoom: (z: number) => void
}

export const MIN_ZOOM = 0.5
export const MAX_ZOOM = 3
const clampZoom = (z: number) => Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, z))

interface Active {
  pointerId: number
  pts: Pt[]
  pen: boolean
  target: { id: string; measure: number; index: number; kind: 'note' | 'rest'; x: number; y: number } | null
  mode: 'undecided' | 'ink' | 'drag'
  /** Goma: ids ya borrados en este gesto (el layout se actualiza un instante después). */
  erased: Set<string>
  startX: number
  startY: number
  startStep: number
  recorded: boolean
  lastStep: number
}

export function ScoreCanvas(p: Props) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const hostRef = useRef<HTMLDivElement>(null)
  const inkRef = useRef<HTMLCanvasElement>(null)
  const captureRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(900)
  const [availH, setAvailH] = useState(700)
  const [layout, setLayout] = useState<Layout | null>(null)
  const layoutRef = useRef<Layout | null>(null)
  const annotRef = useRef<HTMLCanvasElement>(null)
  const popRef = useRef<string[]>([])
  const [bursts, setBursts] = useState<{ id: string; x: number; y: number; erase?: boolean }[]>([])
  const propsRef = useRef(p)
  propsRef.current = p

  // ---- Ancho disponible -------------------------------------------------
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      setWidth(Math.max(320, Math.floor(el.clientWidth - 24)))
      setAvailH(el.clientHeight)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // ---- Fondo escaneado: hoja de ancho fijo + zoom ----------------------------
  // Con fondo, la hoja digital se dibuja siempre con el ancho/espaciado con que se alineó al papel y se escala
  // para caber en pantalla: así no se desalinea al girar el iPad.
  const bg = p.background
  const renderW = bg ? bg.layoutWidth : width
  // Zoom total = ajuste al ancho (con fondo escaneado) × zoom de Mila (pellizco).
  const zoom = (bg ? width / bg.layoutWidth : 1) * p.userZoom
  const zoomRef = useRef(zoom)
  zoomRef.current = zoom
  const bgDisplayH = bg ? bg.layoutWidth * bg.scale * (bg.naturalH / bg.naturalW) : 0
  const paperW = layout?.width ?? renderW
  const paperH = Math.ceil(Math.max(layout?.height ?? 300, bg ? bg.y + bgDisplayH + 24 : 0, (availH - 24) / zoom))
  const paperRef = useRef({ w: paperW, h: paperH })
  paperRef.current = { w: paperW, h: paperH }

  // ---- Render VexFlow ---------------------------------------------------
  useLayoutEffect(() => {
    const host = hostRef.current
    if (!host) return
    const l = renderScore(
      host,
      p.measures,
      bg
        ? { meter: p.meter, clef: p.clef, key: p.keySig, fingerings: p.fingerings, rangeWarnings: p.rangeWarnings, width: bg.layoutWidth, perRow: bg.perRow, rowH: bg.rowH, rowWidths: bg.rowWidths }
        : { meter: p.meter, clef: p.clef, key: p.keySig, bpm: p.bpm, fingerings: p.fingerings, rangeWarnings: p.rangeWarnings, width },
    )
    layoutRef.current = l
    if (import.meta.env.DEV) (window as unknown as { __milaLayout?: Layout }).__milaLayout = l
    setLayout(l)
    if (popRef.current.length) {
      const ids = popRef.current
      popRef.current = []
      const fresh: { id: string; x: number; y: number }[] = []
      ids.forEach((id, i) => {
        const el = noteElement(host, id)
        if (el) {
          el.style.transformBox = 'fill-box'
          el.style.transformOrigin = 'center'
          // Efecto "pop": la nota limpia aparece con un rebote elástico.
          animate(
            el,
            { scale: [0.1, 1.18, 1], opacity: [0, 1, 1], rotate: [-14, 4, 0] },
            { duration: 0.5, delay: i * 0.05, ease: [0.2, 1.4, 0.4, 1] },
          )
        }
        const hit = l.notes.find((n) => n.id === id)
        if (hit) fresh.push({ id: `${id}-${Math.round(performance.now())}`, x: hit.x, y: hit.y })
      })
      if (fresh.length) setBursts((b) => [...b, ...fresh])
    }
  }, [p.measures, width, bg?.layoutWidth, bg?.perRow, bg?.rowH, bg?.rowWidths, p.clef, p.keySig, p.bpm, p.meter, p.fingerings, p.rangeWarnings])

  // ---- Canvas de tinta ----------------------------------------------------
  /** Tinta aún sin convertir; `measure` = compás donde se escribió (-1 fuera de los pentagramas). */
  const pendingRef = useRef<{ stroke: Stroke; pen: boolean; measure: number }[]>([])
  const activeRef = useRef<Active | null>(null)
  const rafRef = useRef(0)

  const redrawInk = useCallback(() => {
    const canvas = inkRef.current
    const l = layoutRef.current
    if (!canvas || !l) return
    const dpr = window.devicePixelRatio || 1
    const { w: pw, h: ph } = paperRef.current
    const w = Math.round(pw * dpr)
    const h = Math.round(ph * dpr)
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w
      canvas.height = h
    }
    const ctx = canvas.getContext('2d')!
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, pw, ph)
    const css = getComputedStyle(canvas)
    ctx.fillStyle = css.getPropertyValue('--ink').trim() || '#2b2118'
    for (const s of pendingRef.current) drawStroke(ctx, s.stroke, s.pen, true)
    const a = activeRef.current
    if (a && a.mode !== 'drag') {
      if (propsRef.current.mode === 'erase') {
        // Rastro de la goma: banda suave + círculo en la punta.
        const coral = css.getPropertyValue('--coral').trim() || '#ff6b4a'
        ctx.save()
        ctx.globalAlpha = 0.18
        ctx.fillStyle = coral
        drawStroke(ctx, a.pts, false, false, ERASE_R * 2, false)
        ctx.globalAlpha = 0.9
        ctx.strokeStyle = coral
        ctx.lineWidth = 2
        const tip = a.pts[a.pts.length - 1]
        ctx.beginPath()
        ctx.arc(tip.x, tip.y, ERASE_R, 0, Math.PI * 2)
        ctx.stroke()
        ctx.restore()
      } else if (propsRef.current.mode === 'annotate') {
        ctx.fillStyle = css.getPropertyValue('--annot').trim() || '#2f62d6'
        drawStroke(ctx, a.pts, a.pen, false, 4.6)
      } else drawStroke(ctx, a.pts, a.pen, false)
    }
  }, [])

  const scheduleRedraw = useCallback(() => {
    if (rafRef.current) return
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = 0
      redrawInk()
    })
  }, [redrawInk])

  useEffect(() => {
    redrawInk()
  }, [layout, paperH, redrawInk])

  // ---- Capa de anotaciones (vectorial, encima de la partitura) ---------------
  /** Pinta la capa de anotaciones; las marcadas por la goma (aún sin soltar el lápiz) salen atenuadas. */
  const drawAnnotLayer = useCallback((fade?: Set<string>) => {
    const canvas = annotRef.current
    const l = layoutRef.current
    if (!canvas || !l) return
    const dpr = window.devicePixelRatio || 1
    const { w: pw, h: ph } = paperRef.current
    const w = Math.round(pw * dpr)
    const h = Math.round(ph * dpr)
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w
      canvas.height = h
    }
    const ctx = canvas.getContext('2d')!
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, pw, ph)
    const color = getComputedStyle(canvas).getPropertyValue('--annot').trim() || '#2f62d6'
    const list = propsRef.current.annotations
    if (!fade?.size) return drawAnnotations(ctx, list, l, color)
    drawAnnotations(ctx, list.filter((a) => !fade.has(a.id)), l, color)
    ctx.globalAlpha = 0.2
    drawAnnotations(ctx, list.filter((a) => fade.has(a.id)), l, color)
    ctx.globalAlpha = 1
  }, [])

  useEffect(() => {
    drawAnnotLayer()
  }, [layout, paperH, p.annotations, drawAnnotLayer])

  /** Copia la tinta pendiente y la encoge/desvanece hacia la nota reconocida (transición trazo → partitura). */
  const ghostInk = useCallback((cx: number, cy: number) => {
    const src = inkRef.current
    if (!src || !src.parentElement || src.width === 0) return
    const ghost = document.createElement('canvas')
    ghost.width = src.width
    ghost.height = src.height
    ghost.getContext('2d')!.drawImage(src, 0, 0)
    ghost.className = src.className
    ghost.style.cssText = src.style.cssText
    ghost.style.transformOrigin = `${cx}px ${cy}px`
    src.parentElement.insertBefore(ghost, src)
    void animate(
      ghost,
      { opacity: [0.9, 0], scale: [1, 0.82], filter: ['blur(0px)', 'blur(2px)'] },
      { duration: 0.32, ease: 'easeIn' },
    ).then(() => ghost.remove())
  }, [])

  // ---- Reconocimiento -----------------------------------------------------
  const timerRef = useRef<number>(0)

  const rowFor = (cy: number, l: Layout) => {
    let best = -1
    let bestD = Infinity
    l.rows.forEach((r, i) => {
      const d = Math.abs(cy - (r.yTop + r.yBottom) / 2)
      if (d < bestD) {
        bestD = d
        best = i
      }
    })
    return bestD <= 95 ? best : -1
  }

  interface Ins {
    measure: number
    x: number
    note: Note
    row: number
  }

  /**
   * Lee la tinta SIN convertirla: qué notas/silencios, alteraciones y anotaciones saldrían. Sirve para
   * convertir y también para saber, antes de convertir, si el compás ya suma 4/4.
   */
  const readInk = (strokes: Stroke[], l: Layout) => {
    const inserts: Ins[] = []
    const looseAcc: { acc: Exclude<Note['acc'], ''>; x: number; row: number }[] = []
    const looseDots: { x: number; y: number; row: number }[] = []
    const toAnnotate: Stroke[][] = []
    const slurs: { row: number; x0: number; x1: number }[] = []
    let unknown = 0
    // Ligaduras: arcos cerca de un pentagrama (encima o debajo). Se sacan antes de agrupar para que no
    // junten dos notas en un solo símbolo; luego se unen las dos notas de sus extremos.
    let rest: Stroke[] = []
    for (const st of strokes) {
      const ends = slurEnds(st)
      const row = ends ? rowFor((ends.y0 + ends.y1) / 2, l) : -1
      if (ends && row >= 0) slurs.push({ row, x0: ends.x0, x1: ends.x1 })
      else rest.push(st)
    }
    // Barras de unión: se apartan y luego convierten en corcheas/semicorcheas las notas cuyas plicas tocan.
    const { beams, count: beamCount } = detectBeams(rest)
    rest = rest.filter((st) => !beams.has(st))
    // Lo que queda claramente por encima/debajo del pentagrama (texto, flechas) se agrupa aparte para que
    // nunca se mezcle con las plicas; lo de dentro se separa en una nota por cabeza. Un trazo de fuera que
    // toca uno de dentro (corchete o plica de una nota aguda) pertenece a la música.
    const farOut = (st: Stroke) => {
      const b = bbox(st)
      const row = rowFor(b.cy, l)
      if (row < 0) return true
      return b.y1 < l.rows[row].yTop - 15 || b.y0 > l.rows[row].yBottom + 15
    }
    const inStaff = rest.filter((st) => !farOut(st))
    let outsideList = rest.filter(farOut)
    for (let changed = true; changed; ) {
      changed = false
      const boxes = inStaff.map((st) => bbox(st))
      for (const st of outsideList) {
        const b = bbox(st)
        if (boxes.some((ib) => boxesNear(ib, b, 6))) {
          inStaff.push(st)
          outsideList = outsideList.filter((x) => x !== st)
          changed = true
          break
        }
      }
    }
    const groups = [...clusterStrokes(inStaff).flatMap(splitByHeads), ...clusterStrokes(outsideList)]
    for (const group of groups) {
      const box = bbox(group.flat())
      const row = rowFor(box.cy, l)
      // Lejos de cualquier pentagrama: es una anotación (texto, flecha, marca de ensayo...).
      if (row < 0) {
        toAnnotate.push(group)
        continue
      }
      const staff = l.rows[row]
      const rec = recognizePersonal(group, staff)
      if (rec.kind === 'barline') continue
      if (rec.kind === 'accidental') {
        looseAcc.push({ acc: rec.acc, x: rec.x, row })
        continue
      }
      if (rec.kind === 'dot') {
        looseDots.push({ x: rec.x, y: rec.y, row })
        continue
      }
      if (rec.kind === 'unknown') {
        // Por encima/debajo del pentagrama o con forma de texto (ancho, varios trazos): anotación.
        const outside = box.y1 < staff.yTop - STAFF_GAP * 1.5 || box.y0 > staff.yBottom + STAFF_GAP * 1.5
        const textLike = group.length >= 3 && box.w > 60
        if (outside || textLike) toAnnotate.push(group)
        else unknown++
        continue
      }
      const mbox = l.measures.find((m) => m.row === row && rec.x >= m.x && rec.x < m.x + m.w)
      if (!mbox) {
        unknown++
        continue
      }
      let dur = rec.dur
      // Nota unida por barra(s): 1 barra = corchea, 2 o más = semicorchea (solo cabezas rellenas).
      if (rec.kind === 'note' && (dur === 'q' || dur === '8')) {
        const beamsHere = Math.max(0, ...group.map((st) => beamCount.get(st) ?? 0))
        if (beamsHere >= 2) dur = '16'
        else if (beamsHere === 1 && dur === 'q') dur = '8'
      }
      const note =
        rec.kind === 'rest'
          ? makeRest(dur)
          : // El reconocedor lee posiciones en clave de Sol: en clave de Fa la misma posición es más grave.
            makeNote({ dur, step: rec.step + clefShift(propsRef.current.clef), acc: rec.acc ?? '', ...(rec.dot ? { dot: true } : {}) })
      inserts.push({ measure: mbox.index, x: rec.x, note, row })
    }

    return { inserts, looseAcc, looseDots, toAnnotate, unknown, slurs }
  }

  /** Compás (índice) donde cae un trazo: por el centro de su caja. -1 si está fuera de los pentagramas. */
  const measureFor = (stroke: Stroke, l: Layout): number => {
    const b = bbox(stroke)
    const row = rowFor(b.cy, l)
    if (row < 0) return -1
    const st = l.rows[row]
    if (b.y1 < st.yTop - 15 || b.y0 > st.yBottom + 15) return -1
    const inRow = l.measures.filter((m) => m.row === row)
    const hit = inRow.find((m) => b.cx >= m.x && b.cx < m.x + m.w)
    if (hit) return hit.index
    let best = -1
    let bestD = Infinity
    for (const m of inRow) {
      const d = Math.min(Math.abs(b.cx - m.x), Math.abs(b.cx - (m.x + m.w)))
      if (d < bestD) {
        bestD = d
        best = m.index
      }
    }
    return best
  }

  /** Lectura provisional de un compás: duración ya escrita + la de su tinta pendiente, y si hay algo dudoso. */
  const readMeasure = (mi: number) => {
    const l = layoutRef.current
    const done = measureUnits(propsRef.current.measures[mi] ?? [])
    const strokes = pendingRef.current.filter((s) => s.measure === mi).map((s) => s.stroke)
    if (!l || !strokes.length) return { units: done, unknown: 0 }
    const r = readInk(strokes, l)
    const units = r.inserts.filter((i) => i.measure === mi).reduce((sum, i) => sum + noteUnits(i.note), done)
    return { units, unknown: r.unknown }
  }


  /**
   * Convierte TODA la tinta pendiente (el compás entero que Mila haya escrito) de una vez:
   * notas y silencios → partitura; barras de compás → se aceptan; alteraciones sueltas → a su nota;
   * lo que claramente no es música (texto, flechas, fuera del pentagrama) → se conserva como anotación.
   */
  const flush = useCallback((only?: Set<number>) => {
    window.clearTimeout(timerRef.current)
    const l = layoutRef.current
    // Sin `only` se convierte todo; con `only`, solo esos compases (más la tinta fuera de los pentagramas).
    const take = (s: (typeof pendingRef.current)[number]) => !only || s.measure < 0 || only.has(s.measure)
    const pending = pendingRef.current.filter(take)
    pendingRef.current = pendingRef.current.filter((s) => !take(s))
    const strokes = pending.map((s) => s.stroke)
    const penUsed = pending.some((s) => s.pen)
    if (strokes.length > 0) {
      const all = bbox(strokes.flat())
      ghostInk(all.cx, all.cy)
    }
    redrawInk()
    if (!l || strokes.length === 0) return
    const cur = propsRef.current
    const read = readInk(strokes, l)
    const { inserts, looseAcc, toAnnotate } = read
    let unknown = read.unknown

    // Alteraciones sueltas: a la nota más cercana a su derecha (nueva o ya escrita).
    const accOnExisting = new Map<string, Exclude<Note['acc'], ''>>()
    for (const a of looseAcc) {
      const fresh = inserts
        .filter((i) => i.row === a.row && i.x > a.x && i.x - a.x < 45 && i.note.kind === 'note')
        .sort((p, q) => p.x - q.x)[0]
      if (fresh) {
        fresh.note = { ...fresh.note, acc: a.acc }
        continue
      }
      const rowMeasures = new Set(l.measures.filter((m) => m.row === a.row).map((m) => m.index))
      const hit = l.notes
        .filter((n) => rowMeasures.has(n.measure) && n.kind === 'note' && n.x > a.x && n.x - a.x < 45)
        .sort((p, q) => p.x - q.x)[0]
      if (hit) accOnExisting.set(hit.id, a.acc)
      else unknown++
    }

    // Puntillos sueltos: a la nota (o silencio) inmediatamente a su izquierda, nueva o ya escrita.
    const dotOnExisting = new Set<string>()
    for (const d of read.looseDots) {
      const fresh = inserts
        .filter((i) => i.row === d.row && i.x < d.x && d.x - i.x < 30)
        .sort((p, q) => q.x - p.x)[0]
      if (fresh) {
        fresh.note = { ...fresh.note, dot: true }
        continue
      }
      const rowMeasures = new Set(l.measures.filter((m) => m.row === d.row).map((m) => m.index))
      const hit = l.notes
        .filter((n) => rowMeasures.has(n.measure) && n.x < d.x && d.x - n.x < 30 && Math.abs(n.y - d.y) < 14)
        .sort((p, q) => q.x - p.x)[0]
      if (hit) dotOnExisting.add(hit.id)
      else unknown++
    }

    // Ligaduras: une la nota bajo el extremo izquierdo del arco con la del derecho (nuevas o ya escritas).
    const slurOnExisting = new Set<string>()
    for (const s of read.slurs) {
      const rowMeasures = new Set(l.measures.filter((m) => m.row === s.row).map((m) => m.index))
      const cands: { x: number; ins?: Ins; id?: string }[] = [
        ...inserts.filter((i) => i.row === s.row && i.note.kind === 'note').map((ins) => ({ x: ins.x, ins })),
        ...l.notes.filter((n) => rowMeasures.has(n.measure) && n.kind === 'note').map((n) => ({ x: n.x, id: n.id })),
      ]
      const nearest = (x: number) => cands.filter((c) => Math.abs(c.x - x) <= 24).sort((p, q) => Math.abs(p.x - x) - Math.abs(q.x - x))[0]
      const left = nearest(s.x0)
      const right = nearest(s.x1)
      if (!left || !right || left === right || left.x >= right.x) {
        unknown++
        continue
      }
      if (left.ins) left.ins.note = { ...left.ins.note, slur: true }
      else if (left.id) slurOnExisting.add(left.id)
    }

    if (inserts.length > 0 || accOnExisting.size > 0 || slurOnExisting.size > 0 || dotOnExisting.size > 0) {
      const xs = new Map<number, number[]>()
      const xsFor = (mi: number) => {
        if (!xs.has(mi)) xs.set(mi, l.notes.filter((n) => n.measure === mi).sort((a, b) => a.index - b.index).map((n) => n.x))
        return xs.get(mi)!
      }
      cur.onEdit()
      cur.setMeasures((ms) => {
        const touched = (n: Note) => accOnExisting.has(n.id) || slurOnExisting.has(n.id) || dotOnExisting.has(n.id)
        const next = ms.map((m) =>
          m.some(touched)
            ? m.map((n) =>
                touched(n)
                  ? { ...n, ...(accOnExisting.has(n.id) ? { acc: accOnExisting.get(n.id)! } : {}), ...(slurOnExisting.has(n.id) ? { slur: true } : {}), ...(dotOnExisting.has(n.id) ? { dot: true } : {}) }
                  : n,
              )
            : m.slice(),
        )
        for (const ins of [...inserts].sort((p, q) => p.x - q.x)) {
          const arr = xsFor(ins.measure)
          const idx = arr.filter((x) => x < ins.x).length
          next[ins.measure].splice(idx, 0, ins.note)
          arr.splice(idx, 0, ins.x)
        }
        return next
      })
      if (inserts.length) {
        const last = inserts[inserts.length - 1].note
        popRef.current = inserts.map((i) => i.note.id)
        cur.onSelect(last.id)
        if (last.kind === 'note') void engine.preview(soundingMidi(writtenMidi(last.step, last.acc || keyAccidental(last.step, cur.keySig)), cur.transposition), 260)
      } else {
        popRef.current = [...accOnExisting.keys(), ...slurOnExisting, ...dotOnExisting]
      }
    }

    // La tinta que no es música se conserva tal cual, como anotación (nunca se pierde ni se confunde).
    if (toAnnotate.length) {
      const created = toAnnotate
        .map((g) => {
          let a = createAnnotation(newId(), g[0], penUsed, l)
          for (const st of g.slice(1)) if (a) a = appendStroke(a, st, l)
          return a
        })
        .filter((a): a is Annotation => !!a)
      if (created.length) {
        cur.setAnnotations((list) => [...list, ...created])
        cur.onToast('Lo guardé como anotación (⌘Z si era una nota)')
      }
    }
    if (unknown > 0) cur.onToast('No lo reconocí. Prueba un círculo, o círculo + plica.', 'warn')
  }, [redrawInk, ghostInk])

  /**
   * Compás completo (sin botones): la tinta NO se convierte mientras se escribe. Tras una pausa natural del
   * lápiz se LEE (sin convertir) cada compás con tinta, y se digitaliza el que ya completa la métrica
   * (2/4, 3/4, 4/4 o 6/8) sin trazos dudosos. Un compás a medias se convierte cuando Mila pasa a escribir
   * en otro compás (ver finishStroke) o con Intro en el Mac.
   */
  const evaluate = useCallback(() => {
    if (activeRef.current) return
    const capacity = measureCapacity(propsRef.current.meter)
    const full = new Set<number>()
    for (const mi of new Set(pendingRef.current.map((s) => s.measure))) {
      if (mi < 0) continue
      const r = readMeasure(mi)
      if (r.units >= capacity && r.unknown === 0) full.add(mi)
    }
    if (full.size) flush(full)
    // readMeasure solo usa refs: no hace falta en las dependencias.
  }, [flush])

  /**
   * Pausa natural: el reloj arranca al levantar el lápiz y se reinicia al volver a apoyarlo, así Mila puede
   * escribir cabeza + plica + corchete sin cortes. Si el Pencil sigue flotando se espera algo más (con tope).
   */
  const idleSince = useRef(0)
  const queueFlush = useCallback(
    (hover = false) => {
      window.clearTimeout(timerRef.current)
      const now = performance.now()
      if (!hover) idleSince.current = now
      const wait = hover
        ? Math.min(RECOGNIZE_DELAY, Math.max(0, MAX_WAIT - (now - idleSince.current)))
        : RECOGNIZE_DELAY
      timerRef.current = window.setTimeout(evaluate, wait)
    },
    [evaluate],
  )

  // "Convertir" desde fuera (tecla Intro).
  useEffect(() => {
    const go = () => {
      if (pendingRef.current.length) flush()
    }
    window.addEventListener('mila:convert', go)
    return () => window.removeEventListener('mila:convert', go)
  }, [flush])

  useEffect(() => () => window.clearTimeout(timerRef.current), [])

  // Al salir del modo Notas, lo que estuviera pendiente se reconoce ya.
  useEffect(() => {
    if (p.mode !== 'notes' && pendingRef.current.length) flush()
  }, [p.mode, flush])

  // ---- Anotaciones a mano alzada --------------------------------------------
  const lastAnnot = useRef<{ id: string; at: number } | null>(null)

  /** Guarda el trazo tal cual: se suma a la anotación anterior si está cerca y es reciente (una palabra). */
  const commitAnnotation = (stroke: Stroke, pen: boolean) => {
    const l = layoutRef.current
    const cur = propsRef.current
    if (!l) return
    const now = performance.now()
    const info = lastAnnot.current
    const prev = info && now - info.at < JOIN_MS ? cur.annotations.find((a) => a.id === info.id) : undefined
    if (prev && shouldJoin(prev, stroke, l)) {
      const next = appendStroke(prev, stroke, l)
      if (next) {
        cur.setAnnotations((list) => list.map((a) => (a.id === prev.id ? next : a)))
        lastAnnot.current = { id: prev.id, at: now }
        return
      }
    }
    const created = createAnnotation(newId(), stroke, pen, l)
    if (!created) return
    cur.setAnnotations((list) => [...list, created])
    lastAnnot.current = { id: created.id, at: now }
  }

  /**
   * Tachado sobre anotaciones. Nunca borra la que se está escribiendo (una letra en zig-zag como M, N o W no
   * borra su palabra). En modo anotación (`strict`) el tachado tiene que pasar por encima de la tinta.
   */
  const eraseAnnotations = (box: ReturnType<typeof bbox>, strict: boolean): boolean => {
    const l = layoutRef.current
    const cur = propsRef.current
    if (!l) return false
    const now = performance.now()
    const writing = lastAnnot.current && now - lastAnnot.current.at < JOIN_MS ? lastAnnot.current.id : null
    const victims = annotationsHit(cur.annotations, l, box).filter(
      (a) => a.id !== writing && (!strict || inkInside(a, l, box)),
    )
    if (!victims.length) return false
    const ids = new Set(victims.map((v) => v.id))
    cur.setAnnotations((list) => list.filter((a) => !ids.has(a.id)))
    return true
  }

  // ---- Punteros -----------------------------------------------------------
  const touches = useRef(new Map<number, { x: number; y: number; big: boolean }>())
  const lastPenAt = useRef(0)
  const scrollGesture = useRef<{ cx: number; cy: number; d: number; z: number } | null>(null)
  /** Punto que debe quedarse bajo los dedos/cursor al hacer zoom (fracción del contenido + posición en pantalla). */
  const zoomAnchor = useRef<{ fx: number; fy: number; vx: number; vy: number } | null>(null)

  // Safari/iPadOS: sin esto, el sistema puede "robar" el trazo del Pencil a mitad (scroll, lupa, selección)
  // y dispara pointercancel: el trazo se cortaba al deslizar o al levantar el lápiz.
  const allowFinger = useCallback(() => propsRef.current.fingerDraw, [])
  usePenSurface(captureRef, allowFinger)

  /** Captura de puntero tolerante: si el puntero ya no existe, Safari lanza y no debe romper el trazo. */
  const capture = (id: number) => {
    try {
      captureRef.current!.setPointerCapture(id)
    } catch {
      /* noop */
    }
  }

  /** Zoom alrededor de un punto de la pantalla (los dedos o el cursor), sin que la hoja "salte". */
  const zoomAround = useCallback((nextZoom: number, clientX: number, clientY: number) => {
    const el = scrollRef.current
    if (!el) return
    const z = clampZoom(nextZoom)
    if (Math.abs(z - propsRef.current.userZoom) < 0.005) return
    const r = el.getBoundingClientRect()
    const vx = clientX - r.left
    const vy = clientY - r.top
    zoomAnchor.current = {
      fx: (el.scrollLeft + vx) / Math.max(1, el.scrollWidth),
      fy: (el.scrollTop + vy) / Math.max(1, el.scrollHeight),
      vx,
      vy,
    }
    propsRef.current.onUserZoom(Math.round(z * 100) / 100)
  }, [])

  // Tras cambiar el zoom, recolocar el scroll para mantener el punto bajo los dedos.
  useLayoutEffect(() => {
    const a = zoomAnchor.current
    const el = scrollRef.current
    if (!a || !el) return
    zoomAnchor.current = null
    el.scrollLeft = a.fx * el.scrollWidth - a.vx
    el.scrollTop = a.fy * el.scrollHeight - a.vy
  }, [zoom])

  // Mac: pellizco del trackpad (llega como rueda con Ctrl).
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return
      e.preventDefault()
      zoomAround(propsRef.current.userZoom * Math.exp(-e.deltaY * 0.01), e.clientX, e.clientY)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [zoomAround])

  const local = (e: { clientX: number; clientY: number }) => {
    const r = captureRef.current!.getBoundingClientRect()
    const z = zoomRef.current
    return { x: (e.clientX - r.left) / z, y: (e.clientY - r.top) / z }
  }

  const findTarget = (x: number, y: number) => {
    const l = layoutRef.current
    if (!l) return null
    let best: NonNullable<Active['target']> | null = null
    let bestD = Infinity
    for (const n of l.notes) {
      const dx = Math.abs(n.x - x)
      const dy = Math.abs(n.y - y)
      if (dx <= NOTE_HIT_X && dy <= NOTE_HIT_Y) {
        const d = dx * dx + dy * dy
        if (d < bestD) {
          bestD = d
          best = n
        }
      }
    }
    return best
  }

  // ---- Mover el fondo escaneado (modo Ajustar) -------------------------------
  const bgDrag = useRef<{ id: number; sx: number; sy: number; x: number; y: number; recorded: boolean } | null>(null)

  const onPointerDown = (e: React.PointerEvent) => {
    const cur = propsRef.current
    const type = e.pointerType
    if (cur.adjustBg && cur.background) {
      // Con el dedo o el lápiz: arrastrar desplaza la partitura escaneada.
      if (bgDrag.current) return
      e.preventDefault()
      capture(e.pointerId)
      bgDrag.current = { id: e.pointerId, sx: e.clientX, sy: e.clientY, x: cur.background.x, y: cur.background.y, recorded: false }
      return
    }
    if (type === 'pen') lastPenAt.current = performance.now()

    if (type === 'touch' && !cur.fingerDraw) {
      // Rechazo de palma: nada de dibujar con dedos. Dos dedos pequeños = scroll.
      const big = Math.max(e.width, e.height) > 38
      touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY, big })
      const penRecent = performance.now() - lastPenAt.current < 900 || activeRef.current?.pen
      if (touches.current.size === 2 && !penRecent) {
        const pts = [...touches.current.values()]
        if (!pts.some((t) => t.big)) {
          scrollGesture.current = {
            cx: (pts[0].x + pts[1].x) / 2,
            cy: (pts[0].y + pts[1].y) / 2,
            d: Math.max(20, Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y)),
            z: cur.userZoom,
          }
        }
      }
      return
    }
    if (type === 'mouse' && e.button !== 0) return
    const prev = activeRef.current
    if (prev) {
      // Un trazo que nunca recibió pointerup (Safari a veces lo pierde) no puede bloquear los siguientes:
      // se cierra con lo que tenga. Un dedo mientras el lápiz escribe se ignora.
      if (prev.pointerId === e.pointerId || type === 'pen' || !prev.pen) {
        activeRef.current = null
        finishStroke(prev)
      } else return
    }

    e.preventDefault()
    capture(e.pointerId)
    const { x, y } = local(e)
    const target = cur.mode === 'notes' ? findTarget(x, y) : null
    const pen = type === 'pen'
    const first: Pt = { x, y, p: pen && e.pressure > 0 ? e.pressure : 0.5, t: performance.now() }
    const n = target && target.kind === 'note' ? cur.measures[target.measure]?.[target.index] : undefined
    activeRef.current = {
      pointerId: e.pointerId,
      pts: [first],
      pen,
      target,
      mode: target ? 'undecided' : 'ink',
      startX: x,
      startY: y,
      startStep: n?.step ?? 0,
      recorded: false,
      lastStep: n?.step ?? 0,
      erased: new Set(),
    }
    window.clearTimeout(timerRef.current)
    if (cur.mode === 'erase') {
      eraseAt(activeRef.current, x, y)
      scheduleRedraw()
    }
  }

  /**
   * Goma, mientras se arrastra: marca (y atenúa) lo que toca la punta. No borra todavía, para que las notas
   * restantes no se recoloquen bajo el lápiz a mitad de gesto.
   */
  const eraseAt = (a: Active, x: number, y: number) => {
    const l = layoutRef.current
    const cur = propsRef.current
    if (!l) return
    const notes = l.notes.filter(
      (n) => !a.erased.has(n.id) && Math.abs(n.x - x) <= ERASE_R && Math.abs(n.y - y) <= ERASE_R + 4,
    )
    const anns = cur.annotations.filter((an) => !a.erased.has(an.id) && inkNear(an, l, x, y, ERASE_R))
    if (!notes.length && !anns.length) return
    for (const n of notes) {
      a.erased.add(n.id)
      const el = hostRef.current && noteElement(hostRef.current, n.id)
      if (el) el.style.opacity = '0.2'
    }
    for (const an of anns) a.erased.add(an.id)
    if (anns.length) drawAnnotLayer(a.erased)
  }

  /** Goma, al levantar el lápiz: borra todo lo marcado en un único paso de deshacer. */
  const commitErase = (a: Active) => {
    const l = layoutRef.current
    const cur = propsRef.current
    const ids = a.erased
    // La partitura escaneada es un calco editable: la goma también borra lo que hay en la foto.
    if (cur.background && touchesImage(cur.background, a.pts, ERASE_R)) erasePhoto(a.pts)
    if (!l || ids.size === 0) return
    const notes = l.notes.filter((n) => ids.has(n.id))
    const hasAnns = cur.annotations.some((an) => ids.has(an.id))
    cur.onEdit()
    if (notes.length) {
      cur.setMeasures((ms) => ms.map((m) => (m.some((n) => ids.has(n.id)) ? m.filter((n) => !ids.has(n.id)) : m)))
      if (cur.selectedId && ids.has(cur.selectedId)) cur.onSelect(null)
    }
    if (hasAnns) cur.setAnnotations((list) => list.filter((an) => !ids.has(an.id)), notes.length === 0)
    const stamp = Math.round(performance.now())
    setBursts((b) => [...b, ...notes.map((n) => ({ id: `e-${n.id}-${stamp}`, x: n.x, y: n.y, erase: true }))])
  }

  /** Pinta del color del papel la zona de la foto por donde pasó la goma (imagen nueva: Deshacer la recupera). */
  // Los borrados se encadenan: cada gesto se aplica sobre la imagen que dejó el anterior (aunque React aún
  // no haya repintado con el fondo nuevo).
  const photoQueue = useRef<Promise<void>>(Promise.resolve())
  const lastPhotoBg = useRef<Background | null>(null)
  const erasePhoto = (pts: Pt[]) => {
    photoQueue.current = photoQueue.current.then(async () => {
      const shown = propsRef.current.background
      if (lastPhotoBg.current && shown?.imageId === lastPhotoBg.current.imageId) lastPhotoBg.current = null
      const bg = lastPhotoBg.current ?? shown
      if (!bg) return
      try {
        const blob = await getImage(bg.imageId)
        if (!blob) return
        const next = await eraseOnImage(blob, bg, [pts], ERASE_R)
        if (!next) return
        const imageId = newId()
        await putImage(imageId, next)
        const nextBg = { ...bg, imageId }
        lastPhotoBg.current = nextBg
        propsRef.current.onBackground(nextBg, true)
      } catch {
        propsRef.current.onToast('No pude borrar en la foto', 'warn')
      }
    })
  }

  /** Gesto de goma cancelado (p.ej. por el sistema): se restaura lo atenuado. */
  const cancelErase = (a: Active) => {
    const host = hostRef.current
    for (const id of a.erased) {
      const el = host && noteElement(host, id)
      if (el) el.style.opacity = ''
    }
    drawAnnotLayer()
  }

  const applyDrag = (a: Active, y: number) => {
    const t = a.target!
    const id = t.id
    const delta = Math.round((a.startY - y) / (STAFF_GAP / 2))
    const step = clampStep(a.startStep + delta, propsRef.current.clef)
    if (step === a.lastStep) return
    a.lastStep = step
    const record = !a.recorded
    a.recorded = true
    const cur = propsRef.current
    if (record) cur.onEdit()
    cur.setMeasures(
      (ms) =>
        ms.map((m) => {
          const i = m.findIndex((n) => n.id === id)
          if (i < 0) return m
          const copy = m.slice()
          copy[i] = { ...copy[i], step }
          return copy
        }),
      record,
    )
    const m = cur.measures[t.measure]
    const acc = m ? effectiveAccidental(m.map((n) => (n.id === id ? { ...n, step } : n)), t.index, cur.keySig) : ''
    void engine.preview(soundingMidi(writtenMidi(step, acc), cur.transposition), 200)
  }

  const onPointerMove = (e: React.PointerEvent) => {
    const type = e.pointerType
    const d = bgDrag.current
    if (d) {
      const cur = propsRef.current
      if (d.id !== e.pointerId || !cur.background) return
      const z = zoomRef.current
      cur.onBackground(
        { ...cur.background, x: Math.round(d.x + (e.clientX - d.sx) / z), y: Math.round(d.y + (e.clientY - d.sy) / z) },
        !d.recorded,
      )
      d.recorded = true
      return
    }
    if (type === 'pen') {
      lastPenAt.current = performance.now()
      // Pencil flotando sobre el lienzo sin tocar: Mila está a punto de seguir el trazo.
      if (!activeRef.current && e.buttons === 0 && pendingRef.current.length) queueFlush(true)
    }

    if (type === 'touch' && !propsRef.current.fingerDraw) {
      const t = touches.current.get(e.pointerId)
      if (!t) return
      t.x = e.clientX
      t.y = e.clientY
      const g = scrollGesture.current
      const penRecent = performance.now() - lastPenAt.current < 900 || activeRef.current?.pen
      if (g && touches.current.size === 2 && !penRecent) {
        // Dos dedos: desplazar (y pellizcar para hacer zoom). El lápiz nunca hace esto.
        const pts = [...touches.current.values()]
        const cx = (pts[0].x + pts[1].x) / 2
        const cy = (pts[0].y + pts[1].y) / 2
        const d = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y)
        scrollRef.current?.scrollBy({ left: g.cx - cx, top: g.cy - cy })
        const ratio = d / g.d
        if (Math.abs(ratio - 1) > 0.04) zoomAround(g.z * ratio, cx, cy)
        scrollGesture.current = { ...g, cx, cy }
      }
      return
    }

    const a = activeRef.current
    if (!a || a.pointerId !== e.pointerId) return
    e.preventDefault()
    addPoints(a, e.nativeEvent)
    if (a.mode !== 'drag') scheduleRedraw()
  }

  /** Añade al trazo todos los puntos del evento (los "coalesced" del Pencil a 240 Hz incluidos). */
  const addPoints = (a: Active, native: PointerEvent) => {
    let list: PointerEvent[] = []
    try {
      list = (native.getCoalescedEvents?.() ?? []) as PointerEvent[]
    } catch {
      list = []
    }
    if (!list.length) list = [native]
    for (const ev of list) {
      const { x, y } = local(ev)
      const last = a.pts[a.pts.length - 1]
      if (last && last.x === x && last.y === y) continue
      // En pointerup la presión llega a 0: valor neutro para no afinar el final del trazo.
      a.pts.push({ x, y, p: a.pen && ev.pressure > 0 ? ev.pressure : 0.5, t: performance.now() })
      if (a.mode === 'undecided') {
        const dx = x - a.startX
        const dy = y - a.startY
        if (Math.hypot(dx, dy) >= DRAG_THRESHOLD) {
          // Movimiento claramente vertical sobre una nota = arrastrar para cambiar el tono.
          if (a.target!.kind === 'note' && Math.abs(dy) > Math.abs(dx) * 1.6) {
            a.mode = 'drag'
            propsRef.current.onSelect(a.target!.id)
          } else {
            a.mode = 'ink'
          }
        }
      }
      if (a.mode === 'drag') applyDrag(a, y)
      else if (propsRef.current.mode === 'erase') eraseAt(a, x, y)
    }
  }

  const finishStroke = (a: Active) => {
    const cur = propsRef.current
    const l = layoutRef.current
    const stroke = a.pts
    const box = bbox(stroke)
    const moved = Math.hypot(box.w, box.h)

    if (a.mode === 'drag') return

    if (cur.mode === 'erase') {
      commitErase(a)
      redrawInk()
      return
    }

    if (cur.mode === 'annotate') {
      if (moved >= 3) {
        const erased = stroke.length > 5 && isScratchOut(stroke) && eraseAnnotations(box, true)
        if (!erased) commitAnnotation(stroke, a.pen)
      }
      redrawInk()
      return
    }

    if (moved < 6) {
      // Toque: seleccionar nota o deseleccionar.
      cur.onSelect(a.target ? a.target.id : null)
      redrawInk()
      if (pendingRef.current.length) queueFlush()
      return
    }

    if (l && stroke.length > 5 && isScratchOut(stroke)) {
      let victim: Layout['notes'][number] | null = null
      let bestD = Infinity
      for (const n of l.notes) {
        if (n.x >= box.x0 - 10 && n.x <= box.x1 + 10 && n.y >= box.y0 - 14 && n.y <= box.y1 + 14) {
          const d = Math.hypot(n.x - box.cx, n.y - box.cy)
          if (d < bestD) {
            bestD = d
            victim = n
          }
        }
      }
      if (victim) {
        const id = victim.id
        cur.onEdit()
        cur.setMeasures((ms) => ms.map((m) => (m.some((n) => n.id === id) ? m.filter((n) => n.id !== id) : m)))
        if (cur.selectedId === id) cur.onSelect(null)
        redrawInk()
        if (pendingRef.current.length) queueFlush()
        return
      }
      if (eraseAnnotations(box, false)) {
        redrawInk()
        if (pendingRef.current.length) queueFlush()
        return
      }
    }

    let measure = l ? measureFor(stroke, l) : -1
    if (measure < 0) {
      // Fuera del pentagrama pero tocando tinta pendiente (barra de unión o corchete de una nota aguda,
      // ligadura): pertenece a ese compás.
      const sb = bbox(stroke)
      const host = pendingRef.current.find((s) => s.measure >= 0 && boxesNear(bbox(s.stroke), sb, 10))
      if (host) measure = host.measure
    }
    // Pasar a escribir en otro compás cierra el anterior: lo que tenga se convierte aunque no esté completo
    // (último compás, anacrusa...). El indicador del compás avisa si faltan tiempos.
    if (measure >= 0) {
      const others = new Set(pendingRef.current.map((s) => s.measure).filter((m) => m >= 0 && m !== measure))
      if (others.size) flush(others)
    }
    pendingRef.current.push({ stroke, pen: a.pen, measure })
    redrawInk()
    queueFlush()
  }

  const endPointer = (e: React.PointerEvent) => {
    if (bgDrag.current) {
      if (bgDrag.current.id === e.pointerId) bgDrag.current = null
      return
    }
    if (e.pointerType === 'touch' && !propsRef.current.fingerDraw) {
      touches.current.delete(e.pointerId)
      if (touches.current.size < 2) scrollGesture.current = null
      return
    }
    const a = activeRef.current
    if (!a || a.pointerId !== e.pointerId) return
    activeRef.current = null
    // El último tramo (entre el último pointermove y el pointerup) también cuenta.
    if (e.type === 'pointerup') addPoints(a, e.nativeEvent)
    // pointercancel: iPadOS puede cancelar a mitad de trazo. Lo dibujado se conserva en vez de perderse;
    // solo un toque sin mover sobre una nota (aún sin decidir) se descarta.
    if (e.type === 'pointercancel' && a.mode === 'undecided') {
      if (a.erased.size) cancelErase(a)
      redrawInk()
      return
    }
    finishStroke(a)
  }

  /** Si el navegador suelta la captura sin pointerup, el trazo se cierra igualmente. */
  const onLostCapture = (e: React.PointerEvent) => {
    const a = activeRef.current
    if (!a || a.pointerId !== e.pointerId) return
    activeRef.current = null
    finishStroke(a)
  }

  // ---- Auto-scroll del cursor --------------------------------------------
  const cursorHit = useMemo(
    () => (p.cursorId && layout ? layout.notes.find((n) => n.id === p.cursorId) ?? null : null),
    [p.cursorId, layout],
  )
  const cursorRow = cursorHit && layout ? layout.measures.find((m) => m.index === cursorHit.measure)?.row ?? 0 : -1
  useEffect(() => {
    if (cursorRow < 0 || !layout || !scrollRef.current) return
    const r = layout.rows[cursorRow]
    const el = scrollRef.current
    const z = zoomRef.current
    const top = (r.yTop - 70) * z
    const bottom = (r.yBottom + 80) * z
    if (top < el.scrollTop || bottom > el.scrollTop + el.clientHeight) {
      el.scrollTo({ top: Math.max(0, top - 20), behavior: 'smooth' })
    }
  }, [cursorRow, layout])

  const selectedHit = p.selectedId && layout ? layout.notes.find((n) => n.id === p.selectedId) ?? null : null
  const empty = p.measures.every((m) => m.length === 0)

  return (
    <div ref={scrollRef} className="relative min-h-0 flex-1 overflow-auto overscroll-none" style={{ touchAction: 'pan-x pan-y' }}>
      <div className="relative mx-auto my-3" style={{ width: paperW * zoom, height: paperH * zoom }}>
      <div
        className="absolute left-0 top-0 rounded-[28px] border border-line bg-paper shadow-[0_10px_40px_-18px_rgba(120,70,20,0.35)] transition-colors duration-300"
        style={{
          width: paperW,
          height: paperH,
          transform: zoom === 1 ? undefined : `scale(${zoom})`,
          transformOrigin: '0 0',
        }}
      >
        {/* Partitura escaneada de fondo */}
        {bg && p.bgUrl && (
          <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-[28px]">
            <img
              src={p.bgUrl}
              alt=""
              draggable={false}
              data-testid="scan-bg"
              className={`scan-bg absolute select-none ${bg.enhance ? 'enhance' : ''}`}
              style={{
                left: bg.x,
                top: bg.y,
                width: bg.layoutWidth * bg.scale,
                maxWidth: 'none',
                opacity: bg.opacity,
                transform: bg.rotation ? `rotate(${bg.rotation}deg)` : undefined,
                transformOrigin: 'center',
                outline: p.adjustBg ? '3px dashed var(--coral)' : undefined,
              }}
            />
          </div>
        )}
        <div ref={hostRef} className="score-svg absolute inset-0" />

        {/* Bucle seleccionado */}
        {layout &&
          p.loopRange &&
          layout.measures
            .filter((m) => m.index >= p.loopRange!.start && m.index <= p.loopRange!.end)
            .map((m) => (
              <motion.div
                key={`loop-${m.index}`}
                className="pointer-events-none absolute rounded-xl border-2 border-sun/80 bg-sun/15"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                style={{ left: m.x + 2, top: m.yTop - 42, width: m.w - 4, height: m.yBottom - m.yTop + 84 }}
              />
            ))}

        {/* Indicador de compás (4/4) */}
        {layout?.measures.map((m) => {
          const st = measureStatus(p.measures[m.index] ?? [], p.meter)
          if (st.state === 'empty') return null
          const ok = st.state === 'ok'
          return (
            <div
              key={`st-${m.index}`}
              className="pointer-events-none absolute"
              style={{ left: m.x + m.w - 8, top: m.yTop - 32, transform: 'translateX(-100%)' }}
            >
              <motion.div
                className="flex items-center gap-1 whitespace-nowrap text-[11px] font-semibold"
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: ok ? 0.55 : 1, y: 0 }}
              >
                {!ok && (
                  <span style={{ color: st.state === 'short' ? 'var(--warn)' : 'var(--bad)' }}>{describeDiff(st.diff, p.meter)}</span>
                )}
                <span
                  className="inline-block h-2 w-2 rounded-full"
                  style={{ background: ok ? 'var(--good)' : st.state === 'short' ? 'var(--warn)' : 'var(--bad)' }}
                />
              </motion.div>
            </div>
          )
        })}

        {/* Insignias de número de compás (también sirven para elegir el bucle) */}
        {layout?.measures.map((m) => {
          const inLoop = p.loopRange && m.index >= p.loopRange.start && m.index <= p.loopRange.end
          return (
            <button
              key={`b-${m.index}`}
              type="button"
              aria-label={`Compás ${m.index + 1}`}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => p.onBadge(m.index)}
              className="absolute z-20 grid place-items-center rounded-full text-[11px] font-bold"
              style={{
                left: m.x + (m.col === 0 ? 8 : 6),
                top: m.yTop - 44,
                width: p.loopMode ? 30 : 22,
                height: p.loopMode ? 30 : 22,
                marginLeft: p.loopMode ? -4 : 0,
                marginTop: p.loopMode ? -4 : 0,
                background: inLoop ? 'var(--sun)' : p.loopMode ? 'var(--panel)' : 'transparent',
                border: p.loopMode ? '2px solid var(--sun)' : 'none',
                color: inLoop ? '#2b2118' : 'var(--muted)',
                transition: 'all .2s',
              }}
            >
              {m.index + 1}
            </button>
          )
        })}

        {/* Nota seleccionada */}
        <AnimatePresence>
          {selectedHit && (
            <motion.div
              key="sel"
              className="pointer-events-none absolute rounded-full border-2 border-coral"
              style={{ width: 34, height: 34, left: 0, top: 0, boxShadow: '0 0 0 4px color-mix(in srgb, var(--coral) 20%, transparent)' }}
              initial={{ opacity: 0, scale: 0.4, x: selectedHit.x - 17, y: selectedHit.y - 17 }}
              animate={{ opacity: 1, scale: 1, x: selectedHit.x - 17, y: selectedHit.y - 17 }}
              exit={{ opacity: 0, scale: 0.6 }}
              transition={{ type: 'spring', stiffness: 520, damping: 26 }}
            />
          )}
        </AnimatePresence>

        {/* Cursor de reproducción */}
        <AnimatePresence>
          {cursorHit && layout && (
            <motion.div
              key="cursor"
              data-testid="cursor"
              className="pointer-events-none absolute rounded-full"
              style={{
                width: 6,
                left: 0,
                top: 0,
                background: 'linear-gradient(var(--coral), var(--sun))',
                boxShadow: '0 0 18px 4px color-mix(in srgb, var(--sun) 55%, transparent)',
              }}
              initial={{ opacity: 0 }}
              animate={{
                opacity: 1,
                x: cursorHit.x - 3,
                y: layout.rows[cursorRow].yTop - 36,
                height: layout.rows[cursorRow].yBottom - layout.rows[cursorRow].yTop + 72,
              }}
              exit={{ opacity: 0 }}
              transition={{ type: 'spring', stiffness: 260, damping: 26 }}
            />
          )}
        </AnimatePresence>

        {/* Pista de bienvenida */}
        <AnimatePresence>
          {empty && layout && p.mode === 'notes' && p.annotations.length === 0 && !bg && (
            <motion.div
              key="hint"
              className="pointer-events-none absolute left-1/2 z-20 grid -translate-x-1/2 place-items-center gap-3 text-center"
              style={{ top: layout.rows[0].yBottom + 52, width: Math.min(520, layout.width - 40) }}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
            >
              <div className="rounded-2xl bg-sun/25 px-5 py-3 text-sm font-semibold text-ink">
                ✏️ Dibuja una nota sobre el pentagrama
                <div className="mt-1 text-xs font-medium text-muted">
                  ○ redonda · ○| blanca · ●| negra · ●|⟩ corchea · tacha en zig-zag para borrar
                </div>
              </div>
              <motion.button
                type="button"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={p.onScan}
                whileTap={{ scale: 0.94 }}
                transition={ELASTIC}
                className="pointer-events-auto flex h-11 items-center gap-2 rounded-full bg-la px-5 text-sm font-extrabold text-[#2b2118] shadow-lg"
              >
                <Camera size={18} /> o escanea / importa tu partitura de papel
              </motion.button>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Destello al convertir un trazo en nota limpia */}
        <AnimatePresence>
          {bursts.map((b) => (
            <motion.div
              key={b.id}
              className="pointer-events-none absolute z-[9]"
              style={{ left: b.x, top: b.y }}
              initial={{ opacity: 1 }}
              animate={{ opacity: 0 }}
              transition={{ duration: 0.55, ease: 'easeOut' }}
              onAnimationComplete={() => setBursts((list) => list.filter((x) => x.id !== b.id))}
            >
              <motion.span
                className={`absolute rounded-full border-2 ${b.erase ? 'border-coral' : 'border-mi'}`}
                style={{ width: 40, height: 40, left: -20, top: -20 }}
                initial={{ scale: 0.3 }}
                animate={{ scale: 1.6 }}
                transition={{ duration: 0.5, ease: 'easeOut' }}
              />
              {Array.from({ length: 6 }, (_, i) => {
                const ang = (i / 6) * Math.PI * 2
                return (
                  <motion.span
                    key={i}
                    className="absolute h-[5px] w-[5px] rounded-full"
                    style={{
                      left: -2.5,
                      top: -2.5,
                      background: b.erase ? (i % 2 ? 'var(--coral)' : 'var(--muted)') : i % 2 ? 'var(--la)' : 'var(--mi)',
                    }}
                    initial={{ x: 0, y: 0, scale: 1 }}
                    animate={{ x: Math.cos(ang) * 26, y: Math.sin(ang) * 26, scale: 0.3 }}
                    transition={{ duration: 0.5, ease: [0.2, 0.8, 0.3, 1] }}
                  />
                )
              })}
            </motion.div>
          ))}
        </AnimatePresence>

        {/* Capa de anotaciones a mano alzada */}
        <canvas
          ref={annotRef}
          data-testid="annotations"
          className="pointer-events-none absolute left-0 top-0 z-[8]"
          style={{ width: paperW, height: paperH }}
        />

        {/* Tinta + captura de gestos */}
        <canvas
          ref={inkRef}
          className="pointer-events-none absolute left-0 top-0 z-10"
          style={{ width: paperW, height: paperH }}
        />
        <div
          ref={captureRef}
          data-testid="capture"
          className="absolute inset-0 z-10"
          style={{ touchAction: 'none', cursor: p.adjustBg ? 'move' : p.mode === 'annotate' ? 'text' : p.mode === 'erase' ? 'cell' : 'crosshair', WebkitUserSelect: 'none', WebkitTouchCallout: 'none' }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endPointer}
          onPointerCancel={endPointer}
          onLostPointerCapture={onLostCapture}
          onContextMenu={(e) => e.preventDefault()}
        />
      </div>
      </div>
    </div>
  )
}

