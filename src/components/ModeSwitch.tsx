import { motion } from 'framer-motion'
import { Eraser, Music2, PenLine } from 'lucide-react'
import type { EditMode } from '../types'
import { ELASTIC } from './springs'

interface Props {
  mode: EditMode
  onMode: (m: EditMode) => void
}

const OPTIONS: { key: EditMode; label: string; hint: string; Icon: typeof Music2; color: string }[] = [
  { key: 'notes', label: 'Notas', hint: 'El trazo se convierte en partitura', Icon: Music2, color: 'var(--mi)' },
  { key: 'annotate', label: 'Anotar', hint: 'Texto, flechas y recuadros a mano', Icon: PenLine, color: 'var(--annot)' },
  { key: 'erase', label: 'Goma', hint: 'Toca o pasa por encima para borrar', Icon: Eraser, color: 'var(--coral)' },
]

const KEYS: Record<EditMode, string> = { notes: 'M', annotate: 'M', erase: 'G' }

/**
 * Barra rápida: escribir notas (reconocidas), anotar a mano alzada (se guarda tal cual) o goma.
 * Teclas: M alterna Notas/Anotar, G activa/desactiva la goma.
 */
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
            title={`${label} · ${hint} (${KEYS[key]})`}
            onClick={() => onMode(key)}
            whileTap={{ scale: 0.9 }}
            transition={ELASTIC}
            className="relative flex h-11 items-center gap-1.5 rounded-full px-3.5 text-sm font-extrabold"
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
