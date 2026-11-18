import { animate, AnimatePresence, motion } from 'framer-motion'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { LoopRange, Measure, Note, Pt, Stroke, Transposition } from '../types'
import { engine } from '../audio/engine'
import { bbox } from '../recognition/geometry'
import {
  clusterStrokes,
  isScratchOut,
  recognizeCluster,
  STAFF_GAP,
} from '../recognition/recognize'
import {
  clampStep,
  describeDiff,
  effectiveAccidental,
  makeNote,
  makeRest,
  measureStatus,
  soundingMidi,
  writtenMidi,
} from '../state/music'
import { type Layout, noteElement, renderScore } from '../notation/renderScore'
import { drawStroke } from './ink'

const RECOGNIZE_DELAY = 520
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
  setMeasures: (fn: (m: Measure[]) => Measure[], record?: boolean) => void
  onSelect: (id: string | null) => void
  onBadge: (measure: number) => void
  onToast: (msg: string, tone?: 'info' | 'warn') => void
  onEdit: () => void
}

interface Active {
  pointerId: number
  pts: Pt[]
  pen: boolean
  target: { id: string; measure: number; index: number; kind: 'note' | 'rest'; x: number; y: number } | null
  mode: 'undecided' | 'ink' | 'drag'
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
  const [layout, setLayout] = useState<Layout | null>(null)
  const layoutRef = useRef<Layout | null>(null)
  const popRef = useRef<string | null>(null)
  const propsRef = useRef(p)
  propsRef.current = p

