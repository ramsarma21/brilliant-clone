import { useId } from 'react'
import type { JerseyPattern, SkillId } from '../types'
import { COSMETICS_BY_ID } from '../content/cosmetics'

// FIFA-style attribute abbreviation + a position per signature skill.
export const ATTR_ABBR: Record<SkillId, string> = {
  kinematics: 'SHO',
  'motion-graphs': 'PAS',
  forces: 'DRI',
  energy: 'HEA',
  momentum: 'DEF',
  impulse: 'GK',
}
export const POSITION: Record<SkillId, string> = {
  kinematics: 'ST',
  'motion-graphs': 'CM',
  forces: 'CAM',
  energy: 'CF',
  momentum: 'CB',
  impulse: 'GK',
}

export type AvatarKit = {
  primary: string
  secondary: string
  accent: string
  shorts?: string
  pattern?: JerseyPattern
}
export type AvatarCleats = { primary: string; secondary: string; accent: string }

// Skin + hair tones mirror the in-drill penalty taker (KICKER_KIT).
const SKIN = '#edbb90'
const SKIN_SHADE = '#cf9869'
const HAIR = '#3a2616'

// Default kit = the BLUE Home kit the in-drill character wears.
const DEFAULT_KIT: AvatarKit = {
  primary: '#2f6df0',
  secondary: '#1d4ec0',
  accent: '#ffffff',
  shorts: '#eef2fb',
  pattern: 'plain',
}
const DEFAULT_CLEATS: AvatarCleats = { primary: '#2b2f37', secondary: '#15171f', accent: '#5a606b' }

/** Build the avatar kit from an equipped jersey cosmetic id. */
export function kitFor(jerseyId: string): AvatarKit {
  const c = COSMETICS_BY_ID[jerseyId]
  if (!c) return DEFAULT_KIT
  return { ...c.colors, pattern: c.pattern, shorts: c.shorts }
}
/** Build the avatar boots from an equipped cleats cosmetic id. */
export function cleatsFor(cleatsId: string): AvatarCleats {
  return COSMETICS_BY_ID[cleatsId]?.colors ?? DEFAULT_CLEATS
}

// Torso bounding box — matches the canonical athletic build (broad shoulders at the top,
// tapering to a lean waist). The pattern + clip path are derived from these so artwork
// lines up. Shoulders span SHW at TY; the waist spans WAW at TY+TH.
const CXC = 52        // centre x
const TY = 40         // shoulder line
const TH = 41         // torso height (to the hip)
const SHW = 34        // shoulder width (athletic, not football-pad wide)
const WAW = 27        // waist width
const TX = CXC - SHW / 2
const TW = SHW
const HIPY = TY + TH

// The torso silhouette (rounded broad shoulders → straight V-taper to the waist).
const torsoPath = () =>
  `M${CXC - SHW / 2} ${TY + 6} Q${CXC - SHW / 2} ${TY} ${CXC - SHW / 2 + 6} ${TY}` +
  ` L${CXC + SHW / 2 - 6} ${TY} Q${CXC + SHW / 2} ${TY} ${CXC + SHW / 2} ${TY + 6}` +
  ` L${CXC + WAW / 2} ${HIPY} L${CXC - WAW / 2} ${HIPY} Z`

function JerseyArt({
  pattern,
  secondary,
  accent,
}: {
  pattern: JerseyPattern
  secondary: string
  accent: string
}) {
  switch (pattern) {
    case 'stripes':
      return (
        <>
          {[0, 1, 2, 3, 4].map((i) => (
            <rect key={i} x={TX + 4 + i * 8} y={TY} width="3.4" height={TH} fill={secondary} opacity="0.9" />
          ))}
        </>
      )
    case 'sash':
      return <path d={`M${TX} ${HIPY - 6} L${CXC + 8} ${TY} L${CXC + 20} ${TY} L${TX + 6} ${HIPY} Z`} fill={accent} opacity="0.95" />
    case 'hoops':
      return (
        <>
          <rect x={TX} y={TY + 7} width={TW} height="6.5" fill={secondary} />
          <rect x={TX} y={TY + 20} width={TW} height="6.5" fill={secondary} />
          <rect x={TX} y={TY + 33} width={TW} height="6.5" fill={secondary} />
        </>
      )
    case 'halves':
      return <rect x={CXC} y={TY} width={SHW / 2} height={TH} fill={secondary} />
    case 'galaxy':
      return (
        <>
          {[
            [40, 48],
            [46, 60],
            [58, 52],
            [62, 70],
            [42, 74],
            [54, 78],
            [60, 46],
            [48, 50],
          ].map(([cx, cy], i) => (
            <circle key={i} cx={cx} cy={cy} r={i % 3 === 0 ? 1.5 : 0.9} fill={accent} opacity="0.95" />
          ))}
        </>
      )
    default:
      return null
  }
}

