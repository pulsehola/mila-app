/**
 * Lector mínimo de .mxl (MusicXML comprimido = un ZIP). Sin dependencias: lee el directorio central del ZIP
 * y descomprime con DecompressionStream('deflate-raw'), que traen Safari 16.4+, Chrome y Node 18+.
 */

const td = new TextDecoder()

export function isZip(bytes: Uint8Array): boolean {
  return bytes.length > 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04
}

interface Entry {
  name: string
  method: number
  size: number
  offset: number
}

function entries(b: Uint8Array): Entry[] {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength)
  // Fin del directorio central: firma 0x06054b50, buscada desde el final (puede haber comentario).
  let eocd = -1
  for (let i = b.length - 22; i >= Math.max(0, b.length - 22 - 65535); i--) {
    if (v.getUint32(i, true) === 0x06054b50) {
      eocd = i
      break
    }
  }
  if (eocd < 0) throw new Error('El archivo .mxl está dañado (no es un ZIP válido).')
  const count = v.getUint16(eocd + 10, true)
  let p = v.getUint32(eocd + 16, true)
  const out: Entry[] = []
  for (let k = 0; k < count && p + 46 <= b.length; k++) {
    if (v.getUint32(p, true) !== 0x02014b50) break
    const method = v.getUint16(p + 10, true)
    const size = v.getUint32(p + 20, true)
    const nameLen = v.getUint16(p + 28, true)
    const extraLen = v.getUint16(p + 30, true)
    const commentLen = v.getUint16(p + 32, true)
    const offset = v.getUint32(p + 42, true)
    out.push({ name: td.decode(b.subarray(p + 46, p + 46 + nameLen)), method, size, offset })
    p += 46 + nameLen + extraLen + commentLen
  }
  return out
}

async function extract(b: Uint8Array, e: Entry): Promise<Uint8Array> {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength)
  if (v.getUint32(e.offset, true) !== 0x04034b50) throw new Error('El archivo .mxl está dañado.')
  const start = e.offset + 30 + v.getUint16(e.offset + 26, true) + v.getUint16(e.offset + 28, true)
  const data = b.subarray(start, start + e.size)
  if (e.method === 0) return data
  if (e.method !== 8) throw new Error('El archivo .mxl usa una compresión que no conozco.')
  const ds = new Response(data as BodyInit).body!.pipeThrough(new DecompressionStream('deflate-raw'))
  return new Uint8Array(await new Response(ds).arrayBuffer())
}

/** Texto del MusicXML principal de un .mxl (el que indica META-INF/container.xml, o el primero que haya). */
export async function unzipMusicXml(bytes: Uint8Array): Promise<string> {
  const list = entries(bytes)
  let target: Entry | undefined
  const container = list.find((e) => e.name === 'META-INF/container.xml')
  if (container) {
    const xml = td.decode(await extract(bytes, container))
    const path = /full-path\s*=\s*"([^"]+)"/.exec(xml)?.[1]
    target = list.find((e) => e.name === path)
  }
  target ??= list.find((e) => !e.name.startsWith('META-INF/') && /\.(musicxml|xml)$/i.test(e.name))
  if (!target) throw new Error('El archivo .mxl no contiene ninguna partitura MusicXML.')
  return decodeText(await extract(bytes, target))
}

/** UTF-8 por defecto; UTF-16 si trae la marca (algunos programas antiguos lo exportan así). */
export function decodeText(b: Uint8Array): string {
  if (b[0] === 0xff && b[1] === 0xfe) return new TextDecoder('utf-16le').decode(b)
  if (b[0] === 0xfe && b[1] === 0xff) return new TextDecoder('utf-16be').decode(b)
  return td.decode(b)
}
