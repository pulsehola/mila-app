import { AnimatePresence, motion } from 'framer-motion'
import { Camera, Check, Copy, FolderDown, FolderUp, PenLine, Plus, ScanLine, Trash2 } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { Score } from '../types'
import { drawAnnotations } from '../notation/annotations'
import { renderScore } from '../notation/renderScore'
import { EXAMPLES } from '../state/examples'
import { noteCount, type SavedScore, usedMeasures } from '../state/library'
import { useImageUrl } from '../state/useImageUrl'
import { ELASTIC } from './springs'
import { Modal } from './ui'

interface Props {
  open: boolean
  onClose: () => void
  items: SavedScore[]
  currentId: string
  onOpen: (id: string) => void
  onNew: () => void
  onExample: (key: string) => void
  onDuplicate: (item: SavedScore) => void
  onDelete: (id: string) => void
  onSaveToFiles: (items: SavedScore[]) => void
  onImport: (files: File[]) => void
  onScan: () => void
}

const THUMB_W = 560

/** Miniatura real: los primeros sistemas con sus notas, anotaciones y, si la hay, la partitura escaneada. */
function ScoreThumb({ score }: { score: Score }) {
  const host = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const [h, setH] = useState(300)
  const bg = score.background
  const bgUrl = useImageUrl(bg?.imageId)
  const W = bg ? bg.layoutWidth : THUMB_W

  useLayoutEffect(() => {
    const el = host.current
    if (!el) return
    const measures = bg
      ? score.measures.slice(0, (bg.rowWidths ?? []).slice(0, 3).reduce((n, r) => n + r.length, 0) || bg.perRow * 3)
      : score.measures.slice(0, 4)
    const meter = score.meter
    const l = renderScore(
      el,
      measures,
      bg ? { meter, width: bg.layoutWidth, perRow: bg.perRow, rowH: bg.rowH, rowWidths: bg.rowWidths } : { meter, width: THUMB_W, perRow: 2 },
    )
    // VexFlow fija el tamaño en píxeles del contenedor: aquí debe adaptarse al ancho de la tarjeta.
    el.style.width = ''
    el.style.height = ''
    const svg = el.querySelector('svg')
    if (svg) {
      svg.setAttribute('viewBox', `0 0 ${l.width} ${l.height}`)
      svg.removeAttribute('width')
      svg.removeAttribute('height')
      svg.style.width = '100%'
      svg.style.height = 'auto'
    }
    setH(l.height)
    const c = canvas.current
    if (c) {
      c.width = l.width
      c.height = l.height
      const ctx = c.getContext('2d')!
      ctx.clearRect(0, 0, l.width, l.height)
      const color = getComputedStyle(c).getPropertyValue('--annot').trim() || '#2f62d6'
      drawAnnotations(ctx, score.annotations ?? [], l, color)
    }
  }, [score, bg])

  const cropH = bg ? Math.min(Math.max(h, 300), W * 0.62) : Math.min(h, 330)
  return (
    <div className="relative w-full overflow-hidden" style={{ aspectRatio: `${W} / ${cropH}` }}>
      {bg && bgUrl && (
        <img
          src={bgUrl}
          alt=""
          className={`scan-bg pointer-events-none absolute max-w-none ${bg.enhance ? 'enhance' : ''}`}
          style={{
            left: `${(bg.x / W) * 100}%`,
            top: `${(bg.y / cropH) * 100}%`,
            width: `${bg.scale * 100}%`,
            opacity: bg.opacity,
            transform: bg.rotation ? `rotate(${bg.rotation}deg)` : undefined,
          }}
        />
      )}
      <div ref={host} className="score-svg pointer-events-none absolute inset-x-0 top-0" />
      <canvas ref={canvas} className="pointer-events-none absolute inset-x-0 top-0 w-full" />
    </div>
  )
}

const rtf = typeof Intl !== 'undefined' && 'RelativeTimeFormat' in Intl ? new Intl.RelativeTimeFormat('es', { numeric: 'auto' }) : null

