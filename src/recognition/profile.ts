import type { Stroke } from '../types'
import { makeTemplate, type SymbolLabel, type Template } from './templates'

/** Perfil de escritura del usuario: muestras del test inicial, guardadas en el dispositivo. */
export interface HandProfile {
  version: 1
  completedAt: number | null
  samples: Partial<Record<SymbolLabel, Stroke[][]>>
}

const KEY = 'mila:hand:v1'

/** Redondea a 0,1 px y descarta presión/tiempo para que el perfil ocupe poco. */
function compact(strokes: Stroke[]): Stroke[] {
  return strokes.map((s) => s.map((p) => ({ x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10, p: 0.5, t: 0 })))
}

let cache: HandProfile | null = null
let templates: Template[] | null = null
const listeners = new Set<() => void>()

export function loadProfile(): HandProfile {
  if (cache) return cache
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) {
      const p = JSON.parse(raw) as HandProfile
      if (p && p.version === 1 && p.samples && typeof p.samples === 'object') {
        cache = p
        return p
      }
    }
  } catch {
    /* almacenamiento no disponible */
  }
  cache = { version: 1, completedAt: null, samples: {} }
  return cache
}

export function saveProfile(p: HandProfile): void {
  cache = { ...p, samples: Object.fromEntries(Object.entries(p.samples).map(([k, v]) => [k, (v ?? []).map(compact)])) }
  templates = null
  try {
    localStorage.setItem(KEY, JSON.stringify(cache))
  } catch {
    /* cuota o modo privado: el perfil vive en memoria esta sesión */
  }
  listeners.forEach((fn) => fn())
}

export function isCalibrated(): boolean {
  return loadProfile().completedAt !== null
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
