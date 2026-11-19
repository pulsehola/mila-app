import { motion } from 'framer-motion'
import { Music2, Piano, Repeat1, X } from 'lucide-react'
import { MAX_SPEED, MIN_SPEED, practiceBpm, SPEED_PRESETS } from '../state/practice'
import type { LoopRange } from '../types'
import type { Mix } from '../audio/engine'

interface Props {
  speed: number
  onSpeed: (v: number) => void
  bpm: number
  loopOn: boolean
  loopRange: LoopRange | null
  onA: () => void
  onB: () => void
  onRepeatMeasure: () => void
  onClearLoop: () => void
  mix: Mix
  onMix: (m: Mix) => void
  onClose: () => void
}

const pct = (v: number) => `${Math.round(v * 100)} %`

function Toggle({ on, label, hint, icon, onClick }: { on: boolean; label: string; hint: string; icon: React.ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={onClick}
      className="flex min-h-[52px] flex-1 items-center gap-2 rounded-2xl border border-line px-3 text-left"
      style={{ background: on ? 'var(--mint)' : 'var(--paper)', color: on ? '#12352c' : 'var(--ink)' }}
    >
      {icon}
      <span className="min-w-0">
        <span className="block text-sm font-black">{label}</span>
        <span className="block text-[11px] font-bold opacity-75">{on ? 'Suena' : 'Silenciado'} · {hint}</span>
      </span>
    </button>
  )
}

/**
 * Modo práctica: velocidad 40–100 % (sin cambiar la afinación), bucle A–B o de un compás, y qué se oye
 * (melodía y acompañamiento por separado). Todo se aplica al momento, también mientras suena.
 */
export function PracticePanel(p: Props) {
  const label = (i: number | undefined) => (i === undefined ? '—' : `c. ${i + 1}`)
  return (
    <motion.div
      role="dialog"
      aria-label="Modo práctica"
      initial={{ opacity: 0, y: 16, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 16 }}
      className="absolute bottom-3 left-1/2 z-50 w-[min(560px,calc(100%-24px))] -translate-x-1/2 rounded-3xl border border-line bg-panel p-4 shadow-2xl"
    >
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-lg font-black">Práctica</h2>
        <button type="button" aria-label="Cerrar práctica" onClick={p.onClose} className="grid h-10 w-10 place-items-center rounded-full border border-line">
          <X size={18} />
        </button>
      </div>

      {/* Velocidad */}
      <section className="rounded-2xl border border-line bg-paper p-3">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-sm font-black">Velocidad</span>
          <span className="text-xs font-bold text-muted">
            ♩ = {Math.round(practiceBpm(p.bpm, p.speed))} (escrito {p.bpm}) · la afinación no cambia
          </span>
        </div>
        <div className="mt-1 flex items-center gap-3">
          <span className="w-[104px] whitespace-nowrap text-3xl font-black tabular-nums">{pct(p.speed)}</span>
          <input
            aria-label="Velocidad de práctica"
            type="range"
            min={MIN_SPEED * 100}
            max={MAX_SPEED * 100}
            step={5}
            value={Math.round(p.speed * 100)}
            onChange={(e) => p.onSpeed(Number(e.target.value) / 100)}
            className="h-8 flex-1 accent-[var(--coral)]"
          />
        </div>
        <div className="mt-2 flex flex-wrap gap-2">
          {SPEED_PRESETS.map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => p.onSpeed(v)}
              aria-pressed={Math.abs(p.speed - v) < 0.001}
              className="h-10 min-w-[56px] rounded-full border border-line px-3 text-sm font-black"
              style={{ background: Math.abs(p.speed - v) < 0.001 ? 'var(--sun)' : 'var(--panel)', color: Math.abs(p.speed - v) < 0.001 ? '#2b2118' : 'var(--ink)' }}
            >
              {pct(v)}
            </button>
          ))}
        </div>
      </section>

      {/* Bucle */}
      <section className="mt-3 rounded-2xl border border-line bg-paper p-3">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-sm font-black">Repetir un fragmento</span>
          <span className="text-xs font-bold text-muted">{p.loopOn ? (p.loopRange ? `bucle c. ${p.loopRange.start + 1}–${p.loopRange.end + 1}` : 'bucle de toda la obra') : 'sin bucle'}</span>
        </div>
        <p className="mt-1 text-xs text-muted">A y B usan el compás que está sonando o, parada la música, el de la nota seleccionada.</p>
        <div className="mt-2 flex flex-wrap gap-2">
          <button type="button" onClick={p.onA} className="h-11 min-w-[88px] rounded-2xl bg-sun px-3 text-sm font-black text-[#2b2118]">
            A · {label(p.loopRange?.start)}
          </button>
          <button type="button" onClick={p.onB} className="h-11 min-w-[88px] rounded-2xl bg-sun px-3 text-sm font-black text-[#2b2118]">
            B · {label(p.loopRange?.end)}
          </button>
          <button type="button" onClick={p.onRepeatMeasure} className="flex h-11 items-center gap-1.5 rounded-2xl border border-line bg-panel px-3 text-sm font-black">
            <Repeat1 size={17} /> Repetir este compás
          </button>
          <button type="button" onClick={p.onClearLoop} disabled={!p.loopOn} className="h-11 rounded-2xl border border-line bg-panel px-3 text-sm font-black disabled:opacity-35">
            Quitar bucle
          </button>
        </div>
      </section>

      {/* Mezcla */}
      <section className="mt-3 flex gap-2">
        <Toggle
          on={p.mix.melody}
          label="Melodía"
          hint="lo escrito"
          icon={<Music2 size={20} />}
          onClick={() => p.onMix({ ...p.mix, melody: !p.mix.melody })}
        />
        <Toggle
          on={p.mix.accomp}
          label="Acompañamiento"
          hint="acordes automáticos"
          icon={<Piano size={20} />}
          onClick={() => p.onMix({ ...p.mix, accomp: !p.mix.accomp })}
        />
      </section>
    </motion.div>
  )
}
