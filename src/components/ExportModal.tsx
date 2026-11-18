import { motion } from 'framer-motion'
import { Download, FileMusic, FileText, Loader2, Send } from 'lucide-react'
import { useState } from 'react'
import type { Score } from '../types'
import { canNativeShare, downloadScore, FORMAT_INFO, type ExportFormat, shareScore } from '../export/share'
import { Modal } from './ui'

interface Props {
  open: boolean
  onClose: () => void
  score: Score
  onToast: (m: string, tone?: 'info' | 'warn') => void
}

const ICONS: Record<ExportFormat, typeof FileText> = { pdf: FileText, midi: FileMusic, xml: FileMusic }

export function ExportModal({ open, onClose, score, onToast }: Props) {
  const [fmt, setFmt] = useState<ExportFormat>('pdf')
  const [busy, setBusy] = useState<'download' | 'share' | null>(null)
  const empty = score.measures.every((m) => m.length === 0)

  const run = async (kind: 'download' | 'share') => {
    if (empty) {
      onToast('Escribe alguna nota antes de exportar.', 'warn')
      return
    }
    setBusy(kind)
    try {
      if (kind === 'download') {
        await downloadScore(score, fmt)
        onToast(`${FORMAT_INFO[fmt].label} descargado ✓`)
      } else {
        const r = await shareScore(score, fmt)
        if (r === 'shared') onToast('Compartido ✓')
        else if (r === 'downloaded') onToast('Tu navegador no comparte archivos: lo descargué.')
      }
    } catch (e) {
      onToast(e instanceof Error ? e.message : 'No se pudo exportar', 'warn')
    } finally {
      setBusy(null)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Compartir y exportar" maxWidth={520}>
      <div className="flex flex-col gap-4">
        <div className="grid gap-2" role="radiogroup" aria-label="Formato">
          {(Object.keys(FORMAT_INFO) as ExportFormat[]).map((k) => {
            const Icon = ICONS[k]
            const on = fmt === k
            return (
              <motion.button
                key={k}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => setFmt(k)}
                whileTap={{ scale: 0.97 }}
                className="flex items-center gap-3 rounded-2xl border-2 px-4 py-3 text-left"
                style={{
                  borderColor: on ? 'var(--coral)' : 'var(--line)',
                  background: on ? 'color-mix(in srgb, var(--coral) 12%, var(--panel))' : 'var(--paper)',
                }}
              >
                <Icon size={26} />
                <span className="flex-1">
                  <span className="block text-base font-extrabold">{FORMAT_INFO[k].label}</span>
                  <span className="block text-xs text-muted">{FORMAT_INFO[k].hint}</span>
                </span>
                <span
                  className="grid h-6 w-6 place-items-center rounded-full border-2"
                  style={{ borderColor: on ? 'var(--coral)' : 'var(--line)', background: on ? 'var(--coral)' : 'transparent' }}
                >
                  {on && <span className="h-2 w-2 rounded-full bg-white" />}
                </span>
              </motion.button>
            )
          })}
        </div>

        <div className="flex flex-wrap gap-2">
          <motion.button
            type="button"
            whileTap={{ scale: 0.95 }}
            disabled={busy !== null}
            onClick={() => void run('download')}
            className="flex h-12 flex-1 items-center justify-center gap-2 rounded-2xl border border-line bg-paper px-4 font-black disabled:opacity-60"
          >
            {busy === 'download' ? <Loader2 size={18} className="animate-spin" /> : <Download size={18} />}
            Descargar {FORMAT_INFO[fmt].label}
          </motion.button>
          <motion.button
            type="button"
            whileTap={{ scale: 0.95 }}
            disabled={busy !== null}
            onClick={() => void run('share')}
            className="flex h-12 flex-1 items-center justify-center gap-2 rounded-2xl bg-coral px-4 font-black text-white disabled:opacity-60"
          >
            {busy === 'share' ? <Loader2 size={18} className="animate-spin" /> : <Send size={18} />}
            Compartir…
          </motion.button>
        </div>
        <p className="text-xs text-muted">
          {canNativeShare()
            ? 'Compartir abre la hoja del sistema: AirDrop, WhatsApp, Mensajes, Archivos…'
            : 'Este navegador no tiene hoja de compartir nativa; “Compartir” descargará el archivo.'}
          {score.transposition === 'Bb' && fmt !== 'pdf' ? ' El MIDI suena en altura real; el MusicXML conserva la transposición a Sib.' : ''}
        </p>
      </div>
    </Modal>
  )
}
