import { motion } from 'framer-motion'

/** Colores fijos de la marca (también en el icono de la app). */
const BRAND = { mi: '#2fd3a6', la: '#f2b33d', ink: '#1d1a2e' }

interface Props {
  size?: number
  /** Cuando suena la música las ondas aceleran. */
  playing?: boolean
  className?: string
  /** Rebote al tocarlo (solo en la bienvenida; en la barra superior Safari podía dejarlo deformado). */
  interactive?: boolean
}

/**
 * Isotipo MI-LA: dos corcheas unidas sobre un pentagrama. La de abajo es un MI (primera línea, verde menta)
 * y la de arriba un LA (segundo espacio, latón). Las ondas respiran y aceleran al reproducir.
 */
export function Logo({ size = 40, playing = false, className, interactive = true }: Props) {
  const speed = playing ? 0.9 : 2.4
  const spring = { type: 'spring' as const, stiffness: 520, damping: 13 }
  return (
    <motion.svg
      width={size}
      height={size}
      className={className}
      // Tamaño fijo y cuadrado también por CSS: ningún contenedor flex puede estirarlo ni aplastarlo.
      style={{ width: size, height: size, minWidth: size, minHeight: size, flex: 'none', aspectRatio: '1 / 1', display: 'block' }}
      viewBox="0 0 64 64"
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label="MILA"
      whileTap={interactive ? { scale: 0.9, rotate: -6 } : undefined}
      transition={{ type: 'spring', stiffness: 500, damping: 14 }}
    >
      <rect width="64" height="64" rx="18" fill={BRAND.ink} />
      {[22, 28, 34, 40, 46].map((y) => (
        <line key={y} x1="9" x2="55" y1={y} y2={y} stroke="#fff6e3" strokeOpacity="0.16" strokeWidth="1.4" />
      ))}
      {/* Plicas + barra */}
      <motion.path
        d="M26.4 45V17.5M43.4 36V14.5"
        stroke="#fff6e3"
        strokeWidth="2.6"
        strokeLinecap="round"
        initial={{ pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={{ duration: 0.45, delay: 0.35, ease: 'easeOut' }}
      />
      <motion.path
        d="M26.4 17.5L43.4 14.5"
        stroke="#fff6e3"
        strokeWidth="5"
        strokeLinecap="round"
        initial={{ pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={{ duration: 0.35, delay: 0.7, ease: 'easeOut' }}
      />
      {/* MI (primera línea) y LA (segundo espacio) */}
      {/* El giro va en un <g>: si comparte elemento con la animación de escala, el transform CSS de la
          animación pisa el atributo y Safari descoloca/deforma la cabeza. */}
      <g transform="rotate(-22 22 46)">
        <motion.ellipse
          cx="22"
          cy="46"
          rx="5.4"
          ry="4"
          fill={BRAND.mi}
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ ...spring, delay: 0.05 }}
          style={{ transformBox: 'fill-box', transformOrigin: 'center' }}
        />
      </g>
      <g transform="rotate(-22 39 37)">
        <motion.ellipse
          cx="39"
          cy="37"
          rx="5.4"
          ry="4"
          fill={BRAND.la}
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ ...spring, delay: 0.2 }}
          style={{ transformBox: 'fill-box', transformOrigin: 'center' }}
        />
      </g>
      {[0, 1].map((i) => (
        <motion.path
          key={i}
          d={`M${50 + i * 4} ${30 - i * 3}q${2.6 + i} ${5 + i * 2.5} 0 ${10 + i * 5}`}
          fill="none"
          stroke={i === 0 ? BRAND.mi : BRAND.la}
          strokeWidth="2.4"
          strokeLinecap="round"
          animate={{ opacity: [0.15, 1, 0.15], x: [-1, 1.5, -1] }}
          transition={{ duration: speed, repeat: Infinity, delay: i * (speed / 5), ease: 'easeInOut' }}
        />
      ))}
    </motion.svg>
  )
}

/** Logotipo "MILA": MI en verde menta, LA en latón. Las sílabas entran como dos notas. */
export function Wordmark({ className = '', animate = true }: { className?: string; animate?: boolean }) {
  const syl = (text: string, color: string, delay: number) => (
    <motion.span
      className="inline-block"
      style={{ color }}
      initial={animate ? { y: 10, opacity: 0, scale: 0.8 } : false}
      animate={{ y: 0, opacity: 1, scale: 1 }}
      transition={{ type: 'spring', stiffness: 480, damping: 16, delay }}
    >
      {text}
    </motion.span>
  )
  return (
    <span className={`inline-flex font-extrabold tracking-tight ${className}`} aria-label="MILA">
      {syl('MI', 'var(--mi)', 0.1)}
      {syl('LA', 'var(--la)', 0.25)}
    </span>
  )
}
