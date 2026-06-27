import { useId } from 'react'
import type { EmblemConfig, EmblemMotif, EmblemShape } from '../types'

// Procedural soccer-club emblems. Each club gets a badge SILHOUETTE (shield / classic /
// hexagon / roundel) + a physics-themed MOTIF (atom, bolt, orbit, wave, flame, …) drawn
// in its own colour scheme. Vector art stays crisp at any size and is themed to the club
// name, so every crest reads as a distinct, real-looking emblem. YOUR club can also pass an
// explicit `config` (chosen in the locker) that overrides the name-derived spec.

type Shape = EmblemShape
type Motif = EmblemMotif

// Hand-tuned identity per club: a silhouette + a motif that fits the club's physics name.
// Clubs sharing a motif are given different silhouettes/colours so no two read alike.
const SPEC: Record<string, { shape: Shape; motif: Motif }> = {
  'Atlético Entropy': { shape: 'shield', motif: 'spiral' },
  'Real Relativity': { shape: 'roundel', motif: 'orbit' },
  'Inertia City': { shape: 'hex', motif: 'arrow' },
  'Quantum Rovers': { shape: 'shield', motif: 'atom' },
  'Photon FC': { shape: 'roundel', motif: 'sun' },
  'Electron United': { shape: 'roundel', motif: 'atom' },
  'Sporting Gravitas': { shape: 'classic', motif: 'star' },
  'Dynamo Tesla': { shape: 'shield', motif: 'bolt' },
  'Inter Friction': { shape: 'hex', motif: 'flame' },
  'Vector Wanderers': { shape: 'shield', motif: 'arrow' },
  'Newton North End': { shape: 'classic', motif: 'mountain' },
  'Joule Town': { shape: 'roundel', motif: 'bolt' },
  'Watt Albion': { shape: 'hex', motif: 'bolt' },
  'Plasma Rangers': { shape: 'shield', motif: 'flame' },
  'Fusion Athletic': { shape: 'hex', motif: 'atom' },
  'Neutron County': { shape: 'classic', motif: 'orbit' },
  'Graviton FC': { shape: 'shield', motif: 'orbit' },
  'Boson Hotspur': { shape: 'classic', motif: 'atom' },
  'Quark City': { shape: 'roundel', motif: 'atom' },
  'Terminal Velocity FC': { shape: 'roundel', motif: 'arrow' },
  'Torque United': { shape: 'shield', motif: 'torque' },
  'Amplitude Athletic': { shape: 'roundel', motif: 'wave' },
  'Resonance Rovers': { shape: 'hex', motif: 'wave' },
  'Pendulum FC': { shape: 'classic', motif: 'pendulum' },
  'Vortex City': { shape: 'roundel', motif: 'spiral' },
  'Physics FC': { shape: 'shield', motif: 'ball' },
}

const SHAPES: Shape[] = ['shield', 'classic', 'hex', 'roundel']
const MOTIFS: Motif[] = ['atom', 'bolt', 'orbit', 'wave', 'star', 'flame', 'arrow', 'spiral']

function hashStr(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0
  return h
}

export function specFor(name: string): { shape: Shape; motif: Motif } {
  if (SPEC[name]) return SPEC[name]
  const h = hashStr(name)
  return { shape: SHAPES[h % SHAPES.length], motif: MOTIFS[(h >> 3) % MOTIFS.length] }
}

// ---- badge silhouettes (viewBox 0 0 64 72) ----
function shapePath(shape: Shape): string {
  switch (shape) {
    case 'shield':
      return 'M32 2 L60 10 V32 C60 50 48 63 32 70 C16 63 4 50 4 32 V10 Z'
    case 'classic':
      return 'M10 8 Q32 1 54 8 L54 31 Q54 55 32 70 Q10 55 10 31 Z'
    case 'hex':
      return 'M32 2 L58 17 V55 L32 70 L6 55 V17 Z'
    case 'roundel':
    default:
      return 'M32 4 C47 4 60 18 60 37 C60 55 47 68 32 68 C17 68 4 55 4 37 C4 18 17 4 32 4 Z'
  }
}

// two-tone treatment, clipped to the badge shape
function SplitOverlay({ shape, primary, secondary }: { shape: Shape; primary: string; secondary: string }) {
  switch (shape) {
    case 'shield':
      return (
        <>
          <rect x="32" y="0" width="32" height="72" fill={secondary} />
          <rect x="31.1" y="0" width="1.8" height="72" fill="rgba(255,255,255,0.18)" />
        </>
      )
    case 'classic':
      return (
        <>
          <rect x="0" y="0" width="64" height="22" fill={secondary} />
          <rect x="0" y="21" width="64" height="2" fill="rgba(255,255,255,0.2)" />
        </>
      )
    case 'hex':
      return <polygon points="0,72 64,72 64,4" fill={secondary} opacity="0.92" />
    case 'roundel':
    default:
      return (
        <>
          <circle cx="32" cy="37" r="34" fill={secondary} />
          <circle cx="32" cy="37" r="23.5" fill={primary} />
        </>
      )
  }
}

