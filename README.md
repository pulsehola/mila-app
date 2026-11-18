# MILA · Partituras a mano para trompeta

PWA de notación manuscrita para iPad (Apple Pencil) y Mac. Frontend puro: sin backend ni base de datos;
todo se guarda en `localStorage`.

## Arrancar

```bash
npm install
npm run dev -- --host      # https://localhost:5173  y  https://<IP-de-tu-Mac>:5173
```

El servidor de desarrollo usa **HTTPS** (certificado local autofirmado) porque Safari solo permite el
micrófono (afinador) y `navigator.share` en contextos seguros. En el iPad abre la URL de red y acepta el aviso
del certificado una vez. En producción (Vercel, Netlify…) ya es HTTPS.

Para instalarla como app: Safari › Compartir › **Añadir a pantalla de inicio**.

```bash
npm test          # lógica pura: reconocimiento, transposición, MIDI/MusicXML, afinador
npm run build     # tsc + vite build
```

## Cómo se escribe

| Trazo                                   | Resultado               |
| --------------------------------------- | ----------------------- |
| Círculo vacío                           | Redonda                 |
| Círculo + plica                         | Blanca                  |
| Cabeza rellena + plica (o solo un punto)| Negra                   |
| Negra + corchete en la plica            | Corchea                 |
| Zig-zag vertical / «7»                  | Silencio de negra / corchea |
| Barra sobre la línea central / bajo la 2ª línea | Silencio de blanca / redonda |
| Tachar en zig-zag sobre una nota        | Borrar                  |
| Arrastrar una nota arriba/abajo         | Cambiar el tono (suena) |

La altura sale de la cabeza de la nota sobre las líneas y espacios de la Clave de Sol. Tras escribir, la nota
queda seleccionada y la paleta izquierda aplica ♯ ♭ ♮, staccato, acento y ligadura.

- **Palm rejection:** solo `pointerType === 'pen'` y ratón dibujan; los dedos no. Dos dedos = scroll.
  El botón de la mano permite dibujar también con el dedo (útil sin Pencil).
- **Mac:** `Espacio` play/pausa · `⌘Z` / `⇧⌘Z` deshacer/rehacer · `⌫` borra · `↑↓` tono · `←→` navegar ·
  `#` `b` `n` alteraciones · `S` staccato · `A` acento · `L` ligadura.
- **Sib vs Do:** la partitura se guarda tal como está escrita. En *Trompeta Sib* el audio suena una 2ª mayor
  más grave que lo escrito; en *Do (real)* suena lo escrito. El afinador muestra la nota que lees.

## Estructura

```
src/
  components/    UI (ScoreCanvas = lienzo + gestos, TopBar, TransportBar, Tuner, ExportModal…)
  recognition/   geometría de trazos, clasificador heurístico, tachado
  notation/      renderizado VexFlow + mapa de posiciones de notas/compases
  audio/         motor Tone.js (trompeta, metrónomo, bucle) y detector de altura YIN
  export/        PDF (jsPDF), MIDI, MusicXML, Web Share
  state/         modelo musical, ejemplos, historial + autoguardado
```
