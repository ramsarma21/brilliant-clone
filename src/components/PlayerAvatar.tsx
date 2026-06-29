import { useId } from 'react'
import type { JerseyPattern, SkillId } from '../types'
import { COSMETICS_BY_ID } from '../content/cosmetics'
import { faceColors, type FaceColors } from '../lib/appearance'

// FIFA-style attribute abbreviation + a position per signature game skill.
export const ATTR_ABBR: Record<SkillId, string> = {
  shooting: 'SHO',
  passing: 'PAS',
  dribbling: 'DRI',
  heading: 'HEA',
  defending: 'DEF',
  stamina: 'STA',
}
export const POSITION: Record<SkillId, string> = {
  shooting: 'ST',
  passing: 'CM',
  dribbling: 'CAM',
  heading: 'CF',
  defending: 'CB',
  stamina: 'CDM',
}

export type AvatarKit = {
  primary: string
  secondary: string
  accent: string
  shorts?: string
  pattern?: JerseyPattern
}
export type AvatarCleats = { primary: string; secondary: string; accent: string }

// Default face = the historical "fair / brown" look. The card + locker pass the player's
// real Appearance via the `face` prop so customising skin/hair updates the model
// everywhere. The sims read the same colours through usePlayerKit.
const DEFAULT_FACE: FaceColors = faceColors()

// Default kit = the BLUE Home kit the in-drill character wears.
const DEFAULT_KIT: AvatarKit = {
  primary: '#2f6df0',
  secondary: '#1d4ec0',
  accent: '#ffffff',
  shorts: '#eef2fb',
  pattern: 'plain',
}
const DEFAULT_CLEATS: AvatarCleats = { primary: '#2b2f37', secondary: '#15171f', accent: '#5a606b' }

