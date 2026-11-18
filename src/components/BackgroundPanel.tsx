import { motion } from 'framer-motion'
import { Check, Move, RotateCcw, Sparkles, Trash2, X } from 'lucide-react'
import type { Background } from '../types'
import { ELASTIC } from './springs'

interface Props {
  bg: Background
  adjust: boolean
  onAdjust: (on: boolean) => void
  /** `record`: un paso de deshacer (al empezar a mover un deslizador). */
  onChange: (bg: Background, record?: boolean) => void
  onRemove: () => void
  onClose: () => void
}

function Slider({
  label,
  value,
  min,
  max,
  step,
  format,
  onStart,
  onValue,
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  format: (v: number) => string
  onStart: () => void
  onValue: (v: number) => void
}) {
  return (
    <label className="block">
      <span className="flex justify-between text-xs font-bold">
        <span>{label}</span>
        <span className="tabular-nums text-muted">{format(value)}</span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onPointerDown={onStart}
        onChange={(e) => onValue(Number(e.target.value))}
        className="mt-1 w-full accent-[var(--mi)]"
        style={{ touchAction: 'pan-y' }}
      />
    </label>
  )
}

/**
 * Ajustes de la partitura escaneada: transparencia, tamaño, giro, y el espaciado de la hoja digital
 * (separación entre sistemas y compases por línea) para que el pentagrama coincida con el papel.
 */
export function BackgroundPanel({ bg, adjust, onAdjust, onChange, onRemove, onClose }: Props) {
  const set = (patch: Partial<Background>) => onChange({ ...bg, ...patch })
  const mark = () => onChange(bg, true)

  return (
    <motion.div
      initial={{ opacity: 0, y: -10, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -10, scale: 0.96 }}
      transition={{ type: 'spring', stiffness: 420, damping: 30 }}
      className="pointer-events-auto w-[300px] rounded-3xl border border-line bg-panel/95 p-4 shadow-2xl backdrop-blur"
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div className="mb-3 flex items-center justify-between">
        <span className="text-base font-extrabold">Partitura de fondo</span>
        <button type="button" aria-label="Cerrar ajustes de fondo" onClick={onClose} className="grid h-8 w-8 place-items-center rounded-full">
          <X size={18} />
        </button>
      </div>

      <motion.button
        type="button"
        aria-pressed={adjust}
        onClick={() => onAdjust(!adjust)}
        whileTap={{ scale: 0.95 }}
        transition={ELASTIC}
        className="mb-3 flex h-11 w-full items-center justify-center gap-2 rounded-2xl text-sm font-extrabold"
        style={{ background: adjust ? 'var(--coral)' : 'var(--paper)', color: adjust ? '#fff' : 'var(--ink)', border: '1px solid var(--line)' }}
      >
        <Move size={17} /> {adjust ? 'Moviendo: arrastra la hoja' : 'Mover la hoja'}
      </motion.button>

      <div className="flex flex-col gap-3">
        <Slider label="Transparencia" value={bg.opacity} min={0.05} max={1} step={0.05} format={(v) => `${Math.round(v * 100)}%`} onStart={mark} onValue={(opacity) => set({ opacity })} />
        <Slider label="Tamaño" value={bg.scale} min={0.3} max={3} step={0.01} format={(v) => `${Math.round(v * 100)}%`} onStart={mark} onValue={(scale) => set({ scale })} />
        <Slider label="Girar" value={bg.rotation} min={-10} max={10} step={0.1} format={(v) => `${v.toFixed(1)}°`} onStart={mark} onValue={(rotation) => set({ rotation })} />
        <Slider label="Separación entre pentagramas" value={bg.rowH} min={100} max={280} step={1} format={(v) => `${v}px`} onStart={mark} onValue={(rowH) => set({ rowH })} />
        <div>
          <div className="text-xs font-bold">Compases por línea</div>
          <div className="mt-1 flex gap-1">
            {[1, 2, 3, 4, 5, 6].map((n) => (
              <button
                key={n}
                type="button"
                aria-pressed={bg.perRow === n}
                onClick={() => onChange({ ...bg, perRow: n }, true)}
                className="h-9 flex-1 rounded-xl text-sm font-extrabold"
                style={{ background: bg.perRow === n ? 'var(--mi)' : 'var(--paper)', color: bg.perRow === n ? '#fff' : 'var(--ink)', border: '1px solid var(--line)' }}
              >
                {n}
              </button>
            ))}
          </div>
        </div>
        <button
          type="button"
          aria-pressed={bg.enhance}
          onClick={() => onChange({ ...bg, enhance: !bg.enhance }, true)}
          className="flex items-center justify-between rounded-2xl border border-line bg-paper px-3 py-2 text-sm font-bold"
        >
          <span className="flex items-center gap-2">
            <Sparkles size={16} /> Realzar (blanco y negro)
          </span>
          <span className="relative h-6 w-10 rounded-full transition-colors" style={{ background: bg.enhance ? 'var(--mi)' : 'var(--line)' }}>
            <motion.span
              className="absolute top-0.5 h-5 w-5 rounded-full bg-white shadow"
              animate={{ left: bg.enhance ? 18 : 2 }}
              transition={{ type: 'spring', stiffness: 600, damping: 30 }}
            />
          </span>
        </button>
      </div>

      <div className="mt-4 flex gap-2">
        <button
          type="button"
          onClick={() => onChange({ ...bg, x: 0, y: 0, scale: 1, rotation: 0 }, true)}
          className="flex h-10 flex-1 items-center justify-center gap-1 rounded-2xl border border-line bg-paper text-xs font-extrabold"
        >
          <RotateCcw size={14} /> Encajar
        </button>
        <button
          type="button"
          onClick={onRemove}
          className="flex h-10 flex-1 items-center justify-center gap-1 rounded-2xl border border-line bg-paper text-xs font-extrabold text-bad"
        >
          <Trash2 size={14} /> Quitar
        </button>
        <button
          type="button"
          onClick={onClose}
          className="flex h-10 flex-1 items-center justify-center gap-1 rounded-2xl bg-mi text-xs font-extrabold text-white"
        >
          <Check size={14} /> Listo
        </button>
      </div>
    </motion.div>
  )
}
