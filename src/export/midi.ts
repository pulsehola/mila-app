import type { Score } from '../types'
import { buildEvents, clampKey } from '../state/music'

const PPQ = 480
const UNIT_TICKS = PPQ / 4

function vlq(value: number): number[] {
  let v = Math.max(0, Math.round(value))
  const bytes = [v & 0x7f]
  while ((v >>= 7) > 0) bytes.unshift((v & 0x7f) | 0x80)
  return bytes
}
const u32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]
const u16 = (n: number) => [(n >>> 8) & 255, n & 255]
const ascii = (s: string) => Array.from(s).map((c) => c.charCodeAt(0) & 0x7f)

/** MIDI formato 0 con la altura sonora (respeta la transposición elegida). */
export function scoreToMidi(score: Score): Uint8Array {
  const meter = score.meter ?? '4/4'
  const { events } = buildEvents(score.measures, score.transposition, null, meter, clampKey(score.key))
  const track: number[] = []

  const usPerQuarter = Math.round(60_000_000 / score.bpm)
  track.push(0x00, 0xff, 0x51, 0x03, (usPerQuarter >> 16) & 255, (usPerQuarter >> 8) & 255, usPerQuarter & 255)
  const [num, den] = meter.split('/').map(Number)
  // Compás: numerador, denominador como potencia de 2 (4 → 2, 8 → 3).
  track.push(0x00, 0xff, 0x58, 0x04, num, Math.log2(den), den === 8 ? 36 : 24, 8)
  const name = ascii(score.title || 'MILA')
  track.push(0x00, 0xff, 0x03, ...vlq(name.length), ...name)
  // Programa según el sonido elegido: 57 Trumpet o 1 Acoustic Grand Piano.
  track.push(0x00, 0xc0, score.sound === 'piano' ? 0 : 56)

  interface Msg {
    tick: number
    order: number
    bytes: number[]
  }
  const msgs: Msg[] = []
  for (const ev of events) {
    if (ev.midi === null) continue
    const start = Math.round(ev.startUnits * UNIT_TICKS)
    const len = ev.durUnits * UNIT_TICKS * (ev.staccato ? 0.45 : ev.slurToNext ? 1 : 0.94)
    // Intensidad según el matiz vigente (pp … ff) y el acento.
    const vel = Math.max(1, Math.min(127, Math.round(ev.velocity * 122)))
    msgs.push({ tick: start, order: 1, bytes: [0x90, ev.midi & 127, vel] })
    msgs.push({ tick: Math.round(start + len), order: 0, bytes: [0x80, ev.midi & 127, 0] })
  }
  msgs.sort((a, b) => a.tick - b.tick || a.order - b.order)
  let last = 0
  for (const m of msgs) {
    track.push(...vlq(m.tick - last), ...m.bytes)
    last = m.tick
  }
  track.push(0x00, 0xff, 0x2f, 0x00)

  return new Uint8Array([
    ...ascii('MThd'),
    ...u32(6),
    ...u16(0),
    ...u16(1),
    ...u16(PPQ),
    ...ascii('MTrk'),
    ...u32(track.length),
    ...track,
  ])
}
