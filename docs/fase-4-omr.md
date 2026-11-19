# Fase 4 — Investigación: reconocer partituras escaneadas sin servidor propio

Fecha: 19/11/2026. **Solo investigación: no se integró ningún servicio ni se generó ningún coste.**
Los precios y límites son los publicados por cada proveedor a la fecha. No probé la calidad de cada
motor con partituras de MILA. Las cifras de calidad son de benchmarks publicados.

## Punto de partida

- MILA ya tiene un OMR propio (`src/scan/omr.ts`). Es heurístico, corre en el navegador y no cuesta nada.
  Reconoce pentagramas, barras, cabezas de nota, plicas y corchetes de una parte de trompeta simple en
  clave de Sol. **No reconoce** silencios, alteraciones, puntillos, ligaduras ni armaduras: saca un borrador
  que hay que corregir a mano.
- **MILA todavía no importa MusicXML.** Cualquier motor externo (Audiveris, homr, Flat, apps de iPad)
  entrega MusicXML, así que el primer paso, sea cual sea la opción, es un **importador de MusicXML**.
  Es trabajo nuestro, gratis y sin servidor (el navegador ya trae `DOMParser`).
- Vercel y Supabase no sirven para correr un motor OMR:
  - **Supabase Edge Functions**: 256 MB de memoria y 2 s de CPU por petición (otra página oficial dice
    200 ms). Un modelo de reconocimiento no entra.
  - **Vercel Functions (Hobby)**: 2 GB de memoria, hasta 300 s y paquetes de 250 MB (500 MB en Python).
    Sí sirven como *intermediario* para ocultar una clave de API. Correr un modelo ahí está al límite y no
    lo verifiqué. Además, el plan Hobby es solo para uso no comercial.

## Opciones

### 1. Mejorar el OMR propio de MILA (navegador)
- **Tecnología:** TypeScript puro sobre la imagen en escala de grises. Ya está integrado.
- **Coste:** 0 €. Sin límites.
- **Ventajas:** funciona sin conexión, es privado y no depende de nadie. Ya está probado en iPad.
- **Desventajas:** cada símbolo nuevo (silencios, alteraciones, puntillos) es trabajo a mano y frágil
  ante fotos torcidas o con sombras. Nunca va a llegar al nivel de un modelo entrenado.
- **iPad:** sí, ya funciona.
- **Calidad esperable:** baja a media. Sirve para partes simples impresas.
- **Mantenimiento:** nuestro código, sin infraestructura.

### 2. homr corriendo en el navegador (onnxruntime-web)
- **Tecnología:** [homr](https://github.com/liebharc/homr) (segmentación UNet + transformer por
  pentagrama) → MusicXML. Hoy corre en Python con ONNX Runtime. Habría que portar el pre/postproceso a
  TypeScript y cargar los modelos con onnxruntime-web (WebGPU, con WASM de respaldo).
- **Coste:** 0 €. Los modelos se sirven como archivos estáticos desde Vercel o se descargan una vez y
  quedan en caché.
- **Ventajas:** según su propio benchmark es lo mejor que hay gratis. En el *Sheet Music Benchmark*
  marca un OMR-NED de 13,0, contra 38,0 de oemer (menos es mejor). Reconoce alteraciones, silencios,
  puntillos, ligaduras, tresillos y repeticiones. Sin servidor y privado.
- **Desventajas:**
  - **Licencia AGPL-3.0.** Incluirlo obliga a publicar el código de MILA bajo AGPL. Los pesos del modelo
    tienen su propia licencia de datos de entrenamiento (LICENSE_FAQ.md, todavía sin revisar).
  - Portarlo es un proyecto grande, y nadie publicó todavía una versión de homr para navegador.
  - La descarga inicial de los modelos es pesada (tamaño sin confirmar).
- **iPad:** probable pero sin verificar. Safari en iPadOS 26 tiene WebGPU, pero la memoria por pestaña es
  limitada y un modelo grande puede cerrar la pestaña. Hay que medirlo en el iPad real antes de decidir.