  // ---- Ancho disponible -------------------------------------------------
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setWidth(Math.max(320, Math.floor(el.clientWidth - 24))))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // ---- Render VexFlow ---------------------------------------------------
  useLayoutEffect(() => {
    const host = hostRef.current
    if (!host) return
    const l = renderScore(host, p.measures, { width })
    layoutRef.current = l
    if (import.meta.env.DEV) (window as unknown as { __milaLayout?: Layout }).__milaLayout = l
    setLayout(l)
    if (popRef.current) {
      const el = noteElement(host, popRef.current)
      popRef.current = null
      if (el) {
        el.style.transformBox = 'fill-box'
        el.style.transformOrigin = 'center'
        animate(el, { scale: [0.15, 1], opacity: [0, 1] }, { type: 'spring', stiffness: 520, damping: 11, mass: 0.7 })
      }
    }
  }, [p.measures, width])

  // ---- Canvas de tinta ----------------------------------------------------
  const pendingRef = useRef<{ stroke: Stroke; pen: boolean }[]>([])
  const activeRef = useRef<Active | null>(null)
  const rafRef = useRef(0)

  const redrawInk = useCallback(() => {
    const canvas = inkRef.current
    const l = layoutRef.current
    if (!canvas || !l) return
    const dpr = window.devicePixelRatio || 1
    const w = Math.round(l.width * dpr)
    const h = Math.round(l.height * dpr)
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w
      canvas.height = h
    }
    const ctx = canvas.getContext('2d')!
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, l.width, l.height)
    ctx.fillStyle = getComputedStyle(canvas).getPropertyValue('--ink').trim() || '#2b2118'
    for (const s of pendingRef.current) drawStroke(ctx, s.stroke, s.pen, true)
    const a = activeRef.current
    if (a && a.mode !== 'drag') drawStroke(ctx, a.pts, a.pen, false)
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
  }, [layout, redrawInk])

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

  const flush = useCallback(() => {
    const l = layoutRef.current
    const strokes = pendingRef.current.map((s) => s.stroke)
    pendingRef.current = []
    redrawInk()
    if (!l || strokes.length === 0) return
    const cur = propsRef.current

    interface Ins {
      measure: number
      x: number
      note: Note
    }
    const inserts: Ins[] = []
    let unknown = 0
    for (const group of clusterStrokes(strokes)) {
      const box = bbox(group.flat())
      const row = rowFor(box.cy, l)
      if (row < 0) {
        unknown++
        continue
      }
      const rec = recognizeCluster(group, l.rows[row])
      if (rec.kind === 'unknown') {
        unknown++
        continue
      }
      const mbox = l.measures.find((m) => m.row === row && rec.x >= m.x && rec.x < m.x + m.w)
      if (!mbox) {
        unknown++
        continue
      }
      const note =
        rec.kind === 'rest' ? makeRest(rec.dur) : makeNote({ dur: rec.dur, step: rec.step })
      inserts.push({ measure: mbox.index, x: rec.x, note })
    }

    if (inserts.length > 0) {
      const xs = new Map<number, number[]>()
      const xsFor = (mi: number) => {
        if (!xs.has(mi)) xs.set(mi, l.notes.filter((n) => n.measure === mi).sort((a, b) => a.index - b.index).map((n) => n.x))
        return xs.get(mi)!
      }
      cur.onEdit()
      cur.setMeasures((ms) => {
        const next = ms.map((m) => m.slice())
        for (const ins of inserts) {
          const arr = xsFor(ins.measure)
          const idx = arr.filter((x) => x < ins.x).length
          next[ins.measure].splice(idx, 0, ins.note)
          arr.splice(idx, 0, ins.x)
        }
        return next
      })
      const last = inserts[inserts.length - 1].note
      popRef.current = last.id
      cur.onSelect(last.id)
      if (last.kind === 'note') {
        void engine.preview(soundingMidi(writtenMidi(last.step, ''), cur.transposition), 260)
      }
    }
    if (unknown > 0) cur.onToast('No lo reconocí. Prueba un círculo, o círculo + plica.', 'warn')
  }, [redrawInk])

  const queueFlush = useCallback(() => {
    window.clearTimeout(timerRef.current)
    timerRef.current = window.setTimeout(flush, RECOGNIZE_DELAY)
  }, [flush])

  useEffect(() => () => window.clearTimeout(timerRef.current), [])

  // ---- Punteros -----------------------------------------------------------
  const touches = useRef(new Map<number, { x: number; y: number; big: boolean }>())
  const lastPenAt = useRef(0)
  const scrollGesture = useRef<{ cx: number; cy: number } | null>(null)

  const local = (e: { clientX: number; clientY: number }) => {
    const r = captureRef.current!.getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top }
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

  const onPointerDown = (e: React.PointerEvent) => {
    const cur = propsRef.current
    const type = e.pointerType
    if (type === 'pen') lastPenAt.current = performance.now()

    if (type === 'touch' && !cur.fingerDraw) {
      // Rechazo de palma: nada de dibujar con dedos. Dos dedos pequeños = scroll.
      const big = Math.max(e.width, e.height) > 38
      touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY, big })
      const penRecent = performance.now() - lastPenAt.current < 900 || activeRef.current?.pen
      if (touches.current.size === 2 && !penRecent) {
        const pts = [...touches.current.values()]
        if (!pts.some((t) => t.big)) {
          scrollGesture.current = { cx: (pts[0].x + pts[1].x) / 2, cy: (pts[0].y + pts[1].y) / 2 }
        }
      }
      return
    }
    if (type === 'mouse' && e.button !== 0) return
    if (activeRef.current) return

    e.preventDefault()
    captureRef.current!.setPointerCapture(e.pointerId)
    const { x, y } = local(e)
    const target = findTarget(x, y)
    const pen = type === 'pen'
    const first: Pt = { x, y, p: pen ? e.pressure || 0.5 : 0.5, t: performance.now() }
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
    }
    window.clearTimeout(timerRef.current)
  }

  const applyDrag = (a: Active, y: number) => {
    const t = a.target!
    const id = t.id
    const delta = Math.round((a.startY - y) / (STAFF_GAP / 2))
    const step = clampStep(a.startStep + delta)
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
    const acc = m ? effectiveAccidental(m.map((n) => (n.id === id ? { ...n, step } : n)), t.index) : ''
    void engine.preview(soundingMidi(writtenMidi(step, acc), cur.transposition), 200)
  }

  const onPointerMove = (e: React.PointerEvent) => {
    const type = e.pointerType
    if (type === 'pen') lastPenAt.current = performance.now()

    if (type === 'touch' && !propsRef.current.fingerDraw) {
      const t = touches.current.get(e.pointerId)
      if (!t) return
      t.x = e.clientX
      t.y = e.clientY
      const g = scrollGesture.current
      const penRecent = performance.now() - lastPenAt.current < 900 || activeRef.current?.pen
      if (g && touches.current.size === 2 && !penRecent) {
        const pts = [...touches.current.values()]
        const cx = (pts[0].x + pts[1].x) / 2
        const cy = (pts[0].y + pts[1].y) / 2
        scrollRef.current?.scrollBy({ left: g.cx - cx, top: g.cy - cy })
        scrollGesture.current = { cx, cy }
      }
      return
    }

    const a = activeRef.current
    if (!a || a.pointerId !== e.pointerId) return
    const events = (e.nativeEvent.getCoalescedEvents?.() ?? []) as PointerEvent[]
    const list = events.length ? events : [e.nativeEvent]
    for (const ev of list) {
      const { x, y } = local(ev)
      a.pts.push({ x, y, p: a.pen ? ev.pressure || 0.5 : 0.5, t: performance.now() })
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
    }
    if (a.mode !== 'drag') scheduleRedraw()
  }

  const finishStroke = (a: Active) => {
    const cur = propsRef.current
    const l = layoutRef.current
    const stroke = a.pts
    const box = bbox(stroke)
    const moved = Math.hypot(box.w, box.h)

    if (a.mode === 'drag') return

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
    }

    pendingRef.current.push({ stroke, pen: a.pen })
    redrawInk()
    queueFlush()
  }

  const endPointer = (e: React.PointerEvent) => {
    if (e.pointerType === 'touch' && !propsRef.current.fingerDraw) {
      touches.current.delete(e.pointerId)
      if (touches.current.size < 2) scrollGesture.current = null
      return
    }
    const a = activeRef.current
    if (!a || a.pointerId !== e.pointerId) return
    activeRef.current = null
    if (e.type !== 'pointercancel') finishStroke(a)
    else redrawInk()
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
    const top = r.yTop - 70
    const bottom = r.yBottom + 80
    if (top < el.scrollTop || bottom > el.scrollTop + el.clientHeight) {
      el.scrollTo({ top: Math.max(0, top - 20), behavior: 'smooth' })
    }
  }, [cursorRow, layout])

  const selectedHit = p.selectedId && layout ? layout.notes.find((n) => n.id === p.selectedId) ?? null : null
  const empty = p.measures.every((m) => m.length === 0)

  return (
    <div ref={scrollRef} className="relative min-h-0 flex-1 overflow-auto overscroll-contain" style={{ touchAction: 'pan-x pan-y' }}>
      <div
        className="relative mx-auto my-3 rounded-[28px] border border-line bg-paper shadow-[0_10px_40px_-18px_rgba(120,70,20,0.35)] transition-colors duration-300"
        style={{ width: layout?.width ?? width, height: layout?.height ?? 300, minHeight: 'calc(100% - 24px)' }}
      >
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
          const st = measureStatus(p.measures[m.index] ?? [])
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
                  <span style={{ color: st.state === 'short' ? 'var(--warn)' : 'var(--bad)' }}>{describeDiff(st.diff)}</span>
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
                left: m.x + (m.index % layout.perRow === 0 ? 8 : 6),
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
          {empty && layout && (
            <motion.div
              key="hint"
              className="pointer-events-none absolute left-1/2 grid -translate-x-1/2 place-items-center text-center"
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
            </motion.div>
          )}
        </AnimatePresence>

        {/* Tinta + captura de gestos */}
        <canvas
          ref={inkRef}
          className="pointer-events-none absolute left-0 top-0 z-10"
          style={{ width: layout?.width, height: layout?.height }}
        />
        <div
          ref={captureRef}
          data-testid="capture"
          className="absolute inset-0 z-10"
          style={{ touchAction: 'none', cursor: 'crosshair' }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endPointer}
          onPointerCancel={endPointer}
          onContextMenu={(e) => e.preventDefault()}
        />
      </div>
    </div>
  )
}

