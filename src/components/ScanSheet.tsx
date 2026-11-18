import { motion } from 'framer-motion'
import { Camera, FileUp, Loader2, ScanLine } from 'lucide-react'
import { useRef } from 'react'
import { MAX_PDF_PAGES } from '../scan/importScan'
import { ELASTIC } from './springs'
import { Modal } from './ui'

interface Props {
  open: boolean
  busy: boolean
  onClose: () => void
  onFile: (file: File) => void
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
  const pick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (f) onFile(f)
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
          <span className="font-extrabold">Preparando tu partitura…</span>
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
