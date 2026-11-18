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

/**
 * Anotación a mano alzada (texto, flecha, recuadro...). Se guarda tal cual se dibujó, anclada a un compás
 * para que acompañe a la música cuando cambia el ancho o se exporta.
 */
export interface Annotation {
  id: string
  /** Compás de anclaje (índice global). */
  measure: number
  /** Ancla: fracción horizontal dentro del compás (0..1) y px respecto a la primera línea del pentagrama. */
  ax: number
  ay: number
  /** Ancho del compás al dibujarla: la anotación se escala con él. */
  w0: number
  /** Trazos relativos al ancla: [dx, dy, presión]. */
  strokes: [number, number, number][][]
  /** true si se dibujó con lápiz (grosor por presión real). */
  pen: boolean
}

export interface Score {
  title: string
  measures: Measure[]
  bpm: number
  transposition: Transposition
  /** Capa vectorial superior de anotaciones libres. */
  annotations?: Annotation[]
}

export type EditMode = 'notes' | 'annotate'

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
