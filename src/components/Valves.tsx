import { type Fingering, valvesText } from '../state/trumpet'

/** Los 3 pistones vistos desde arriba: relleno = pulsado. */
export function ValveDots({ valves, size = 14 }: { valves: string; size?: number }) {
  return (
    <span className="inline-flex items-center gap-[3px]" aria-hidden>
      {['1', '2', '3'].map((v) => {
        const on = valves.includes(v)
        return (
          <span
            key={v}
            className="inline-block rounded-full border-2"
            style={{
              width: size,
              height: size,
              borderColor: 'currentColor',
              background: on ? 'currentColor' : 'transparent',
            }}
          />
        )
      })}
    </span>
  )
}

/** Digitación completa: pistones, texto accesible y alternativas. */
export function FingeringView({ f, size = 14, compact = false }: { f: Fingering; size?: number; compact?: boolean }) {
  const label = f.valves === '0' ? 'al aire (sin pistones)' : `pistones ${valvesText(f.valves)}`
  return (
    <span className="inline-flex flex-col items-center gap-0.5" title={f.hint ?? label} aria-label={`Digitación: ${label}${f.alt?.length ? `; alternativa ${f.alt.map(valvesText).join(' o ')}` : ''}`}>
      <ValveDots valves={f.valves} size={size} />
      {!compact && (
        <span className="text-[10px] font-bold leading-none text-muted">
          {f.valves === '0' ? 'al aire' : valvesText(f.valves)}
          {f.alt?.length ? ` · alt. ${f.alt.map(valvesText).join(', ')}` : ''}
        </span>
      )}
    </span>
  )
}
