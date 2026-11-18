import { Trash2 } from 'lucide-react'
import type { Note } from '../types'
import { IconButton } from './ui'

interface Props {
  note: Note | null
  canSlur: boolean
  onAcc: (a: '#' | 'b' | 'n') => void
  onToggle: (k: 'staccato' | 'accent' | 'slur') => void
  onDelete: () => void
}

/** Paleta vertical de articulaciones, pensada para el pulgar izquierdo mientras el Pencil escribe. */
export function ArticulationPalette({ note, canSlur, onAcc, onToggle, onDelete }: Props) {
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
      <IconButton label="Borrar nota" disabled={!note} onClick={onDelete} size={56}>
        <Trash2 size={22} />
      </IconButton>
    </div>
  )
}
