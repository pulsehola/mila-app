import { Trash2 } from 'lucide-react'
import type { Note, TupletKind } from '../types'
import { IconButton } from './ui'

interface Props {
  note: Note | null
  canSlur: boolean
  onAcc: (a: '#' | 'b' | 'n') => void
  onToggle: (k: 'staccato' | 'accent' | 'slur') => void
  onDot: () => void
  onTuplet: (k: TupletKind) => void
  onDelete: () => void
}

/** Paleta vertical de articulaciones, pensada para el pulgar izquierdo mientras el Pencil escribe. */
export function ArticulationPalette({ note, canSlur, onAcc, onToggle, onDot, onTuplet, onDelete }: Props) {
  const isNote = note?.kind === 'note'
  const off = !isNote
  return (
    <div className="flex w-[76px] shrink-0 flex-col items-center gap-2 overflow-y-auto px-2 py-3" aria-label="Articulaciones">
      <IconButton label="Sostenido ♯" active={note?.acc === '#'} disabled={off} onClick={() => onAcc('#')} size={56}>
        <span className="text-2xl leading-none">♯</span>
      </IconButton>
      <IconButton label="Bemol ♭" active={note?.acc === 'b'} disabled={off} onClick={() => onAcc('b')} size={56}>
        <span className="text-2xl leading-none">♭</span>
      </IconButton>
      <IconButton label="Becuadro ♮" active={note?.acc === 'n'} disabled={off} onClick={() => onAcc('n')} size={56}>
        <span className="text-2xl leading-none">♮</span>
      </IconButton>
      <div className="my-1 h-px w-8 bg-line" />
      <IconButton label="Staccato" active={!!note?.staccato} disabled={off} onClick={() => onToggle('staccato')} size={56} tone="sun">
        <span className="text-3xl leading-none">•</span>
      </IconButton>
      <IconButton label="Acento" active={!!note?.accent} disabled={off} onClick={() => onToggle('accent')} size={56} tone="sun">
        <span className="text-2xl leading-none">&gt;</span>
      </IconButton>
      <IconButton
        label="Ligadura a la siguiente nota"
        active={!!note?.slur}
        disabled={off || !canSlur}
        onClick={() => onToggle('slur')}
        size={56}
        tone="mint"
      >
        <svg width="28" height="16" viewBox="0 0 28 16" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round">
          <path d="M3 4c4 11 18 11 22 0" />
        </svg>
      </IconButton>
      <div className="my-1 h-px w-8 bg-line" />
      <IconButton label="Puntillo (suma la mitad del valor)" active={!!note?.dot} disabled={!note} onClick={onDot} size={56} tone="mint">
        <svg width="28" height="20" viewBox="0 0 28 20" aria-hidden>
          <ellipse cx="10" cy="12" rx="6" ry="4.4" transform="rotate(-20 10 12)" fill="currentColor" />
          <circle cx="22" cy="10" r="2.6" fill="currentColor" />
        </svg>
      </IconButton>
      {([3, 5, 6] as const).map((k) => (
        <IconButton
          key={k}
          label={`${k === 3 ? 'Tresillo' : k === 5 ? 'Quintillo' : 'Seisillo'}: esta nota y las ${k - 1} siguientes`}
          active={note?.tuplet?.n === k}
          disabled={!note}
          onClick={() => onTuplet(k)}
          size={56}
          tone="mint"
        >
          <span className="flex flex-col items-center leading-none">
            <svg width="30" height="7" viewBox="0 0 30 7" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
              <path d="M2 6V2h9M19 2h9v4" />
            </svg>
            <span className="-mt-2 text-lg font-black">{k}</span>
          </span>
        </IconButton>
      ))}
      <div className="my-1 h-px w-8 bg-line" />
      <IconButton label="Borrar nota" disabled={!note} onClick={onDelete} size={56}>
        <Trash2 size={22} />
      </IconButton>
    </div>
  )
}
