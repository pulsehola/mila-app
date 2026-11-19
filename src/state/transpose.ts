import type { Accidental, Measure, Note, Score } from '../types'
import { accidentalOffset, clampKey, effectiveAccidental, newId, writtenMidi } from './music'

/**
 * Transporte con ortografía musical: cada nota sube/baja un intervalo (no solo semitonos), la armadura se
 * mueve con ella y se elige la escritura más sencilla (Re♭ mayor antes que Do♯ mayor). Nunca modifica la
 * partitura recibida: devuelve compases nuevos.
 */

const mod = (a: number, n: number) => ((a % n) + n) % n

/** Quintas que mueve la armadura para cada semitono (escritura habitual: 2ª menor, 2ª mayor, 3ª menor…). */
const FIFTHS_BY_SEMITONE = [0, -5, 2, -3, 4, -1, 6, 1, -4, 3, -2, 5]

export interface Interval {
  /** Pasos diatónicos (Do→Re = 1). */
  steps: number
  /** Cambio de la armadura en quintas. */
  fifths: number
}

/** Intervalo para transportar `semis` semitonos desde la armadura `key`, con la armadura resultante más simple. */
export function intervalFor(semis: number, key = 0): Interval & { key: number } {
  const oct = Math.floor(semis / 12)
  const f = FIFTHS_BY_SEMITONE[mod(semis, 12)]
  const steps = mod(f * 4, 7) + 7 * oct
  // Mismo sonido, escritura enarmónica: ± una 2ª disminuida (un paso diatónico, 12 quintas).
  const candidates: Interval[] = [
    { steps, fifths: f },
    { steps: steps + 1, fifths: f - 12 },
    { steps: steps - 1, fifths: f + 12 },
  ]
  const k = clampKey(key)
  let best: (Interval & { key: number }) | null = null
  for (const c of candidates) {
    const nk = k + c.fifths
    if (nk < -7 || nk > 7) continue
    if (!best || Math.abs(nk) < Math.abs(best.key)) best = { ...c, key: nk }
  }
  return best ?? { steps, fifths: f, key: k }
}

function accFor(alter: number): Accidental {
  return alter > 0 ? '#' : alter < 0 ? 'b' : 'n'
}

/** Transporta los compases `semis` semitonos. Devuelve compases nuevos (mismos ids) y la armadura nueva. */
export function transposeMeasures(measures: Measure[], key: number, semis: number): { measures: Measure[]; key: number } {
  const iv = intervalFor(semis, key)
  const out = measures.map((m) => {
    const next: Measure = []
    m.forEach((n, i) => {
      if (n.kind === 'rest') {
        next.push(n)
        return
      }
      const midi = writtenMidi(n.step, effectiveAccidental(m, i, key)) + semis
      let step = n.step + iv.steps
      let alter = midi - writtenMidi(step, '')
      // Sin dobles alteraciones: se usa la nota enarmónica vecina.
      if (alter > 1) {
        step += 1
        alter = midi - writtenMidi(step, '')
      } else if (alter < -1) {
        step -= 1
        alter = midi - writtenMidi(step, '')
      }
      // Solo se escribe la alteración si la armadura (y lo anterior del compás) no la da ya.
      const plain: Note = { ...n, step, acc: '' }
      const implied = accidentalOffset(effectiveAccidental([...next, plain], next.length, iv.key))
      next.push(implied === alter ? plain : { ...plain, acc: accFor(alter) })
    })
    return next
  })
  return { measures: out, key: iv.key }
}

/** Copia transportada de una partitura (ids nuevos, para guardarla aparte en la galería). */
export function transposedCopy(score: Score, semis: number, title: string): Score {
  const t = transposeMeasures(score.measures, clampKey(score.key), semis)
  const tuplets = new Map<string, string>()
  const measures = t.measures.map((m) =>
    m.map((n) => ({
      ...n,
      id: newId(),
      ...(n.tuplet
        ? { tuplet: { ...n.tuplet, id: tuplets.get(n.tuplet.id) ?? (tuplets.set(n.tuplet.id, newId()), tuplets.get(n.tuplet.id)!) } }
        : {}),
    })),
  )
  const copy: Score = { ...score, title, measures, key: t.key }
  if (!t.key) delete copy.key
  // La copia no lleva la foto escaneada: las notas ya no coinciden con el papel.
  delete copy.background
  return copy
}

/** "+2 semitonos (2ª mayor arriba)" para mostrar el intervalo elegido. */
export function semitoneLabel(semis: number): string {
  if (semis === 0) return 'Sin transportar'
  const names = ['unísono', '2ª menor', '2ª mayor', '3ª menor', '3ª mayor', '4ª justa', 'tritono', '5ª justa', '6ª menor', '6ª mayor', '7ª menor', '7ª mayor']
  const a = Math.abs(semis)
  const oct = Math.floor(a / 12)
  const r = a % 12
  const parts = [r ? names[r] : '', oct ? (oct === 1 ? '1 octava' : `${oct} octavas`) : ''].filter(Boolean).join(' + ')
  return `${semis > 0 ? '+' : '−'}${a} ${a === 1 ? 'semitono' : 'semitonos'} (${parts} ${semis > 0 ? 'arriba' : 'abajo'})`
}