- **Calidad esperable:** alta en partituras impresas. No soporta manuscritas.
- **Mantenimiento:** medio. Hay que seguir las versiones de homr y de onnxruntime-web.

### 3. homr u oemer en un Hugging Face Space gratuito
- **Tecnología:** se sube homr a un Space (Python) y MILA le manda la imagen por HTTP.
- **Coste:** 0 € en el plan CPU Basic (2 vCPU, 16 GB). El Space duerme tras 48 h sin uso y la primera
  petición lo despierta, con una espera de minutos.
- **Ventajas:** homr corre tal cual, sin portar nada.
- **Desventajas:**
  - En 2026 hay usuarios que reportan recortes sin aviso del plan CPU gratuito y errores de cuota. No es
    una base fiable.
  - Las imágenes salen del iPad hacia un tercero, y un Space gratuito es público.
  - En la práctica sigue siendo un servidor, aunque lo mantenga otro.
  - Sin GPU, cada página tarda bastante (oemer: 3–5 min por página incluso con GPU).
- **iPad:** sí (es una llamada HTTP).
- **Calidad esperable:** alta (la misma de homr).
- **Mantenimiento:** medio-alto: dependencias de Python, Space dormido y cambios de política de HF.

### 4. Audiveris (escritorio, flujo manual)
- **Tecnología:** [Audiveris](https://audiveris.github.io/audiveris/_pages/handbook) 5.9 (Java, AGPL-3.0).
  Es un programa de escritorio que exporta MusicXML 4.0.
- **Coste:** 0 €.
- **Ventajas:** maduro, muy usado (MuseScore se apoyó en él) y bueno con partituras impresas limpias.
  Usado *a mano* fuera de MILA no impone su licencia a la app.
- **Desventajas:** no corre en el navegador ni en el iPad. Ponerlo en un servidor pide Java + Tesseract
  y no entra en Vercel ni en Supabase. Le cuestan las fotos de móvil.
- **iPad:** no. El flujo sería: compu con Audiveris → MusicXML → importar en MILA.
- **Calidad esperable:** media-alta con PDF o escaneos limpios. Baja con fotos.
- **Mantenimiento:** ninguno para MILA (solo el importador de MusicXML).

### 5. Apps de iPad que exportan MusicXML (flujo manual)
- **Ejemplos:** PlayScore 2 Professional (6,99 US$/mes o 59,99 US$/año en la App Store de EE. UU.; la
  importación de PDF y la exportación a MusicXML requieren ese plan), ScoreInspect (gratis 3 páginas por
  semana; Pro 9,99 US$ con 100 páginas).
- **Ventajas:** reconocimiento bueno desde la cámara del iPad. Se comparte el MusicXML con MILA desde la
  hoja de compartir.
- **Desventajas:** una suscripción **(es de pago: requiere tu aprobación)** y dos apps en vez de una.
- **iPad:** sí, nativo.
- **Calidad esperable:** alta en impresas.
- **Mantenimiento:** ninguno para MILA (solo el importador de MusicXML).

### 6. API de OMR de Flat (servicio de pago)
- **Tecnología:** [API de Flat](https://flat.io/developers/docs/api/omr/). Recibe PDF o foto (JPG, PNG,
  HEIC…) y devuelve MusicXML. La clave tiene que quedar oculta en una función de Vercel que haga de
  intermediario.
- **Coste real:** 1 crédito = 1 página. Paquetes: 30 págs 9,99 US$ (0,33/pág), 300 págs 49,99 US$
  (0,17/pág), 3000 págs 300 US$ (0,10/pág). No encontré créditos gratuitos para la API. Sin créditos
  responde error 402, así que no hay cobros sorpresa.
- **Ventajas:** calidad profesional sin mantener nada. ~30 s por página. Hasta 50 páginas por trabajo.
  No usa los archivos para entrenar.
- **Desventajas:** **de pago (requiere tu aprobación)**. Las imágenes van a un tercero (se guardan 30 días
  por defecto). No soporta manuscritas.
- **iPad:** sí.
- **Calidad esperable:** alta.
- **Mantenimiento:** bajo: una función intermediaria en Vercel y vigilar los créditos.

### 7. Modelos de IA generales con visión (Gemini, GPT, Claude)
- **Coste:** por llamada, según el proveedor **(de pago)**.
- **Calidad:** los estudios de 2025–2026 (LEGATO, LEGATO 2) concluyen que **no compiten** con los modelos
  de OMR especializados. Además, inventan notas con total seguridad, y eso es peligroso para estudiar.
- **Veredicto:** descartado como motor principal.

## Tabla resumen

| Opción | Coste | iPad | Calidad | Esfuerzo | Mantenimiento | Licencia/privacidad |
|---|---|---|---|---|---|---|
| 1. OMR propio | 0 € | Sí | Baja-media | Medio, continuo | Bajo | Sin problemas |
| 2. homr en navegador | 0 € | Probable | Alta | Alto | Medio | AGPL |
| 3. homr en HF Space | 0 € (inestable) | Sí | Alta | Medio | Medio-alto | Imágenes a terceros |
| 4. Audiveris manual | 0 € | No (compu) | Media-alta | Bajo* | Nulo | Sin problemas |
| 5. App de iPad + MusicXML | Suscripción | Sí | Alta | Bajo* | Nulo | Según la app |
| 6. API de Flat | 0,10–0,33 US$/pág | Sí | Alta | Medio | Bajo | Imágenes a terceros |
| 7. IA general | Por llamada | Sí | Baja-media | Medio | Bajo | Imágenes a terceros |

\* Solo hace falta el importador de MusicXML.

## Recomendación

1. **Hacer ya el importador de MusicXML en MILA.** Es gratis, no tiene servidor y sirve para todas las
   opciones. Con eso, el flujo con Audiveris (gratis) o con una app de iPad pasa a funcionar enseguida.
   **Hecho (19/11/2026):** «Mis partituras → Abrir desde Archivos» abre .musicxml, .xml y .mxl (`src/import/`).
2. **Prueba de concepto de homr en el navegador**, midiendo en el iPad real el tiempo, la memoria y el
   tamaño de descarga. **Antes hay que decidir sobre la licencia AGPL**, porque obligaría a publicar el
   código de MILA.
3. **Seguir mejorando el OMR propio** para partes simples (silencios, alteraciones, puntillos) mientras
   tanto. Es lo único que funciona sin conexión hoy.
4. La API de Flat queda como opción de pago si querés la mejor calidad sin mantener nada.
   **No la integro sin tu aprobación.**

## Decisiones que te tocan

- ¿Hago el importador de MusicXML? (gratis)
- ¿Aceptarías publicar MILA bajo AGPL para usar homr? Si no, la opción 2 queda descartada.
- ¿Te interesa explorar alguna opción de pago (Flat, app de iPad)? Nada se contrata sin tu OK.

## Fuentes

- homr: https://github.com/liebharc/homr (README, Benchmark.md, IDEAS_FOR_CONTRIBUTORS.md)
- oemer: https://pypi.org/project/oemer/
- Audiveris: https://audiveris.github.io/audiveris/_pages/reference/updates · https://en.wikipedia.org/wiki/Audiveris
- API de Flat: https://flat.io/developers/docs/api/omr/ · https://flat.io/developers/docs/api/omr/faq/credits
- Comparativa de conversores: https://www.sheetmusicapps.com/guides/pdf-to-musicxml/ · https://scoreinspect.com/
- Hugging Face Spaces: https://huggingface.co/docs/hub/en/spaces-overview · https://discuss.huggingface.co/t/official-community-complaint-revert-free-cpu-basic-spaces-and-remove-anti-developer-sdk-restrictions/177703
- Vercel: https://vercel.com/docs/functions/limitations · https://vercel.com/docs/plans/hobby
- Supabase: https://supabase.com/docs/guides/functions/limits
- IA general vs OMR: https://arxiv.org/html/2506.19065v1 · https://arxiv.org/pdf/2607.05769
- OMR en navegador (ejemplo ONNX): https://huggingface.co/Beyaban/omr-weights
