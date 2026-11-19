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

## Modo práctica

Botón **práctica** (birrete) en la barra de abajo:

- **Velocidad 40–100 %.** Solo cambia el tempo (♩ = tempo escrito × velocidad). Cada nota se sintetiza a su
  frecuencia, así que la afinación no cambia. Medido con el audio real del motor: las 16 notas de «Fanfarria»
  suenan a la altura esperada (±2 cents) tanto al 100 % como al 40 %.
- **Bucle A–B y repetir un compás.** A y B usan el compás que suena o el de la nota seleccionada. También se
  puede elegir tocando los números de compás con el bucle activado.
- **Cursor continuo** (`notation/playhead.ts`): en cada fotograma lee del motor la posición que se oye (descontando
  el lookAhead de Tone y la latencia de salida) y la interpola entre las cabezas de nota.
- **Melodía / acompañamiento** por separado. El acompañamiento (`state/practice.ts`) elige un acorde diatónico
  (I ii iii IV V vi) por medio compás según las notas de la melodía y la armadura, en altura real, y lo toca como
  bajo + acorde con un piano sintetizado.

## Estructura

```
src/
  components/    UI (ScoreCanvas = lienzo + gestos, TopBar, TransportBar, Tuner, ExportModal…)
  recognition/   geometría de trazos, clasificador heurístico, tachado
  notation/      renderizado VexFlow + mapa de posiciones de notas/compases
  audio/         motor Tone.js (trompeta, metrónomo, bucle) y detector de altura YIN
  export/        PDF (jsPDF), MIDI, MusicXML, Web Share
  state/         modelo musical, ejemplos, historial + autoguardado, práctica (acompañamiento, línea de tiempo)
```
