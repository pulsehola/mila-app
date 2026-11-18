import { AnimatePresence, motion } from 'framer-motion'
import { CircleHelp, Hand, Library, Mic, Moon, Redo2, Share2, Sun, Undo2 } from 'lucide-react'
import { useState } from 'react'
import type { Transposition } from '../types'
import { EXAMPLES } from '../state/examples'
import { Logo, Wordmark } from './Logo'
import { IconButton } from './ui'
import { ELASTIC } from './springs'

interface Props {
  title: string
  onTitle: (t: string) => void
  transposition: Transposition
  onTransposition: (t: Transposition) => void
  dark: boolean
  onTheme: () => void
  playing: boolean
  canUndo: boolean
  canRedo: boolean
  onUndo: () => void
  onRedo: () => void
  onTuner: () => void
  onExport: () => void
  onHelp: () => void
  onExample: (key: string | 'blank') => void
  fingerDraw: boolean
  onFinger: () => void
}

export function TopBar(p: Props) {
  const [menu, setMenu] = useState(false)
  return (
    <header
      className="relative z-30 flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-line bg-panel/90 px-4 py-2 backdrop-blur"
      style={{ paddingTop: 'max(8px, env(safe-area-inset-top))' }}
    >
      <div className="flex items-center gap-2">
        <Logo size={44} playing={p.playing} />
        <div className="leading-none">
          <Wordmark className="text-[22px]" />
          <div className="text-[10px] font-bold uppercase tracking-widest text-muted">partituras a mano</div>
        </div>
      </div>

      <input
        aria-label="Título de la partitura"
        value={p.title}
        onChange={(e) => p.onTitle(e.target.value)}
        className="min-w-0 max-w-[220px] flex-1 rounded-2xl border border-transparent bg-transparent px-3 py-2 text-base font-bold focus:border-line focus:bg-paper focus:outline-none"
        style={{ fontSize: 16 }}
      />

      <div className="relative ml-auto flex rounded-2xl border border-line bg-paper p-1" role="group" aria-label="Transposición">
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
              className="relative h-11 rounded-xl px-3 text-sm font-extrabold"
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
        <div className="relative">
          <IconButton label="Melodías de ejemplo" onClick={() => setMenu((v) => !v)} active={menu} tone="sun" size={44}>
            <Library size={20} />
          </IconButton>
          <AnimatePresence>
            {menu && (
              <>
                <div className="fixed inset-0 z-40" onPointerDown={() => setMenu(false)} />
                <motion.div
                  className="absolute right-0 top-14 z-50 w-72 rounded-3xl border border-line bg-panel p-2 shadow-2xl"
                  initial={{ opacity: 0, y: -8, scale: 0.94 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -8, scale: 0.94 }}
                  transition={{ type: 'spring', stiffness: 460, damping: 28 }}
                >
                  <div className="px-3 pb-1 pt-2 text-[11px] font-bold uppercase tracking-widest text-muted">Cargar ejemplo</div>
                  {EXAMPLES.map((ex) => (
                    <button
                      key={ex.key}
                      type="button"
                      onClick={() => {
                        setMenu(false)
                        p.onExample(ex.key)
                      }}
                      className="block w-full rounded-2xl px-3 py-3 text-left"
                    >
                      <div className="font-extrabold">🎺 {ex.name}</div>
                      <div className="text-xs text-muted">{ex.blurb}</div>
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => {
                      setMenu(false)
                      p.onExample('blank')
                    }}
                    className="mt-1 block w-full rounded-2xl border-t border-line px-3 py-3 text-left font-bold"
                  >
                    📄 Partitura en blanco
                  </button>
                </motion.div>
              </>
            )}
          </AnimatePresence>
        </div>
        <IconButton label="Afinador" onClick={p.onTuner} size={44}>
          <Mic size={20} />
        </IconButton>
        <IconButton label="Dibujar también con el dedo" active={p.fingerDraw} onClick={p.onFinger} size={44}>
          <Hand size={20} />
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
