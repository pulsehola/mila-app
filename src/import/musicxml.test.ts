// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import type { Measure, Score } from '../types'
import { EXAMPLES } from '../state/examples'
import { effectiveAccidental, makeNote, writtenMidi } from '../state/music'
import { scoreToMusicXML } from '../export/musicxml'
import { isMusicXmlFile, looksLikeMusicXml, musicXmlToScore, readMusicXmlFile } from './musicxml'

/** Lo que importa de cada nota: altura escrita real (con armadura y alteraciones), figura y adornos. */
function digest(measures: Measure[], key = 0) {
  return measures.map((m) =>
    m.map((n, i) => ({
      kind: n.kind,
      midi: n.kind === 'note' ? writtenMidi(n.step, effectiveAccidental(m, i, key)) : null,
      dur: n.dur,
      dot: !!n.dot,
      tuplet: n.tuplet?.n ?? null,
      staccato: n.staccato,
      accent: n.accent,
      slur: n.slur && m[i + 1]?.kind === 'note',
      dyn: n.dyn ?? null,
    })),
  )
}

const wrap = (body: string, extraParts = '', partName = 'Trumpet in Bb') => `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">
<score-partwise version="4.0">
  <work><work-title>Prueba</work-title></work>
  <part-list><score-part id="P1"><part-name>${partName}</part-name></score-part>${extraParts}</part-list>
  <part id="P1">${body}</part>
</score-partwise>`

const attrs = (o: { div?: number; fifths?: number; beats?: number; type?: number; clef?: string; transpose?: string } = {}) =>
  `<attributes><divisions>${o.div ?? 2}</divisions><key><fifths>${o.fifths ?? 0}</fifths></key><time><beats>${o.beats ?? 4}</beats><beat-type>${o.type ?? 4}</beat-type></time>${o.clef ?? '<clef><sign>G</sign><line>2</line></clef>'}${o.transpose ?? ''}</attributes>`
const n = (step: string, oct: number, dur: number, type: string, extra = '') =>
  `<note><pitch><step>${step}</step>${extra.includes('<alter>') ? '' : ''}<octave>${oct}</octave></pitch><duration>${dur}</duration><voice>1</voice><type>${type}</type>${extra}</note>`

describe('MusicXML → MILA: ida y vuelta con el exportador', () => {
  for (const ex of EXAMPLES) {
    it(`«${ex.name}» vuelve igual`, () => {
      const s: Score = ex.build()
      const r = musicXmlToScore(scoreToMusicXML(s))
      expect(r.score.title).toBe(s.title)
      expect(r.score.bpm).toBe(s.bpm)
      expect(r.score.meter).toBe(s.meter ?? '4/4')
      expect(r.score.key ?? 0).toBe(s.key ?? 0)
      expect(r.score.clef).toBe(s.clef ?? 'treble')
      expect(r.score.transposition).toBe(s.transposition)
      expect(digest(r.score.measures, r.score.key)).toEqual(digest(s.measures, s.key))
      expect(r.warnings).toEqual([])
    })
  }

  it('conserva alteraciones, armadura, puntillos, tresillos, quintillos, matices y articulaciones', () => {
    const s: Score = {
      title: 'Todo',
      bpm: 72,
      transposition: 'C',
      meter: '3/4',
      key: -3,
      measures: [
        [
          makeNote({ dur: 'q', step: 2, dot: true, dyn: 'p', staccato: true }), // Mi♭ por armadura
          makeNote({ dur: '8', step: 2, acc: 'n', accent: true }), // Mi natural
          makeNote({ dur: 'q', step: 2, slur: true }), // hereda el becuadro
          makeNote({ dur: 'q', step: 3 }),
        ].slice(0, 3),
        [
          makeNote({ dur: '8', step: 0, tuplet: { id: 't1', n: 3 } }),
          makeNote({ dur: '8', step: 1, acc: '#', tuplet: { id: 't1', n: 3 } }),
          makeNote({ dur: '8', step: 2, tuplet: { id: 't1', n: 3 } }),
          ...[0, 1, 2, 3, 4].map((st) => makeNote({ dur: '16', step: st, tuplet: { id: 't2', n: 5 } })),
          makeNote({ dur: 'q', step: 7, dyn: 'ff' }),
        ],
        [],
      ],
    }
    const r = musicXmlToScore(scoreToMusicXML(s))
    expect(digest(r.score.measures, -3)).toEqual(digest(s.measures, -3))
    expect(r.score.measures[2]).toEqual([])
    // Tresillo y quintillo quedan como dos grupos distintos.
    const ids = new Set(r.score.measures[1].map((x) => x.tuplet?.id).filter(Boolean))
    expect(ids.size).toBe(2)
  })
})

