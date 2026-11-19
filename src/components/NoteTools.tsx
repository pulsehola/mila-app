import { motion } from 'framer-motion'
import { ClipboardPaste, Copy } from 'lucide-react'
import type { Duration, Dynamic, Note } from '../types'
import { DUR_LABEL, DYNAMIC_LABEL, DYNAMICS } from '../state/music'
import { ELASTIC } from './springs'

const DURS: Duration[] = ['w', 'h', 'q', '8', '16']

/** Figura dibujada (cabeza, plica y corchetes) para los botones de duración. */
function DurGlyph({ d }: { d: Duration }) {
  const hollow = d === 'w' || d === 'h'
  const flags = d === '8' ? 1 : d === '16' ? 2 : 0
  return (
    <svg width="22" height="30" viewBox="0 0 22 30" aria-hidden>
      <ellipse
        cx="8"
        cy="23"
        rx="5.6"
        ry="4"
        transform="rotate(-20 8 23)"
        fill={hollow ? 'none' : 'currentColor'}
        stroke="currentColor"
        strokeWidth={hollow ? 2 : 0}
      />
      {d !== 'w' && <path d="M13 22V3" stroke="currentColor" strokeWidth="1.8" />}
      {Array.from({ length: flags }, (_, i) => (
        <path key={i} d={`M13 ${3 + i * 6}c1 5 7 6 6 12`} fill="none" stroke="currentColor" strokeWidth="1.8" />
      ))}
    </svg>
  )
}

interface Props {
  note: Note | null
  onDur: (d: Duration) => void
  onDyn: (d: Dynamic) => void
  canCopy: boolean
  canPaste: boolean
  onCopy: () => void
  onPaste: () => void
}

/**
 * Barra de la nota seleccionada: cambiar la figura (también de un silencio), poner un matiz y copiar/pegar
 * el compás. Aparece abajo, encima de Notas/Anotar/Goma, al tocar una nota.
 */
export function NoteTools({ note, onDur, onDyn, canCopy, canPaste, onCopy, onPaste }: Props) {
  const btn = 'grid h-11 min-w-11 place-items-center rounded-xl px-1.5 text-sm font-extrabold'
  return (
    <motion.div
      initial={{ opacity: 0, y: 10, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 10 }}
      transition={ELASTIC}
      className="pointer-events-auto flex w-fit max-w-full flex-wrap items-center gap-1 rounded-2xl border border-line bg-panel/95 p-1 shadow-lg backdrop-blur"
      role="toolbar"
      aria-label="Nota seleccionada"
    >
      <div className="flex items-center gap-0.5" role="group" aria-label="Figura">
        {DURS.map((d) => {
          const on = note?.dur === d
          return (
            <button
              key={d}
              type="button"
              aria-label={`${DUR_LABEL[d]}${note?.kind === 'rest' ? ' (silencio)' : ''}`}
              title={DUR_LABEL[d]}
              aria-pressed={on}
              disabled={!note}
              onClick={() => onDur(d)}
              className={`${btn} disabled:opacity-35`}
              style={{ background: on ? 'var(--sky)' : 'transparent', color: on ? '#0b2540' : 'var(--ink)' }}
            >
              <DurGlyph d={d} />
            </button>
          )
        })}
      </div>
      <div className="mx-0.5 h-8 w-px bg-line" />
      <div className="flex items-center gap-0.5" role="group" aria-label="Matiz">
        {DYNAMICS.map((d) => {
          const on = note?.dyn === d
          return (
            <button
              key={d}
              type="button"
              aria-label={`Matiz ${d}: ${DYNAMIC_LABEL[d]}`}
              title={DYNAMIC_LABEL[d]}
              aria-pressed={on}
              disabled={!note}
              onClick={() => onDyn(d)}
              className={`${btn} font-serif text-[17px] italic disabled:opacity-35`}
              style={{ background: on ? 'var(--sun)' : 'transparent', color: on ? '#2b2118' : 'var(--ink)' }}
            >
              {d}
            </button>
          )
        })}
      </div>
      <div className="mx-0.5 h-8 w-px bg-line" />
      <button
        type="button"
        aria-label="Copiar este compás (⌘C)"
        title="Copiar este compás (⌘C)"
        disabled={!canCopy}
        onClick={onCopy}
        className={`${btn} gap-1 disabled:opacity-35`}
      >
        <span className="flex items-center gap-1">
          <Copy size={17} /> <span className="hidden sm:inline">Copiar</span>
        </span>
      </button>
      <button
        type="button"
        aria-label="Pegar el compás copiado después de este (⌘V)"
        title="Pegar después de este compás (⌘V)"
        disabled={!canPaste}
        onClick={onPaste}
        className={`${btn} disabled:opacity-35`}
      >
        <span className="flex items-center gap-1">
          <ClipboardPaste size={17} /> <span className="hidden sm:inline">Pegar</span>
        </span>
      </button>
    </motion.div>
  )
}
