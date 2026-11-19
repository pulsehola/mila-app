/**
 * Importar MusicXML (.musicxml, .xml y .mxl comprimido) a una partitura de MILA.
 *
 * Es la puerta para usar cualquier programa de reconocimiento (Audiveris, PlayScore, MuseScore, Flat…):
 * todos exportan MusicXML. MILA es de una sola voz, así que se importa UNA parte y, dentro de ella, la
 * primera voz del primer pentagrama; de los acordes queda la nota de arriba (la melodía). Todo lo que no
 * se puede representar se avisa en `warnings`, nunca se descarta en silencio.
 *
 * Altura escrita y real: las notas de MILA son las ESCRITAS (lo que lee la trompeta).
 *  - Con <transpose> de Sib (−2 semitonos) → trompeta en Sib, notas tal cual.
 *  - Sin <transpose> en la parte → no se puede saber si es música en Do o una parte de trompeta escaneada
 *    (los programas de OMR no lo indican). Se usa `fallback` (lo que tenga abierto Mila) y se avisa.
 *  - Otro instrumento transpositor (Mib, Fa…) → se pasa a altura real (Do) y se avisa.
 */
import type { Accidental, Clef, Duration, Dynamic, Measure, Meter, Note, Score, Transposition, TupletKind } from '../types'
import { clampKey, clampStep, DUR_UNITS, effectiveAccidental, isDynamic, makeNote, makeRest, newId, TUPLET_NORMAL } from '../state/music'
import { transposeMeasures } from '../state/transpose'
import { decodeText, isZip, unzipMusicXml } from './mxl'

export const MAX_IMPORT_MEASURES = 64

export interface ImportResult {
  score: Score
  /** Avisos para Mila (en castellano, uno por tipo de problema). */
  warnings: string[]
  /** Nombre de la parte importada. */
  part: string
}

const TYPES: Record<string, Duration> = { whole: 'w', half: 'h', quarter: 'q', eighth: '8', '16th': '16' }
const LETTER_INDEX: Record<string, number> = { C: 0, D: 1, E: 2, F: 3, G: 4, A: 5, B: 6 }
const TUPLETS: Record<string, TupletKind> = { '3:2': 3, '5:4': 5, '6:4': 6 }

const kids = (el: Element | null | undefined, tag: string): Element[] =>
  el ? Array.from(el.children).filter((c) => c.localName === tag) : []
const kid = (el: Element | null | undefined, tag: string): Element | undefined => kids(el, tag)[0]
const text = (el: Element | null | undefined, tag: string): string | undefined => kid(el, tag)?.textContent?.trim() || undefined
const num = (el: Element | null | undefined, tag: string): number | undefined => {
  const t = text(el, tag)
  const n = t === undefined ? NaN : Number(t)
  return Number.isFinite(n) ? n : undefined
}
/** Primer descendiente con esa etiqueta (sin importar el espacio de nombres). */
const find = (el: Element | Document, tag: string): Element | undefined => el.getElementsByTagName(tag)[0]

/** ¿Este texto parece MusicXML? (para distinguirlo de un .mila.json al abrir desde Archivos). */
export function looksLikeMusicXml(t: string): boolean {
  return /<score-(partwise|timewise)[\s>]/.test(t.slice(0, 4000))
}

/** Duración de MILA para un valor en semicorcheas (sin grupo especial): exacta o undefined. */
function durFromUnits(units: number): { dur: Duration; dot: boolean } | undefined {
  for (const [d, u] of Object.entries(DUR_UNITS) as [Duration, number][]) {
    if (Math.abs(units - u) < 1e-6) return { dur: d, dot: false }
    if (Math.abs(units - u * 1.5) < 1e-6) return { dur: d, dot: true }
  }
  return undefined
}

function meterFor(beats: number, beatType: number): Meter | undefined {
  const m = `${beats}/${beatType}`
  if (m === '2/4' || m === '3/4' || m === '4/4' || m === '6/8') return m
  if (m === '2/2') return '4/4' // mismo largo de compás
  return undefined
}

