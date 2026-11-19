import type { Clef, Score, Sound } from '../types'
import { clampKey, concertKey, keyCount, keyLabel } from '../state/music'
import { Modal } from './ui'

interface Props {
  open: boolean
  onClose: () => void
  score: Score
  onChange: (p: Partial<Pick<Score, 'clef' | 'key' | 'sound'>>) => void
  /** Preferencias de vista (de este iPad, no de la partitura). */
  fingerings: boolean
  onFingerings: (v: boolean) => void
  rangeWarnings: boolean
  onRangeWarnings: (v: boolean) => void
}

const KEYS = Array.from({ length: 15 }, (_, i) => i - 7)

function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T
  options: [T, string][]
  onChange: (v: T) => void
  label: string
}) {
  return (
    <div className="flex rounded-2xl border border-line bg-paper p-1" role="group" aria-label={label}>
      {options.map(([v, text]) => {
        const on = v === value
        return (
          <button
            key={v}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(v)}
            className="h-11 flex-1 rounded-xl px-3 text-sm font-extrabold"
            style={{ background: on ? 'var(--sun)' : 'transparent', color: on ? '#2b2118' : 'var(--muted)' }}
          >
            {text}
          </button>
        )
      })}
    </div>
  )
}

/** Ajustes de la partitura: clave, armadura y sonido de la reproducción. */
export function ScoreSettings({ open, onClose, score, onChange, fingerings, onFingerings, rangeWarnings, onRangeWarnings }: Props) {
  const key = clampKey(score.key)
  const bb = score.transposition === 'Bb'
  const concert = concertKey(key, score.transposition)
  return (
    <Modal open={open} onClose={onClose} title="Clave, armadura y sonido" maxWidth={480}>
      <div className="flex flex-col gap-5">
        <section className="flex flex-col gap-2">
          <h3 className="text-xs font-bold uppercase tracking-widest text-muted">Clave</h3>
          <Segmented<Clef>
            label="Clave"
            value={score.clef ?? 'treble'}
            options={[
              ['treble', '𝄞  Sol'],
              ['bass', '𝄢  Fa'],
            ]}
            onChange={(clef) => onChange({ clef })}
          />
          <p className="text-xs text-muted">
            La trompeta se escribe en clave de Sol. Las notas ya escritas conservan su altura al cambiar de clave.
          </p>
        </section>

        <section className="flex flex-col gap-2">
          <h3 className="text-xs font-bold uppercase tracking-widest text-muted">Armadura (escrita)</h3>
          <select
            aria-label="Armadura"
            value={key}
            onChange={(e) => onChange({ key: Number(e.target.value) })}
            className="h-12 rounded-2xl border border-line bg-paper px-3 text-base font-bold"
            style={{ fontSize: 16 }}
          >
            {KEYS.map((k) => (
              <option key={k} value={k}>
                {keyLabel(k)} · {keyCount(k)}
              </option>
            ))}
          </select>
          <p className="text-sm">
            {bb ? (
              <>
                Escrita para trompeta en Sib: <b>{keyLabel(key)}</b> suena <b>{keyLabel(concert)}</b> (altura real,{' '}
                {keyCount(concert)}).
              </>
            ) : (
              <>
                En Do (altura real): se escribe y suena <b>{keyLabel(key)}</b>.
              </>
            )}
          </p>
          <p className="text-xs text-muted">
            Las notas sin alteración siguen la armadura al sonar y al exportar; ♮ (becuadro) la anula hasta el final del
            compás.
          </p>
        </section>

        <section className="flex flex-col gap-2">
          <h3 className="text-xs font-bold uppercase tracking-widest text-muted">Sonido al escuchar</h3>
          <Segmented<Sound>
            label="Sonido"
            value={score.sound ?? 'trumpet'}
            options={[
              ['trumpet', '🎺  Trompeta'],
              ['piano', '🎹  Piano'],
            ]}
            onChange={(sound) => onChange({ sound })}
          />
          <p className="text-xs text-muted">Los dos sonidos son sintetizados en el iPad (funcionan sin conexión).</p>
        </section>

        <section className="flex flex-col gap-2">
          <h3 className="text-xs font-bold uppercase tracking-widest text-muted">Trompeta (en pantalla)</h3>
          <label className="flex cursor-pointer items-center gap-3 text-sm font-semibold">
            <input type="checkbox" checked={fingerings} onChange={(e) => onFingerings(e.target.checked)} className="h-5 w-5 accent-[var(--mint)]" />
            Digitaciones encima de cada nota (pistones 1 2 3, 0 = al aire)
          </label>
          <label className="flex cursor-pointer items-center gap-3 text-sm font-semibold">
            <input type="checkbox" checked={rangeWarnings} onChange={(e) => onRangeWarnings(e.target.checked)} className="h-5 w-5 accent-[var(--mint)]" />
            Marcar en rojo las notas fuera del registro (más graves que Fa#3 o más agudas que Do6)
          </label>
          <p className="text-xs text-muted">Por nota escrita, en clave de Sol. Son de este iPad: no cambian la partitura ni el PDF.</p>
        </section>
      </div>
    </Modal>
  )
}
