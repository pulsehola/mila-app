import { type RefObject, useEffect } from 'react'
import type { Pt } from '../types'

/**
 * Guardas nativas para superficies de dibujo con Apple Pencil en Safari/iPadOS.
 *
 * Aunque el elemento tenga `touch-action: none`, Safari puede decidir a mitad de trazo que el gesto es un
 * scroll, una selección de texto, la lupa o el menú contextual y dispara `pointercancel`: el trazo se corta
 * justo al deslizar o al levantar el lápiz (con el lápiz quieto no pasa porque no hay gesto que adivinar).
 * React registra sus listeners táctiles como *passive*, así que `preventDefault()` desde JSX no sirve:
 * hay que añadirlos a mano con `{ passive: false }`.
 *
 * `allowFinger()` decide si un dedo también dibuja; si no, los toques de dedo se dejan pasar
 * (la superficie implementa su propio scroll con dos dedos vía pointer events).
 */
export function usePenSurface(ref: RefObject<HTMLElement | null>, allowFinger: () => boolean): void {
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const isStylus = (e: TouchEvent) =>
      Array.from(e.changedTouches).some((t) => (t as Touch & { touchType?: string }).touchType === 'stylus')
    const block = (e: TouchEvent) => {
      if (e.cancelable && (isStylus(e) || allowFinger())) e.preventDefault()
    }
    // touchmove siempre: con touch-action:none no hay scroll nativo que preservar en esta capa.
    const blockMove = (e: TouchEvent) => {
      if (e.cancelable) e.preventDefault()
    }
    const noMenu = (e: Event) => e.preventDefault()
    el.addEventListener('touchstart', block, { passive: false })
    el.addEventListener('touchmove', blockMove, { passive: false })
    el.addEventListener('touchend', block, { passive: false })
    el.addEventListener('contextmenu', noMenu)
    el.addEventListener('selectstart', noMenu)
    // Safari: impide la lupa / gestos de doble toque sobre la superficie.
    el.addEventListener('gesturestart', noMenu)
    return () => {
      el.removeEventListener('touchstart', block)
      el.removeEventListener('touchmove', blockMove)
      el.removeEventListener('touchend', block)
      el.removeEventListener('contextmenu', noMenu)
      el.removeEventListener('selectstart', noMenu)
      el.removeEventListener('gesturestart', noMenu)
    }
  }, [ref, allowFinger])
}

/**
 * Todos los puntos de un pointermove/pointerup: los "coalesced" (el Pencil muestrea a 240 Hz y el navegador
 * agrupa varios por frame) o, si no hay, el propio evento. Coordenadas relativas a `rect`.
 */
export function pointsOf(e: PointerEvent, rect: DOMRect, pen: boolean): Pt[] {
  let list: PointerEvent[] = []
  try {
    list = (e.getCoalescedEvents?.() ?? []) as PointerEvent[]
  } catch {
    list = []
  }
  if (list.length === 0) list = [e]
  return list.map((ev) => ({
    x: ev.clientX - rect.left,
    y: ev.clientY - rect.top,
    // En pointerup la presión llega a 0: se usa un valor neutro para no afinar el final del trazo.
    p: pen ? (ev.pressure > 0 ? ev.pressure : 0.5) : 0.5,
    t: ev.timeStamp || performance.now(),
  }))
}
