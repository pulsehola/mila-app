import { useEffect, useRef, useState } from 'react'

/**
 * Comportamiento de MILA como app instalada en el iPad (PWA): service worker con aviso de versión nueva,
 * guardado al salir, pantalla encendida mientras suena la partitura y sin zoom accidental de la página.
 */

const UPDATE_EVENT = 'mila:update-ready'
let updateReady = false

/** Registra el service worker (solo en producción) y avisa cuando una versión nueva toma el control. */
export function registerServiceWorker(): void {
  if (!('serviceWorker' in navigator)) return
  const hadController = !!navigator.serviceWorker.controller
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    // La primera instalación también cambia el controlador: eso no es una "versión nueva".
    if (!hadController || updateReady) return
    updateReady = true
    window.dispatchEvent(new Event(UPDATE_EVENT))
  })
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js')
      .then((reg) => {
        // Una app instalada en el iPad casi nunca se "recarga": se busca versión nueva al volver a ella.
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'visible') void reg.update().catch(() => undefined)
        })
      })
      .catch(() => {
        /* sin SW la app sigue funcionando en línea */
      })
  })
}

/** true cuando hay una versión nueva de MILA lista; se aplica recargando. */
export function useUpdateReady(): boolean {
  const [ready, setReady] = useState(updateReady)
  useEffect(() => {
    const on = () => setReady(true)
    window.addEventListener(UPDATE_EVENT, on)
    return () => window.removeEventListener(UPDATE_EVENT, on)
  }, [])
  return ready
}

/**
 * Ejecuta `fn` cuando la app pasa a segundo plano o se cierra (cambiar de app, bloquear el iPad, cerrar
 * desde el multitarea). En iPadOS `pagehide` no siempre llega: `visibilitychange` → hidden sí.
 */
export function useOnHide(fn: () => void): void {
  const ref = useRef(fn)
  ref.current = fn
  useEffect(() => {
    const vis = () => {
      if (document.visibilityState === 'hidden') ref.current()
    }
    const hide = () => ref.current()
    document.addEventListener('visibilitychange', vis)
    window.addEventListener('pagehide', hide)
    return () => {
      document.removeEventListener('visibilitychange', vis)
      window.removeEventListener('pagehide', hide)
    }
  }, [])
}

interface WakeLockSentinelLike {
  released: boolean
  release: () => Promise<void>
}

/** Mantiene la pantalla encendida mientras `active` (p.ej. al tocar con la partitura sonando). */
export function useWakeLock(active: boolean): void {
  useEffect(() => {
    const wl = (navigator as Navigator & { wakeLock?: { request: (t: 'screen') => Promise<WakeLockSentinelLike> } }).wakeLock
    if (!active || !wl) return
    let lock: WakeLockSentinelLike | null = null
    let cancelled = false
    const acquire = () => {
      if (document.visibilityState !== 'visible' || (lock && !lock.released)) return
      wl.request('screen')
        .then((l) => {
          if (cancelled) void l.release().catch(() => undefined)
          else lock = l
        })
        .catch(() => undefined) // batería baja o no permitido: la pantalla se apaga como siempre
    }
    acquire()
    // El sistema suelta el bloqueo al salir de la app: se pide otra vez al volver.
    document.addEventListener('visibilitychange', acquire)
    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', acquire)
      if (lock && !lock.released) void lock.release().catch(() => undefined)
    }
  }, [active])
}

/**
 * Safari en iPad ignora `user-scalable=no`: un pellizco sobre la barra o los botones agrandaba toda la
 * página. Se bloquea el zoom de la página entera; la partitura tiene su propio zoom (pellizco con
 * pointer events), que no usa estos eventos.
 */
export function blockPageZoom(): () => void {
  const stop = (e: Event) => e.preventDefault()
  const opts = { passive: false } as const
  document.addEventListener('gesturestart', stop, opts)
  document.addEventListener('gesturechange', stop, opts)
  document.addEventListener('gestureend', stop, opts)
  return () => {
    document.removeEventListener('gesturestart', stop)
    document.removeEventListener('gesturechange', stop)
    document.removeEventListener('gestureend', stop)
  }
}
