import { motion } from 'framer-motion'
import { Music2, PenLine } from 'lucide-react'
import type { EditMode } from '../types'
import { ELASTIC } from './springs'

interface Props {
  mode: EditMode
  onMode: (m: EditMode) => void
}

const OPTIONS: { key: EditMode; label: string; hint: string; Icon: typeof Music2; color: string }[] = [
  { key: 'notes', label: 'Notas', hint: 'El trazo se convierte en partitura', Icon: Music2, color: 'var(--mi)' },
  { key: 'annotate', label: 'Anotar', hint: 'Texto, flechas y recuadros a mano', Icon: PenLine, color: 'var(--annot)' },
]

/** Barra rápida: alterna entre escribir notas (reconocidas) y anotar a mano alzada (se guarda tal cual). Tecla M. */
export function ModeSwitch({ mode, onMode }: Props) {
  return (
    <div
      role="radiogroup"
      aria-label="Modo de escritura"
      className="pointer-events-auto flex rounded-full border border-line bg-panel/95 p-1 shadow-lg backdrop-blur"
    >
      {OPTIONS.map(({ key, label, hint, Icon, color }) => {
        const on = mode === key
        return (
          <motion.button
            key={key}
            type="button"
            role="radio"
            aria-checked={on}
            title={`${label} · ${hint} (M)`}
            onClick={() => onMode(key)}
            whileTap={{ scale: 0.9 }}
            transition={ELASTIC}
            className="relative flex h-11 items-center gap-1.5 rounded-full px-4 text-sm font-extrabold"
            style={{ color: on ? '#fff' : 'var(--muted)' }}
          >
            {on && (
              <motion.span
                layoutId="mode-pill"
                className="absolute inset-0 rounded-full"
                style={{ background: color }}
                transition={{ type: 'spring', stiffness: 520, damping: 30 }}
              />
            )}
            <span className="relative flex items-center gap-1.5">
              <Icon size={17} strokeWidth={2.4} />
              {label}
            </span>
          </motion.button>
        )
      })}
    </div>
  )
}
