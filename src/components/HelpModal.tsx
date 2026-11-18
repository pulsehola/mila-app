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
  { name: 'Redonda', how: 'Círculo vacío', glyph: <ellipse cx="32" cy="28" rx="10" ry="7" /> },
  {
    name: 'Blanca',
    how: 'Círculo + plica',
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
  { name: 'Silencio de corchea', how: 'Una «7»', glyph: <path d="M24 14h16L30 44" /> },
  { name: 'Silencio de blanca', how: 'Barra sobre la línea central', glyph: <path d="M20 22h24v6H20z" /> },
  { name: 'Silencio de redonda', how: 'Barra bajo la 2ª línea desde arriba', glyph: <path d="M20 12h24v6H20z" /> },
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

export function HelpModal({ open, onClose }: { open: boolean; onClose: () => void }) {
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
      <div className="mt-4 rounded-2xl bg-sun/25 p-3 text-sm">
        <p className="font-bold">Consejos</p>
        <ul className="mt-1 list-disc space-y-1 pl-5 text-[13px]">
          <li>Escribe con el Apple Pencil; apoya la mano con tranquilidad: los dedos no dibujan. Dos dedos hacen scroll.</li>
          <li>La nota se coloca por la altura de la cabeza: líneas y espacios de la clave de Sol.</li>
          <li>Tras escribir, la nota queda seleccionada: usa ♯ ♭ ♮, staccato, acento o ligadura en la paleta izquierda.</li>
          <li>Escribe a tu ritmo: cabeza, plica y corchete se agrupan solos. La nota aparece tras ~0,6 s sin tocar la pantalla.</li>
          <li>
            Modo <b>Anotar</b> (abajo a la izquierda): textos como “ENTRA DIRECTO”, flechas o recuadros se guardan tal cual, en
            azul, pegados a su compás. Tacha en zig-zag por encima para borrarlos. También salen en el PDF y la imagen.
          </li>
          <li>El punto junto a cada compás avisa si faltan o sobran tiempos (4/4).</li>
          <li>
            Mac: <kbd>Espacio</kbd> play/pausa · <kbd>⌘Z</kbd> deshacer · <kbd>⇧⌘Z</kbd> rehacer · <kbd>⌫</kbd> borra la nota · <kbd>↑ ↓</kbd> tono ·{' '}
            <kbd>← →</kbd> navegar · <kbd>#</kbd> <kbd>b</kbd> <kbd>n</kbd> alteraciones · <kbd>S</kbd> staccato · <kbd>A</kbd> acento · <kbd>L</kbd> ligadura ·{' '}
            <kbd>M</kbd> Notas/Anotar
          </li>
        </ul>
      </div>
    </Modal>
  )
}
