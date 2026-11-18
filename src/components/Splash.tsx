import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { useEffect, useState } from 'react'
import { Logo, Wordmark } from './Logo'

const KEY = 'mila:splash'
const DURATION = 2100

function alreadySeen(): boolean {
  try {
    return sessionStorage.getItem(KEY) === '1'
  } catch {
    return false
  }
}

/** Ondas de sonido: una línea que oscila entre MI (menta) y LA (latón). */
function SoundWave() {
  const bars = 23
  return (
    <div className="flex h-12 items-center gap-[5px]" aria-hidden>
      {Array.from({ length: bars }, (_, i) => {
        const mid = Math.abs(i - (bars - 1) / 2) / ((bars - 1) / 2)
        const peak = 10 + (1 - mid) * 34
        return (
          <motion.span
            key={i}
            className="w-[5px] rounded-full"
            style={{ background: i < bars / 2 ? 'var(--mi)' : 'var(--la)' }}
            initial={{ height: 4, opacity: 0 }}
            animate={{ height: [4, peak, 6, peak * 0.7, 4], opacity: 1 }}
            transition={{ duration: 1.4, delay: 0.25 + i * 0.03, repeat: Infinity, ease: 'easeInOut' }}
          />
        )
      })}
    </div>
  )
}

/** Pantalla de bienvenida (una vez por sesión). Se salta tocando. */
export function Splash() {
  const reduce = useReducedMotion()
  const [show, setShow] = useState(() => !alreadySeen())

  useEffect(() => {
    if (!show) return
    try {
      sessionStorage.setItem(KEY, '1')
    } catch {
      /* modo privado */
    }
    const id = window.setTimeout(() => setShow(false), reduce ? 500 : DURATION)
    return () => window.clearTimeout(id)
  }, [show, reduce])

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          key="splash"
          className="fixed inset-0 z-[100] grid place-items-center bg-bg"
          onPointerDown={() => setShow(false)}
          exit={{ opacity: 0, scale: 1.04, filter: 'blur(6px)' }}
          transition={{ duration: 0.45, ease: [0.2, 0.7, 0.2, 1] }}
        >
          <div className="flex flex-col items-center gap-5">
            <div className="relative grid place-items-center">
              {!reduce &&
                [0, 1, 2].map((i) => (
                  <motion.span
                    key={i}
                    className="absolute rounded-full border-2"
                    style={{ width: 132, height: 132, borderColor: i % 2 ? 'var(--la)' : 'var(--mi)' }}
                    initial={{ scale: 0.7, opacity: 0 }}
                    animate={{ scale: [0.7, 2.3], opacity: [0.7, 0] }}
                    transition={{ duration: 1.8, delay: 0.3 + i * 0.45, repeat: Infinity, ease: 'easeOut' }}
                  />
                ))}
              <motion.div
                initial={{ scale: 0.4, rotate: -12, opacity: 0 }}
                animate={{ scale: 1, rotate: 0, opacity: 1 }}
                transition={{ type: 'spring', stiffness: 260, damping: 14 }}
                className="rounded-[34px] shadow-[0_24px_60px_-20px_rgba(29,26,46,0.6)]"
              >
                <Logo size={132} />
              </motion.div>
            </div>
            <Wordmark className="text-6xl" />
            <motion.p
              className="text-sm font-semibold uppercase tracking-[0.3em] text-muted"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.5 }}
            >
              partituras a mano
            </motion.p>
            {!reduce && <SoundWave />}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
