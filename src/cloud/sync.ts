import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js'
import {
  deleteScore,
  getImage,
  listScores,
  onLibraryChange,
  putImage,
  putMany,
  type SavedScore,
} from '../state/library'
import { normalizeScore } from '../state/useScore'

/**
 * Copia en la nube (Supabase): cada persona entra con su email y sus partituras e imágenes se sincronizan
 * entre sus dispositivos. El iPad sigue siendo la fuente principal: todo funciona sin conexión y se sube
 * cuando vuelve internet. Gana siempre la versión modificada más recientemente.
 */

const env = import.meta.env as Record<string, string | undefined>
const URL = env.NEXT_PUBLIC_SUPABASE_URL || env.VITE_SUPABASE_URL
const KEY =
  env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
  env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  env.VITE_SUPABASE_ANON_KEY

export const cloudEnabled = !!(URL && KEY)
const BUCKET = 'mila-images'
const PUSH_DELAY = 1500

let client: SupabaseClient | null = null
export function supabase(): SupabaseClient | null {
  if (!cloudEnabled) return null
  if (!client) {
    client = createClient(URL!, KEY!, {
      // "implicit": el enlace del email funciona aunque se abra en otro navegador que el que lo pidió.
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'implicit' },
    })
  }
  return client
}

export type CloudStatus = 'off' | 'syncing' | 'ok' | 'offline' | 'error'