// How much to scale the SVG hair around the head centre per style (0 = bald, hide it).
const HAIR_SVG_SCALE: Record<string, number> = { short: 1, buzz: 0.9, curly: 1.13, afro: 1.28, bald: 0 }
function hairScale(style?: string): number {
  return HAIR_SVG_SCALE[style ?? 'short'] ?? 1
}

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
  face = DEFAULT_FACE,
  hairStyle = 'short',
  className = 'fut__player',
}: {
  jersey?: AvatarKit
  cleats?: AvatarCleats
  face?: FaceColors
  hairStyle?: string
  className?: string
}) {
  const uid = useId()
  const hs = hairScale(hairStyle)
  const clipId = `torso-${uid}`
  const gradId = `galaxy-${uid}`
  const pattern: JerseyPattern = jersey.pattern ?? 'plain'
  const shorts = jersey.shorts ?? '#f2f5fb'
  const shortsDark = '#cdd6e6'
  const torsoFill = pattern === 'galaxy' ? `url(#${gradId})` : jersey.primary
  const { skin: SKIN, skinShade: SKIN_SHADE, skinHi: SKIN_HI, hair: HAIR, hairHi: HAIR_HI } = face

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

      {/* neck (short stub) with a touch of jaw shadow */}
      <rect x={CXC - 5} y="30" width="10" height="11" rx="3.5" fill={SKIN} />
      <rect x={CXC - 5} y="30" width="10" height="3.5" rx="1.8" fill={SKIN_SHADE} opacity="0.5" />

      {/* ears */}
      <circle cx={CXC - 9.4} cy="25" r="2.4" fill={SKIN} />
      <circle cx={CXC + 9.4} cy="25" r="2.4" fill={SKIN} />
      <circle cx={CXC - 9.2} cy="25.4" r="1" fill={SKIN_SHADE} opacity="0.5" />
      <circle cx={CXC + 9.2} cy="25.4" r="1" fill={SKIN_SHADE} opacity="0.5" />

      {/* head — defined jaw tapering to a strong chin (the same face as CardFace) */}
      <path
        d={`M${CXC - 10} 22.5 C${CXC - 10} 16 ${CXC - 5.5} 13 ${CXC} 13
            C${CXC + 5.5} 13 ${CXC + 10} 16 ${CXC + 10} 22.5
            C${CXC + 10} 28 ${CXC + 7.5} 31.5 ${CXC + 3} 33.4
            C${CXC + 1.4} 34 ${CXC - 1.4} 34 ${CXC - 3} 33.4
            C${CXC - 7.5} 31.5 ${CXC - 10} 28 ${CXC - 10} 22.5 Z`}
        fill={SKIN}
      />
      {/* cheekbone highlights + forehead light */}
      <ellipse cx={CXC - 5} cy="24.5" rx="2.4" ry="1.6" fill={SKIN_HI} opacity="0.5" />
      <ellipse cx={CXC + 5} cy="24.5" rx="2.4" ry="1.6" fill={SKIN_HI} opacity="0.5" />
      <ellipse cx={CXC} cy="17.5" rx="6.5" ry="3" fill={SKIN_HI} opacity="0.32" />

      {/* hair — modern textured quiff with temple fades + a side sweep highlight.
          Scaled around the crown by hair style (bald hides it entirely). */}
      {hs > 0 && (
        <g transform={`translate(${CXC} 16) scale(${hs}) translate(${-CXC} -16)`}>
          <path
            d={`M${CXC - 10} 23 C${CXC - 11.5} 14 ${CXC - 5.5} 9 ${CXC} 9
                C${CXC + 5.5} 9 ${CXC + 11.5} 14 ${CXC + 10} 23
                C${CXC + 10} 18.5 ${CXC + 8} 17 ${CXC + 6} 17.5
                C${CXC + 7} 14.5 ${CXC + 4.5} 13.5 ${CXC + 2.5} 14.5
                C${CXC + 1.5} 12.5 ${CXC - 1.5} 12.5 ${CXC - 2.5} 14.5
                C${CXC - 4.5} 13.5 ${CXC - 7} 14.5 ${CXC - 6} 17.5
                C${CXC - 8} 17 ${CXC - 10} 18.5 ${CXC - 10} 23 Z`}
            fill={HAIR}
          />
          <path d={`M${CXC - 5.5} 11.5 C${CXC - 3} 10 ${CXC + 3} 10 ${CXC + 5.5} 11.5 C${CXC + 2} 10.5 ${CXC - 2} 10.5 ${CXC - 5.5} 13 Z`} fill={HAIR_HI} opacity="0.7" />
        </g>
      )}

      {/* eyebrows — angled, fuller at the inner edge */}
      <path d={`M${CXC - 6.6} 20.4 C${CXC - 4.6} 19 ${CXC - 2.4} 19.1 ${CXC - 1.2} 20.1 L${CXC - 1.4} 21.1 C${CXC - 2.6} 20.3 ${CXC - 4.6} 20.3 ${CXC - 6.2} 21.5 Z`} fill={HAIR} />
      <path d={`M${CXC + 6.6} 20.4 C${CXC + 4.6} 19 ${CXC + 2.4} 19.1 ${CXC + 1.2} 20.1 L${CXC + 1.4} 21.1 C${CXC + 2.6} 20.3 ${CXC + 4.6} 20.3 ${CXC + 6.2} 21.5 Z`} fill={HAIR} />

      {/* eyes — almond shaped, dark iris + catchlight */}
      {[CXC - 3.7, CXC + 3.7].map((ex) => (
        <g key={ex}>
          <path d={`M${ex - 2} 23.7 Q${ex} 21.9 ${ex + 2} 23.7 Q${ex} 25 ${ex - 2} 23.7 Z`} fill="#fff" />
          <circle cx={ex} cy="23.8" r="1.15" fill="#3b2a20" />
          <circle cx={ex} cy="23.8" r="0.55" fill="#15110d" />
          <circle cx={ex + 0.4} cy="23.3" r="0.35" fill="#fff" />
        </g>
      ))}

      {/* nose — slim bridge highlight + soft tip shadow */}
      <rect x={CXC - 0.4} y="22" width="0.9" height="5.4" rx="0.45" fill={SKIN_HI} opacity="0.5" />
      <path d={`M${CXC} 27.4 C${CXC - 1.6} 27.4 ${CXC - 2.3} 28.3 ${CXC - 1.7} 29 C${CXC - 0.8} 29.6 ${CXC + 0.8} 29.6 ${CXC + 1.7} 29 C${CXC + 2.3} 28.3 ${CXC + 1.6} 27.4 ${CXC} 27.4 Z`} fill={SKIN_SHADE} opacity="0.5" />

      {/* mouth — confident, lightly smiling */}
      <path d={`M${CXC - 3.2} 31 Q${CXC} 30.2 ${CXC + 3.2} 31 Q${CXC} 32.8 ${CXC - 3.2} 31 Z`} fill="#b56a52" />
      <path d={`M${CXC - 3.2} 31 Q${CXC} 31.7 ${CXC + 3.2} 31`} stroke="#7e4233" strokeWidth="0.7" fill="none" strokeLinecap="round" />
    </svg>
  )
}

