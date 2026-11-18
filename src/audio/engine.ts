import * as Tone from 'tone'
import { DEFAULT_METER, meterParts, midiToFreq, type PlayEvent } from '../state/music'
import type { Meter } from '../types'

const PPQ = 192 // ticks por negra en Tone.Transport
const TICKS_PER_UNIT = PPQ / 4 // 1 unidad = semicorchea

export interface PlayOptions {
  events: PlayEvent[]
  totalUnits: number
  loop: boolean
  /** Compás (relativo al inicio de los eventos) en el que arrancan los eventos; usado para cursor/bucle. */
  bpm: number
}

type Listener<T> = ((v: T) => void) | null

/**
 * Motor de audio: sintetizador de viento-metal (MonoSynth con filtro que "abre" al atacar),
 * metrónomo y transporte de Tone.js. Un único Transport para partitura + click.
 */
export class AudioEngine {
  private ready = false
  private synth!: Tone.MonoSynth
  private click!: Tone.MembraneSynth
  private vibrato!: Tone.LFO
  private reverb!: Tone.Reverb
  private metronomeOn = false
  private scoreActive = false
  private beatCounter = 0
  private meter: Meter = DEFAULT_METER

  onCursor: Listener<{ noteId: string; measure: number; index: number } | null> = null
  onBeat: Listener<number> = null
  onStop: Listener<void> = null

  /** Debe llamarse desde un gesto del usuario (política de autoplay de iOS/Safari). */
  async init(): Promise<void> {
    if (this.ready) {
      if (Tone.getContext().state !== 'running') await Tone.start()
      return
    }
    // Safari 16.4+: reproducir como "media" para que el interruptor de silencio del iPad no mute el audio.
    const nav = navigator as Navigator & { audioSession?: { type: string } }
    if (nav.audioSession) {
      try {
        nav.audioSession.type = 'playback'
      } catch {
        /* no soportado */
      }
    }
    await Tone.start()
    this.reverb = new Tone.Reverb({ decay: 1.6, wet: 0.16 })
    await this.reverb.ready
    const limiter = new Tone.Limiter(-3).toDestination()
    this.reverb.connect(limiter)

    this.synth = new Tone.MonoSynth({
      oscillator: { type: 'sawtooth' },
      envelope: { attack: 0.035, decay: 0.12, sustain: 0.82, release: 0.14 },
      filter: { type: 'lowpass', Q: 1.4, rolloff: -24 },
      filterEnvelope: {
        attack: 0.07,
        decay: 0.22,
        sustain: 0.55,
        release: 0.25,
        baseFrequency: 380,
        octaves: 3.2,
      },
      volume: -8,
    }).connect(this.reverb)

    // Vibrato muy sutil, característico de una nota sostenida de trompeta.
    this.vibrato = new Tone.LFO({ frequency: 5.2, min: -6, max: 6 }).start()
    this.vibrato.connect(this.synth.detune)

    this.click = new Tone.MembraneSynth({
      pitchDecay: 0.008,
      octaves: 2,
      envelope: { attack: 0.001, decay: 0.07, sustain: 0, release: 0.02 },
      volume: -10,
    }).connect(limiter)

    Tone.getTransport().PPQ = PPQ
    this.ready = true
  }

  /** Previsualización instantánea (al reconocer o arrastrar una nota). */
  async preview(midi: number, ms = 280): Promise<void> {
    await this.init()
    const now = Tone.now()
    this.synth.triggerAttackRelease(midiToFreq(midi), ms / 1000, now + 0.005, 0.8)
  }

  setBpm(bpm: number): void {
    if (!this.ready) return
    Tone.getTransport().bpm.rampTo(bpm, 0.05)
  }

  /** Métrica para el metrónomo: en x/4 marca negras; en 6/8, corcheas (acento en 1 y en 4). */
  setMeter(meter: Meter): void {
    this.meter = meter
  }

  private get beatNote(): '4n' | '8n' {
    return meterParts(this.meter).beatType === 8 ? '8n' : '4n'
  }

  setMetronome(on: boolean): void {
    this.metronomeOn = on
  }

  get isPlaying(): boolean {
    return this.scoreActive
  }

