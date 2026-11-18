import { motion, useAnimationControls } from 'framer-motion'
import { Metronome as MetronomeIcon, Minus, Pause, Play, Plus, Repeat, Square } from 'lucide-react'
import { forwardRef, useImperativeHandle } from 'react'
import { IconButton } from './ui'
import { ELASTIC } from './springs'

export interface TransportHandle {
  pulse: () => void
}

interface Props {
  playing: boolean
  bpm: number
  metronome: boolean
  loop: boolean
  loopLabel: string
  onPlay: () => void
  onStop: () => void
  onBpm: (bpm: number) => void
  onTap: () => void
  onMetronome: () => void
  onLoop: () => void
}

/** Barra inferior para el atril: Play con latido sincronizado, BPM + Tap Tempo, metrónomo y bucle. */
export const TransportBar = forwardRef<TransportHandle, Props>(function TransportBar(p, ref) {
  const beat = useAnimationControls()
  const ring = useAnimationControls()
  useImperativeHandle(ref, () => ({
    pulse: () => {
      void beat.start({ scale: [1, 1.16, 1], transition: { duration: 0.32, ease: 'easeOut' } })
      void ring.start({ scale: [0.9, 1.9], opacity: [0.55, 0], transition: { duration: 0.5, ease: 'easeOut' } })
    },
  }))

  return (
    <div
      className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2 border-t border-line bg-panel/90 px-4 py-3 backdrop-blur"
      style={{ paddingBottom: 'max(12px, env(safe-area-inset-bottom))' }}
    >
      <div className="flex items-center gap-2">
        <div className="relative">
          <motion.span
            aria-hidden
            className="pointer-events-none absolute inset-0 rounded-full bg-coral"
            initial={{ opacity: 0 }}
            animate={ring}
          />
          <motion.button
            type="button"
            aria-label={p.playing ? 'Pausar' : 'Reproducir'}
            onClick={p.onPlay}
            animate={beat}
            whileTap={{ scale: 0.9 }}
            className="relative grid h-[68px] w-[68px] place-items-center rounded-full text-white shadow-lg"
            style={{ background: 'linear-gradient(135deg, #ff8a5c, #ff5a7a)' }}
          >
            {p.playing ? <Pause size={32} fill="currentColor" /> : <Play size={32} fill="currentColor" className="ml-1" />}
          </motion.button>
        </div>
        <IconButton label="Detener" onClick={p.onStop} size={52}>
          <Square size={20} fill="currentColor" />
        </IconButton>
      </div>

      <div className="flex items-center gap-2 rounded-3xl border border-line bg-paper px-2 py-1.5">
        <IconButton label="Más lento" onClick={() => p.onBpm(p.bpm - 1)} size={44}>
          <Minus size={20} />
        </IconButton>
        <div className="min-w-[76px] text-center">
          <div className="text-3xl font-black tabular-nums leading-none">{p.bpm}</div>
          <div className="text-[10px] font-bold uppercase tracking-widest text-muted">♩ BPM</div>
        </div>
        <IconButton label="Más rápido" onClick={() => p.onBpm(p.bpm + 1)} size={44}>
          <Plus size={20} />
        </IconButton>
        <input
          aria-label="Tempo"
          type="range"
          min={30}
          max={240}
          value={p.bpm}
          onChange={(e) => p.onBpm(Number(e.target.value))}
          className="mx-1 hidden w-32 accent-[var(--coral)] sm:block"
        />
        <motion.button
          type="button"
          aria-label="Tap tempo"
          onClick={p.onTap}
          whileTap={{ scale: 0.86, rotate: -4 }}
          transition={ELASTIC}
          className="h-11 rounded-2xl bg-sun px-4 text-sm font-black text-[#2b2118]"
        >
          TAP
        </motion.button>
      </div>

      <div className="flex items-center gap-2">
        <IconButton label="Metrónomo" active={p.metronome} onClick={p.onMetronome} tone="mint" size={52}>
          <MetronomeIcon size={24} />
        </IconButton>
        <div className="flex flex-col items-center">
          <IconButton label="Bucle" active={p.loop} onClick={p.onLoop} tone="sun" size={52}>
            <Repeat size={24} />
          </IconButton>
          <span className="mt-0.5 text-[10px] font-bold text-muted">{p.loopLabel}</span>
        </div>
      </div>
    </div>
  )
})
