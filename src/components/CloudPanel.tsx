import { Cloud, CloudOff, LogOut, Mail, RefreshCw } from 'lucide-react'
import { useState, useSyncExternalStore } from 'react'
import { cloudEnabled, getCloudState, sendLoginEmail, signOut, subscribeCloud, syncNow, verifyLoginCode } from '../cloud/sync'

/** Copia en la nube: entrar con el email (enlace o código) y ver el estado de la sincronización. */
export function CloudPanel() {
  const st = useSyncExternalStore(subscribeCloud, getCloudState)
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [sent, setSent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  if (!cloudEnabled) return null

  const run = async (fn: () => Promise<void>) => {
    setBusy(true)
    setMsg(null)
    try {
      await fn()
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'No se pudo')
    } finally {
      setBusy(false)
    }
  }

  if (st.user) {
    const label =
      st.status === 'syncing'
        ? 'Sincronizando…'
        : st.status === 'offline'
          ? 'Sin conexión: se subirá al volver internet'
          : st.status === 'error'
            ? `No se pudo sincronizar${st.error ? ` (${st.error})` : ''}`
            : st.lastSync
              ? `Sincronizado ${new Date(st.lastSync).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
              : 'Conectado'
    return (
      <div className="mb-4 flex flex-wrap items-center gap-2 rounded-2xl border border-line bg-paper p-3">
        {st.status === 'offline' || st.status === 'error' ? <CloudOff size={18} className="text-coral" /> : <Cloud size={18} className="text-mint" />}
        <div className="mr-auto min-w-0 text-xs">
          <div className="truncate font-extrabold">Copia en la nube · {st.user.email}</div>
          <div className="text-muted">{label}</div>
        </div>
        <button
          type="button"
          disabled={busy || st.status === 'syncing'}
          onClick={() => void run(syncNow)}
          className="flex h-9 items-center gap-1.5 rounded-xl border border-line px-3 text-xs font-extrabold disabled:opacity-40"
        >
          <RefreshCw size={15} /> Sincronizar
        </button>
        <button
          type="button"
          onClick={() => void run(signOut)}
          className="flex h-9 items-center gap-1.5 rounded-xl border border-line px-3 text-xs font-extrabold"
        >
          <LogOut size={15} /> Salir
        </button>
      </div>
    )
  }

  return (
    <div className="mb-4 rounded-2xl border border-line bg-paper p-3">
      <div className="flex items-center gap-2 text-sm font-extrabold">
        <Cloud size={18} className="text-mint" /> Copia en la nube
      </div>
      <p className="mt-1 text-xs text-muted">
        Entrá con tu email y tus partituras (con sus fotos) quedan guardadas también en la nube y aparecen en cualquier
        iPad o computadora donde entres.
      </p>
      {!sent ? (
        <form
          className="mt-2 flex flex-wrap gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            if (email.includes('@')) void run(async () => {
              await sendLoginEmail(email)
              setSent(true)
            })
          }}
        >
          <input
            type="email"
            required
            autoComplete="email"
            placeholder="tu@email.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="h-10 min-w-[200px] flex-1 rounded-xl border border-line bg-panel px-3 text-base focus:outline-none"
            style={{ fontSize: 16 }}
          />
          <button type="submit" disabled={busy} className="flex h-10 items-center gap-1.5 rounded-xl bg-mint px-4 text-sm font-black text-[#12352c] disabled:opacity-50">
            <Mail size={16} /> Enviarme el enlace
          </button>
        </form>
      ) : (
        <form
          className="mt-2 flex flex-wrap items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            if (code.trim().length >= 6) void run(() => verifyLoginCode(email, code))
          }}
        >
          <p className="w-full text-xs">
            Te mandé un email a <b>{email}</b>. Tocá el enlace, o escribí acá el código de 6 dígitos si usás la app
            instalada.
          </p>
          <input
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder="123456"
            maxLength={10}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
            className="h-10 w-32 rounded-xl border border-line bg-panel px-3 text-center text-base tracking-widest focus:outline-none"
            style={{ fontSize: 16 }}
          />
          <button type="submit" disabled={busy} className="h-10 rounded-xl bg-mint px-4 text-sm font-black text-[#12352c] disabled:opacity-50">
            Entrar
          </button>
          <button type="button" onClick={() => setSent(false)} className="h-10 px-2 text-xs font-bold text-muted underline">
            Cambiar email
          </button>
        </form>
      )}
      {msg && <p className="mt-2 text-xs font-bold text-coral">{msg}</p>}
    </div>
  )
}
