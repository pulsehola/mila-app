import { motion } from 'framer-motion'
import { Copy, Minus, Plus } from 'lucide-react'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { Score, Transposition } from '../types'
import { renderScore } from '../notation/renderScore'
import { clampKey, keyLabel } from '../state/music'
import { semitoneLabel, transposeMeasures } from '../state/transpose'
import { IconButton, Modal } from './ui'
import { ELASTIC } from './springs'

interface Props {
  open: boolean
  onClose: () => void
  score: Score
  /** Crea en la galería una copia transportada (la partitura actual no cambia). */
  onCreate: (semis: number, transposition: Transposition) => void
}

const PREVIEW_W = 760

/**
 * Transportar por semitonos u octavas, con vista previa. Nunca toca la partitura abierta: crea una copia.
 * En Sib ofrece además "altura real": la misma música escrita como suena (para piano, flauta, voz…).
 */
export function TransposeModal({ open, onClose, score, onCreate }: Props) {
  const [semis, setSemis] = useState(0)
  const [concert, setConcert] = useState(false)
  const bb = score.transposition === 'Bb'
  const total = semis + (concert ? -2 : 0)
  const key = clampKey(score.key)
  useEffect(() => {
    if (open) {
      setSemis(0)
      setConcert(false)
    }
  }, [open])

  const preview = useMemo(() => {
    const used = Math.max(1, score.measures.reduce((a, m, i) => (m.length ? i + 1 : a), 0))
    return transposeMeasures(score.measures.slice(0, Math.min(used, 8)), key, total)
  }, [score.measures, key, total])

  const host = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const el = host.current
    if (!el || !open) return
    const l = renderScore(el, preview.measures, { meter: score.meter, clef: score.clef, key: preview.key, width: PREVIEW_W, perRow: 4 })
    const svg = el.querySelector('svg')
    if (svg) {
      svg.setAttribute('viewBox', `0 0 ${l.width} ${l.height}`)
      svg.removeAttribute('width')
      svg.removeAttribute('height')
      svg.style.width = '100%'
      svg.style.height = 'auto'
    }
    el.style.width = ''
    el.style.height = ''
  }, [preview, open, score.meter, score.clef])

  const step = (d: number) => setSemis((s) => Math.max(-24, Math.min(24, s + d)))
  const target: Transposition = concert ? 'C' : score.transposition

  return (
    <Modal open={open} onClose={onClose} title="Transportar" maxWidth={640}>
      <div className="flex flex-col gap-4">
        {bb && (
          <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-line bg-paper p-3">
            <input type="checkbox" checked={concert} onChange={(e) => setConcert(e.target.checked)} className="mt-1 h-5 w-5 accent-[var(--mint)]" />
            <span className="text-sm">
              <b>En altura real (como suena)</b>
              <span className="block text-muted">
                La trompeta en Sib suena una 2ª mayor más grave de lo escrito. La copia se escribe como suena, para
                piano, flauta o voz, y queda marcada como «Do (real)».
              </span>
            </span>
          </label>
        )}

        <div className="flex flex-wrap items-center justify-center gap-2">
          <button type="button" onClick={() => step(-12)} className="h-11 rounded-2xl border border-line bg-paper px-3 text-sm font-extrabold">
            −8ª
          </button>
          <IconButton label="Medio tono más grave" onClick={() => step(-1)} size={44}>
            <Minus size={20} />
          </IconButton>
          <div className="min-w-[90px] text-center">
            <div className="text-3xl font-black tabular-nums leading-none">{semis > 0 ? `+${semis}` : semis}</div>
            <div className="text-[10px] font-bold uppercase tracking-widest text-muted">semitonos</div>
          </div>
          <IconButton label="Medio tono más agudo" onClick={() => step(1)} size={44}>
            <Plus size={20} />
          </IconButton>
          <button type="button" onClick={() => step(12)} className="h-11 rounded-2xl border border-line bg-paper px-3 text-sm font-extrabold">
            +8ª
          </button>
        </div>

        <p className="text-center text-sm">
          {semitoneLabel(total)}
          <br />
          <span className="text-muted">
            Armadura: {keyLabel(key)} → <b className="text-ink">{keyLabel(preview.key)}</b>
          </span>
        </p>

        <div className="overflow-hidden rounded-2xl border border-line bg-paper">
          <div ref={host} className="score-svg" aria-label="Vista previa transportada" />
        </div>
        <p className="text-xs text-muted">
          Vista previa de los primeros compases. Tu partitura no cambia: se crea una copia nueva en Mis partituras (sin la
          foto escaneada, si la tiene).
        </p>

        <motion.button
          type="button"
          whileTap={{ scale: 0.96 }}
          transition={ELASTIC}
          disabled={total === 0 && target === score.transposition}
          onClick={() => onCreate(total, target)}
          className="flex h-12 items-center justify-center gap-2 rounded-2xl bg-mint font-extrabold text-[#12352c] disabled:opacity-40"
        >
          <Copy size={18} /> Crear copia transportada
        </motion.button>
      </div>
    </Modal>
  )
}
