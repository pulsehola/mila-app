import type { Score } from '../types'
import { DUR_UNITS, effectiveAccidental, letterOf, octaveOf } from '../state/music'

const TYPE: Record<string, string> = { w: 'whole', h: 'half', q: 'quarter', '8': 'eighth' }
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
  score.measures.forEach((m, mi) => {
    out.push(`    <measure number="${mi + 1}">`)
    if (mi === 0) {
      out.push('      <attributes>')
      out.push('        <divisions>4</divisions>')
      out.push('        <key><fifths>0</fifths></key>')
      out.push('        <time><beats>4</beats><beat-type>4</beat-type></time>')
      out.push('        <clef><sign>G</sign><line>2</line></clef>')
      if (bb) out.push('        <transpose><diatonic>-1</diatonic><chromatic>-2</chromatic></transpose>')
      out.push('      </attributes>')
      out.push(`      <direction placement="above"><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>${score.bpm}</per-minute></metronome></direction-type><sound tempo="${score.bpm}"/></direction>`)
    }
    if (m.length === 0) {
      out.push('      <note><rest measure="yes"/><duration>16</duration></note>')
    }
    m.forEach((n, i) => {
      const next = m[i + 1]
      out.push('      <note>')
      if (n.kind === 'rest') {
        out.push('        <rest/>')
      } else {
        const eff = effectiveAccidental(m, i)
        const alter = eff === '#' ? 1 : eff === 'b' ? -1 : 0
        out.push('        <pitch>')
        out.push(`          <step>${letterOf(n.step).toUpperCase()}</step>`)
        if (alter !== 0) out.push(`          <alter>${alter}</alter>`)
        out.push(`          <octave>${octaveOf(n.step)}</octave>`)
        out.push('        </pitch>')
      }
      out.push(`        <duration>${DUR_UNITS[n.dur]}</duration>`)
      out.push(`        <type>${TYPE[n.dur]}</type>`)
      if (n.kind === 'note') {
        if (n.acc === '#') out.push('        <accidental>sharp</accidental>')
        if (n.acc === 'b') out.push('        <accidental>flat</accidental>')
        if (n.acc === 'n') out.push('        <accidental>natural</accidental>')
        const starts = n.slur && next?.kind === 'note'
        const stops = i > 0 && m[i - 1].kind === 'note' && m[i - 1].slur
        if (n.staccato || n.accent || starts || stops) {
          out.push('        <notations>')
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
