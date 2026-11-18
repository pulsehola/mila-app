import type { ReactNode } from 'react'
import { Modal } from './ui'

function Glyph({ children }: { children: ReactNode }) {
  return (
    <svg viewBox="0 0 64 56" width="64" height="56" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
      <line x1="2" y1="28" x2="62" y2="28" strokeWidth="1" opacity=".35" />
      {children}
    </svg>
  )
}

const ITEMS: { name: string; how: string; glyph: ReactNode }[] = [
  { name: 'Redonda', how: 'Círculo vacío, sin plica', glyph: <ellipse cx="32" cy="28" rx="10" ry="7" /> },
  {
    name: 'Blanca',
    how: 'Círculo vacío + plica (la plica la distingue de la redonda)',
    glyph: (
      <>
        <ellipse cx="26" cy="38" rx="9" ry="6.5" />
        <path d="M35 38V8" />
      </>
    ),
  },
  {
    name: 'Negra',
    how: 'Cabeza rellena + plica (o solo un punto relleno)',
    glyph: (
      <>
        <path d="M18 38l16-4M18 41l16-4M19 44l15-4M20 36l12-3" strokeWidth="3" />
        <path d="M35 38V8" />
      </>
    ),
  },
  {
    name: 'Corchea',
    how: 'Negra + corchete en la plica',
    glyph: (
      <>
        <path d="M18 38l16-4M18 41l16-4M19 44l15-4M20 36l12-3" strokeWidth="3" />
        <path d="M35 38V8l12 12" />
      </>
    ),
  },
  { name: 'Silencio de negra', how: 'Zig-zag vertical', glyph: <path d="M30 6l10 12-12 12 12 14" /> },
  {
    name: 'Silencio de corchea',
    how: 'Diagonal con un gancho (o punto) arriba a la izquierda',
    glyph: (
      <>
        <circle cx="25" cy="15" r="3" fill="currentColor" />
        <path d="M25 18c5 1 10-1 14-5L28 46" />
      </>
    ),
  },
  {
    name: 'Silencio de semicorchea',
    how: 'La misma diagonal con dos ganchos',
    glyph: (
      <>
        <circle cx="27" cy="11" r="3" fill="currentColor" />
        <circle cx="23" cy="23" r="3" fill="currentColor" />
        <path d="M27 14c5 1 9-1 13-5M23 26c5 1 9-1 13-5M40 9L26 50" />
      </>
    ),
  },
  { name: 'Silencio de blanca', how: 'Bloque relleno apoyado sobre la 3ª línea (la central)', glyph: <path d="M20 22h24v6H20z" fill="currentColor" /> },
  { name: 'Silencio de redonda', how: 'Bloque relleno colgado de la 4ª línea', glyph: <path d="M20 12h24v6H20z" fill="currentColor" /> },
  {
    name: 'Bemol ♭',
    how: 'Palo alto y una panza cerrada abajo, a su derecha',
    glyph: <path d="M26 4v42c8-2 14-7 12-12s-8-3-12 1" />,
  },
  {
    name: 'Puntillo',
    how: 'Un punto a la derecha de la cabeza: suma la mitad del valor',
    glyph: (
      <>
        <ellipse cx="26" cy="34" rx="9" ry="6.5" fill="currentColor" transform="rotate(-20 26 34)" />
        <path d="M35 34V6" />
        <circle cx="45" cy="34" r="3" fill="currentColor" />
      </>
    ),
  },
  { name: 'Borrar', how: 'Tacha una nota en zig-zag', glyph: <path d="M10 18l44 6-44 8 44 8" /> },
  {
    name: 'Cambiar tono',
    how: 'Arrastra la nota arriba o abajo (suena al moverla)',
    glyph: (
      <>
        <ellipse cx="32" cy="28" rx="8" ry="5.5" />
        <path d="M32 8v8M28 12l4-4 4 4M32 48v-8M28 44l4 4 4-4" />
      </>
    ),
  },
]