/**
 * FIFA-style head-and-shoulders portrait — the same face as {@link CardPlayer},
 * but framed as a bust for the player card. Only the jersey colours show (on the
 * shoulders + collar); the full body model lives in CardPlayer / the sims.
 */
export function CardFace({
  jersey = DEFAULT_KIT,
  face = DEFAULT_FACE,
  hairStyle = 'short',
  className = 'fut__player',
}: {
  jersey?: AvatarKit
  face?: FaceColors
  hairStyle?: string
  className?: string
}) {
  const FX = 52 // face centre x
  const hs = hairScale(hairStyle)
  const accent = jersey.accent
  const { skin: SKIN, skinShade: SKIN_SHADE, skinHi: SKIN_HI, hair: HAIR, hairHi: HAIR_HI } = face

  // Defined face silhouette: broad forehead/cheekbones tapering to a strong,
  // slightly squared chin (egg-shaped, not a circle).
  const facePath =
    `M31 40 C31 25 40 18 52 18 C64 18 73 25 73 40 ` +
    `C73 50 69 57 61 62 C57 64.5 54.5 66 52 66 ` +
    `C49.5 66 47 64.5 43 62 C35 57 31 50 31 40 Z`

  return (
    <svg viewBox="0 0 104 104" className={className} aria-hidden>
      {/* shoulders / kit bust */}
      <path d={`M8 104 C8 82 28 73 52 73 C76 73 96 82 96 104 Z`} fill={jersey.primary} />
      <path d={`M8 104 C8 82 28 73 52 73 C52 73 52 104 52 104 Z`} fill="#000" opacity="0.08" />
      <path d={`M52 73 C76 73 96 82 96 104 L82 104 C80 86 68 78 52 77 Z`} fill={jersey.secondary} opacity="0.55" />
      {/* collar V (accent) */}
      <path d={`M${FX - 10} 74 L${FX} 88 L${FX + 10} 74 Z`} fill={accent} opacity="0.95" />

      {/* neck (with a touch of shadow under the jaw) */}
      <rect x={FX - 7} y="58" width="14" height="22" rx="5" fill={SKIN} />
      <path d="M40 62 Q52 70 64 62 L64 66 Q52 73 40 66 Z" fill={SKIN_SHADE} opacity="0.45" />

      {/* ears */}
      <path d="M30 41 q-5 -1 -4.5 4 q0.6 5 5 4.2 Z" fill={SKIN} />
      <path d="M74 41 q5 -1 4.5 4 q-0.6 5 -5 4.2 Z" fill={SKIN} />
      <circle cx="29" cy="44" r="1.4" fill={SKIN_SHADE} opacity="0.5" />
      <circle cx="75" cy="44" r="1.4" fill={SKIN_SHADE} opacity="0.5" />

      {/* face */}
      <path d={facePath} fill={SKIN} />

      {/* structure: cheekbone highlights + a jaw/stubble shadow for definition */}
      <path d="M33 42 C36 55 44 62 52 62 C60 62 68 55 71 42 C67 50 60 55 52 55 C44 55 37 50 33 42 Z" fill={SKIN_SHADE} opacity="0.16" />
      <ellipse cx="40" cy="44" rx="5" ry="3.2" fill={SKIN_HI} opacity="0.5" />
      <ellipse cx="64" cy="44" rx="5" ry="3.2" fill={SKIN_HI} opacity="0.5" />
      {/* forehead light */}
      <ellipse cx="52" cy="28" rx="13" ry="6" fill={SKIN_HI} opacity="0.35" />

      {/* hair — modern textured quiff, scaled around the crown by style (bald hides it) */}
      {hs > 0 && (
        <g transform={`translate(52 26) scale(${hs}) translate(-52 -26)`}>
          <path
            d="M30 43 C27 24 39 13 52 13 C65 13 77 24 74 43
               C74 34 70 31 66 32 C68 27 63 25 59 27
               C57 23 52 24 52 27 C52 24 47 23 45 27
               C41 25 36 27 38 32 C34 31 30 35 30 43 Z"
            fill={HAIR}
          />
          <path d="M40 18 C45 14 56 14 62 18 C56 16 46 16 40 22 Z" fill={HAIR_HI} opacity="0.7" />
        </g>
      )}

      {/* eyebrows — angled, fuller at the inner edge (striking, masculine) */}
      <path d="M38 34.5 C42 31.6 47 31.8 49.6 33.8 L49.2 36 C46.6 34.4 42 34.4 38.8 36.8 Z" fill={HAIR} />
      <path d="M66 34.5 C62 31.6 57 31.8 54.4 33.8 L54.8 36 C57.4 34.4 62 34.4 65.2 36.8 Z" fill={HAIR} />

      {/* eyes — almond shaped with defined lid, dark iris + catchlight */}
      {[44, 60].map((ex) => (
        <g key={ex}>
          <path d={`M${ex - 4} 41.4 Q${ex} 37.8 ${ex + 4} 41.4 Q${ex} 44 ${ex - 4} 41.4 Z`} fill="#fff" />
          <circle cx={ex} cy="41.4" r="2.3" fill="#3b2a20" />
          <circle cx={ex} cy="41.4" r="1.1" fill="#15110d" />
          <circle cx={ex + 0.8} cy="40.5" r="0.7" fill="#fff" />
          <path d={`M${ex - 4} 41.2 Q${ex} 37.6 ${ex + 4} 41.2`} stroke="#5b3d2b" strokeWidth="0.9" fill="none" strokeLinecap="round" />
        </g>
      ))}

      {/* nose — slim bridge highlight, soft tip shadow + nostrils */}
      <rect x={FX - 0.8} y="38" width="1.6" height="11" rx="0.8" fill={SKIN_HI} opacity="0.5" />
      <path d="M52 49 C49 49 47.5 50.5 48.5 52 C50 53 54 53 55.5 52 C56.5 50.5 55 49 52 49 Z" fill={SKIN_SHADE} opacity="0.45" />
      <circle cx="49.3" cy="51.4" r="0.8" fill={SKIN_SHADE} opacity="0.7" />
      <circle cx="54.7" cy="51.4" r="0.8" fill={SKIN_SHADE} opacity="0.7" />

      {/* mouth — confident, lightly smiling, with a fuller lower lip */}
      <path d="M45.5 56.4 Q48.5 55 52 55.6 Q55.5 55 58.5 56.4 Q55 58.2 52 58.2 Q49 58.2 45.5 56.4 Z" fill="#b56a52" />
      <path d="M45.5 56.4 Q52 57.4 58.5 56.4 Q52 60 45.5 56.4 Z" fill="#9c5340" />
      <path d="M45.5 56.2 Q52 57.2 58.5 56.2" stroke="#7e4233" strokeWidth="0.8" fill="none" strokeLinecap="round" />
    </svg>
  )
}
