import { AnimatePresence, motion } from 'framer-motion'
import { X } from 'lucide-react'
import type { ReactNode } from 'react'
import { ELASTIC } from './springs'

/** Botón táctil de tamaño cómodo (≥44 px) sin depender de :hover. */
export function IconButton({
  label,
  onClick,
  active,
  disabled,
  children,
  tone = 'plain',
  size = 48,
  className = '',
}: {
  label: string
  onClick?: () => void
  active?: boolean
  disabled?: boolean
  children: ReactNode
  tone?: 'plain' | 'coral' | 'sun' | 'mint'
  size?: number
  className?: string
}) {
  const bg =
    active && tone === 'sun'
      ? 'var(--sun)'
      : active && tone === 'mint'
        ? 'var(--mint)'
        : active
          ? 'var(--coral)'
          : 'var(--panel)'
  const fg = active ? '#2b2118' : 'var(--ink)'
  return (
    <motion.button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      whileTap={{ scale: 0.84, rotate: -3 }}
      whileHover={{ scale: 1.05, y: -1 }}
      transition={ELASTIC}
      className={`grid shrink-0 place-items-center rounded-2xl border border-line text-lg font-bold shadow-sm disabled:opacity-35 ${className}`}
      style={{ width: size, height: size, background: bg, color: active && tone === 'coral' ? '#fff' : fg }}
    >
      {children}
    </motion.button>
  )
}

export function Modal({
  open,
  onClose,
  title,
  children,
  maxWidth = 560,
}: {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
  maxWidth?: number
}) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 grid place-items-center p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <div className="absolute inset-0 bg-black/45 backdrop-blur-[2px]" onPointerDown={onClose} />
          <motion.div
            role="dialog"
            aria-label={title}
            className="relative max-h-[90vh] w-full overflow-auto rounded-[28px] border border-line bg-panel p-5 shadow-2xl"
            style={{ maxWidth }}
            initial={{ scale: 0.88, y: 24, opacity: 0 }}
            animate={{ scale: 1, y: 0, opacity: 1 }}
            exit={{ scale: 0.92, y: 16, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 380, damping: 26 }}
          >
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-xl font-extrabold">{title}</h2>
              <IconButton label="Cerrar" onClick={onClose} size={44}>
                <X size={20} />
              </IconButton>
            </div>
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

export function Toast({ msg, tone }: { msg: string | null; tone: 'info' | 'warn' }) {
  return (
    <AnimatePresence>
      {msg && (
        <motion.div
          key={msg}
          className="pointer-events-none fixed bottom-28 left-1/2 z-[60] -translate-x-1/2 rounded-2xl px-5 py-3 text-sm font-bold shadow-xl"
          style={{
            background: tone === 'warn' ? 'var(--warn)' : 'var(--ink)',
            color: tone === 'warn' ? '#2b2118' : 'var(--paper)',
          }}
          initial={{ opacity: 0, y: 24, scale: 0.9 }}
          animate={
            tone === 'warn'
              ? { opacity: 1, y: 0, scale: 1, x: [0, -8, 8, -5, 5, 0] }
              : { opacity: 1, y: 0, scale: 1 }
          }
          exit={{ opacity: 0, y: 12 }}
          transition={{ type: 'spring', stiffness: 420, damping: 22 }}
        >
          {msg}
        </motion.div>
      )}
    </AnimatePresence>
  )
}
