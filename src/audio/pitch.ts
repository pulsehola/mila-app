import { midiName, midiOctave } from '../state/music'

/**
 * Detección de altura con YIN (de Cheveigné & Kawahara, 2002).
 * Devuelve la frecuencia fundamental en Hz o null si la señal es débil/ruidosa.
 */
export function detectPitch(buf: Float32Array, sampleRate: number, threshold = 0.12): number | null {
  const size = buf.length
  let rms = 0
  for (let i = 0; i < size; i++) rms += buf[i] * buf[i]
  rms = Math.sqrt(rms / size)
  if (rms < 0.008) return null

  const half = Math.floor(size / 2)
  const minTau = Math.floor(sampleRate / 1200)
  const maxTau = Math.min(half - 1, Math.floor(sampleRate / 70))
  const limit = Math.min(half, maxTau + 2)
  const diff = new Float32Array(half)
  for (let tau = 1; tau < limit; tau++) {
    let sum = 0
    for (let i = 0; i < half; i++) {
      const d = buf[i] - buf[i + tau]
      sum += d * d
    }
    diff[tau] = sum
  }
  // Diferencia normalizada acumulada media
  const cmnd = new Float32Array(half)
  cmnd[0] = 1
  let running = 0
  for (let tau = 1; tau < limit; tau++) {
    running += diff[tau]
    cmnd[tau] = running === 0 ? 1 : (diff[tau] * tau) / running
  }
  let tauEstimate = -1
  for (let tau = Math.max(2, minTau); tau < maxTau; tau++) {
    if (cmnd[tau] < threshold) {
      while (tau + 1 < maxTau && cmnd[tau + 1] < cmnd[tau]) tau++
      tauEstimate = tau
      break
    }
  }
  if (tauEstimate === -1) return null
  // Interpolación parabólica
  const x0 = tauEstimate > 1 ? tauEstimate - 1 : tauEstimate
  const x2 = tauEstimate + 1 < half ? tauEstimate + 1 : tauEstimate
  let better = tauEstimate
  if (x0 !== tauEstimate && x2 !== tauEstimate) {
    const s0 = cmnd[x0]
    const s1 = cmnd[tauEstimate]
    const s2 = cmnd[x2]
    const denom = 2 * (2 * s1 - s2 - s0)
    if (denom !== 0) better = tauEstimate + (s2 - s0) / denom
  }
  return sampleRate / better
}

export interface TunerReading {
  freq: number
  /** MIDI sonoro más cercano (altura real). */
  midi: number
  cents: number
}

export function readingFromFreq(freq: number, a4 = 440): TunerReading {
  const exact = 69 + 12 * Math.log2(freq / a4)
  const midi = Math.round(exact)
  return { freq, midi, cents: Math.round((exact - midi) * 100) }
}

export function noteLabel(midi: number): string {
  return `${midiName(midi)}${midiOctave(midi)}`
}
