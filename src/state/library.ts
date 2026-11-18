import type { Score } from '../types'
import { normalizeScore } from './useScore'

/** Una partitura de la galería: TODO lo de la partitura (notas, anotaciones, título, tempo, transposición) + fechas. */
export interface SavedScore {
  id: string
  score: Score
  createdAt: number
  updatedAt: number
}

/** Formato de archivo para la carpeta Mila_partituras de Archivos (una partitura o la galería entera). */
export interface MilaFile {
  app: 'MILA'
  version: 1
  exportedAt: number
  scores: SavedScore[]
  /** Imágenes de fondo (escaneos) como data-URL, por id. */
  images?: Record<string, string>
}

export const FOLDER_NAME = 'Mila_partituras'

/** Una partitura sin notas ni anotaciones no se guarda en la galería (evita llenarla de hojas vacías). */
export function isBlank(s: Score): boolean {
  return s.measures.every((m) => m.length === 0) && !(s.annotations ?? []).length
}

export function noteCount(s: Score): number {
  return s.measures.reduce((n, m) => n + m.filter((x) => x.kind === 'note').length, 0)
}

export function usedMeasures(s: Score): number {
  return s.measures.reduce((acc, m, i) => (m.length ? i + 1 : acc), 0)
}

// ---- Archivos .mila.json ---------------------------------------------------

export function toMilaFile(scores: SavedScore[], images?: Record<string, string>): MilaFile {
  return { app: 'MILA', version: 1, exportedAt: Date.now(), scores, ...(images && Object.keys(images).length ? { images } : {}) }
}

/** Ids de las imágenes de fondo que usan estas partituras. */
export function imageIdsOf(scores: SavedScore[]): string[] {
  return [...new Set(scores.map((s) => s.score.background?.imageId).filter((x): x is string => !!x))]
}

/** Imágenes incluidas en un archivo .mila.json (data-URL por id). */
export function parseMilaImages(text: string): Record<string, string> {
  try {
    const raw = JSON.parse(text) as Partial<MilaFile>
    const out: Record<string, string> = {}
    for (const [k, v] of Object.entries(raw.images ?? {})) if (typeof v === 'string' && v.startsWith('data:image/')) out[k] = v
    return out
  } catch {
    return {}
  }
}

/** Lee un archivo exportado por MILA. Valida cada partitura; descarta lo que no reconoce. */
export function parseMilaFile(text: string): SavedScore[] {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    throw new Error('El archivo no es una partitura de MILA')
  }
  const list: unknown[] =
    raw && typeof raw === 'object' && Array.isArray((raw as MilaFile).scores)
      ? (raw as MilaFile).scores
      : raw && typeof raw === 'object' && 'measures' in (raw as object)
        ? [{ score: raw }] // compatibilidad: una partitura "suelta"
        : []
  const out: SavedScore[] = []
  for (const item of list) {
    if (!item || typeof item !== 'object') continue
    const it = item as Partial<SavedScore>
    const score = normalizeScore(it.score)
    if (!score) continue
    const now = Date.now()
    out.push({
      id: typeof it.id === 'string' && it.id ? it.id : `imp-${now.toString(36)}-${out.length}`,
      score,
      createdAt: typeof it.createdAt === 'number' ? it.createdAt : now,
      updatedAt: typeof it.updatedAt === 'number' ? it.updatedAt : now,
    })
  }
  if (!out.length) throw new Error('No encontré partituras de MILA en el archivo')
  return out
}

export function fileSlug(title: string): string {
  return (
    (title || 'partitura')
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-zA-Z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'partitura'
  )
}

// ---- Almacén en el dispositivo (IndexedDB) ---------------------------------

const DB_NAME = 'mila'
const STORE = 'scores'
const IMAGES = 'images'
let dbPromise: Promise<IDBDatabase> | null = null

function db(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 2)
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE, { keyPath: 'id' })
        if (!req.result.objectStoreNames.contains(IMAGES)) req.result.createObjectStore(IMAGES)
      }
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => {
        dbPromise = null
        reject(req.error ?? new Error('No se pudo abrir la galería'))
      }
    })
  }
  return dbPromise
}

function run<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T> | void,
  storeName: string = STORE,
): Promise<T> {
  return db().then(
    (d) =>
      new Promise<T>((resolve, reject) => {
        const tx = d.transaction(storeName, mode)
        const req = fn(tx.objectStore(storeName))
        tx.oncomplete = () => resolve(req ? req.result : (undefined as T))
        tx.onerror = () => reject(tx.error)
        tx.onabort = () => reject(tx.error)
      }),
  )
}

/** Pide al sistema que no borre los datos de MILA por falta de espacio (iPadOS lo respeta en apps instaladas). */
let persistAsked = false
function askPersist() {
  if (persistAsked) return
  persistAsked = true
  void navigator.storage?.persist?.().catch(() => undefined)
}

export async function listScores(): Promise<SavedScore[]> {
  const all = await run<SavedScore[]>('readonly', (s) => s.getAll())
  return (all ?? []).sort((a, b) => b.updatedAt - a.updatedAt)
}

export function getScore(id: string): Promise<SavedScore | undefined> {
  return run<SavedScore | undefined>('readonly', (s) => s.get(id))
}

/** Guarda (o actualiza) una partitura conservando su fecha de creación. */
export async function saveScore(id: string, score: Score): Promise<SavedScore> {
  askPersist()
  const prev = await getScore(id)
  const now = Date.now()
  const item: SavedScore = { id, score, createdAt: prev?.createdAt ?? now, updatedAt: now }
  await run('readwrite', (s) => s.put(item))
  return item
}

export async function putMany(items: SavedScore[]): Promise<void> {
  askPersist()
  await run('readwrite', (s) => {
    for (const it of items) s.put(it)
  })
}

export async function deleteScore(id: string): Promise<void> {
  await run('readwrite', (s) => s.delete(id))
}

// ---- Imágenes de fondo (escaneos) -------------------------------------------

/**
 * Las imágenes se guardan como bytes (ArrayBuffer + tipo), no como Blob/File: Safari del iPad falla a veces al
 * guardar Blobs en IndexedDB ("Error preparing Blob/File data to be stored in object store"). Las guardadas
 * antes como Blob se siguen leyendo.
 */
interface StoredImage {
  bytes: ArrayBuffer
  type: string
}

async function blobBytes(blob: Blob): Promise<ArrayBuffer> {
  if (typeof blob.arrayBuffer === 'function') return blob.arrayBuffer()
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(r.result as ArrayBuffer)
    r.onerror = () => reject(r.error)
    r.readAsArrayBuffer(blob)
  })
}

export async function putImage(id: string, blob: Blob): Promise<void> {
  askPersist()
  const rec: StoredImage = { bytes: await blobBytes(blob), type: blob.type || 'image/jpeg' }
  await run('readwrite', (s) => s.put(rec, id), IMAGES)
}

export async function getImage(id: string): Promise<Blob | undefined> {
  const v = await run<StoredImage | Blob | undefined>('readonly', (s) => s.get(id), IMAGES)
  if (!v) return undefined
  if (v instanceof Blob) return v
  if (v && v.bytes) return new Blob([v.bytes], { type: v.type })
  return undefined
}

export async function deleteImage(id: string): Promise<void> {
  await run('readwrite', (s) => s.delete(id), IMAGES)
}

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result))
    r.onerror = () => reject(r.error)
    r.readAsDataURL(blob)
  })
}

export async function dataUrlToBlob(url: string): Promise<Blob> {
  return (await fetch(url)).blob()
}