// ---- physics motifs, centred ~ (32, 35), drawn in the accent colour ----
function MotifArt({ motif, c, base }: { motif: Motif; c: string; base: string }) {
  const s = { stroke: c, strokeWidth: 2.6, fill: 'none', strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }
  switch (motif) {
    case 'atom':
      return (
        <>
          <g {...s}>
            <ellipse cx="32" cy="35" rx="15" ry="6.4" />
            <ellipse cx="32" cy="35" rx="15" ry="6.4" transform="rotate(60 32 35)" />
            <ellipse cx="32" cy="35" rx="15" ry="6.4" transform="rotate(120 32 35)" />
          </g>
          <circle cx="32" cy="35" r="3.6" fill={c} />
        </>
      )
    case 'bolt':
      return <path d="M37 15 L21 39 H30.5 L27 55 L45 29 H35 Z" fill={c} stroke={base} strokeWidth="1" strokeLinejoin="round" />
    case 'ball':
      return (
        <>
          <circle cx="32" cy="35" r="14" fill={c} />
          <path d="M32 28.6 l6.2 4.5 -2.4 7.3 h-7.6 l-2.4 -7.3 Z" fill={base} />
          <g stroke={base} strokeWidth="1.7" strokeLinecap="round">
            <line x1="32" y1="22" x2="32" y2="28.6" />
            <line x1="44.5" y1="31.6" x2="38.2" y2="33.1" />
            <line x1="40.2" y1="46.5" x2="35.8" y2="40.4" />
            <line x1="23.8" y1="46.5" x2="28.2" y2="40.4" />
            <line x1="19.5" y1="31.6" x2="25.8" y2="33.1" />
          </g>
        </>
      )
    case 'wave':
      return <path d="M15 35 Q21.5 22 28 35 Q34.5 48 41 35 Q47.5 22 49 31" {...s} strokeWidth="3" />
    case 'orbit':
      return (
        <>
          <ellipse cx="32" cy="35" rx="17" ry="7" {...s} strokeWidth="2.4" transform="rotate(-22 32 35)" />
          <circle cx="32" cy="35" r="5.2" fill={c} />
          <circle cx="47.5" cy="28.5" r="2.8" fill={c} />
        </>
      )
    case 'star':
      return <path d="M32 16 l4.9 9.9 10.9 1.6 -7.9 7.7 1.9 10.8 -9.8 -5.1 -9.8 5.1 1.9 -10.8 -7.9 -7.7 10.9 -1.6 Z" fill={c} />
    case 'flame':
      return <path d="M32 15 C36 24 43 26 39 36 C45 34 43 27 46 40 C47 50 40 56 32 56 C24 56 17 50 18 40 C19 32 27 35 25 26 C30 31 27 22 32 15 Z" fill={c} />
    case 'arrow':
      return <path d="M32 15 L46 33 H38 V55 H26 V33 H18 Z" fill={c} />
    case 'mountain':
      return (
        <>
          <path d="M13 49 L25 29 L32 38 L40 25 L51 49 Z" fill={c} />
          <path d="M25 29 l3.2 5 -3.4 4.6 -3 -4.4 Z" fill={base} opacity="0.55" />
        </>
      )
    case 'pendulum':
      return (
        <>
          <path d="M15 20 H35" {...s} strokeWidth="2.6" />
          <circle cx="25" cy="20" r="2.4" fill={c} />
          <line x1="25" y1="20" x2="41" y2="46" {...s} strokeWidth="2.6" />
          <circle cx="41.5" cy="48" r="6" fill={c} />
        </>
      )
    case 'torque':
      return (
        <>
          <path d="M45 27 A14 14 0 1 0 47 39" {...s} strokeWidth="3" />
          <path d="M45 20 L48.5 29 L39.5 28 Z" fill={c} />
        </>
      )
    case 'spiral':
      return (
        <path
          d="M32 35 a3 3 0 1 1 5.2 -1.4 a8 8 0 1 1 -13.7 2 a13 13 0 1 1 21.6 -2.4"
          {...s}
          strokeWidth="2.8"
        />
      )
    case 'sun':
      return (
        <>
          <circle cx="32" cy="35" r="7.5" fill={c} />
          <g stroke={c} strokeWidth="2.6" strokeLinecap="round">
            {Array.from({ length: 8 }).map((_, i) => {
              const a = (i * Math.PI) / 4
              const x1 = 32 + Math.cos(a) * 11
              const y1 = 35 + Math.sin(a) * 11
              const x2 = 32 + Math.cos(a) * 15.5
              const y2 = 35 + Math.sin(a) * 15.5
              return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} />
            })}
          </g>
        </>
      )
    default:
      return null
  }
}

export function ClubEmblem({
  name,
  primary,
  secondary,
  accent,
  size = 36,
  config,
}: {
  name: string
  primary: string
  secondary: string
  accent: string
  size?: number
  /** Explicit crest override (shape/motif + optional colours). Used by YOUR club. */
  config?: EmblemConfig
}) {
  const uid = useId().replace(/:/g, '')
  const cid = `emb-${uid}`
  const spec = config ? { shape: config.shape, motif: config.motif } : specFor(name)
  const { shape, motif } = spec
  const pri = config?.primary ?? primary
  const sec = config?.secondary ?? secondary
  const acc = config?.accent ?? accent
  const d = shapePath(shape)
  return (
    <svg className="crest" width={size} height={size * 1.12} viewBox="0 0 64 72" aria-hidden>
      <defs>
        <clipPath id={cid}>
          <path d={d} />
        </clipPath>
      </defs>
      <g clipPath={`url(#${cid})`}>
        <rect x="0" y="0" width="64" height="72" fill={pri} />
        <SplitOverlay shape={shape} primary={pri} secondary={sec} />
        {/* soft inner sheen */}
        <ellipse cx="24" cy="18" rx="26" ry="16" fill="rgba(255,255,255,0.12)" />
      </g>
      <MotifArt motif={motif} c={acc} base={pri} />
      {/* dark rim + thin highlight for a crisp, badge-like edge */}
      <path d={d} fill="none" stroke="#0b0e1c" strokeWidth="3.4" strokeLinejoin="round" />
      <path d={d} fill="none" stroke="rgba(255,255,255,0.45)" strokeWidth="1.1" strokeLinejoin="round" />
    </svg>
  )
}
