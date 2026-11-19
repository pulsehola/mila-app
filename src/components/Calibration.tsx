import { motion } from 'framer-motion'
import { ArrowLeft, Check, Eraser, Sparkles, X } from 'lucide-react'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Accidental as VfAccidental, Formatter, Renderer, Stave, StaveNote, Voice } from 'vexflow'
import type { Pt, Stroke } from '../types'
import { pointsOf, usePenSurface } from '../input/pen'
import { labelOf, recognizePersonal } from '../recognition/personal'
import { addSamples, type HandProfile, loadDraft, loadDraftAsync, loadProfile, saveDraft } from '../recognition/profile'
import { type Recognized, STAFF_GAP, type StaffCtx } from '../recognition/recognize'
import type { SymbolLabel } from '../recognition/templates'
import { DUR_LABEL } from '../state/music'
import { drawStroke } from './ink'

interface Step {
  label: SymbolLabel
  name: string
  how: string
  /** Qué dibujar en la referencia VexFlow. */
  ref: { keys: string; duration: string; acc?: string }[]
}

export const CALIBRATION_STEPS: Step[] = [
  { label: 'note:w', name: 'Redonda', how: 'Un círculo vacío', ref: [{ keys: 'b/4', duration: 'w' }] },
  { label: 'note:h', name: 'Blanca', how: 'Círculo vacío + plica', ref: [{ keys: 'g/4', duration: 'h' }] },
  { label: 'note:q', name: 'Negra', how: 'Cabeza rellena + plica', ref: [{ keys: 'g/4', duration: 'q' }] },
  { label: 'note:8', name: 'Corchea', how: 'Negra + un corchete', ref: [{ keys: 'g/4', duration: '8' }] },
  { label: 'note:16', name: 'Semicorchea', how: 'Negra + dos corchetes', ref: [{ keys: 'g/4', duration: '16' }] },
  { label: 'acc:#', name: 'Sostenido ♯', how: 'Solo el ♯, como lo pones delante de una nota', ref: [{ keys: 'b/4', duration: 'q', acc: '#' }] },
  { label: 'acc:b', name: 'Bemol ♭', how: 'Solo el ♭', ref: [{ keys: 'b/4', duration: 'q', acc: 'b' }] },
  { label: 'acc:n', name: 'Becuadro ♮', how: 'Solo el ♮', ref: [{ keys: 'b/4', duration: 'q', acc: 'n' }] },
  {
    label: 'rest:bar',
    name: 'Silencio de redonda / blanca',
    how: 'La barra: colgando de la 4ª línea o apoyada en la 3ª',
    ref: [
      { keys: 'b/4', duration: 'wr' },
      { keys: 'b/4', duration: 'hr' },
    ],
  },
  { label: 'rest:q', name: 'Silencio de negra', how: 'El zig-zag vertical', ref: [{ keys: 'b/4', duration: 'qr' }] },
  { label: 'rest:8', name: 'Silencio de corchea', how: 'Una especie de «7»', ref: [{ keys: 'b/4', duration: '8r' }] },
  { label: 'rest:16', name: 'Silencio de semicorchea', how: 'Un «7» con dos ganchos', ref: [{ keys: 'b/4', duration: '16r' }] },
]

/** Muestras por símbolo: dos dan bastante margen a la variación natural de la letra. */
export const SAMPLES_PER_SYMBOL = 2

const PAD_W = 340
const PAD_H = 150
const STAFF: StaffCtx = { yTop: 55, yBottom: 55 + STAFF_GAP * 4 }

function RefGlyph({ step }: { step: Step }) {
  const ref = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.innerHTML = ''
    const w = 70 + step.ref.length * 60
    const renderer = new Renderer(el as HTMLDivElement, Renderer.Backends.SVG)
    renderer.resize(w, 120)
    const ctx = renderer.getContext()
    const stave = new Stave(4, 15, w - 10)
    stave.addClef('treble').setContext(ctx).draw()
    const notes = step.ref.map((r) => {
      const n = new StaveNote({ keys: [r.keys], duration: r.duration, clef: 'treble' })
      if (r.acc) n.addModifier(new VfAccidental(r.acc), 0)
      return n
    })
    const voice = new Voice({ numBeats: 4, beatValue: 4 }).setMode(Voice.Mode.SOFT)
    voice.addTickables(notes)
    new Formatter().joinVoices([voice]).format([voice], w - 80)
    voice.draw(ctx, stave)
  }, [step])
  return <div ref={ref} className="score-svg" />
}