export function HelpModal({ open, onClose, onRecalibrate }: { open: boolean; onClose: () => void; onRecalibrate: () => void }) {
  return (
    <Modal open={open} onClose={onClose} title="Guía de trazos" maxWidth={680}>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {ITEMS.map((it) => (
          <div key={it.name} className="rounded-2xl border border-line bg-paper p-3">
            <div className="text-coral">
              <Glyph>{it.glyph}</Glyph>
            </div>
            <div className="mt-1 text-sm font-extrabold">{it.name}</div>
            <div className="text-xs text-muted">{it.how}</div>
          </div>
        ))}
      </div>
      <button
        type="button"
        onClick={onRecalibrate}
        className="mt-4 flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-mint px-4 text-sm font-black text-[#12352c] shadow"
      >
        ✍️ Repetir el test de escritura (Mila aprende tu letra)
      </button>
      <div className="mt-4 rounded-2xl bg-sun/25 p-3 text-sm">
        <p className="font-bold">Consejos</p>
        <ul className="mt-1 list-disc space-y-1 pl-5 text-[13px]">
          <li>Escribe con el Apple Pencil; apoya la mano con tranquilidad: los dedos no dibujan. Dos dedos hacen scroll.</li>
          <li>La nota se coloca por la altura de la cabeza: líneas y espacios de la clave de Sol.</li>
          <li>Tras escribir, la nota queda seleccionada: usa ♯ ♭ ♮, staccato, acento o ligadura en la paleta izquierda.</li>
          <li>
            Escribe el <b>compás entero</b> a tu ritmo (cabezas, plicas, corchetes, ♯ ♭ ♮ delante de la nota y la barra
            de compás). Nada se convierte mientras escribes: el compás se digitaliza solo en cuanto completa la métrica
            elegida arriba (<b>2/4, 3/4, 4/4 o 6/8</b>). Si un compás se queda corto (el último, una anacrusa), se
            convierte al empezar a escribir en otro compás (o con Intro en el Mac). Lo que no sea música (textos,
            flechas) queda como anotación.
          </li>
          <li>
            <b>Corcheas y semicorcheas unidas</b>: dibuja las cabezas rellenas con sus plicas y une los extremos con una
            barra (corcheas) o dos (semicorcheas). <b>Ligadura</b>: un arco de una nota a la siguiente.
          </li>
          <li>
            <b>Tresillos, quintillos y seisillos</b>: escribe las notas, toca la primera y pulsa 3, 5 o 6 en la paleta
            izquierda (agrupa esa nota y las siguientes; tócalo otra vez para deshacerlo). El compás se recalcula solo.
            El <b>puntillo</b> también está en la paleta (o escribe el punto a la derecha de la cabeza).
          </li>
          <li>Zoom: pellizca con dos dedos (o el trackpad del Mac, o ⌘+ / ⌘−); dos dedos también desplazan la hoja.</li>
          <li>
            Modo <b>Anotar</b> (abajo a la izquierda): textos como “ENTRA DIRECTO”, flechas o recuadros se guardan tal cual, en
            azul, pegados a su compás. Tacha en zig-zag por encima para borrarlos. También salen en el PDF y la imagen.
          </li>
          <li>
            <b>Goma</b>: toca una nota o pasa por encima de varias para borrarlas (también anotaciones). La papelera de al
            lado borra toda la partitura, con confirmación; <kbd>⌘Z</kbd> la recupera.
          </li>
          <li>
            <b>Mis partituras</b> (botón de cuadrícula arriba): todo se guarda solo en este iPad. Toca una tarjeta para
            seguir editándola. Para tener copia en la app Archivos usa «Guardar en Archivos» y elige la carpeta
            Mila_partituras (créala la primera vez); «Abrir desde Archivos» las trae de vuelta.
          </li>
          <li>
            <b>Escanear</b> (en Mis partituras o en una hoja vacía): haz una foto o sube un PDF de tu partitura de papel.
            MILA la endereza, <b>lee sus notas y compases</b> y los convierte en notas editables alineadas encima del papel
            (es un borrador: revisa y corrige). Con <b>Fondo</b> puedes reajustar o «Detectar notas» otra vez. Al
            exportar sale tal cual se ve.
          </li>
          <li>El punto junto a cada compás avisa si faltan o sobran tiempos según la métrica.</li>
          <li>
            Mac: <kbd>Espacio</kbd> play/pausa · <kbd>⌘Z</kbd> deshacer · <kbd>⇧⌘Z</kbd> rehacer · <kbd>⌫</kbd> borra la nota · <kbd>↑ ↓</kbd> tono ·{' '}
            <kbd>← →</kbd> navegar · <kbd>#</kbd> <kbd>b</kbd> <kbd>n</kbd> alteraciones · <kbd>S</kbd> staccato · <kbd>A</kbd> acento · <kbd>L</kbd> ligadura ·{' '}
            <kbd>M</kbd> Notas/Anotar · <kbd>G</kbd> goma
          </li>
        </ul>
      </div>
    </Modal>
  )
}
