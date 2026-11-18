import { motion } from 'framer-motion'

interface Props {
  size?: number
  /** Cuando suena la música las ondas aceleran. */
  playing?: boolean
}

/** Logo MILA: una "M" de trazo redondeado con ondas musicales que respiran. */
export function Logo({ size = 40, playing = false }: Props) {
  const speed = playing ? 0.9 : 2.4
  return (
    <motion.svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      role="img"
      aria-label="MILA"
      whileTap={{ scale: 0.92, rotate: -6 }}
      transition={{ type: 'spring', stiffness: 500, damping: 14 }}
    >
      <defs>
        <linearGradient id="logo-bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ff8a5c" />
          <stop offset="1" stopColor="#ff5a7a" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="18" fill="url(#logo-bg)" />
      <motion.path
        d="M15 47V19l13.5 19L42 19v28"
        fill="none"
        stroke="#fff6e3"
        strokeWidth="6.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        initial={{ pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={{ duration: 0.9, ease: 'easeOut' }}
      />
      {[0, 1, 2].map((i) => (
        <motion.path
          key={i}
          d={`M${47 + i * 4.5} ${26 - i * 2.5}q${3 + i} ${6 + i * 2.5} 0 ${12 + i * 5}`}
          fill="none"
          stroke="#ffe08a"
          strokeWidth="3"
          strokeLinecap="round"
          animate={{ opacity: [0.15, 1, 0.15], x: [-1, 1.5, -1] }}
          transition={{ duration: speed, repeat: Infinity, delay: i * (speed / 6), ease: 'easeInOut' }}
        />
      ))}
    </motion.svg>
  )
}
