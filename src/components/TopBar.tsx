import { AnimatePresence, motion } from 'framer-motion'
import { CircleHelp, FolderDown, Hand, LayoutGrid, Maximize2, Mic, Moon, Redo2, Share2, Sun, Undo2 } from 'lucide-react'
import type { Meter, Transposition } from '../types'
import { METERS } from '../state/music'
import { Logo, Wordmark } from './Logo'
import { IconButton } from './ui'
import { ELASTIC } from './springs'

interface Props {
  title: string
  onTitle: (t: string) => void
  transposition: Transposition
  onTransposition: (t: Transposition) => void
  /** Métrica de toda la partitura (2/4, 3/4, 4/4, 6/8). */
  meter: Meter
  onMeter: (m: Meter) => void
  dark: boolean
  onTheme: () => void
  playing: boolean
  canUndo: boolean
  canRedo: boolean
  onUndo: () => void
  onRedo: () => void
  onTuner: () => void
  onExport: () => void
  /** Guardar en… (Mila elige la carpeta). */
  onSave: () => void
  onHelp: () => void
  onGallery: () => void
  fingerDraw: boolean
  onFinger: () => void
  /** Pantalla de escritura: oculta barras y paleta. */
  onFocus: () => void
}

export function TopBar(p: Props) {
  return (
    <header
      className="relative z-30 flex min-h-[60px] flex-wrap items-center gap-x-3 gap-y-2 border-b border-line bg-panel/90 py-2 backdrop-blur"
      style={{
        paddingTop: 'max(8px, env(safe-area-inset-top))',
        paddingLeft: 'max(16px, env(safe-area-inset-left))',
        paddingRight: 'max(16px, env(safe-area-inset-right))',
      }}
    >
      {/* Logo: mismo alto (44 px) que el resto de controles y centrado con ellos. El SVG va como "block"
          para que no herede el hueco de línea base de un elemento inline. */}
      <div className="flex h-11 flex-none items-center gap-2.5">
        <span className="grid h-10 w-10 flex-none place-items-center" style={{ aspectRatio: '1 / 1' }}>
          <Logo size={40} playing={p.playing} interactive={false} />
        </span>
        <div className="flex flex-none flex-col justify-center gap-[3px] whitespace-nowrap">
          <Wordmark className="text-[22px] leading-none" animate={false} />
          <div className="text-[10px] font-bold uppercase leading-none tracking-widest text-muted">partituras a mano</div>
        </div>
      </div>

      <input
        aria-label="Título de la partitura"
        value={p.title}
        onChange={(e) => p.onTitle(e.target.value)}
        className="h-11 min-w-[110px] max-w-[220px] flex-1 rounded-2xl border border-transparent bg-transparent px-3 text-base font-bold leading-none focus:border-line focus:bg-paper focus:outline-none"
        style={{ fontSize: 16 }}
      />

      {/* Métrica: selector nativo (en el iPad abre la rueda del sistema, cómoda con el dedo). */}
      <label className="relative ml-auto flex h-11 flex-none items-center gap-1 rounded-2xl border border-line bg-paper pl-3 pr-2 text-sm font-extrabold" title="Compás de la partitura">
        <span className="text-[10px] font-bold uppercase tracking-widest text-muted">Compás</span>
        <select
          aria-label="Compás (métrica)"
          value={p.meter}
          onChange={(e) => p.onMeter(e.target.value as Meter)}
          className="h-9 cursor-pointer appearance-none rounded-xl bg-transparent px-1.5 text-base font-black focus:outline-none"
          style={{ fontSize: 16 }}
        >
          {METERS.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      </label>

      <div className="relative flex h-11 items-center rounded-2xl border border-line bg-paper p-1" role="group" aria-label="Transposición">
        {(
          [
            ['Bb', 'Trompeta Sib'],
            ['C', 'Do (real)'],
          ] as const
        ).map(([key, label]) => {
          const on = p.transposition === key
          return (
            <button
              key={key}
              type="button"
              aria-pressed={on}
              onClick={() => p.onTransposition(key)}
              className="relative h-full rounded-xl px-3 text-sm font-extrabold"
              style={{ color: on ? '#2b2118' : 'var(--muted)' }}
            >
              {on && (
                <motion.span
                  layoutId="transp-pill"
                  className="absolute inset-0 rounded-xl bg-sun"
                  transition={{ type: 'spring', stiffness: 500, damping: 34 }}
                />
              )}
              <span className="relative">{label}</span>
            </button>
          )
        })}
      </div>

      <div className="flex items-center gap-1.5">
        <IconButton label="Deshacer (⌘Z)" onClick={p.onUndo} disabled={!p.canUndo} size={44}>
          <Undo2 size={20} />
        </IconButton>
        <IconButton label="Rehacer (⇧⌘Z)" onClick={p.onRedo} disabled={!p.canRedo} size={44}>
          <Redo2 size={20} />
        </IconButton>
        <IconButton label="Mis partituras" onClick={p.onGallery} tone="sun" size={44}>
          <LayoutGrid size={20} />
        </IconButton>
        <IconButton label="Guardar en… (⌘S)" onClick={p.onSave} tone="mint" size={44}>
          <FolderDown size={20} />
        </IconButton>
        <IconButton label="Afinador" onClick={p.onTuner} size={44}>
          <Mic size={20} />
        </IconButton>
        <IconButton label="Dibujar también con el dedo" active={p.fingerDraw} onClick={p.onFinger} size={44}>
          <Hand size={20} />
        </IconButton>
        <IconButton label="Pantalla de escritura: ocultar barras (F)" onClick={p.onFocus} size={44}>
          <Maximize2 size={20} />
        </IconButton>
        <IconButton label="Guía de trazos" onClick={p.onHelp} size={44}>
          <CircleHelp size={20} />
        </IconButton>
        <IconButton label={p.dark ? 'Modo claro' : 'Modo oscuro de escenario'} onClick={p.onTheme} size={44}>
          <AnimatePresence mode="wait" initial={false}>
            <motion.span
              key={p.dark ? 'sun' : 'moon'}
              initial={{ rotate: -90, scale: 0.4, opacity: 0 }}
              animate={{ rotate: 0, scale: 1, opacity: 1 }}
              exit={{ rotate: 90, scale: 0.4, opacity: 0 }}
              transition={{ duration: 0.18 }}
              className="grid place-items-center"
            >
              {p.dark ? <Sun size={20} /> : <Moon size={20} />}
            </motion.span>
          </AnimatePresence>
        </IconButton>
        <motion.button
          type="button"
          onClick={p.onExport}
          whileTap={{ scale: 0.92 }}
          transition={ELASTIC}
          className="flex h-11 items-center gap-2 rounded-2xl bg-coral px-4 text-sm font-black text-white shadow"
        >
          <Share2 size={18} /> Compartir
        </motion.button>
      </div>
    </header>
  )
}