interface CloudState {
  user: User | null
  status: CloudStatus
  lastSync: number | null
  error: string | null
}
let state: CloudState = { user: null, status: 'off', lastSync: null, error: null }
const listeners = new Set<() => void>()
/** Avisos de que llegó algo de otro dispositivo (para refrescar la galería). */
const remoteListeners = new Set<() => void>()
const set = (p: Partial<CloudState>) => {
  state = { ...state, ...p }
  listeners.forEach((fn) => fn())
}
export const getCloudState = () => state
export function subscribeCloud(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
export function onRemoteChange(fn: () => void): () => void {
  remoteListeners.add(fn)
  return () => remoteListeners.delete(fn)
}

// ---- Inicio de sesión ---------------------------------------------------------

/** Envía el email con el enlace (y el código de 6 dígitos, si la plantilla lo incluye). */
export async function sendLoginEmail(email: string): Promise<void> {
  const sb = supabase()
  if (!sb) throw new Error('La nube no está configurada')
  const { error } = await sb.auth.signInWithOtp({
    email: email.trim(),
    options: { emailRedirectTo: window.location.origin, shouldCreateUser: true },
  })
  if (error) throw new Error(error.message)
}

/** Para la app instalada en el iPad (el enlace se abre en Safari, no en la app): el código del email. */
export async function verifyLoginCode(email: string, code: string): Promise<void> {
  const sb = supabase()
  if (!sb) throw new Error('La nube no está configurada')
  const { error } = await sb.auth.verifyOtp({ email: email.trim(), token: code.trim(), type: 'email' })
  if (error) throw new Error(error.message)
}

export async function signOut(): Promise<void> {
  await supabase()?.auth.signOut()
}

// ---- Sincronización -----------------------------------------------------------

interface Row {
  id: string
  data: unknown
  created_at: number
  updated_at: number
  deleted: boolean
}

const uploaded = new Set<string>()
async function uploadImage(sb: SupabaseClient, uid: string, imageId: string) {
  if (uploaded.has(imageId)) return
  const blob = await getImage(imageId)
  if (!blob) return
  const { error } = await sb.storage.from(BUCKET).upload(`${uid}/${imageId}`, blob, {
    contentType: blob.type || 'image/jpeg',
    upsert: false,
  })
  // "Ya existe" = ya estaba subida (las imágenes nunca cambian de contenido: la goma crea una nueva).
  if (error && !/exist|duplicate|409/i.test(error.message)) throw error
  uploaded.add(imageId)
}

async function downloadImage(sb: SupabaseClient, uid: string, imageId: string) {
  if (await getImage(imageId).catch(() => undefined)) return
  const { data, error } = await sb.storage.from(BUCKET).download(`${uid}/${imageId}`)
  if (error || !data) return
  await putImage(imageId, data)
  uploaded.add(imageId)
}

async function pushItem(sb: SupabaseClient, uid: string, item: SavedScore) {
  const imageId = item.score.background?.imageId
  if (imageId) await uploadImage(sb, uid, imageId)
  const { error } = await sb.from('scores').upsert({
    user_id: uid,
    id: item.id,
    data: item.score,
    created_at: item.createdAt,
    updated_at: item.updatedAt,
    deleted: false,
  })
  if (error) throw error
}

async function pushDelete(sb: SupabaseClient, uid: string, id: string) {
  const now = Date.now()
  const { error } = await sb
    .from('scores')
    .upsert({ user_id: uid, id, data: {}, created_at: now, updated_at: now, deleted: true })
  if (error) throw error
}

const describe = (e: unknown) => (e instanceof Error ? e.message : typeof e === 'object' && e && 'message' in e ? String((e as { message: unknown }).message) : String(e))

/** Trae lo de la nube, baja lo más nuevo, sube lo que solo (o más nuevo) está en este dispositivo. */
export async function syncNow(): Promise<void> {
  const sb = supabase()
  const uid = state.user?.id
  if (!sb || !uid) return
  if (!navigator.onLine) return set({ status: 'offline' })
  set({ status: 'syncing', error: null })
  try {
    const { data, error } = await sb.from('scores').select('id, data, created_at, updated_at, deleted')
    if (error) throw error
    const remote = new Map((data as Row[]).map((r) => [r.id, r]))
    const local = new Map((await listScores()).map((x) => [x.id, x]))
    const incoming: SavedScore[] = []
    let changed = false
    for (const r of remote.values()) {
      const mine = local.get(r.id)
      if (r.deleted) {
        if (mine && mine.updatedAt <= r.updated_at) {
          await deleteScore(r.id, true)
          changed = true
        }
        continue
      }
      if (mine && mine.updatedAt >= r.updated_at) continue
      const score = normalizeScore(r.data)
      if (!score) continue
      incoming.push({ id: r.id, score, createdAt: r.created_at, updatedAt: r.updated_at })
      if (score.background?.imageId) await downloadImage(sb, uid, score.background.imageId)
    }
    if (incoming.length) {
      await putMany(incoming, true)
      changed = true
    }
    for (const mine of local.values()) {
      const r = remote.get(mine.id)
      if (!r || mine.updatedAt > r.updated_at) await pushItem(sb, uid, mine)
    }
    set({ status: 'ok', lastSync: Date.now() })
    if (changed) remoteListeners.forEach((fn) => fn())
  } catch (e) {
    set({ status: navigator.onLine ? 'error' : 'offline', error: describe(e) })
  }
}

// Cambios locales → nube (agrupados por partitura para no subir en cada trazo).
const pending = new Map<string, { kind: 'save'; item: SavedScore } | { kind: 'delete' }>()
let pushTimer = 0
function schedulePush() {
  window.clearTimeout(pushTimer)
  pushTimer = window.setTimeout(() => void flushPushes(), PUSH_DELAY)
}
async function flushPushes() {
  const sb = supabase()
  const uid = state.user?.id
  if (!sb || !uid || !navigator.onLine) return
  const batch = [...pending.entries()]
  pending.clear()
  try {
    for (const [id, op] of batch) {
      if (op.kind === 'save') await pushItem(sb, uid, op.item)
      else await pushDelete(sb, uid, id)
    }
    set({ status: 'ok', lastSync: Date.now(), error: null })
  } catch (e) {
    // Se reintenta en la próxima sincronización completa (al volver la conexión o al abrir la app).
    for (const [id, op] of batch) if (!pending.has(id)) pending.set(id, op)
    set({ status: navigator.onLine ? 'error' : 'offline', error: describe(e) })
  }
}

let started = false
/** Arranca la sesión guardada (si la hay), escucha los cambios de la galería y sincroniza. */
export function startCloud(): void {
  const sb = supabase()
  if (!sb || started) return
  started = true
  onLibraryChange((c) => {
    if (!state.user) return
    pending.set(c.type === 'save' ? c.item.id : c.id, c.type === 'save' ? { kind: 'save', item: c.item } : { kind: 'delete' })
    schedulePush()
  })
  sb.auth.onAuthStateChange((event, session) => {
    const user = session?.user ?? null
    const was = state.user?.id
    set({ user, status: user ? state.status : 'off' })
    if (user && user.id !== was) void syncNow()
    if (event === 'SIGNED_OUT') uploaded.clear()
  })
  window.addEventListener('online', () => {
    void flushPushes()
    void syncNow()
  })
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void syncNow()
    else void flushPushes()
  })
}
