import { AnimatePresence, motion } from 'framer-motion'
import { Check, Download, FileImage, FileMusic, FileText, Loader2, MessageCircle, Send } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { Score } from '../types'
import {
  buildFiles,
  canNativeShare,
  downloadScore,
  FORMAT_INFO,
  type ExportFormat,
  type ShareResult,
  shareFiles,
  shareScore,
} from '../export/share'
import { pageCount } from '../export/pdf'
import { Modal } from './ui'
import { ELASTIC } from './springs'

interface Props {
  open: boolean
  onClose: () => void
  score: Score
  onToast: (m: string, tone?: 'info' | 'warn') => void
}

const ICONS: Record<ExportFormat, typeof FileText> = { pdf: FileText, png: FileImage, midi: FileMusic, xml: FileMusic }
const WA_GREEN = '#25D366'
type WaFormat = 'png' | 'pdf'

export function ExportModal({ open, onClose, score, onToast }: Props) {
  const [fmt, setFmt] = useState<ExportFormat>('pdf')
  const [waFmt, setWaFmt] = useState<WaFormat>('png')
  const [busy, setBusy] = useState<'download' | 'share' | 'wa' | null>(null)
  const empty = score.measures.every((m) => m.length === 0) && !(score.annotations ?? []).length

  // El archivo para WhatsApp se genera al abrir: así el toque abre la hoja de compartir al instante
  // (Safari solo permite navigator.share justo después del gesto).
  const [ready, setReady] = useState<{ score: Score; fmt: WaFormat; files: File[] } | null>(null)
  /** Páginas A4 de la partitura y cuál exportar como PNG (null = todas). */
  const [pages, setPages] = useState(1)
  const [pngPage, setPngPage] = useState<number | null>(null)
  useEffect(() => {
    if (!open || empty) return
    let alive = true
    void pageCount(score).then((n) => {
      if (!alive) return
      setPages(n)
      setPngPage((p) => (p !== null && p >= n ? null : p))
    })
    return () => {
      alive = false
    }
  }, [open, empty, score])
  const building = useRef<string>('')
  useEffect(() => {
    if (!open || empty) return
    if (ready && ready.score === score && ready.fmt === waFmt) return
    const key = `${waFmt}:${Date.now()}`
    building.current = key
    void buildFiles(score, waFmt)
      .then((files) => {
        if (building.current === key) setReady({ score, fmt: waFmt, files })
      })
      .catch(() => {
        /* se reintenta al pulsar */
      })
  }, [open, empty, score, waFmt, ready])
  const waFiles = ready && ready.score === score && ready.fmt === waFmt ? ready.files : null

  const report = (r: ShareResult) => {
    if (r === 'shared') onToast('Enviado ✓')
    else if (r === 'downloaded') onToast('Este navegador no comparte archivos: lo descargué para adjuntarlo.')
    else if (r === 'blocked') onToast('Listo. Toca otra vez para enviar.')
  }

  const sendWhatsApp = async () => {
    if (empty) {
      onToast('Escribe alguna nota antes de enviar.', 'warn')
      return
    }
    const title = score.title || 'Partitura MILA'
    if (waFiles) {
      report(await shareFiles(waFiles, title)) // sin await previo: conserva el gesto
      return
    }
    setBusy('wa')
    try {
      const files = await buildFiles(score, waFmt)
      setReady({ score, fmt: waFmt, files })
      report(await shareFiles(files, title))
    } catch (e) {
      onToast(e instanceof Error ? e.message : 'No se pudo preparar el archivo', 'warn')
    } finally {
      setBusy(null)
    }
  }

  const run = async (kind: 'download' | 'share') => {
    if (empty) {
      onToast('Escribe alguna nota antes de exportar.', 'warn')
      return
    }
    setBusy(kind)
    try {
      const page = fmt === 'png' && pngPage !== null ? pngPage : undefined
      if (kind === 'download') {
        const n = await downloadScore(score, fmt, page)
        onToast(n > 1 ? `${n} imágenes descargadas ✓` : `${FORMAT_INFO[fmt].label} descargado ✓`)
      } else {
        report(await shareScore(score, fmt, page))
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
        {/* WhatsApp: un toque */}
        <div
          className="rounded-3xl border-2 p-3"
          style={{ borderColor: `color-mix(in srgb, ${WA_GREEN} 45%, var(--line))`, background: `color-mix(in srgb, ${WA_GREEN} 8%, var(--paper))` }}
        >
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="text-sm font-extrabold">Enviar a un chat</span>
            <div className="flex rounded-full border border-line bg-panel p-0.5" role="radiogroup" aria-label="Formato para WhatsApp">
              {(['png', 'pdf'] as const).map((k) => {
                const on = waFmt === k
                return (
                  <button
                    key={k}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    onClick={() => setWaFmt(k)}
                    className="relative h-8 rounded-full px-3 text-xs font-extrabold"
                    style={{ color: on ? '#fff' : 'var(--muted)' }}
                  >
                    {on && (
                      <motion.span
                        layoutId="wa-pill"
                        className="absolute inset-0 rounded-full"
                        style={{ background: WA_GREEN }}
                        transition={{ type: 'spring', stiffness: 520, damping: 30 }}
                      />
                    )}
                    <span className="relative">{FORMAT_INFO[k].label}</span>
                  </button>
                )
              })}
            </div>
          </div>
          <motion.button
            type="button"
            whileTap={{ scale: 0.94 }}
            whileHover={{ scale: 1.02 }}
            transition={ELASTIC}
            disabled={busy !== null}
            onClick={() => void sendWhatsApp()}
            className="flex h-14 w-full items-center justify-center gap-2 rounded-2xl text-base font-extrabold text-white shadow-lg disabled:opacity-70"
            style={{ background: WA_GREEN, boxShadow: `0 10px 24px -12px ${WA_GREEN}` }}
          >
            {busy === 'wa' ? <Loader2 size={22} className="animate-spin" /> : <MessageCircle size={22} strokeWidth={2.4} />}
            Enviar por WhatsApp
          </motion.button>
          <div className="mt-2 flex items-center gap-1.5 text-xs text-muted">
            <AnimatePresence mode="wait" initial={false}>
              {empty ? (
                <motion.span key="empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                  Escribe alguna nota para poder enviarla.
                </motion.span>
              ) : waFiles ? (
                <motion.span key="ok" className="flex items-center gap-1" initial={{ opacity: 0, y: 3 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
                  <Check size={14} style={{ color: WA_GREEN }} />{' '}
                  {waFmt === 'png' && waFiles.length > 1 ? `${waFiles.length} imágenes (una por página) listas` : `${FORMAT_INFO[waFmt].label} lista`} · elige
                  WhatsApp en la hoja de compartir
                </motion.span>
              ) : (
                <motion.span key="prep" className="flex items-center gap-1" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                  <Loader2 size={13} className="animate-spin" /> Preparando {FORMAT_INFO[waFmt].label.toLowerCase()}…
                </motion.span>
              )}
            </AnimatePresence>
          </div>
        </div>

        <div className="text-[11px] font-bold uppercase tracking-widest text-muted">Otros formatos</div>
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
                transition={ELASTIC}
                className="flex items-center gap-3 rounded-2xl border-2 px-4 py-2.5 text-left"
                style={{
                  borderColor: on ? 'var(--coral)' : 'var(--line)',
                  background: on ? 'color-mix(in srgb, var(--coral) 12%, var(--panel))' : 'var(--paper)',
                }}
              >
                <Icon size={24} />
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

        {fmt === 'png' && pages > 1 && (
          <div className="flex flex-wrap items-center gap-2" role="radiogroup" aria-label="Página a exportar">
            <span className="text-xs font-bold text-muted">Páginas:</span>
            {[null, ...Array.from({ length: pages }, (_, i) => i)].map((p) => {
              const on = pngPage === p
              return (
                <button
                  key={p ?? 'all'}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => setPngPage(p)}
                  className="h-9 min-w-[44px] rounded-full border border-line px-3 text-sm font-extrabold"
                  style={{ background: on ? 'var(--coral)' : 'var(--paper)', color: on ? '#fff' : 'var(--ink)' }}
                >
                  {p === null ? `Todas (${pages})` : p + 1}
                </button>
              )
            })}
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          <motion.button
            type="button"
            whileTap={{ scale: 0.95 }}
            transition={ELASTIC}
            disabled={busy !== null}
            onClick={() => void run('download')}
            className="flex h-12 flex-1 items-center justify-center gap-2 rounded-2xl border border-line bg-paper px-4 font-extrabold disabled:opacity-60"
          >
            {busy === 'download' ? <Loader2 size={18} className="animate-spin" /> : <Download size={18} />}
            Descargar {FORMAT_INFO[fmt].label}
          </motion.button>
          <motion.button
            type="button"
            whileTap={{ scale: 0.95 }}
            transition={ELASTIC}
            disabled={busy !== null}
            onClick={() => void run('share')}
            className="flex h-12 flex-1 items-center justify-center gap-2 rounded-2xl bg-coral px-4 font-extrabold text-white disabled:opacity-60"
          >
            {busy === 'share' ? <Loader2 size={18} className="animate-spin" /> : <Send size={18} />}
            Compartir…
          </motion.button>
        </div>
        <p className="text-xs text-muted">
          {canNativeShare()
            ? 'Compartir abre la hoja del sistema: AirDrop, WhatsApp, Mensajes, Archivos…'
            : 'Este navegador no tiene hoja de compartir nativa; se descargará el archivo.'}
          {' PDF e imágenes salen en páginas A4 con lo que se ve en la partitura (notas y anotaciones a mano), sin botones ni marcas de la app.'}
          {score.transposition === 'Bb' && (fmt === 'midi' || fmt === 'xml') ? ' El MIDI suena en altura real; el MusicXML conserva la transposición a Sib.' : ''}
        </p>
      </div>
    </Modal>
  )
}
