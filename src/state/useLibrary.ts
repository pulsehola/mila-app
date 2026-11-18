import { useCallback, useEffect, useRef, useState } from 'react'
import type { Score } from '../types'
import { newId } from './music'
import {
  deleteScore,
  getScore,
  isBlank,
  listScores,
  putMany,
  type SavedScore,
  saveScore,
} from './library'

const CURRENT_KEY = 'mila:currentId'
const SAVE_DELAY = 600

function initialId(): string {
  try {
    const id = localStorage.getItem(CURRENT_KEY)
    if (id) return id
  } catch {
    /* sin almacenamiento */
  }
  return newId()
}

export interface LibraryApi {
  items: SavedScore[]
  currentId: string
  /** Estado del último guardado, para mostrarlo discretamente. */
  saved: 'idle' | 'saving' | 'saved' | 'error'
  refresh: () => Promise<void>
  /** Guarda ya la partitura abierta (antes de cambiar a otra). */
  flush: () => Promise<void>
  openItem: (id: string) => Promise<SavedScore | undefined>
  /** Lo siguiente que se abra en el editor será una entrada nueva (nueva, ejemplo, duplicado...). */
  startNew: () => string
  remove: (id: string) => Promise<void>
  importItems: (items: SavedScore[]) => Promise<number>
}

/**
 * Galería en el propio iPad: la partitura abierta se guarda sola (con un pequeño retraso) dentro de la galería,
 * con TODO su contenido. Abrir otra no mezcla historiales.
 */
export function useLibrary(score: Score): LibraryApi {
  const [currentId, setCurrentId] = useState(initialId)
  const [items, setItems] = useState<SavedScore[]>([])
  const [saved, setSaved] = useState<LibraryApi['saved']>('idle')
  const known = useRef(new Set<string>())
  const latest = useRef({ id: currentId, score })
  latest.current = { id: currentId, score }
  const timer = useRef(0)
  /** Partitura recién abierta tal cual está guardada: no se reescribe (no cambia su fecha). */
  const untouched = useRef<Score | null>(null)

  useEffect(() => {
    try {
      localStorage.setItem(CURRENT_KEY, currentId)
    } catch {
      /* sin almacenamiento */
    }
  }, [currentId])

  const refresh = useCallback(async () => {
    try {
      const list = await listScores()
      list.forEach((it) => known.current.add(it.id))
      setItems(list)
    } catch {
      setItems([])
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const save = useCallback(async (id: string, s: Score) => {
    // Las hojas vacías no ocupan sitio, salvo que ya existieran (p.ej. tras "Borrar todo").
    if (isBlank(s) && !known.current.has(id)) return
    if (s === untouched.current) return
    setSaved('saving')
    try {
      const item = await saveScore(id, s)
      known.current.add(id)
      setItems((list) => [item, ...list.filter((x) => x.id !== id)])
      setSaved('saved')
    } catch {
      setSaved('error')
    }
  }, [])

  // Autoguardado de la partitura abierta.
  useEffect(() => {
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => void save(currentId, score), SAVE_DELAY)
    return () => window.clearTimeout(timer.current)
  }, [score, currentId, save])

  const flush = useCallback(async () => {
    window.clearTimeout(timer.current)
    await save(latest.current.id, latest.current.score)
  }, [save])

  const openItem = useCallback(async (id: string) => {
    const item = await getScore(id)
    if (item) {
      known.current.add(id)
      untouched.current = item.score
      setCurrentId(id)
    }
    return item
  }, [])

  const startNew = useCallback(() => {
    const id = newId()
    setCurrentId(id)
    return id
  }, [])

  const remove = useCallback(async (id: string) => {
    await deleteScore(id)
    known.current.delete(id)
    setItems((list) => list.filter((x) => x.id !== id))
  }, [])

  const importItems = useCallback(
    async (incoming: SavedScore[]) => {
      // Si ya existe una con el mismo id, se conserva la más reciente.
      const current = new Map(items.map((x) => [x.id, x]))
      // La partitura abierta ahora no se pisa: lo importado con su mismo id entra como copia.
      const openId = latest.current.id
      incoming = incoming.map((x) => (x.id === openId ? { ...x, id: newId() } : x))
      const fresh = incoming.filter((x) => {
        const have = current.get(x.id)
        return !have || have.updatedAt < x.updatedAt
      })
      if (fresh.length) await putMany(fresh)
      await refresh()
      return fresh.length
    },
    [items, refresh],
  )

  return { items, currentId, saved, refresh, flush, openItem, startNew, remove, importItems }
}
