import type { Score } from '../types'
import { scoreToMidi } from './midi'
import { scoreToMusicXML } from './musicxml'
import { scoreToPdf } from './pdf'

export type ExportFormat = 'pdf' | 'midi' | 'xml'

export const FORMAT_INFO: Record<ExportFormat, { label: string; ext: string; mime: string; hint: string }> = {
  pdf: { label: 'PDF', ext: 'pdf', mime: 'application/pdf', hint: 'Partitura limpia para imprimir o enviar' },
  midi: { label: 'MIDI', ext: 'mid', mime: 'audio/midi', hint: 'Suena en cualquier DAW o app de música' },
  xml: { label: 'MusicXML', ext: 'musicxml', mime: 'application/vnd.recordare.musicxml+xml', hint: 'Para MuseScore, Finale, Sibelius' },
}

export function fileNameFor(score: Score, fmt: ExportFormat): string {
  const base =
    (score.title || 'partitura')
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-zA-Z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .toLowerCase() || 'partitura'
  return `mila-${base}.${FORMAT_INFO[fmt].ext}`
}

export async function buildBlob(score: Score, fmt: ExportFormat): Promise<Blob> {
  if (fmt === 'pdf') return scoreToPdf(score)
  if (fmt === 'midi') return new Blob([scoreToMidi(score) as BlobPart], { type: FORMAT_INFO.midi.mime })
  return new Blob([scoreToMusicXML(score)], { type: FORMAT_INFO.xml.mime })
}

export function downloadBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 4000)
}

export async function downloadScore(score: Score, fmt: ExportFormat): Promise<void> {
  downloadBlob(await buildBlob(score, fmt), fileNameFor(score, fmt))
}

export function canNativeShare(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.share === 'function'
}

export type ShareResult = 'shared' | 'cancelled' | 'downloaded'

/** Hoja nativa de compartir (AirDrop, WhatsApp, Mensajes...). Si no hay soporte, descarga el archivo. */
export async function shareScore(score: Score, fmt: ExportFormat): Promise<ShareResult> {
  const blob = await buildBlob(score, fmt)
  const name = fileNameFor(score, fmt)
  const file = new File([blob], name, { type: FORMAT_INFO[fmt].mime })
  try {
    if (canNativeShare() && navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title: score.title || 'Partitura MILA' })
      return 'shared'
    }
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') return 'cancelled'
  }
  downloadBlob(blob, name)
  return 'downloaded'
}
