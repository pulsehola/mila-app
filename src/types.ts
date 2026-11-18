/** Duraciones soportadas: redonda, blanca, negra, corchea. */
export type Duration = 'w' | 'h' | 'q' | '8'
export type Accidental = '' | '#' | 'b' | 'n'
export type Transposition = 'Bb' | 'C'

export interface Note {
  id: string
  kind: 'note' | 'rest'
  dur: Duration
  /** Paso diatónico respecto a Do4 (C4 = 0, D4 = 1, E4 = 2 ...). Ignorado en silencios. */
  step: number
  /** Alteración escrita explícitamente (el resto del compás la hereda). */
  acc: Accidental
  staccato: boolean
  accent: boolean
  /** Ligadura de expresión hacia la nota siguiente. */
  slur: boolean
}

export type Measure = Note[]

export interface Score {
  title: string
  measures: Measure[]
  bpm: number
  transposition: Transposition
}

export interface LoopRange {
  start: number
  end: number
}

export interface Pt {
  x: number
  y: number
  p: number
  t: number
}
export type Stroke = Pt[]
