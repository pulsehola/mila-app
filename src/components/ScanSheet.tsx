import { motion } from 'framer-motion'
import { Camera, FileUp, Loader2, ScanLine, Wand2 } from 'lucide-react'
import { useRef, useState } from 'react'
import { MAX_PDF_PAGES } from '../scan/importScan'
import { ELASTIC } from './springs'
import { Modal } from './ui'

interface Props {
  open: boolean
  busy: boolean
  onClose: () => void
  /** `convert`: leer las notas del papel y convertirlas en notas editables. */
  onFile: (file: File, convert: boolean) => void
}

function Big({
  onClick,
  icon,
  title,
  hint,
  color,
  busy,
}: {
  onClick: () => void
  icon: React.ReactNode
  title: string
  hint: string
  color: string
  busy: boolean
}) {
  return (
    <motion.button
      type="button"
      disabled={busy}
      onClick={onClick}
      whileTap={{ scale: 0.95 }}
      whileHover={{ scale: 1.02 }}
      transition={ELASTIC}
      className="flex flex-1 flex-col items-center gap-2 rounded-3xl border-2 border-line bg-paper px-4 py-6 text-center disabled:opacity-50"
    >
      <span className="grid h-16 w-16 place-items-center rounded-full text-white shadow-lg" style={{ background: color }}>
        {icon}
      </span>
      <span className="text-base font-extrabold">{title}</span>
      <span className="text-xs text-muted">{hint}</span>
    </motion.button>
  )
}

/** Escanear (cámara del iPad/Mac) o importar una foto o PDF como fondo de la hoja. */
export function ScanSheet({ open, busy, onClose, onFile }: Props) {
  const camera = useRef<HTMLInputElement>(null)
  const upload = useRef<HTMLInputElement>(null)
  const [convert, setConvert] = useState(true)
  const pick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (f) onFile(f, convert)
  }

  return (
    <Modal open={open} onClose={busy ? () => undefined : onClose} title="Escanear o importar partitura" maxWidth={560}>
      <p className="mb-4 text-sm text-muted">
        Tu partitura de papel queda de fondo y puedes escribir notas, anotaciones y borrar encima, con audio y transposición.
      </p>
      {busy ? (
        <div className="flex flex-col items-center gap-3 py-10">
          <motion.span animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 1.1, ease: 'linear' }}>
            <Loader2 size={36} className="text-mi" />
          </motion.span>
          <span className="font-extrabold">{convert ? 'Leyendo las notas del papel…' : 'Preparando tu partitura…'}</span>
        </div>
      ) : (
        <div className="flex flex-col gap-3 sm:flex-row">
          <Big
            onClick={() => camera.current?.click()}
            icon={<Camera size={30} />}
            title="Hacer foto"
            hint="Con la cámara del iPad o del Mac"
            color="var(--mi)"
            busy={busy}
          />
          <Big
            onClick={() => upload.current?.click()}
            icon={<FileUp size={30} />}
            title="Subir foto o PDF"
            hint={`Desde Fotos o Archivos (PDF: hasta ${MAX_PDF_PAGES} páginas)`}
            color="var(--la)"
            busy={busy}
          />
        </div>
      )}
      {!busy && (
        <button
          type="button"
          aria-pressed={convert}
          onClick={() => setConvert((v) => !v)}
          className="mt-3 flex w-full items-center justify-between rounded-2xl border border-line bg-paper px-3 py-2.5 text-left text-sm font-bold"
        >
          <span className="flex items-center gap-2">
            <Wand2 size={17} />
            <span>
              Convertir en notas editables
              <span className="block text-xs font-medium text-muted">Lee pentagramas, compases y notas del papel (borrador para revisar)</span>
            </span>
          </span>
          <span className="relative h-6 w-10 shrink-0 rounded-full transition-colors" style={{ background: convert ? 'var(--mi)' : 'var(--line)' }}>
            <motion.span
              className="absolute top-0.5 h-5 w-5 rounded-full bg-white shadow"
              animate={{ left: convert ? 18 : 2 }}
              transition={{ type: 'spring', stiffness: 600, damping: 30 }}
            />
          </span>
        </button>
      )}
      <div className="mt-4 flex items-start gap-2 rounded-2xl bg-sun/20 p-3 text-xs">
        <ScanLine size={16} className="mt-0.5 shrink-0" />
        <span>
          Para una buena foto: buena luz, la hoja entera, recta y sin sombras. Después podrás moverla, girarla y
          ajustar su tamaño para que el pentagrama coincida.
        </span>
      </div>
      <input ref={camera} type="file" accept="image/*" capture="environment" hidden onChange={pick} />
      <input ref={upload} type="file" accept="image/*,application/pdf,.pdf" hidden onChange={pick} />
    </Modal>
  )
}
