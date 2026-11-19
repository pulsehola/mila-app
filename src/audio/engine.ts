import * as Tone from 'tone'
import { DEFAULT_METER, meterParts, midiToFreq, type PlayEvent } from '../state/music'
import { clampSpeed, practiceBpm, type AccompEvent } from '../state/practice'
import type { Meter, Sound } from '../types'

const PPQ = 192 // ticks por negra en Tone.Transport
const TICKS_PER_UNIT = PPQ / 4 // 1 unidad = semicorchea
/** Golpes de rejilla por pulso (múltiplo de 2, 3 y 4). */
const SUB_GRID = 12
export type Subdivision = 1 | 2 | 3 | 4

export interface PlayOptions {
  events: PlayEvent[]
  totalUnits: number
  loop: boolean
  /** Tempo escrito en la partitura (♩ = bpm). La velocidad de práctica se aplica aparte. */
  bpm: number
  /** Acompañamiento automático (alturas de concierto). */
  accompaniment?: AccompEvent[]
}

/** Qué se oye: la melodía (lo escrito) y el acompañamiento, cada uno se puede silenciar. */
export interface Mix {
  melody: boolean
  accomp: boolean
}

type Listener<T> = ((v: T) => void) | null

/**
 * Motor de audio: sintetizador de viento-metal (MonoSynth con filtro que "abre" al atacar),
 * metrónomo y transporte de Tone.js. Un único Transport para partitura + click.
 */