function describe(r: Recognized): string {
  if (r.kind === 'note') return `${DUR_LABEL[r.dur]}${r.acc ? ` ${r.acc}` : ''}`
  if (r.kind === 'rest') return `Silencio de ${DUR_LABEL[r.dur].toLowerCase()}`
  if (r.kind === 'accidental') return r.acc === '#' ? 'Sostenido' : r.acc === 'b' ? 'Bemol' : 'Becuadro'
  if (r.kind === 'barline') return 'Barra de compás'
  if (r.kind === 'dot') return 'Puntillo'
  return 'algo que aún no conozco'
}

interface Props {
  onClose: () => void
  onDone: () => void
}

/** Test de escritura OPCIONAL (desde la guía de trazos): siempre se puede cerrar y nunca se pide al entrar. */
export function Calibration({ onClose, onDone }: Props) {
  // Un test a medias (se cerró la app, se recargó...) sigue donde quedó: cada muestra se guarda al momento.
  const [samples, setSamples] = useState<HandProfile['samples']>(loadDraft)
  const [stepIdx, setStepIdx] = useState(() => {
    const d = loadDraft()
    return Math.max(0, CALIBRATION_STEPS.findIndex((st) => (d[st.label]?.length ?? 0) < SAMPLES_PER_SYMBOL))
  })
  const restored = useRef(false)
  useEffect(() => {
    // Si Safari vació localStorage, el borrador puede seguir en IndexedDB.
    if (Object.keys(samples).length) return
    void loadDraftAsync().then((d) => {
      if (restored.current || !Object.keys(d).length) return
      restored.current = true
      setSamples(d)
      setStepIdx(Math.max(0, CALIBRATION_STEPS.findIndex((st) => (d[st.label]?.length ?? 0) < SAMPLES_PER_SYMBOL)))
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useEffect(() => saveDraft(samples), [samples])
  /** Muestras de tests anteriores que ya conoce (se suman, no se reemplazan). */
  const previous = Object.values(loadProfile().samples).reduce((n, l) => n + (l?.length ?? 0), 0)
  const [strokes, setStrokes] = useState<Stroke[]>([])
  const [feedback, setFeedback] = useState<string | null>(null)
  const [finished, setFinished] = useState(false)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const padRef = useRef<HTMLDivElement>(null)
  const activeRef = useRef<{ id: number; pts: Pt[]; pen: boolean } | null>(null)
  const penSeen = useRef(false)
  const strokesRef = useRef<Stroke[]>([])
  strokesRef.current = strokes

  const step = CALIBRATION_STEPS[stepIdx]
  const have = samples[step.label]?.length ?? 0
  const totalNeeded = CALIBRATION_STEPS.length * SAMPLES_PER_SYMBOL
  const totalHave = CALIBRATION_STEPS.reduce((s, st) => s + Math.min(SAMPLES_PER_SYMBOL, samples[st.label]?.length ?? 0), 0)

  const allowFinger = useCallback(() => !penSeen.current, [])
  usePenSurface(padRef, allowFinger)

  const redraw = useCallback(() => {
    const c = canvasRef.current
    if (!c) return
    const dpr = window.devicePixelRatio || 1
    if (c.width !== PAD_W * dpr) {
      c.width = PAD_W * dpr
      c.height = PAD_H * dpr
    }
    const ctx = c.getContext('2d')!
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, PAD_W, PAD_H)
    const ink = getComputedStyle(c).getPropertyValue('--ink').trim() || '#2b2118'
    ctx.strokeStyle = ink
    ctx.globalAlpha = 0.45
    ctx.lineWidth = 1
    for (let i = 0; i < 5; i++) {
      const y = STAFF.yTop + i * STAFF_GAP + 0.5
      ctx.beginPath()
      ctx.moveTo(14, y)
      ctx.lineTo(PAD_W - 14, y)
      ctx.stroke()
    }
    ctx.globalAlpha = 1
    ctx.fillStyle = ink
    for (const s of strokesRef.current) drawStroke(ctx, s, penSeen.current, true)
    const a = activeRef.current
    if (a) drawStroke(ctx, a.pts, a.pen, false)
  }, [])

  useEffect(() => {
    redraw()
  }, [strokes, stepIdx, finished, redraw])

  const down = (e: React.PointerEvent) => {
    if (e.pointerType === 'pen') penSeen.current = true
    if (e.pointerType === 'touch' && penSeen.current) return // palma con el lápiz en uso
    if (e.pointerType === 'mouse' && e.button !== 0) return
    if (activeRef.current) {
      const prev = activeRef.current
      activeRef.current = null
      if (prev.pts.length > 1) setStrokes((s) => [...s, prev.pts])
    }
    e.preventDefault()
    try {
      padRef.current!.setPointerCapture(e.pointerId)
    } catch {
      /* noop */
    }
    const r = padRef.current!.getBoundingClientRect()
    activeRef.current = {
      id: e.pointerId,
      pen: e.pointerType === 'pen',
      pts: [{ x: e.clientX - r.left, y: e.clientY - r.top, p: e.pressure > 0 ? e.pressure : 0.5, t: e.timeStamp }],
    }
    setFeedback(null)
  }
  const move = (e: React.PointerEvent) => {
    const a = activeRef.current
    if (!a || a.id !== e.pointerId) return
    e.preventDefault()
    a.pts.push(...pointsOf(e.nativeEvent, padRef.current!.getBoundingClientRect(), a.pen))
    redraw()
  }
  const up = (e: React.PointerEvent) => {
    const a = activeRef.current
    if (!a || a.id !== e.pointerId) return
    activeRef.current = null
    if (e.type === 'pointerup') a.pts.push(...pointsOf(e.nativeEvent, padRef.current!.getBoundingClientRect(), a.pen))
    setStrokes((s) => [...s, a.pts])
  }

  const save = () => {
    if (strokes.length === 0) return
    // Lectura SIN muestras propias: así se ve qué habría entendido Mila sin el test.
    const heur = recognizePersonal(strokes, STAFF, [])
    const next = { ...samples, [step.label]: [...(samples[step.label] ?? []), strokes] }
    setSamples(next)
    setStrokes([])
    const read = describe(heur)
    const same = labelOf(heur) === step.label
    setFeedback(same ? `✓ Reconocido como ${read}` : `Aprendido. Sin tu muestra lo habría leído como: ${read}`)
    const count = next[step.label]!.length
    if (count >= SAMPLES_PER_SYMBOL) {
      const nextIdx = CALIBRATION_STEPS.findIndex((st) => (next[st.label]?.length ?? 0) < SAMPLES_PER_SYMBOL)
      window.setTimeout(() => {
        setFeedback(null)
        if (nextIdx < 0) setFinished(true)
        else setStepIdx(nextIdx)
      }, 650)
    }
  }

  const finish = () => {
    // Se SUMAN a las de tests anteriores (las más recientes de cada símbolo), nunca las reemplazan.
    addSamples(samples, true)
    saveDraft({})
    onDone()
  }

  const redoStep = () => {
    setSamples((s) => ({ ...s, [step.label]: [] }))
    setStrokes([])
    setFeedback(null)
  }

  return (
    <motion.div
      className="fixed inset-0 z-[70] flex flex-col overflow-auto bg-bg text-ink"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      role="dialog"
      aria-label="Test de escritura"
    >
      <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-4 pb-6" style={{ paddingTop: 'max(16px, env(safe-area-inset-top))' }}>
        <div className="flex items-center gap-3">
          <div className="flex-1">
            <div className="text-[11px] font-bold uppercase tracking-widest text-muted">Test de escritura</div>
            <h1 className="text-2xl font-black leading-tight">Enséñale a Mila tu letra</h1>
          </div>
          <button
            type="button"
            aria-label="Cerrar"
            onClick={() => {
              // Lo dibujado hasta aquí también sirve: se suma a la letra de Mila.
              if (Object.values(samples).some((l) => l?.length)) addSamples(samples, false)
              saveDraft({})
              onClose()
            }}
            className="grid h-11 w-11 place-items-center rounded-2xl border border-line bg-panel"
          >
            <X size={20} />
          </button>
        </div>
        <p className="mt-1 text-sm text-muted">
          Dibuja cada símbolo {SAMPLES_PER_SYMBOL} veces sobre el pentagrama, como lo escribes normalmente. Mila guarda tus trazos en este
          dispositivo y los usa para reconocer tu caligrafía.
          {previous > 0 && (
            <>
              {' '}
              Ya conoce <b className="text-ink">{previous} muestras</b> de tests anteriores: las nuevas se suman a esas.
            </>
          )}
        </p>

        <div className="mt-3 h-2 overflow-hidden rounded-full bg-line">
          <motion.div className="h-full rounded-full bg-mint" animate={{ width: `${(totalHave / totalNeeded) * 100}%` }} />
        </div>

        {/* Lista de símbolos */}
        <div className="mt-3 flex flex-wrap gap-1.5">
          {CALIBRATION_STEPS.map((st, i) => {
            const n = samples[st.label]?.length ?? 0
            const done = n >= SAMPLES_PER_SYMBOL
            return (
              <button
                key={st.label}
                type="button"
                onClick={() => {
                  setFinished(false)
                  setStepIdx(i)
                  setStrokes([])
                  setFeedback(null)
                }}
                className="rounded-full border px-2.5 py-1 text-xs font-bold"
                style={{
                  borderColor: i === stepIdx && !finished ? 'var(--coral)' : 'var(--line)',
                  background: done ? 'color-mix(in srgb, var(--mint) 22%, transparent)' : 'var(--panel)',
                }}
              >
                {done ? '✓ ' : ''}
                {st.name}
              </button>
            )
          })}
        </div>

        {finished ? (
            <motion.div
              key="done"
              className="mt-6 grid place-items-center gap-3 rounded-[28px] border border-line bg-paper p-8 text-center"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
            >
              <Sparkles className="text-sun" size={40} />
              <div className="text-xl font-black">¡Listo! Mila ya conoce tu letra</div>
              <p className="max-w-md text-sm text-muted">
                Puedes repetir el test cuando quieras desde la guía de trazos (?). Si algún símbolo falla a menudo, vuelve a dibujarlo
                tocando su nombre arriba.
              </p>
              <button type="button" onClick={finish} className="mt-2 flex h-12 items-center gap-2 rounded-2xl bg-coral px-6 font-black text-white shadow">
                <Check size={18} /> Empezar a escribir
              </button>
            </motion.div>
          ) : (
            <motion.div
              key={step.label}
              className="mt-4 grid gap-4 rounded-[28px] border border-line bg-paper p-4 sm:grid-cols-[auto_1fr]"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
            >
              <div className="flex flex-col items-center justify-center gap-1">
                <RefGlyph step={step} />
                <div className="text-lg font-black">{step.name}</div>
                <div className="max-w-[220px] text-center text-xs text-muted">{step.how}</div>
                <div className="mt-1 flex gap-1">
                  {Array.from({ length: SAMPLES_PER_SYMBOL }, (_, i) => (
                    <span key={i} className="h-2.5 w-2.5 rounded-full" style={{ background: i < have ? 'var(--mint)' : 'var(--line)' }} />
                  ))}
                </div>
              </div>

              <div className="flex flex-col items-center gap-2">
                <div
                  ref={padRef}
                  data-testid="calibration-pad"
                  className="relative rounded-2xl border-2 border-dashed border-line bg-panel"
                  style={{ width: PAD_W, height: PAD_H, touchAction: 'none', cursor: 'crosshair' }}
                  onPointerDown={down}
                  onPointerMove={move}
                  onPointerUp={up}
                  onPointerCancel={up}
                  onLostPointerCapture={up}
                >
                  <canvas ref={canvasRef} className="pointer-events-none absolute inset-0" style={{ width: PAD_W, height: PAD_H }} />
                  {strokes.length === 0 && (
                    <div className="pointer-events-none absolute inset-x-0 bottom-2 text-center text-xs font-semibold text-muted">
                      Muestra {Math.min(have + 1, SAMPLES_PER_SYMBOL)} de {SAMPLES_PER_SYMBOL} · dibuja aquí
                    </div>
                  )}
                </div>
                <div className="min-h-5 text-center text-sm font-semibold" style={{ color: feedback?.startsWith('✓') ? 'var(--good)' : 'var(--muted)' }}>
                  {feedback}
                </div>
                <div className="flex flex-wrap justify-center gap-2">
                  <button
                    type="button"
                    disabled={stepIdx === 0}
                    onClick={() => {
                      setStepIdx((i) => Math.max(0, i - 1))
                      setStrokes([])
                      setFeedback(null)
                    }}
                    className="flex h-11 items-center gap-1 rounded-2xl border border-line bg-panel px-3 text-sm font-bold disabled:opacity-35"
                  >
                    <ArrowLeft size={16} /> Anterior
                  </button>
                  <button
                    type="button"
                    disabled={strokes.length === 0}
                    onClick={() => setStrokes([])}
                    className="flex h-11 items-center gap-1 rounded-2xl border border-line bg-panel px-3 text-sm font-bold disabled:opacity-35"
                  >
                    <Eraser size={16} /> Borrar
                  </button>
                  {have > 0 && (
                    <button type="button" onClick={redoStep} className="h-11 rounded-2xl border border-line bg-panel px-3 text-sm font-bold">
                      Repetir este símbolo
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={strokes.length === 0}
                    onClick={save}
                    className="flex h-11 items-center gap-1 rounded-2xl bg-mint px-4 text-sm font-black text-[#12352c] shadow disabled:opacity-40"
                  >
                    <Check size={16} /> Guardar trazo
                  </button>
                </div>
              </div>
            </motion.div>
          )}
      </div>
    </motion.div>
  )
}
