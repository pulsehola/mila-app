import { AlertTriangle, CheckCircle2 } from 'lucide-react'
import { Modal } from './ui'

export interface ImportReportItem {
  file: string
  title?: string
  part?: string
  warnings: string[]
  /** Si no se pudo importar, el motivo. */
  error?: string
}

/**
 * Qué pasó al importar MusicXML: lo que MILA no puede representar se cuenta aquí (nunca se descarta en
 * silencio), para que Mila sepa qué revisar contra el papel.
 */
export function ImportReport({ items, onClose }: { items: ImportReportItem[] | null; onClose: () => void }) {
  return (
    <Modal open={!!items} onClose={onClose} title="Partitura importada" maxWidth={560}>
      <div className="flex flex-col gap-4" data-testid="import-report">
        {(items ?? []).map((it, i) => (
          <section key={i} className="flex flex-col gap-2">
            <div className="flex items-start gap-2">
              {it.error || it.warnings.length ? (
                <AlertTriangle size={20} className="mt-0.5 shrink-0" style={{ color: it.error ? 'var(--bad)' : 'var(--warn)' }} />
              ) : (
                <CheckCircle2 size={20} className="mt-0.5 shrink-0" style={{ color: 'var(--good)' }} />
              )}
              <div className="min-w-0">
                <div className="truncate text-base font-extrabold">{it.title ?? it.file}</div>
                <div className="text-xs text-muted">
                  {it.error ? `No se pudo importar ${it.file}` : `${it.file}${it.part ? ` · parte «${it.part}»` : ''}`}
                </div>
              </div>
            </div>
            {it.error ? (
              <p className="text-sm">{it.error}</p>
            ) : it.warnings.length ? (
              <ul className="ml-7 list-disc space-y-1 text-sm">
                {it.warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            ) : (
              <p className="ml-7 text-sm text-muted">Se importó todo sin cambios.</p>
            )}
          </section>
        ))}
        <p className="text-xs text-muted">
          Revisa la partitura contra el original: los programas de reconocimiento (OMR) también se equivocan.
        </p>
        <button type="button" onClick={onClose} className="h-12 rounded-2xl bg-coral font-extrabold text-white">
          Entendido
        </button>
      </div>
    </Modal>
  )
}
