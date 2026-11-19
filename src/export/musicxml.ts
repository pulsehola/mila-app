import type { Score } from '../types'
import { clampKey, effectiveAccidental, letterOf, measureCapacity, meterParts, noteUnits, octaveOf, TUPLET_NORMAL } from '../state/music'

/** Divisiones por negra: 120 admite puntillos y tresillos, quintillos y seisillos de semicorchea. */
const DIV = 120
const dur = (units: number) => Math.round((units * DIV) / 4)

const TYPE: Record<string, string> = { w: 'whole', h: 'half', q: 'quarter', '8': 'eighth', '16': '16th' }
const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/**
 * MusicXML 3.1 (partwise). Las notas se guardan como están escritas;
 * en Sib se añade <transpose> para que MuseScore/Finale/Sibelius suenen una 2ª mayor más grave.
 */
export function scoreToMusicXML(score: Score): string {
  const bb = score.transposition === 'Bb'
  const out: string[] = []
  out.push('<?xml version="1.0" encoding="UTF-8" standalone="no"?>')
  out.push(
    '<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 3.1 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">',
  )
  out.push('<score-partwise version="3.1">')
  out.push(`  <work><work-title>${esc(score.title || 'MILA')}</work-title></work>`)
  out.push('  <identification><encoding><software>MILA</software></encoding></identification>')
  out.push('  <part-list>')
  out.push(
    `    <score-part id="P1"><part-name>${bb ? 'Trompeta en Sib' : 'Trompeta'}</part-name><score-instrument id="P1-I1"><instrument-name>Trumpet</instrument-name></score-instrument><midi-instrument id="P1-I1"><midi-channel>1</midi-channel><midi-program>57</midi-program></midi-instrument></score-part>`,
  )
  out.push('  </part-list>')
  out.push('  <part id="P1">')
  const meter = score.meter ?? '4/4'
  const { beats, beatType } = meterParts(meter)
  const key = clampKey(score.key)
  const bass = score.clef === 'bass'
  score.measures.forEach((m, mi) => {
    out.push(`    <measure number="${mi + 1}">`)
    if (mi === 0) {
      out.push('      <attributes>')
      out.push(`        <divisions>${DIV}</divisions>`)
      out.push(`        <key><fifths>${key}</fifths></key>`)
      out.push(`        <time><beats>${beats}</beats><beat-type>${beatType}</beat-type></time>`)
      out.push(bass ? '        <clef><sign>F</sign><line>4</line></clef>' : '        <clef><sign>G</sign><line>2</line></clef>')
      if (bb) out.push('        <transpose><diatonic>-1</diatonic><chromatic>-2</chromatic></transpose>')
      out.push('      </attributes>')
      out.push(`      <direction placement="above"><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>${score.bpm}</per-minute></metronome></direction-type><sound tempo="${score.bpm}"/></direction>`)
    }
    if (m.length === 0) {
      out.push(`      <note><rest measure="yes"/><duration>${dur(measureCapacity(meter))}</duration></note>`)
    }
    m.forEach((n, i) => {
      const next = m[i + 1]
      if (n.dyn) {
        out.push(`      <direction placement="below"><direction-type><dynamics><${n.dyn}/></dynamics></direction-type></direction>`)
      }
      out.push('      <note>')
      if (n.kind === 'rest') {
        out.push('        <rest/>')
      } else {
        const eff = effectiveAccidental(m, i, key)
        const alter = eff === '#' ? 1 : eff === 'b' ? -1 : 0
        out.push('        <pitch>')
        out.push(`          <step>${letterOf(n.step).toUpperCase()}</step>`)
        if (alter !== 0) out.push(`          <alter>${alter}</alter>`)
        out.push(`          <octave>${octaveOf(n.step)}</octave>`)
        out.push('        </pitch>')
      }
      out.push(`        <duration>${dur(noteUnits(n))}</duration>`)
      out.push(`        <type>${TYPE[n.dur]}</type>`)
      if (n.dot) out.push('        <dot/>')
      const t = n.tuplet
      const tStart = !!t && m[i - 1]?.tuplet?.id !== t.id
      const tStop = !!t && next?.tuplet?.id !== t.id
      if (t) {
        out.push(
          `        <time-modification><actual-notes>${t.n}</actual-notes><normal-notes>${TUPLET_NORMAL[t.n]}</normal-notes></time-modification>`,
        )
      }
      const tupletTags = [tStart ? '          <tuplet type="start" bracket="yes"/>' : '', tStop ? '          <tuplet type="stop"/>' : ''].filter(Boolean)
      if (n.kind === 'rest' && tupletTags.length) {
        out.push('        <notations>', ...tupletTags, '        </notations>')
      }
      if (n.kind === 'note') {
        if (n.acc === '#') out.push('        <accidental>sharp</accidental>')
        if (n.acc === 'b') out.push('        <accidental>flat</accidental>')
        if (n.acc === 'n') out.push('        <accidental>natural</accidental>')
        const starts = n.slur && next?.kind === 'note'
        const stops = i > 0 && m[i - 1].kind === 'note' && m[i - 1].slur
        if (n.staccato || n.accent || starts || stops || tupletTags.length) {
          out.push('        <notations>')
          out.push(...tupletTags)
          if (stops) out.push('          <slur type="stop" number="1"/>')
          if (starts) out.push('          <slur type="start" number="1"/>')
          if (n.staccato || n.accent) {
            out.push('          <articulations>')
            if (n.staccato) out.push('            <staccato/>')
            if (n.accent) out.push('            <accent/>')
            out.push('          </articulations>')
          }
          out.push('        </notations>')
        }
      }
      out.push('      </note>')
    })
    out.push('    </measure>')
  })
  out.push('  </part>')
  out.push('</score-partwise>')
  return out.join('\n')
}
