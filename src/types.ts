/** Duraciones soportadas: redonda, blanca, negra, corchea, semicorchea. */
export type Duration = 'w' | 'h' | 'q' | '8' | '16'
export type Accidental = '' | '#' | 'b' | 'n'
export type Transposition = 'Bb' | 'C'
/** Compás (métrica) de toda la partitura. */
export type Meter = '2/4' | '3/4' | '4/4' | '6/8'
/** Clave: de Sol (trompeta) o de Fa. */
export type Clef = 'treble' | 'bass'
/** Matices dinámicos (se mantienen hasta el siguiente). */
export type Dynamic = 'pp' | 'p' | 'mp' | 'mf' | 'f' | 'ff'
/** Sonido de la reproducción (ambos sintetizados en el navegador). */
export type Sound = 'trumpet' | 'piano'

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
  /** Puntillo: suma la mitad del valor de la figura (negra con puntillo = 1½ tiempos). */
  dot?: boolean
  /**
   * Grupo de valoración especial al que pertenece (notas consecutivas con el mismo `id`):
   * 3 = tresillo (3 en el tiempo de 2), 5 = quintillo y 6 = seisillo (5 o 6 en el tiempo de 4).
   */
  tuplet?: Tuplet
  /** Matiz que empieza en esta nota (pp … ff). */
  dyn?: Dynamic
}

export type TupletKind = 3 | 5 | 6
export interface Tuplet {
  id: string
  n: TupletKind
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

/**
 * Partitura escaneada (foto o PDF) como fondo de la hoja. La imagen vive en el almacén del dispositivo
 * (`imageId`); aquí solo se guarda cómo se coloca. Con fondo, la hoja digital se dibuja siempre con el mismo
 * ancho y espaciado para que no se desalinee al girar el iPad.
 */
export interface Background {
  imageId: string
  /** Tamaño en píxeles de la imagen guardada. */
  naturalW: number
  naturalH: number
  /** Ancho de la hoja digital (px de layout) con el que se alineó. */
  layoutWidth: number
  /** Separación entre sistemas (px) y compases por línea de la hoja digital, para casar con el papel. */
  rowH: number
  perRow: number
  /** Anchos de compás de cada sistema del papel (px de layout), detectados al escanear. */
  rowWidths?: number[][]
  /** Colocación de la imagen, en px de layout: esquina superior izquierda, escala (1 = ancho de la hoja) y giro. */
  x: number
  y: number
  scale: number
  rotation: number
  opacity: number
  /** Realzar: escala de grises + contraste (la foto parece un escaneo limpio). */
  enhance: boolean
}

export interface Score {
  title: string
  measures: Measure[]
  bpm: number
  transposition: Transposition
  /** Métrica; si falta, 4/4 (partituras guardadas antes de existir esta opción). */
  meter?: Meter
  /** Clave; si falta, de Sol. */
  clef?: Clef
  /**
   * Armadura ESCRITA en quintas (−7 = 7 bemoles … 0 = sin alteraciones … 7 = 7 sostenidos).
   * Como las notas, es lo que lee el trompetista; en Sib suena una 2ª mayor más grave (2 bemoles más).
   */
  key?: number
  /** Sonido al reproducir; si falta, trompeta. */
  sound?: Sound
  /** Capa vectorial superior de anotaciones libres. */
  annotations?: Annotation[]
  /** Partitura escaneada de fondo (opcional). */
  background?: Background
}

export type EditMode = 'notes' | 'annotate' | 'erase'

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