describe('MusicXML de otros programas', () => {
  it('Sib: con <transpose> de trompeta las notas quedan escritas y la partitura en Sib', () => {
    const r = musicXmlToScore(
      wrap(`<measure number="1">${attrs({ fifths: 2, transpose: '<transpose><diatonic>-1</diatonic><chromatic>-2</chromatic></transpose>' })}${n('D', 5, 8, 'whole')}</measure>`),
    )
    expect(r.score.transposition).toBe('Bb')
    expect(r.score.key).toBe(2)
    expect(r.score.measures[0][0].step).toBe(8) // Re5 escrito
    expect(r.warnings).toEqual([])
  })

  it('sin <transpose> ni nombre que lo diga: usa la transposición de reserva y lo avisa', () => {
    const body = `<measure number="1">${attrs()}${n('C', 5, 8, 'whole')}</measure>`
    const bb = musicXmlToScore(wrap(body, '', 'Voice'), { fallback: 'Bb' })
    expect(bb.score.transposition).toBe('Bb')
    expect(bb.warnings.join(' ')).toMatch(/no dice para qué instrumento/)
    const c = musicXmlToScore(wrap(body, '', 'Voice'), { fallback: 'C' })
    expect(c.score.transposition).toBe('C')
    expect(c.score.measures[0][0].step).toBe(7)
  })

  it('el nombre «Trompeta en Sib» basta para saber que es en Sib', () => {
    const r = musicXmlToScore(wrap(`<measure number="1">${attrs()}${n('C', 5, 8, 'whole')}</measure>`, '', 'Trompeta en Sib'), { fallback: 'C' })
    expect(r.score.transposition).toBe('Bb')
    expect(r.warnings).toEqual([])
  })

  it('otro transpositor (saxo alto en Mib): pasa a altura real en Do', () => {
    const r = musicXmlToScore(
      wrap(
        `<measure number="1">${attrs({ fifths: 0, transpose: '<transpose><diatonic>-5</diatonic><chromatic>-9</chromatic></transpose>' })}${n('A', 4, 8, 'whole')}</measure>`,
        '',
        'Alto Saxophone',
      ),
    )
    expect(r.score.transposition).toBe('C')
    const m = r.score.measures[0]
    expect(writtenMidi(m[0].step, effectiveAccidental(m, 0, r.score.key))).toBe(69 - 9) // La4 escrito suena Do4
    expect(r.score.key).toBe(-3) // Do mayor escrito → Mib mayor real
    expect(r.warnings.join(' ')).toMatch(/transpositor/)
  })

  it('acordes: queda la nota de arriba; voces y pentagramas extra se ignoran con aviso', () => {
    const body = `<measure number="1">${attrs()}
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><voice>1</voice><type>half</type><staff>1</staff></note>
      <note><chord/><pitch><step>G</step><octave>4</octave></pitch><duration>4</duration><voice>1</voice><type>half</type><staff>1</staff></note>
      <note><chord/><pitch><step>E</step><octave>4</octave></pitch><duration>4</duration><voice>1</voice><type>half</type><staff>1</staff></note>
      <note><pitch><step>A</step><octave>4</octave></pitch><duration>4</duration><voice>1</voice><type>half</type><staff>1</staff></note>
      <backup><duration>8</duration></backup>
      <note><pitch><step>E</step><octave>4</octave></pitch><duration>8</duration><voice>2</voice><type>whole</type><staff>1</staff></note>
      <backup><duration>8</duration></backup>
      <note><pitch><step>C</step><octave>3</octave></pitch><duration>8</duration><voice>5</voice><type>whole</type><staff>2</staff></note>
    </measure>`
    const r = musicXmlToScore(wrap(body, '', 'Piano'), { fallback: 'C' })
    expect(r.score.measures[0].map((x) => [x.dur, x.step])).toEqual([
      ['h', 4],
      ['h', 5],
    ])
    const all = r.warnings.join(' ')
    expect(all).toMatch(/acordes/)
    expect(all).toMatch(/varias voces/)
    expect(all).toMatch(/más de un pentagrama/)
  })

  it('elige la parte de trompeta entre varias y lo avisa', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="3.1">
  <part-list>
    <score-part id="P1"><part-name>Flute</part-name></score-part>
    <score-part id="P2"><part-name>Trumpet in B♭</part-name></score-part>
  </part-list>
  <part id="P1"><measure number="1">${attrs()}${n('F', 5, 8, 'whole')}</measure></part>
  <part id="P2"><measure number="1">${attrs({ transpose: '<transpose><diatonic>-1</diatonic><chromatic>-2</chromatic></transpose>' })}${n('G', 4, 8, 'whole')}</measure></part>
</score-partwise>`
    const r = musicXmlToScore(xml)
    expect(r.part).toBe('Trumpet in B♭')
    expect(r.score.measures[0][0].step).toBe(4)
    expect(r.warnings.join(' ')).toMatch(/2 partes/)
  })

  it('sin <type> (algunos OMR): deduce la figura de la duración; silencio de compás → compás vacío', () => {
    const body = `<measure number="1">${attrs({ div: 4 })}
      <note><pitch><step>E</step><octave>4</octave></pitch><duration>6</duration></note>
      <note><pitch><step>F</step><octave>4</octave></pitch><duration>2</duration></note>
      <note><pitch><step>G</step><octave>4</octave></pitch><duration>8</duration></note>
    </measure>
    <measure number="2"><note><rest measure="yes"/><duration>16</duration></note></measure>`
    const r = musicXmlToScore(wrap(body))
    expect(r.score.measures[0].map((x) => [x.dur, !!x.dot])).toEqual([
      ['q', true],
      ['8', false],
      ['h', false],
    ])
    expect(r.score.measures[1]).toEqual([])
  })

  it('ligaduras: arco de varias notas y ligadura de prolongación (con aviso)', () => {
    const body = `<measure number="1">${attrs()}
      ${n('C', 5, 2, 'quarter', '<notations><slur type="start" number="1"/></notations>')}
      ${n('D', 5, 2, 'quarter')}
      ${n('E', 5, 2, 'quarter', '<notations><slur type="stop" number="1"/></notations>')}
      ${n('E', 5, 2, 'quarter', '<tie type="start"/><notations><tied type="start"/></notations>')}
    </measure>
    <measure number="2">${n('E', 5, 8, 'whole', '<tie type="stop"/><notations><tied type="stop"/></notations>')}</measure>`
    const r = musicXmlToScore(wrap(body))
    expect(r.score.measures[0].map((x) => x.slur)).toEqual([true, true, false, false]) // la última del compás no se une
    expect(r.warnings.join(' ')).toMatch(/prolongación/)
  })

  it('tempo desde el metrónomo (blanca = 60 → 120 negras) y compás 2/2 como 4/4', () => {
    const body = `<measure number="1">${attrs({ beats: 2, type: 2 })}
      <direction><direction-type><metronome><beat-unit>half</beat-unit><per-minute>60</per-minute></metronome></direction-type></direction>
      ${n('C', 5, 8, 'whole')}</measure>`
    const r = musicXmlToScore(wrap(body))
    expect(r.score.bpm).toBe(120)
    expect(r.score.meter).toBe('4/4')
  })

  it('clave de Fa y notas fuera de registro (se acercan y se avisa)', () => {
    const body = `<measure number="1">${attrs({ clef: '<clef><sign>F</sign><line>4</line></clef>' })}${n('G', 2, 4, 'half')}${n('C', 1, 4, 'half')}</measure>`
    const r = musicXmlToScore(wrap(body, '', 'Tuba'), { fallback: 'C' })
    expect(r.score.clef).toBe('bass')
    expect(r.score.measures[0][0].step).toBe(-10)
    expect(r.warnings.join(' ')).toMatch(/fuera del registro/)
  })

  it('más de 64 compases: importa los primeros 64 y avisa', () => {
    const ms = Array.from({ length: 70 }, (_, i) => `<measure number="${i + 1}">${i === 0 ? attrs() : ''}${n('C', 5, 8, 'whole')}</measure>`).join('')
    const r = musicXmlToScore(wrap(ms))
    expect(r.score.measures).toHaveLength(64)
    expect(r.warnings.join(' ')).toMatch(/70 compases/)
  })

  it('rechaza lo que no es MusicXML con un mensaje claro', () => {
    expect(() => musicXmlToScore('<html><body>hola</body></html>')).toThrow(/no es una partitura/)
    expect(() => musicXmlToScore('<score-partwise><part')).toThrow(/dañado/)
    expect(looksLikeMusicXml('{"mila":1}')).toBe(false)
    expect(looksLikeMusicXml(wrap(''))).toBe(true)
  })
})

/** ZIP mínimo (como los .mxl de MuseScore y Audiveris): container.xml + partitura, comprimida con deflate. */
async function makeMxl(files: Record<string, string>): Promise<Uint8Array> {
  const enc = new TextEncoder()
  const locals: Uint8Array[] = []
  const centrals: Uint8Array[] = []
  let offset = 0
  for (const [name, content] of Object.entries(files)) {
    const nameB = enc.encode(name)
    const raw = enc.encode(content)
    const comp = new Uint8Array(await new Response(new Response(raw).body!.pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer())
    const lh = new DataView(new ArrayBuffer(30))
    lh.setUint32(0, 0x04034b50, true)
    lh.setUint16(8, 8, true)
    lh.setUint32(18, comp.length, true)
    lh.setUint32(22, raw.length, true)
    lh.setUint16(26, nameB.length, true)
    const ch = new DataView(new ArrayBuffer(46))
    ch.setUint32(0, 0x02014b50, true)
    ch.setUint16(10, 8, true)
    ch.setUint32(20, comp.length, true)
    ch.setUint32(24, raw.length, true)
    ch.setUint16(28, nameB.length, true)
    ch.setUint32(42, offset, true)
    locals.push(new Uint8Array(lh.buffer), nameB, comp)
    centrals.push(new Uint8Array(ch.buffer), nameB)
    offset += 30 + nameB.length + comp.length
  }
  const cdSize = centrals.reduce((a, b) => a + b.length, 0)
  const end = new DataView(new ArrayBuffer(22))
  end.setUint32(0, 0x06054b50, true)
  end.setUint16(8, Object.keys(files).length, true)
  end.setUint16(10, Object.keys(files).length, true)
  end.setUint32(12, cdSize, true)
  end.setUint32(16, offset, true)
  const parts = [...locals, ...centrals, new Uint8Array(end.buffer)]
  const out = new Uint8Array(parts.reduce((a, b) => a + b.length, 0))
  let p = 0
  for (const x of parts) {
    out.set(x, p)
    p += x.length
  }
  return out
}

describe('archivos .mxl (comprimidos) y detección', () => {
  it('lee el .mxl siguiendo META-INF/container.xml', async () => {
    const s = EXAMPLES[0].build()
    const zip = await makeMxl({
      'META-INF/container.xml':
        '<?xml version="1.0"?><container><rootfiles><rootfile full-path="score.musicxml" media-type="application/vnd.recordare.musicxml+xml"/></rootfiles></container>',
      'score.musicxml': scoreToMusicXML(s),
    })
    const file = new File([zip as BlobPart], 'fanfarria.mxl')
    expect(await isMusicXmlFile(file)).toBe(true)
    const r = await readMusicXmlFile(file)
    expect(digest(r.score.measures, r.score.key)).toEqual(digest(s.measures, s.key))
  })

  it('reconoce MusicXML aunque llegue sin extensión, y no confunde un .mila.json', async () => {
    const xml = new File([scoreToMusicXML(EXAMPLES[0].build())], 'archivo')
    expect(await isMusicXmlFile(xml)).toBe(true)
    expect(await isMusicXmlFile(new File(['{"mila":1,"scores":[]}'], 'x.mila.json'))).toBe(false)
  })

  it('usa el nombre del archivo como título si el MusicXML no trae ninguno', async () => {
    const xml = scoreToMusicXML(EXAMPLES[0].build()).replace(/<work>.*<\/work>/, '')
    const r = await readMusicXmlFile(new File([xml], 'Himno_de_la_alegria.musicxml'))
    expect(r.score.title).toBe('Himno de la alegria')
  })
})
