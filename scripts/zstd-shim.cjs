/**
 * Solo para los tests: jsdom 31 trae undici 8, que al cargarse usa zlib.createZstdDecompress (Node ≥ 22.15).
 * En un Node más antiguo esa función no existe y los tests con jsdom ni siquiera arrancan. Los tests no
 * descomprimen nada con zstd, así que basta con que exista.
 */
const zlib = require('node:zlib')
if (typeof zlib.createZstdDecompress !== 'function') {
  zlib.createZstdDecompress = () => {
    throw new Error('zstd no está disponible en esta versión de Node')
  }
}
