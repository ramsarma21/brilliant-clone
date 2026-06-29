// YOUR PLAYER's physical look — skin tone + hair colour.
//
// This is the SAME idea as the equipped jersey/cleats loadout, but for the body the
// loadout can't change: your face. It is a single source of truth that flows EVERYWHERE
// — the card portrait (CardFace), the rotatable locker model + full body (CardPlayer),
// and every drill / Quantum League game (via usePlayerKit, which folds these colours onto
// the sim kits so the head/limbs reflect your character). Customising your look updates
// the player globally without touching each sim's drawing code.

import type { Appearance } from '../types'

export type SkinTone = { id: string; name: string; base: string }
export type HairColor = { id: string; name: string; base: string }

// Ordered light → deep. `fair` is the historical default the card/sims already used.
export const SKIN_TONES: SkinTone[] = [
  { id: 'light', name: 'Light', base: '#f6d8bd' },
  { id: 'fair', name: 'Fair', base: '#edbb90' },
  { id: 'tan', name: 'Tan', base: '#d49a6a' },
  { id: 'brown', name: 'Brown', base: '#ab7448' },
  { id: 'deep', name: 'Deep', base: '#7c4a2c' },
  { id: 'rich', name: 'Rich', base: '#54301a' },
]

export const HAIR_COLORS: HairColor[] = [
  { id: 'black', name: 'Black', base: '#211810' },
  { id: 'brown', name: 'Brown', base: '#3a2616' },
  { id: 'auburn', name: 'Auburn', base: '#5e2f1d' },
  { id: 'blonde', name: 'Blonde', base: '#c9a154' },
  { id: 'ginger', name: 'Ginger', base: '#a8501f' },
  { id: 'platinum', name: 'Platinum', base: '#cfcabc' },
]

// Hair SILHOUETTE — gives each player a distinct head shape on top of skin/hair colour,
// so they're recognisable in 3D and on the card. Rendered by both the SVG avatars and
// the 3D rig.
export type HairStyleId = 'short' | 'buzz' | 'curly' | 'afro' | 'bald'
export type HairStyle = { id: HairStyleId; name: string }
export const HAIR_STYLES: HairStyle[] = [
  { id: 'short', name: 'Short' },
  { id: 'buzz', name: 'Buzz cut' },
  { id: 'curly', name: 'Curly' },
  { id: 'afro', name: 'Afro' },
  { id: 'bald', name: 'Bald' },
]

export const DEFAULT_APPEARANCE: Appearance = { skin: 'fair', hair: 'brown', hairStyle: 'short' }

const SKIN_BY_ID = Object.fromEntries(SKIN_TONES.map((s) => [s.id, s]))
const HAIR_BY_ID = Object.fromEntries(HAIR_COLORS.map((h) => [h.id, h]))
const HAIRSTYLE_BY_ID = Object.fromEntries(HAIR_STYLES.map((h) => [h.id, h]))

/**
 * How a hair style is drawn in 3D: cap radius scale (around the head sphere), a
 * vertical lift, whether any hair shows at all, and surface roughness. `bald` shows
 * none; `afro`/`curly` puff out; `buzz` hugs the scalp.
 */
export function hairRig(styleId: string): { show: boolean; scale: number; lift: number; rough: number } {
  switch (styleId) {
    case 'bald':
      return { show: false, scale: 1, lift: 0, rough: 1 }
    case 'buzz':
      return { show: true, scale: 0.93, lift: -0.01, rough: 1 }
    case 'curly':
      return { show: true, scale: 1.12, lift: 0.02, rough: 1 }
    case 'afro':
      return { show: true, scale: 1.32, lift: 0.06, rough: 1 }
    default:
      return { show: true, scale: 1.0, lift: 0, rough: 0.95 }
  }
}

// Self-contained shade (no playerKit import) so this module has zero cycle risk and can
// be used by both the SVG card renderers and the canvas sim kit builder.
function clamp255(n: number): number {
  return Math.max(0, Math.min(255, Math.round(n)))
}
function toHex(n: number): string {
  return clamp255(n).toString(16).padStart(2, '0')
}
function shadeHex(hex: string, amt: number): string {
  const h = hex.replace('#', '')
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h
  const r = parseInt(full.slice(0, 2), 16)
  const g = parseInt(full.slice(2, 4), 16)
  const b = parseInt(full.slice(4, 6), 16)
  const mix = (c: number) => (amt < 0 ? c * (1 + amt) : c + (255 - c) * amt)
  return `#${toHex(mix(r))}${toHex(mix(g))}${toHex(mix(b))}`
}

/** Resolved colour fields for drawing a face/body from an Appearance. */
export type FaceColors = {
  skin: string
  skinShade: string
  skinHi: string
  hair: string
  hairHi: string
}

/** Normalise an arbitrary (possibly legacy/partial) appearance to a valid one. */
export function normalizeAppearance(a?: Partial<Appearance> | null): Appearance {
  return {
    skin: a?.skin && SKIN_BY_ID[a.skin] ? a.skin : DEFAULT_APPEARANCE.skin,
    hair: a?.hair && HAIR_BY_ID[a.hair] ? a.hair : DEFAULT_APPEARANCE.hair,
    hairStyle: a?.hairStyle && HAIRSTYLE_BY_ID[a.hairStyle] ? a.hairStyle : DEFAULT_APPEARANCE.hairStyle,
  }
}

type Rng = () => number
const pickId = <T extends { id: string }>(arr: T[], rng: Rng): string => arr[Math.floor(rng() * arr.length)].id

/** A fully random look — independent skin tone, hair colour, and hair style. */
export function randomAppearance(rng: Rng = Math.random): Appearance {
  return {
    skin: pickId(SKIN_TONES, rng),
    hair: pickId(HAIR_COLORS, rng),
    hairStyle: pickId(HAIR_STYLES, rng),
  }
}

/** Turn an Appearance into the concrete colours the renderers use. */
export function faceColors(a?: Partial<Appearance> | null): FaceColors {
  const norm = normalizeAppearance(a)
  const skin = SKIN_BY_ID[norm.skin].base
  const hair = HAIR_BY_ID[norm.hair].base
  return {
    skin,
    skinShade: shadeHex(skin, -0.18),
    skinHi: shadeHex(skin, 0.2),
    hair,
    hairHi: shadeHex(hair, 0.28),
  }
}