function ago(ts: number): string {
  const s = Math.round((ts - Date.now()) / 1000)
  const abs = Math.abs(s)
  if (!rtf) return new Date(ts).toLocaleString('es')
  if (abs < 45) return 'ahora mismo'
  if (abs < 3600) return rtf.format(Math.round(s / 60), 'minute')
  if (abs < 86400) return rtf.format(Math.round(s / 3600), 'hour')
  if (abs < 86400 * 7) return rtf.format(Math.round(s / 86400), 'day')
  return new Date(ts).toLocaleDateString('es', { day: 'numeric', month: 'short', year: 'numeric' })
}

function Card({
  item,
  current,
  onOpen,
  onDuplicate,
  onDelete,
  onSave,
}: {
  item: SavedScore
  current: boolean
  onOpen: () => void
  onDuplicate: () => void
  onDelete: () => void
  onSave: () => void
}) {
  const [confirm, setConfirm] = useState(false)
  useEffect(() => {
    if (!confirm) return
    const id = window.setTimeout(() => setConfirm(false), 3000)
    return () => window.clearTimeout(id)
  }, [confirm])
  const s = item.score
  const ann = (s.annotations ?? []).length
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 12, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, scale: 0.9 }}
      transition={{ type: 'spring', stiffness: 420, damping: 30 }}
      className="flex flex-col overflow-hidden rounded-3xl border-2 bg-paper"
      style={{ borderColor: current ? 'var(--mi)' : 'var(--line)' }}
    >
      <motion.button
        type="button"
        onClick={onOpen}
        whileTap={{ scale: 0.97 }}
        transition={ELASTIC}
        aria-label={`Abrir ${s.title || 'Sin título'}`}
        className="relative block border-b border-line bg-paper px-1 pt-1"
      >
        <ScoreThumb score={s} />
        {current && (
          <span className="absolute left-2 top-2 rounded-full bg-mi px-2 py-0.5 text-[11px] font-extrabold text-white">
            Abierta
          </span>
        )}
        {s.background && (
          <span className="absolute right-2 top-2 flex items-center gap-1 rounded-full bg-la px-2 py-0.5 text-[11px] font-extrabold text-[#2b2118]">
            <ScanLine size={11} /> Escaneada
          </span>
        )}
      </motion.button>
      <div className="flex items-start gap-2 p-3">
        <button type="button" onClick={onOpen} className="min-w-0 flex-1 text-left">
          <div className="truncate text-base font-extrabold">{s.title || 'Sin título'}</div>
          <div className="text-xs text-muted">
            {ago(item.updatedAt)} · {usedMeasures(s)} compases · {noteCount(s)} notas
            {ann ? (
              <span className="ml-1 inline-flex items-center gap-0.5 text-annot">
                · <PenLine size={11} /> {ann}
              </span>
            ) : null}
          </div>
        </button>
        <div className="flex shrink-0 gap-1">
          <IconMini label="Guardar en…" onClick={onSave}>
            <FolderDown size={17} />
          </IconMini>
          <IconMini label="Duplicar" onClick={onDuplicate}>
            <Copy size={16} />
          </IconMini>
          <AnimatePresence mode="wait" initial={false}>
            {confirm ? (
              <motion.button
                key="sure"
                type="button"
                initial={{ width: 36, opacity: 0 }}
                animate={{ width: 'auto', opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={onDelete}
                className="flex h-9 items-center gap-1 rounded-xl bg-bad px-2.5 text-xs font-extrabold text-white"
              >
                <Trash2 size={14} /> ¿Borrar?
              </motion.button>
            ) : (
              <IconMini key="trash" label="Borrar partitura" onClick={() => setConfirm(true)} danger>
                <Trash2 size={16} />
              </IconMini>
            )}
          </AnimatePresence>
        </div>
      </div>
    </motion.div>
  )
}

function IconMini({
  label,
  onClick,
  children,
  danger,
}: {
  label: string
  onClick: () => void
  children: React.ReactNode
  danger?: boolean
}) {
  return (
    <motion.button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      whileTap={{ scale: 0.85 }}
      transition={ELASTIC}
      className="grid h-9 w-9 place-items-center rounded-xl border border-line bg-panel"
      style={{ color: danger ? 'var(--bad)' : 'var(--ink)' }}
    >
      {children}
    </motion.button>
  )
}

