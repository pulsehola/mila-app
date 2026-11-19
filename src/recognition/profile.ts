import type { Stroke } from '../types'
import { kvGet, kvSet } from '../state/library'
import { makeTemplate, type SymbolLabel, type Template } from './templates'

/**
 * Perfil de escritura de Mila: TODAS las muestras de los tests que hizo (no solo el último), guardadas en el
 * dispositivo. Vive en localStorage (lectura instantánea al abrir) y con copia en IndexedDB, que el sistema no
 * borra (Safari puede vaciar localStorage si la web no se abre en unos días).
 */
export interface HandProfile {
  version: 1
  completedAt: number | null
  samples: Partial<Record<SymbolLabel, Stroke[][]>>
}

const KEY = 'mila:hand:v1'
const DRAFT_KEY = 'mila:hand:draft'
const KV_KEY = 'hand'
const KV_DRAFT = 'hand-draft'
/** Muestras que se conservan por símbolo (las más recientes): la letra cambia con el tiempo. */
export const MAX_PER_SYMBOL = 12

/** Redondea a 0,1 px y descarta presión/tiempo para que el perfil ocupe poco. */
function compact(strokes: Stroke[]): Stroke[] {
  return strokes.map((s) => s.map((p) => ({ x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10, p: 0.5, t: 0 })))
}

const isStrokes = (v: unknown): v is Stroke[] =>
  Array.isArray(v) && v.every((s) => Array.isArray(s) && s.every((p) => p && typeof p.x === 'number' && typeof p.y === 'number'))

/** Valida un perfil leído de cualquier sitio (almacenamiento, archivo). */
export function parseProfile(raw: unknown): HandProfile | null {
  if (!raw || typeof raw !== 'object') return null
  const p = raw as Partial<HandProfile>
  if (p.version !== 1 || !p.samples || typeof p.samples !== 'object') return null
  const samples: HandProfile['samples'] = {}
  for (const [k, list] of Object.entries(p.samples)) {
    if (!Array.isArray(list)) continue
    const ok = list.filter(isStrokes)
    if (ok.length) samples[k as SymbolLabel] = ok
  }
  return { version: 1, completedAt: typeof p.completedAt === 'number' ? p.completedAt : null, samples }
}

/** Junta muestras: se añaden las nuevas detrás y se conservan las MAX_PER_SYMBOL más recientes de cada símbolo. */
export function mergeSamples(a: HandProfile['samples'], b: HandProfile['samples']): HandProfile['samples'] {
  const out: HandProfile['samples'] = {}
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)]) as Set<SymbolLabel>) {
    const seen = new Set<string>()
    const all = [...(a[k] ?? []), ...(b[k] ?? [])].map(compact).filter((s) => {
      const sig = JSON.stringify(s)
      if (seen.has(sig)) return false // la misma muestra (p.ej. al importar dos veces)
      seen.add(sig)
      return true
    })
    if (all.length) out[k] = all.slice(-MAX_PER_SYMBOL)
  }
  return out
}

let cache: HandProfile | null = null
let templates: Template[] | null = null
const listeners = new Set<() => void>()

function readLocal(key: string): unknown {
  try {
    const raw = localStorage.getItem(key)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}
function writeLocal(key: string, v: unknown) {
  try {
    if (v === null) localStorage.removeItem(key)
    else localStorage.setItem(key, JSON.stringify(v))
  } catch {
    /* cuota o modo privado: queda la copia en IndexedDB */
  }
}

export function loadProfile(): HandProfile {
  if (cache) return cache
  cache = parseProfile(readLocal(KEY)) ?? { version: 1, completedAt: null, samples: {} }
  return cache
}

export function saveProfile(p: HandProfile): void {
  cache = { ...p, samples: mergeSamples({}, p.samples) }
  templates = null
  writeLocal(KEY, cache)
  void kvSet(KV_KEY, cache).catch(() => undefined)
  listeners.forEach((fn) => fn())
}

/** Suma muestras al perfil (sin borrar las de tests anteriores). `complete` marca el test como hecho. */
export function addSamples(samples: HandProfile['samples'], complete: boolean): void {
  const prev = loadProfile()
  saveProfile({
    version: 1,
    completedAt: complete ? Date.now() : prev.completedAt,
    samples: mergeSamples(prev.samples, samples),
  })
}

/** Perfil traído de un archivo de MILA (copia de seguridad): se suma al actual. */
export function importProfile(raw: unknown): boolean {
  const p = parseProfile(raw)
  if (!p || !Object.keys(p.samples).length) return false
  const prev = loadProfile()
  saveProfile({
    version: 1,
    completedAt: prev.completedAt ?? p.completedAt,
    samples: mergeSamples(p.samples, prev.samples),
  })
  return true
}

export function isCalibrated(): boolean {
  return loadProfile().completedAt !== null
}

/**
 * Al abrir la app: si localStorage se vació (Safari lo hace) se recupera la copia de IndexedDB, y se juntan
 * las dos si ambas tienen muestras. Devuelve si el test ya está hecho.
 */
export async function restoreProfile(): Promise<boolean> {
  const local = loadProfile()
  let backup: HandProfile | null = null
  try {
    backup = parseProfile(await kvGet(KV_KEY))
  } catch {
    backup = null
  }
  if (backup) {
    const merged = mergeSamples(backup.samples, local.samples)
    const completedAt = local.completedAt ?? backup.completedAt
    const changed =
      completedAt !== local.completedAt || JSON.stringify(merged) !== JSON.stringify(mergeSamples({}, local.samples))
    if (changed) saveProfile({ version: 1, completedAt, samples: merged })
  } else if (local.completedAt !== null || Object.keys(local.samples).length) {
    // Primera vez con copia de seguridad: se crea a partir de lo que hay.
    void kvSet(KV_KEY, local).catch(() => undefined)
  }
  return isCalibrated()
}

// ---- Test a medias: se guarda cada muestra al momento ---------------------------

export function loadDraft(): HandProfile['samples'] {
  return parseProfile({ version: 1, completedAt: null, samples: readLocal(DRAFT_KEY) ?? {} })?.samples ?? {}
}
export async function loadDraftAsync(): Promise<HandProfile['samples']> {
  const local = loadDraft()
  if (Object.keys(local).length) return local
  try {
    return parseProfile({ version: 1, completedAt: null, samples: (await kvGet(KV_DRAFT)) ?? {} })?.samples ?? {}
  } catch {
    return {}
  }
}
export function saveDraft(samples: HandProfile['samples']): void {
  const empty = !Object.values(samples).some((l) => l?.length)
  const v = empty ? null : mergeSamples({}, samples)
  writeLocal(DRAFT_KEY, v)
  void kvSet(KV_DRAFT, v).catch(() => undefined)
}

export function onProfileChange(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

/** Plantillas listas para comparar (se recalculan solo cuando cambia el perfil). */
export function userTemplates(): Template[] {
  if (templates) return templates
  const p = loadProfile()
  const out: Template[] = []
  for (const [label, list] of Object.entries(p.samples) as [SymbolLabel, Stroke[][]][]) {
    for (const strokes of list ?? []) {
      const t = makeTemplate(label, strokes)
      if (t) out.push(t)
    }
  }
  templates = out
  return out
}

/** Solo para tests. */
export function __resetProfileCache(): void {
  cache = null
  templates = null
}