  /** Arranca solo el metrónomo (sin partitura). */
  async startMetronomeOnly(bpm: number): Promise<void> {
    await this.init()
    this.stop(false)
    const tr = Tone.getTransport()
    tr.bpm.value = bpm
    this.beatCounter = 0
    tr.scheduleRepeat((time) => this.tickBeat(time), this.beatNote, 0)
    tr.start('+0.05')
  }

  async play(opts: PlayOptions): Promise<void> {
    await this.init()
    this.stop(false)
    const tr = Tone.getTransport()
    tr.bpm.value = opts.bpm
    tr.position = 0
    this.beatCounter = 0
    this.scoreActive = true

    const bpmNow = () => tr.bpm.value
    for (const ev of opts.events) {
      if (ev.midi === null) continue
      const ticks = ev.startUnits * TICKS_PER_UNIT
      tr.schedule((time) => {
        const secPerUnit = 60 / bpmNow() / 4
        let dur = ev.durUnits * secPerUnit
        if (ev.staccato) dur *= 0.4
        else if (ev.slurToNext) dur *= 1.0
        else dur *= 0.93
        const vel = ev.accent ? 1 : 0.72
        this.synth.triggerAttackRelease(midiToFreq(ev.midi!), dur, time, vel)
        Tone.getDraw().schedule(() => this.onCursor?.({ noteId: ev.noteId, measure: ev.measure, index: ev.index }), time)
      }, `${ticks}i`)
    }

    tr.scheduleRepeat((time) => this.tickBeat(time), this.beatNote, 0)

    const endTicks = opts.totalUnits * TICKS_PER_UNIT
    if (opts.loop) {
      tr.loop = true
      tr.loopStart = 0
      tr.loopEnd = `${endTicks}i`
    } else {
      tr.loop = false
      tr.schedule((time) => {
        Tone.getDraw().schedule(() => {
          this.stop(true)
        }, time + 0.15)
      }, `${endTicks}i`)
    }
    tr.start('+0.06')
  }

  private tickBeat(time: number): void {
    const { beats: beatsPerBar } = meterParts(this.meter)
    const beatInBar = this.beatCounter % beatsPerBar
    this.beatCounter += 1
    if (this.metronomeOn) {
      // 6/8: dos tiempos de tres corcheas; la 4ª corchea lleva un acento secundario.
      const strong = beatInBar === 0
      const second = this.meter === '6/8' && beatInBar === 3
      this.click.triggerAttackRelease(strong ? 'A5' : second ? 'C#5' : 'E5', '32n', time, strong ? 1 : second ? 0.8 : 0.6)
    }
    const idx = this.beatCounter - 1
    Tone.getDraw().schedule(() => this.onBeat?.(idx), time)
  }

  stop(notify = true): void {
    if (!this.ready) return
    const tr = Tone.getTransport()
    const wasActive = this.scoreActive
    tr.stop()
    tr.cancel(0)
    tr.loop = false
    this.synth.triggerRelease()
    this.scoreActive = false
    this.onCursor?.(null)
    if (notify && wasActive) this.onStop?.()
  }

  get metronomeEnabled(): boolean {
    return this.metronomeOn
  }

  dispose(): void {
    if (!this.ready) return
    this.stop(false)
    this.synth.dispose()
    this.click.dispose()
    this.vibrato.dispose()
    this.reverb.dispose()
    this.ready = false
  }
}

export const engine = new AudioEngine()

/** Tap tempo: promedia los últimos intervalos; reinicia si pasan >2.5 s entre toques. */
export function createTapTempo() {
  let taps: number[] = []
  return (now = performance.now()): number | null => {
    if (taps.length && now - taps[taps.length - 1] > 2500) taps = []
    taps.push(now)
    if (taps.length > 6) taps.shift()
    if (taps.length < 2) return null
    const intervals: number[] = []
    for (let i = 1; i < taps.length; i++) intervals.push(taps[i] - taps[i - 1])
    const avg = intervals.reduce((a, b) => a + b, 0) / intervals.length
    return Math.max(30, Math.min(240, Math.round(60000 / avg)))
  }
}