/** "Mis partituras": galería guardada en el dispositivo + «Guardar en…» donde Mila elija. */
export function Gallery(p: Props) {
  const fileInput = useRef<HTMLInputElement>(null)

  return (
    <Modal open={p.open} onClose={p.onClose} title="Mis partituras" maxWidth={920}>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <p className="mr-auto text-xs text-muted">
          Se guardan solas en este dispositivo, con notas, anotaciones, tempo y todo lo demás.
          <br />
          Con <b className="text-ink">Guardar en…</b> eliges dónde guardar una copia (una carpeta, iCloud Drive, Drive…).
        </p>
        <motion.button
          type="button"
          whileTap={{ scale: 0.94 }}
          transition={ELASTIC}
          onClick={() => fileInput.current?.click()}
          className="flex h-10 items-center gap-1.5 rounded-2xl border border-line bg-paper px-3 text-sm font-extrabold"
        >
          <FolderUp size={17} /> Abrir desde Archivos
        </motion.button>
        <motion.button
          type="button"
          whileTap={{ scale: 0.94 }}
          transition={ELASTIC}
          disabled={!p.items.length}
          onClick={() => p.onSaveToFiles(p.items)}
          className="flex h-10 items-center gap-1.5 rounded-2xl bg-ink px-3 text-sm font-extrabold text-paper disabled:opacity-40"
        >
          <FolderDown size={17} /> Guardar todo en…
        </motion.button>
        <input
          ref={fileInput}
          type="file"
          accept=".json,application/json"
          multiple
          hidden
          onChange={(e) => {
            const files = [...(e.target.files ?? [])]
            e.target.value = ''
            if (files.length) p.onImport(files)
          }}
        />
      </div>

      <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-3">
        <motion.button
          type="button"
          onClick={p.onNew}
          whileTap={{ scale: 0.96 }}
          whileHover={{ scale: 1.02 }}
          transition={ELASTIC}
          className="flex min-h-[190px] flex-col items-center justify-center gap-2 rounded-3xl border-2 border-dashed border-line bg-panel text-muted"
        >
          <span className="grid h-14 w-14 place-items-center rounded-full bg-mi text-white shadow-lg">
            <Plus size={28} strokeWidth={2.6} />
          </span>
          <span className="text-base font-extrabold text-ink">Nueva partitura</span>
        </motion.button>
        <motion.button
          type="button"
          onClick={p.onScan}
          whileTap={{ scale: 0.96 }}
          whileHover={{ scale: 1.02 }}
          transition={ELASTIC}
          className="flex min-h-[190px] flex-col items-center justify-center gap-2 rounded-3xl border-2 border-dashed border-line bg-panel px-4 text-center text-muted"
        >
          <span className="grid h-14 w-14 place-items-center rounded-full bg-la text-white shadow-lg">
            <Camera size={26} strokeWidth={2.4} />
          </span>
          <span className="text-base font-extrabold text-ink">Escanear o importar</span>
          <span className="text-xs">Foto de tu partitura de papel o un PDF</span>
        </motion.button>
        <AnimatePresence initial={false}>
          {p.items.map((it) => (
            <Card
              key={it.id}
              item={it}
              current={it.id === p.currentId}
              onOpen={() => p.onOpen(it.id)}
              onDuplicate={() => p.onDuplicate(it)}
              onDelete={() => p.onDelete(it.id)}
              onSave={() => p.onSaveToFiles([it])}
            />
          ))}
        </AnimatePresence>
      </div>

      {p.items.length === 0 && (
        <p className="mt-3 flex items-center gap-1.5 text-sm text-muted">
          <Check size={15} /> En cuanto escribas una nota, la partitura aparecerá aquí.
        </p>
      )}

      <div className="mt-6 text-[11px] font-bold uppercase tracking-widest text-muted">Empezar desde un ejemplo</div>
      <div className="mt-2 flex flex-wrap gap-2">
        {EXAMPLES.map((ex) => (
          <motion.button
            key={ex.key}
            type="button"
            whileTap={{ scale: 0.94 }}
            transition={ELASTIC}
            onClick={() => p.onExample(ex.key)}
            className="rounded-2xl border border-line bg-paper px-3 py-2 text-left"
          >
            <div className="text-sm font-extrabold">🎺 {ex.name}</div>
            <div className="text-[11px] text-muted">{ex.blurb}</div>
          </motion.button>
        ))}
      </div>
    </Modal>
  )
}