export class AudioEngine {
  private ready = false
  private synth!: Tone.MonoSynth
  /** Piano sintetizado (FM con caída natural, sin muestras: funciona sin conexión). */
  private piano!: Tone.PolySynth<Tone.FMSynth>
  private sound: Sound = 'trumpet'
  private click!: Tone.MembraneSynth
  private vibrato!: Tone.LFO
  private reverb!: Tone.Reverb
  /** Canales: melodía y acompañamiento, con su propio volumen y silencio. */
  private melodyBus!: Tone.Volume
  private accompBus!: Tone.Volume
  private accompPiano!: Tone.PolySynth<Tone.FMSynth>
  private limiter!: Tone.Limiter
  private mix: Mix = { melody: true, accomp: false }
  /** Tempo escrito y velocidad de práctica (0,4–1). El tono de cada nota no depende de ninguno de los dos. */
  private baseBpm = 90
  private speed = 1
  /** Momento (tiempo del AudioContext) en que empezó a sonar la partitura actual. */
  private startAt = Infinity
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
    this.limiter = limiter
    this.reverb.connect(limiter)
    this.melodyBus = new Tone.Volume(0).connect(this.reverb)
    this.accompBus = new Tone.Volume(0).connect(this.reverb)

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
    }).connect(this.melodyBus)

    // Vibrato muy sutil, característico de una nota sostenida de trompeta.
    this.piano = new Tone.PolySynth(Tone.FMSynth, {
      harmonicity: 3,
      modulationIndex: 6,
      oscillator: { type: 'sine' },
      envelope: { attack: 0.004, decay: 1.4, sustain: 0.06, release: 0.9 },
      modulation: { type: 'sine' },
      modulationEnvelope: { attack: 0.002, decay: 0.5, sustain: 0.1, release: 0.6 },
      volume: -9,
    }).connect(this.melodyBus)

    // Piano del acompañamiento: más suave y sin brillo, para que la melodía quede delante.
    this.accompPiano = new Tone.PolySynth(Tone.FMSynth, {
      harmonicity: 2,
      modulationIndex: 3,
      oscillator: { type: 'sine' },
      envelope: { attack: 0.006, decay: 1.1, sustain: 0.12, release: 0.7 },
      modulation: { type: 'sine' },
      modulationEnvelope: { attack: 0.002, decay: 0.4, sustain: 0.08, release: 0.5 },
    }).connect(this.accompBus)
    this.accompPiano.maxPolyphony = 16
    // El volumen va en el PolySynth (en las opciones de voz no se aplica).
    this.accompPiano.volume.value = 1
    this.applyMix()

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
    this.voice(midiToFreq(midi), ms / 1000, now + 0.005, 0.8)
  }

  /** Trompeta o piano (ambos sintetizados). */
  setSound(sound: Sound): void {
    if (this.ready && sound !== this.sound) this.synth.triggerRelease()
    this.sound = sound
  }

  private voice(freq: number, dur: number, time: number, vel: number): void {
    if (this.sound === 'piano') this.piano.triggerAttackRelease(freq, Math.max(dur, 0.25), time, vel)
    else this.synth.triggerAttackRelease(freq, dur, time, vel)
  }

  /** Tempo escrito. Lo que suena es tempo × velocidad de práctica. */
  setBpm(bpm: number): void {
    this.baseBpm = bpm
    this.applyTempo()
  }

  /**
   * Velocidad de práctica (40 %–100 %). Solo cambia CUÁNDO empieza y cuánto dura cada nota: la frecuencia de
   * cada nota se calcula de su altura (midiToFreq), así que la afinación no cambia al ir más lento.
   */
  setSpeed(speed: number): void {
    this.speed = clampSpeed(speed)
    this.applyTempo()
  }

  get currentSpeed(): number {
    return this.speed
  }

  private applyTempo(): void {
    if (!this.ready) return
    Tone.getTransport().bpm.rampTo(practiceBpm(this.baseBpm, this.speed), 0.05)
  }

  setMix(mix: Mix): void {
    this.mix = { ...mix }
    this.applyMix()
  }

  private applyMix(): void {
    if (!this.ready) return
    this.melodyBus.mute = !this.mix.melody
    this.accompBus.mute = !this.mix.accomp
  }

  /**
   * Posición de lo que SE OYE ahora mismo, en semicorcheas desde el inicio de lo que suena. Tone programa por
   * delante (lookAhead) y el altavoz añade latencia: se resta para que el cursor vaya con el audio, no antes.
   */
  get positionUnits(): number | null {
    if (!this.ready || !this.scoreActive) return null
    const ctx = Tone.getContext()
    const raw = ctx.rawContext as AudioContext
    const latency = (raw.outputLatency || 0) + (raw.baseLatency || 0)
    const tr = Tone.getTransport()
    const heard = ctx.currentTime - latency
    // Antes de que empiece a sonar, el Transport aún recuerda la reproducción anterior: no hay posición.
    if (heard < this.startAt) return null
    const ticks = tr.getTicksAtTime(heard)
    if (!(ticks >= 0)) return 0
    let u = ticks / TICKS_PER_UNIT
    if (tr.loop) {
      const ls = Tone.Time(tr.loopStart).toTicks() / TICKS_PER_UNIT
      const le = Tone.Time(tr.loopEnd).toTicks() / TICKS_PER_UNIT
      if (le > ls && u >= le) u = ls + ((u - ls) % (le - ls))
    }
    return u
  }

  /** Salida final (para grabar y medir el audio real en las pruebas). */
  get output(): Tone.ToneAudioNode | null {
    return this.ready ? this.limiter : null
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

  /** Subdivisión del metrónomo: 1 = solo pulsos, 2 = corcheas, 3 = tresillos, 4 = semicorcheas. */
  private subdivision: Subdivision = 1
  setSubdivision(n: Subdivision): void {
    // Se lee en cada golpe: el cambio se oye al momento, sin reiniciar.
    this.subdivision = n
  }

  /**
   * Pulsos + subdivisiones: una rejilla de 12 golpes por pulso (sirve para 2, 3 y 4); en el golpe 0 suena el
   * pulso normal y en los de la subdivisión elegida, un clic más suave.
   */
  private scheduleClicks(tr: ReturnType<typeof Tone.getTransport>): void {
    const beatTicks = this.beatNote === '8n' ? PPQ / 2 : PPQ
    let k = 0
    tr.scheduleRepeat(
      (time) => {
        const pos = k % SUB_GRID
        k += 1
        if (pos === 0) return this.tickBeat(time)
        const n = this.subdivision
        if (this.metronomeOn && n > 1 && pos % (SUB_GRID / n) === 0) {
          this.click.triggerAttackRelease('B4', '64n', time, 0.28)
        }
      },
      `${beatTicks / SUB_GRID}i`,
      0,
    )
  }

  get isPlaying(): boolean {
    return this.scoreActive
  }

  /** Arranca solo el metrónomo (sin partitura). */
  async startMetronomeOnly(bpm: number): Promise<void> {
    await this.init()
    this.stop(false)
    const tr = Tone.getTransport()
    this.baseBpm = bpm
    tr.bpm.value = practiceBpm(bpm, this.speed)
    this.beatCounter = 0
    this.scheduleClicks(tr)
    tr.start('+0.05')
  }

  async play(opts: PlayOptions): Promise<void> {
    await this.init()
    this.stop(false)
    const tr = Tone.getTransport()
    this.baseBpm = opts.bpm
    tr.bpm.value = practiceBpm(opts.bpm, this.speed)
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
        this.voice(midiToFreq(ev.midi!), dur, time, ev.velocity)
        Tone.getDraw().schedule(() => this.onCursor?.({ noteId: ev.noteId, measure: ev.measure, index: ev.index }), time)
      }, `${ticks}i`)
    }

    for (const ev of opts.accompaniment ?? []) {
      tr.schedule((time) => {
        const secPerUnit = 60 / bpmNow() / 4
        const dur = Math.max(0.12, ev.durUnits * secPerUnit * 0.9)
        const vel = ev.midis.length === 1 ? 0.75 : 0.5
        // Ojo: no pasar midiToFreq directo a map (el índice entraría como «La4 = 0 Hz»).
        this.accompPiano.triggerAttackRelease(ev.midis.map((m) => midiToFreq(m)), dur, time, vel)
      }, `${ev.startUnits * TICKS_PER_UNIT}i`)
    }

    this.scheduleClicks(tr)

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
    this.startAt = Tone.now() + 0.06
    tr.start(this.startAt)
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
    this.piano?.releaseAll()
    this.accompPiano?.releaseAll()
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
    this.piano.dispose()
    this.accompPiano.dispose()
    this.melodyBus.dispose()
    this.accompBus.dispose()
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
