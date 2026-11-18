import { motion } from 'framer-motion'
import { Mic, MicOff } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { detectPitch, noteLabel, readingFromFreq } from '../audio/pitch'
import { midiName, midiOctave } from '../state/music'
import type { Transposition } from '../types'
import { IconButton, Modal } from './ui'
import { ELASTIC } from './springs'

interface Props {
  open: boolean
  onClose: () => void
  transposition: Transposition
}

interface View {
  midi: number
  cents: number
  freq: number
}

const A4_KEY = 'mila:a4'

/** Afinador cromático con micrófono (YIN). En Sib muestra la nota que lee el trompetista. */
export function Tuner({ open, onClose, transposition }: Props) {
  const [view, setView] = useState<View | null>(null)
  const [state, setState] = useState<'idle' | 'starting' | 'live' | 'error'>('idle')
  const [error, setError] = useState('')
  const [a4, setA4] = useState(() => Number(localStorage.getItem(A4_KEY)) || 440)
  const a4Ref = useRef(a4)
  a4Ref.current = a4

  const ctxRef = useRef<AudioContext | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const rafRef = useRef(0)
  const smooth = useRef<{ cents: number; midi: number; at: number } | null>(null)

  const stop = useCallback(() => {
    cancelAnimationFrame(rafRef.current)
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    void ctxRef.current?.close()
    ctxRef.current = null
    smooth.current = null
    setView(null)
    setState('idle')
  }, [])

  const start = useCallback(async () => {
    setState('starting')
    setError('')
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error('El micrófono necesita HTTPS (o localhost). Abre la app con https://.')
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      })
      streamRef.current = stream
      const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
      const ctx = new Ctx()
      await ctx.resume()
      if (ctx.state !== 'running') throw new Error('Toca «Activar micrófono» para iniciar el audio.')
      ctxRef.current = ctx
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 4096
      ctx.createMediaStreamSource(stream).connect(analyser)
      const buf = new Float32Array(analyser.fftSize)
      let last = 0
      setState('live')
      const tick = (now: number) => {
        rafRef.current = requestAnimationFrame(tick)
        if (now - last < 55) return
        last = now
        analyser.getFloatTimeDomainData(buf)
        const f = detectPitch(buf, ctx.sampleRate)
        if (f && f > 70 && f < 1300) {
          const r = readingFromFreq(f, a4Ref.current)
          const prev = smooth.current
          const sameNote = prev && prev.midi === r.midi
          const cents = sameNote ? prev.cents * 0.55 + r.cents * 0.45 : r.cents
          smooth.current = { cents, midi: r.midi, at: now }
          setView({ midi: r.midi, cents: Math.round(cents), freq: f })
        } else if (smooth.current && now - smooth.current.at > 700) {
          smooth.current = null
          setView(null)
        }
      }
      rafRef.current = requestAnimationFrame(tick)
    } catch (e) {
      stop()
      setState('error')
      setError(
        e instanceof DOMException && e.name === 'NotAllowedError'
          ? 'Permiso de micrófono denegado. Actívalo en Ajustes › Safari › Micrófono.'
          : e instanceof Error
            ? e.message
            : 'No se pudo abrir el micrófono.',
      )
    }
  }, [stop])

  useEffect(() => {
    if (open) void start()
    else stop()
    return stop
  }, [open, start, stop])

  useEffect(() => {
    localStorage.setItem(A4_KEY, String(a4))
  }, [a4])

  const sounding = view?.midi ?? null
  // Trompeta en Sib: lo que suena es una 2ª mayor más grave que lo que se lee.
  const written = sounding === null ? null : transposition === 'Bb' ? sounding + 2 : sounding
  const cents = view?.cents ?? 0
  const inTune = view !== null && Math.abs(cents) <= 5
  const angle = Math.max(-50, Math.min(50, cents)) * 1.5

  return (
    <Modal open={open} onClose={onClose} title="Afinador" maxWidth={460}>
      <div className="flex flex-col items-center gap-3">
        <svg viewBox="-110 -100 220 130" className="w-full max-w-[360px]">
          <path d="M-90 0A90 90 0 0 1 90 0" fill="none" stroke="var(--line)" strokeWidth="14" strokeLinecap="round" />
          <path d="M-9 -88A90 90 0 0 1 9 -88" fill="none" stroke="var(--mint)" strokeWidth="14" strokeLinecap="round" />
          {[-50, -25, 0, 25, 50].map((c) => (
            <line
              key={c}
              x1="0"
              y1="-98"
              x2="0"
              y2={c === 0 ? -108 : -104}
              stroke="var(--muted)"
              strokeWidth="2"
              transform={`rotate(${c * 1.5})`}
            />
          ))}
          <motion.g animate={{ rotate: view ? angle : 0, opacity: view ? 1 : 0.35 }} transition={{ type: 'spring', stiffness: 160, damping: 16 }} style={{ originX: '0px', originY: '0px' }}>
            <line x1="0" y1="0" x2="0" y2="-84" stroke={inTune ? 'var(--mint)' : 'var(--coral)'} strokeWidth="5" strokeLinecap="round" />
            <circle r="9" fill={inTune ? 'var(--mint)' : 'var(--coral)'} />
          </motion.g>
          <text x="-92" y="22" fontSize="11" fill="var(--muted)" fontWeight="700">♭</text>
          <text x="86" y="22" fontSize="11" fill="var(--muted)" fontWeight="700">♯</text>
        </svg>

        <motion.div
          key={written ?? 'none'}
          initial={{ scale: 0.85, opacity: 0.4 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: 'spring', stiffness: 500, damping: 18 }}
          className="text-center"
        >
          <div className="text-6xl font-black leading-none" style={{ color: inTune ? 'var(--mint)' : 'var(--ink)' }}>
            {written !== null ? `${midiName(written)}${midiOctave(written)}` : '—'}
          </div>
          <div className="mt-2 text-sm font-semibold text-muted">
            {view
              ? `${cents > 0 ? '+' : ''}${cents} cents · ${view.freq.toFixed(1)} Hz${transposition === 'Bb' && sounding !== null ? ` · suena ${noteLabel(sounding)}` : ''}`
              : state === 'live'
                ? 'Toca una nota…'
                : state === 'starting'
                  ? 'Abriendo micrófono…'
                  : ''}
          </div>
          {transposition === 'Bb' && <div className="text-[11px] text-muted">Se muestra la nota que lees (trompeta en Sib)</div>}
        </motion.div>

        {state === 'error' && <div className="rounded-2xl bg-bad/15 p-3 text-center text-sm font-semibold text-bad">{error}</div>}

        <div className="flex items-center gap-3">
          <IconButton label="Bajar referencia" onClick={() => setA4((v) => Math.max(430, v - 1))} size={44}>
            −
          </IconButton>
          <div className="text-center text-sm font-bold">
            La4 = {a4} Hz
          </div>
          <IconButton label="Subir referencia" onClick={() => setA4((v) => Math.min(450, v + 1))} size={44}>
            +
          </IconButton>
        </div>

        <motion.button
          type="button"
          whileTap={{ scale: 0.94 }}
          transition={ELASTIC}
          onClick={() => (state === 'live' ? stop() : void start())}
          className="flex h-12 items-center gap-2 rounded-2xl bg-coral px-5 font-black text-white"
        >
          {state === 'live' ? <MicOff size={18} /> : <Mic size={18} />}
          {state === 'live' ? 'Parar' : 'Activar micrófono'}
        </motion.button>
      </div>
    </Modal>
  )
}
