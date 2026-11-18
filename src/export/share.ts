import type { Score } from '../types'
import { scoreToMidi } from './midi'
import { scoreToMusicXML } from './musicxml'
import { scoreToPdf, scoreToPng } from './pdf'

export type ExportFormat = 'pdf' | 'png' | 'midi' | 'xml'

export const FORMAT_INFO: Record<ExportFormat, { label: string; ext: string; mime: string; hint: string }> = {
  pdf: { label: 'PDF', ext: 'pdf', mime: 'application/pdf', hint: 'Partitura limpia para imprimir o enviar' },
  png: { label: 'Imagen', ext: 'png', mime: 'image/png', hint: 'Imagen nítida, se ve al instante en WhatsApp' },
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
  if (fmt === 'png') return scoreToPng(score)
  if (fmt === 'midi') return new Blob([scoreToMidi(score) as BlobPart], { type: FORMAT_INFO.midi.mime })
  return new Blob([scoreToMusicXML(score)], { type: FORMAT_INFO.xml.mime })
}

export async function buildFile(score: Score, fmt: ExportFormat): Promise<File> {
  const blob = await buildBlob(score, fmt)
  return new File([blob], fileNameFor(score, fmt), { type: FORMAT_INFO[fmt].mime })
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

export function canShareFile(file: File): boolean {
  return canNativeShare() && !!navigator.canShare?.({ files: [file] })
}

/** 'blocked': Safari exige que compartir ocurra justo tras el toque; el archivo ya está listo para reintentar. */
export type ShareResult = 'shared' | 'cancelled' | 'downloaded' | 'blocked'

/**
 * Abre la hoja de compartir con un archivo ya generado. `navigator.share` se llama sin ningún `await` previo
 * para conservar el gesto del usuario (requisito de Safari en iPad). Sin soporte, descarga el archivo.
 */
export async function shareFile(file: File, title: string): Promise<ShareResult> {
  if (canShareFile(file)) {
    try {
      await navigator.share({ files: [file], title })
      return 'shared'
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return 'cancelled'
      if (e instanceof DOMException && e.name === 'NotAllowedError') return 'blocked'
    }
  }
  downloadBlob(file, file.name)
  return 'downloaded'
}

export type SaveResult = 'saved' | ShareResult

interface SavePickerWindow {
  showSaveFilePicker?: (opts: {
    suggestedName: string
    types?: { description: string; accept: Record<string, string[]> }[]
  }) => Promise<{ createWritable: () => Promise<{ write: (b: Blob) => Promise<void>; close: () => Promise<void> }> }>
}

/**
 * «Guardar en…»: la persona elige dónde queda el archivo.
 *  - Compu (Chrome/Edge): ventana de guardar del sistema, con carpeta y nombre a elegir.
 *  - iPad / iPhone / Android: hoja de compartir → «Guardar en Archivos» (iCloud Drive, En mi iPad, Drive…).
 *  - Sin nada de eso: descarga (el navegador pregunta dónde, si está así configurado).
 * La ventana de guardar se abre ANTES de preparar el archivo para no perder el toque (lo exige el navegador).
 */
export async function saveFileAs(suggestedName: string, build: () => Promise<File>, title: string): Promise<SaveResult> {
  const picker = (window as unknown as SavePickerWindow).showSaveFilePicker
  if (typeof picker === 'function') {
    let handle = null
    try {
      handle = await picker.call(window, {
        suggestedName,
        types: [{ description: 'Partitura de MILA', accept: { 'application/json': ['.json'] } }],
      })
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return 'cancelled'
    }
    if (handle) {
      const file = await build()
      const w = await handle.createWritable()
      await w.write(file)
      await w.close()
      return 'saved'
    }
  }
  return shareFile(await build(), title)
}

/** Hoja nativa de compartir (AirDrop, WhatsApp, Mensajes...). Si no hay soporte, descarga el archivo. */
export async function shareScore(score: Score, fmt: ExportFormat): Promise<ShareResult> {
  return shareFile(await buildFile(score, fmt), score.title || 'Partitura MILA')
}