/** Detailed, kit-coloured footballer matching the in-drill character build. */
export function CardPlayer({
  jersey = DEFAULT_KIT,
  cleats = DEFAULT_CLEATS,
  className = 'fut__player',
}: {
  jersey?: AvatarKit
  cleats?: AvatarCleats
  className?: string
}) {
  const uid = useId()
  const clipId = `torso-${uid}`
  const gradId = `galaxy-${uid}`
  const pattern: JerseyPattern = jersey.pattern ?? 'plain'
  const shorts = jersey.shorts ?? '#f2f5fb'
  const shortsDark = '#cdd6e6'
  const torsoFill = pattern === 'galaxy' ? `url(#${gradId})` : jersey.primary

  // Athletic build: small head, broad shoulders → lean waist, LONG legs (hips at
  // mid-height). Leg centres + knee/sock/boot lines mirror the canonical sim proportions.
  const legLx = 46.5, legRx = 57.5     // leg centres (slight inseam gap)
  const legW = 7.4
  const hipTop = 76                     // shorts/leg start (just under the torso hip)
  const kneeY = 116                     // skin thigh → sock transition
  const footY = 147

  return (
    <svg viewBox="0 0 104 160" className={className} aria-hidden>
      <defs>
        <clipPath id={clipId}>
          <path d={torsoPath()} />
        </clipPath>
        <linearGradient id={gradId} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={jersey.primary} />
          <stop offset="1" stopColor={jersey.secondary} />
        </linearGradient>
      </defs>

      {/* ground shadow */}
      <ellipse cx={CXC} cy={footY + 5} rx="26" ry="4.4" fill="rgba(0,0,0,0.22)" />

      {/* legs: skin thigh → sock shin (kit colour) */}
      {[legLx, legRx].map((lx, i) => (
        <g key={i}>
          <rect x={lx - legW / 2} y={hipTop} width={legW} height={kneeY - hipTop + 2} rx={legW / 2} fill={SKIN} />
          <rect x={lx - legW / 2} y={kneeY} width={legW} height={footY - kneeY} rx={legW / 2.4} fill={jersey.primary} />
          <rect x={lx - legW / 2} y={kneeY} width={legW} height="3.4" rx="1.5" fill={jersey.accent} opacity="0.7" />
        </g>
      ))}

      {/* boots (cleat colour) */}
      {[legLx, legRx].map((lx, i) => (
        <g key={i}>
          <ellipse cx={lx} cy={footY} rx="8" ry="4.6" fill={cleats.primary} />
          <ellipse cx={lx} cy={footY + 2.6} rx="8" ry="2" fill={cleats.secondary} />
          <ellipse cx={lx} cy={footY - 1} rx="4.4" ry="1.6" fill={cleats.accent} opacity="0.8" />
        </g>
      ))}

      {/* shorts: slim white seat + two short thigh covers with an inseam gap */}
      <rect x={CXC - 14.5} y={hipTop - 4} width="29" height="14" rx="5" fill={shorts} />
      <rect x={legLx - 4.5} y={hipTop + 6} width="9" height="12" rx="3.5" fill={shorts} />
      <rect x={legRx - 4.5} y={hipTop + 6} width="9" height="12" rx="3.5" fill={shorts} />
      <rect x={CXC - 14.5} y={hipTop - 4} width="29" height="3.6" rx="1.8" fill={shortsDark} opacity="0.7" />
      <rect x={legLx - 4.5} y={hipTop + 15} width="9" height="2.4" rx="1.2" fill={shortsDark} opacity="0.7" />
      <rect x={legRx - 4.5} y={hipTop + 15} width="9" height="2.4" rx="1.2" fill={shortsDark} opacity="0.7" />

      {/* arms (behind torso): jersey upper arm → skin forearm + hand */}
      {[
        { sx: CXC - SHW / 2 + 2, dir: -1 },
        { sx: CXC + SHW / 2 - 2, dir: 1 },
      ].map(({ sx, dir }, i) => (
        <g key={i}>
          <rect x={sx + (dir < 0 ? -12 : 4)} y={TY + 2} width="8" height="20" rx="4" fill={jersey.secondary} />
          <rect x={sx + (dir < 0 ? -11 : 5)} y={TY + 20} width="6.5" height="20" rx="3.2" fill={SKIN} />
          <circle cx={sx + (dir < 0 ? -7.8 : 8.2)} cy={TY + 41} r="3.7" fill={SKIN} />
        </g>
      ))}

      {/* torso + jersey artwork */}
      <path d={torsoPath()} fill={torsoFill} />
      <g clipPath={`url(#${clipId})`}>
        <JerseyArt pattern={pattern} secondary={jersey.secondary} accent={jersey.accent} />
        {/* soft shading for depth */}
        <rect x={TX} y={HIPY - 14} width={TW} height="14" fill="#000" opacity="0.1" />
        <rect x={TX} y={TY} width="9" height={TH} fill="#fff" opacity="0.08" />
      </g>
      {/* collar */}
      <path d={`M${CXC - 6} ${TY} L${CXC} ${TY + 8} L${CXC + 6} ${TY} Z`} fill={jersey.accent} opacity="0.95" />
      {/* shirt number */}
      <text
        x={CXC}
        y={TY + TH * 0.58}
        textAnchor="middle"
        fontFamily="'Baloo 2', sans-serif"
        fontSize="12.5"
        fontWeight="800"
        fill={jersey.accent}
        opacity="0.92"
      >
        10
      </text>

      {/* neck (short stub) */}
      <rect x={CXC - 5} y="30" width="10" height="11" rx="3.5" fill={SKIN} />
      <rect x={CXC - 5} y="30" width="10" height="3.5" rx="1.8" fill={SKIN_SHADE} opacity="0.5" />

      {/* ears */}
      <circle cx={CXC - 9.4} cy="25" r="2.4" fill={SKIN} />
      <circle cx={CXC + 9.4} cy="25" r="2.4" fill={SKIN} />

      {/* head */}
      <circle cx={CXC} cy="24" r="10" fill={SKIN} />

      {/* hair */}
      <path d={`M${CXC - 10} 24 a10 10 0 0 1 20 0 c-1 -7 -8.2 -9.8 -10 -9.8 c-1.8 0 -9 2.8 -10 9.8 Z`} fill={HAIR} />

      {/* eyebrows */}
      <rect x={CXC - 6.6} y="20.8" width="4.8" height="1.4" rx="0.7" fill={HAIR} />
      <rect x={CXC + 1.8} y="20.8" width="4.8" height="1.4" rx="0.7" fill={HAIR} />

      {/* eyes */}
      <ellipse cx={CXC - 3.7} cy="24.4" rx="1.8" ry="2.1" fill="#fff" />
      <ellipse cx={CXC + 3.7} cy="24.4" rx="1.8" ry="2.1" fill="#fff" />
      <circle cx={CXC - 3.4} cy="24.7" r="1" fill="#20242e" />
      <circle cx={CXC + 4} cy="24.7" r="1" fill="#20242e" />

      {/* nose + mouth */}
      <path d={`M${CXC} 25 l-1.4 4 q1.4 1 2.8 0 Z`} fill={SKIN_SHADE} opacity="0.55" />
      <path d={`M${CXC - 3} 31 q3 2.6 6 0`} stroke="#9c5a44" strokeWidth="1.2" fill="none" strokeLinecap="round" />
    </svg>
  )
}