export function musicXmlToScore(xml: string, opts: { fallback?: Transposition; fileName?: string } = {}): ImportResult {
  const doc = new DOMParser().parseFromString(xml, 'application/xml')
  if (find(doc, 'parsererror')) throw new Error('El archivo MusicXML está dañado o incompleto.')
  const root = doc.documentElement
  if (root.localName === 'score-timewise') throw new Error('Este MusicXML está en formato «timewise», que MILA no lee. Expórtalo como «partwise».')
  if (root.localName !== 'score-partwise') throw new Error('Este archivo no es una partitura MusicXML.')

  const warnings = new Set<string>()
  const warn = (w: string) => warnings.add(w)

  // ---- Parte a importar: la de trompeta si la hay; si no, la primera.
  const parts = kids(root, 'part')
  if (!parts.length) throw new Error('El MusicXML no tiene ninguna parte con notas.')
  const names = new Map<string, string>()
  for (const sp of kids(kid(root, 'part-list'), 'score-part')) {
    names.set(sp.getAttribute('id') ?? '', text(sp, 'part-name') ?? text(sp, 'part-abbreviation') ?? '')
  }
  const nameOf = (p: Element) => names.get(p.getAttribute('id') ?? '') ?? ''
  const isTrumpet = (n: string) => /trump|tromp|corn|flug|fiscorno/i.test(n)
  const part = parts.find((p) => isTrumpet(nameOf(p))) ?? parts[0]
  const partName = nameOf(part) || 'Parte 1'
  if (parts.length > 1) warn(`La partitura tiene ${parts.length} partes: importé solo «${partName}».`)

  // ---- Título
  const creditTitle = Array.from(root.getElementsByTagName('credit'))
    .find((c) => text(c, 'credit-type') === 'title')
    ?.getElementsByTagName('credit-words')[0]
    ?.textContent?.trim()
  const fileTitle = opts.fileName?.replace(/\.(musicxml|mxl|xml)$/i, '').replace(/[_-]+/g, ' ').trim()
  const title = text(kid(root, 'work'), 'work-title') ?? text(root, 'movement-title') ?? creditTitle ?? (fileTitle || 'Partitura importada')

  // ---- Recorrido de compases
  let divisions = 1
  let key: number | undefined
  let meter: Meter | undefined
  let clef: Clef | undefined
  let chromatic: number | undefined
  let bpm: number | undefined
  let voice: string | undefined
  let inSlur = false
  let pendingDyn: Dynamic | undefined
  const measures: Measure[] = []
  const measureEls = kids(part, 'measure')
  if (measureEls.length > MAX_IMPORT_MEASURES) warn(`Tiene ${measureEls.length} compases: MILA admite ${MAX_IMPORT_MEASURES}, importé los primeros.`)

  const readTempo = (dir: Element) => {
    if (bpm !== undefined) return
    const t = Number(kid(dir, 'sound')?.getAttribute('tempo'))
    if (Number.isFinite(t) && t > 0) {
      bpm = t
      return
    }
    const metro = dir.getElementsByTagName('metronome')[0]
    const per = num(metro, 'per-minute')
    if (!metro || per === undefined) return
    const unit = text(metro, 'beat-unit') ?? 'quarter'
    const f = { whole: 4, half: 2, quarter: 1, eighth: 0.5, '16th': 0.25 }[unit] ?? 1
    bpm = per * f * (kid(metro, 'beat-unit-dot') ? 1.5 : 1)
  }

  for (const mEl of measureEls.slice(0, MAX_IMPORT_MEASURES)) {
    const notes: Note[] = []
    /** Nota de la voz elegida que suena ahora (para resolver los acordes). */
    let last: Note | undefined
    let lastAlter = 0
    const alters = new Map<Note, number>()
    const explicitAcc = new Map<Note, Accidental>()
    let tupletCount = 0
    let tupletSpan = 0
    let tupletId = ''
    let wholeRest = false

    for (const el of Array.from(mEl.children)) {
      const tag = el.localName
      if (tag === 'attributes') {
        const d = num(el, 'divisions')
        if (d && d > 0) divisions = d
        const k = num(kid(el, 'key'), 'fifths')
        if (k !== undefined) {
          if (key === undefined) key = clampKey(k)
          else if (clampKey(k) !== key) warn('Cambia de armadura a mitad de la obra: MILA usa una sola, la del principio.')
        }
        const time = kid(el, 'time')
        if (time && !kid(time, 'senza-misura')) {
          const b = num(time, 'beats')
          const bt = num(time, 'beat-type')
          const m = b && bt ? meterFor(b, bt) : undefined
          if (b && bt && !m) warn(`El compás ${b}/${bt} no existe en MILA: usé 4/4 y algunos compases pueden quedar incompletos o pasados.`)
          const got = m ?? '4/4'
          if (meter === undefined) meter = got
          else if (got !== meter) warn('Cambia de compás (métrica) a mitad de la obra: MILA usa uno solo, el del principio.')
        }
        const clefs = kids(el, 'clef').filter((c) => (c.getAttribute('number') ?? '1') === '1')
        for (const c of clefs) {
          const sign = text(c, 'sign')
          const got: Clef = sign === 'F' ? 'bass' : 'treble'
          if (sign !== 'G' && sign !== 'F') warn(`La clave «${sign ?? '?'}» no existe en MILA: la puse en clave de Sol.`)
          if (clef === undefined) clef = got
          else if (got !== clef) warn('Cambia de clave a mitad de la obra: MILA usa una sola, la del principio.')
        }
        const tr = kid(el, 'transpose')
        if (tr && chromatic === undefined) chromatic = (num(tr, 'chromatic') ?? 0) + 12 * (num(tr, 'octave-change') ?? 0)
        continue
      }
      if (tag === 'direction') {
        const staff = text(el, 'staff')
        if (staff && staff !== '1') continue
        readTempo(el)
        for (const dy of Array.from(el.getElementsByTagName('dynamics'))) {
          const d = dy.children[0]?.localName
          if (isDynamic(d)) pendingDyn = d
        }
        continue
      }
      if (tag === 'sound') {
        const t = Number(el.getAttribute('tempo'))
        if (bpm === undefined && Number.isFinite(t) && t > 0) bpm = t
        continue
      }
      if (tag === 'barline') {
        if (kid(el, 'repeat') || kid(el, 'ending')) warn('Las repeticiones y casillas de 1ª/2ª vez no se importan: se lee todo seguido.')
        continue
      }
      if (tag !== 'note') continue

      // ---- Nota
      const staff = text(el, 'staff')
      if (staff && staff !== '1') {
        warn('Tiene más de un pentagrama (p. ej. piano): importé solo el de arriba.')
        continue
      }
      if (kid(el, 'grace')) {
        warn('Las notas de adorno (appoggiaturas) no se importan.')
        continue
      }
      if (kid(el, 'cue')) continue
      const v = text(el, 'voice') ?? '1'
      voice ??= v
      if (v !== voice) {
        warn('Tiene varias voces en el mismo pentagrama: importé solo la primera.')
        continue
      }
      const pitch = kid(el, 'pitch')
      const isRest = !!kid(el, 'rest')
      const unpitched = !pitch && !isRest
      let alter = 0
      let step = 6
      if (pitch) {
        const letter = text(pitch, 'step')?.toUpperCase() ?? 'C'
        const octave = num(pitch, 'octave') ?? 4
        alter = Math.round(num(pitch, 'alter') ?? 0)
        if (Math.abs(alter) > 1) {
          warn('Hay dobles sostenidos o dobles bemoles: MILA los escribe como alteración simple (revisa esas notas).')
          alter = Math.sign(alter)
        }
        step = (octave - 4) * 7 + (LETTER_INDEX[letter] ?? 0)
      }

      // Acordes: queda la nota más aguda (la melodía).
      if (kid(el, 'chord')) {
        if (last && last.kind === 'note' && pitch) {
          warn('Hay acordes: MILA es de una sola voz y dejé la nota de arriba de cada uno.')
          const above = step > last.step || (step === last.step && alter > lastAlter)
          if (above) {
            last.step = step
            alters.set(last, alter)
            lastAlter = alter
            explicitAcc.delete(last)
          }
        }
        continue
      }

      // Duración
      const units = ((num(el, 'duration') ?? 0) * 4) / divisions
      const typeName = text(el, 'type')
      const dots = kids(el, 'dot').length
      const tm = kid(el, 'time-modification')
      const tupletKey = tm ? `${num(tm, 'actual-notes')}:${num(tm, 'normal-notes')}` : ''
      let tuplet: TupletKind | undefined = tm ? TUPLETS[tupletKey] : undefined
      if (tm && !tuplet) warn('Hay grupos de valoración especial que MILA no tiene (solo tresillo, quintillo y seisillo).')
      if (isRest && kid(el, 'rest')?.getAttribute('measure') === 'yes') {
        // Silencio de compás entero: en MILA es el compás vacío.
        wholeRest = true
        continue
      }
      let dur: Duration | undefined = typeName ? TYPES[typeName] : undefined
      let dot = dots > 0
      if (dots > 1) warn('Hay notas con doble puntillo: MILA usa un solo puntillo (el ritmo de esas notas no cuadra).')
      if (!dur) {
        if (typeName === '32nd' || typeName === '64th' || typeName === '128th') {
          warn('Hay fusas o figuras más cortas: MILA llega a la semicorchea, así que las escribí como semicorcheas.')
          dur = '16'
        } else if (typeName === 'breve' || typeName === 'long') {
          warn('Hay cuadradas (breves): las escribí como redondas.')
          dur = 'w'
        } else {
          const plain = tuplet ? (units * tuplet) / TUPLET_NORMAL[tuplet] : units
          const got = durFromUnits(plain)
          if (got) ({ dur, dot } = got)
          else {
            warn('Hay figuras con una duración que MILA no puede escribir: las aproximé, revisa el ritmo.')
            dur = (['w', 'h', 'q', '8', '16'] as Duration[]).reduce((a, b) => (Math.abs(DUR_UNITS[b] - plain) < Math.abs(DUR_UNITS[a] - plain) ? b : a))
            dot = false
          }
        }
      }
      if (unpitched) {
        warn('Hay notas de percusión (sin altura): las importé como silencios.')
      }

      const note: Note = isRest || unpitched ? makeRest(dur) : makeNote({ dur, step })
      if (dot) note.dot = true

      // Grupo especial: notas seguidas del mismo tipo hasta completar el grupo.
      const tStart = Array.from(el.getElementsByTagName('tuplet')).some((t) => t.getAttribute('type') === 'start')
      if (tuplet) {
        const value = DUR_UNITS[dur] * (dot ? 1.5 : 1)
        const prev = notes[notes.length - 1]
        const continues = prev?.tuplet?.n === tuplet && prev.tuplet.id === tupletId && !tStart && tupletCount < tupletSpan - 1e-6
        if (!continues) {
          tupletId = newId()
          tupletCount = 0
          tupletSpan = value * tuplet
        }
        tupletCount += value
        note.tuplet = { id: tupletId, n: tuplet }
      } else {
        tuplet = undefined
      }

      if (note.kind === 'note') {
        alters.set(note, alter)
        const accEl = text(el, 'accidental')
        const acc: Accidental | undefined =
          accEl === 'sharp' ? '#' : accEl === 'flat' ? 'b' : accEl === 'natural' ? 'n' : undefined
        if (acc) explicitAcc.set(note, acc)
        const notations = kids(el, 'notations')
        const all = (tagName: string) => notations.flatMap((n) => Array.from(n.getElementsByTagName(tagName)))
        if (all('staccato').length || all('staccatissimo').length) note.staccato = true
        if (all('accent').length || all('strong-accent').length) note.accent = true
        const slurStart = all('slur').some((s) => s.getAttribute('type') === 'start')
        const slurStop = all('slur').some((s) => s.getAttribute('type') === 'stop')
        const tieStart = kids(el, 'tie').some((t) => t.getAttribute('type') === 'start') || all('tied').some((t) => t.getAttribute('type') === 'start')
        if (tieStart) warn('Las ligaduras de prolongación se muestran como ligaduras de expresión (MILA no tiene de las otras).')
        // La ligadura de MILA va «hacia la nota siguiente»: la llevan todas menos la última del arco.
        if (slurStop) inSlur = false
        if (slurStart) inSlur = true
        if (inSlur || tieStart) note.slur = true
        for (const dy of all('dynamics')) {
          const d = dy.children[0]?.localName
          if (isDynamic(d)) pendingDyn = d
        }
      }
      if (pendingDyn && note.kind === 'note') {
        note.dyn = pendingDyn
        pendingDyn = undefined
      }
      notes.push(note)
      last = note
      lastAlter = alter
    }

    // Alteraciones: explícita solo donde hace falta (o donde el original la escribía), con la armadura.
    const k = key ?? 0
    notes.forEach((n, i) => {
      if (n.kind !== 'note') return
      const want = alters.get(n) ?? 0
      const shown = explicitAcc.get(n)
      const wantAcc: Accidental = want === 1 ? '#' : want === -1 ? 'b' : 'n'
      if (shown && shown === wantAcc) {
        n.acc = shown
        return
      }
      n.acc = ''
      const eff = effectiveAccidental(notes, i, k)
      const effOff = eff === '#' ? 1 : eff === 'b' ? -1 : 0
      if (effOff !== want) n.acc = wantAcc
    })
    // La ligadura de la última nota del compás no tiene a qué unirse en MILA.
    const tail = notes[notes.length - 1]
    if (tail?.slur) tail.slur = false
    // Un compás que solo tiene un silencio (de compás entero) es, en MILA, el compás vacío.
    const onlyRest = notes.length === 1 && notes[0].kind === 'rest' && !notes[0].tuplet
    measures.push((wholeRest && notes.length === 0) || onlyRest ? [] : notes)
  }

  // ---- Transposición (escrita ↔ real)
  let transposition: Transposition
  let finalMeasures = measures
  let finalKey = key ?? 0
  const c = chromatic ?? 0
  if (chromatic === undefined) {
    if (/\b(B\s*b|B♭|Sib|Si\s*b|Si♭|in\s*B)\b/i.test(partName)) transposition = 'Bb'
    else {
      transposition = opts.fallback ?? 'Bb'
      warn(
        transposition === 'Bb'
          ? 'El archivo no dice para qué instrumento está escrito: lo abrí como trompeta en Sib (las notas son las del papel). Si es música en Do, cámbialo arriba a «Do».'
          : 'El archivo no dice para qué instrumento está escrito: lo abrí en Do (altura real). Si es una parte de trompeta en Sib, cámbialo arriba a «Sib».',
      )
    }
  } else if (c === 0) {
    transposition = 'C'
  } else if (((c % 12) + 12) % 12 === 10) {
    transposition = 'Bb'
    if (c !== -2) warn('La parte está escrita una octava distinta de la trompeta (p. ej. saxo tenor): dejé las notas escritas.')
  } else {
    // Otro transpositor: se pasa a altura real para no confundir lo escrito con lo que suena.
    const t = transposeMeasures(measures, finalKey, c)
    finalMeasures = t.measures
    finalKey = t.key
    transposition = 'C'
    warn(`La parte es de un instrumento transpositor (${c > 0 ? '+' : ''}${c} semitonos): la pasé a altura real (en Do).`)
  }

  // Notas fuera del pentagrama de MILA
  const clefFinal = clef ?? 'treble'
  let clamped = 0
  for (const m of finalMeasures) {
    for (const n of m) {
      if (n.kind !== 'note') continue
      const s = clampStep(n.step, clefFinal)
      if (s !== n.step) {
        clamped++
        n.step = s
      }
    }
  }
  if (clamped) warn(`${clamped} nota${clamped === 1 ? '' : 's'} quedaba${clamped === 1 ? '' : 'n'} fuera del registro que muestra MILA: la${clamped === 1 ? '' : 's'} acerqué al pentagrama.`)

  if (!finalMeasures.some((m) => m.some((n) => n.kind === 'note'))) warn('No encontré ninguna nota en la parte importada.')

  const score: Score = {
    title,
    measures: finalMeasures.length ? finalMeasures : [[]],
    bpm: Math.max(30, Math.min(240, Math.round(bpm ?? 96))),
    transposition,
    meter: meter ?? '4/4',
    clef: clefFinal,
    key: clampKey(finalKey),
  }
  return { score, warnings: [...warnings], part: partName }
}

/** Lee un archivo .musicxml, .xml o .mxl. */
export async function readMusicXmlFile(file: Blob & { name?: string }, opts: { fallback?: Transposition } = {}): Promise<ImportResult> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  const xml = isZip(bytes) ? await unzipMusicXml(bytes) : decodeText(bytes)
  return musicXmlToScore(xml, { ...opts, fileName: file.name })
}

/** ¿El archivo es MusicXML? Por extensión, o mirando el contenido (en iPad a veces llega sin extensión). */
export async function isMusicXmlFile(file: Blob & { name?: string }): Promise<boolean> {
  if (/\.(musicxml|mxl)$/i.test(file.name ?? '')) return true
  const head = new Uint8Array(await file.slice(0, 4000).arrayBuffer())
  if (isZip(head)) return /\.xml$/i.test(file.name ?? '') || new TextDecoder().decode(head).includes('META-INF')
  return looksLikeMusicXml(decodeText(head))
}
