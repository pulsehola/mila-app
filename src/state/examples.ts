import type { Accidental, Duration, Measure, Score } from '../types'
import { LETTERS, makeNote, makeRest } from './music'

/**
 * Mini-lenguaje para escribir compases a mano:
 *   g4/q   nota Sol4 negra     r/h   silencio de blanca
 *   f#4/8  Fa#4 corchea         bb4/q Sib4 negra
 *   sufijos: .  staccato   >  acento   ~  ligadura a la siguiente nota
 */
const TOKEN = /^(?:(r)|([a-g])([#bn])?(\d))\/(w|h|q|16|8)([.>~]*)$/

export function parseMeasure(src: string): Measure {
  return src
    .trim()
    .split(/\s+/)
    .map((tok) => {
      const m = TOKEN.exec(tok)
      if (!m) throw new Error(`Token inválido: ${tok}`)
      const [, rest, letter, acc, octave, dur, mods] = m
      if (rest) return makeRest(dur as Duration)
      const step = LETTERS.indexOf(letter as (typeof LETTERS)[number]) + (Number(octave) - 4) * 7
      return makeNote({
        dur: dur as Duration,
        step,
        acc: (acc ?? '') as Accidental,
        staccato: mods.includes('.'),
        accent: mods.includes('>'),
        slur: mods.includes('~'),
      })
    })
}

export interface Example {
  key: string
  name: string
  blurb: string
  build: () => Score
}

const make = (title: string, bpm: number, bars: string[]): Score => ({
  title,
  bpm,
  transposition: 'Bb',
  measures: bars.map(parseMeasure),
})

export const EXAMPLES: Example[] = [
  {
    key: 'fanfarria',
    name: 'Fanfarria',
    blurb: 'Arpegio de Do mayor con acentos',
    build: () =>
      make('Fanfarria', 108, [
        'c4/q e4/q g4/q c5/q>',
        'g4/8 g4/8 g4/q e4/q g4/q',
        'c5/q c5/8 d5/8 e5/q g5/q',
        'g5/h> c5/h',
      ]),
  },
  {
    key: 'jazz',
    name: 'Frase Jazz',
    blurb: 'Corcheas, alteraciones y ligadura',
    build: () =>
      make('Frase Jazz', 126, [
        'r/q e4/8 g4/8 bb4/q a4/q',
        'g4/8 e4/8 d4/q. c4/h',
        'd4/8 f#4/8 a4/8 c5/8 b4/q> g4/q',
        'a4/q~ g4/q f#4/q e4/q',
      ]),
  },
  {
    key: 'calentamiento',
    name: 'Calentamiento',
    blurb: 'Nota larga, escala ligada y picada',
    build: () =>
      make('Calentamiento', 80, [
        'c4/w',
        'c4/q~ d4/q~ e4/q~ f4/q',
        'g4/q~ a4/q~ b4/q~ c5/q',
        'c5/q b4/q a4/q g4/q',
        'f4/q. e4/q. d4/q. c4/q.',
        'c4/h r/h',
      ]),
  },
]

export function emptyScore(): Score {
  return {
    title: 'Sin título',
    bpm: 96,
    transposition: 'Bb',
    measures: [[], [], [], []],
  }
}
