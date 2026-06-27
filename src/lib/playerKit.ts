// Universal player appearance.
//
// YOUR PLAYER is the same person everywhere — the card, the locker preview, and
// every drill / Quantum League game. The equipped loadout (jersey + cleats) is the
// single source of truth. The card/locker render it as SVG; the canvas sims render
// it as flat shapes. This module converts the equipped cosmetics into the colour
// fields the canvas sims already use, so changing your loadout updates the player
// EVERYWHERE without touching each sim's drawing code.

import { useMemo } from 'react'
import { COSMETICS_BY_ID } from '../content/cosmetics'
import { usePlayer } from '../state/PlayerState'
import type { JerseyPattern } from '../types'

const FALLBACK_JERSEY = { primary: '#2f6df0', secondary: '#1d4ec0', accent: '#ffffff' }
const FALLBACK_CLEATS = { primary: '#15171f', secondary: '#05060a', accent: '#5a606b' }

function clamp255(n: number): number {
  return Math.max(0, Math.min(255, Math.round(n)))
}
function toHex(n: number): string {
  return clamp255(n).toString(16).padStart(2, '0')
}
/** Lighten (amt > 0, toward white) or darken (amt < 0, toward black) a hex colour. */
export function shade(hex: string, amt: number): string {
  const h = hex.replace('#', '')
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h
  const r = parseInt(full.slice(0, 2), 16)
  const g = parseInt(full.slice(2, 4), 16)
  const b = parseInt(full.slice(4, 6), 16)
  const mix = (c: number) => (amt < 0 ? c * (1 + amt) : c + (255 - c) * amt)
  return `#${toHex(mix(r))}${toHex(mix(g))}${toHex(mix(b))}`
}

/** The full set of kit colour fields used across the canvas sims. */
export type LoadoutColors = {
  jersey: string
  jerseyDark: string
  jerseyHi: string
  collar: string
  shorts: string
  shortsDark: string
  sock: string
  sockBand: string
  boot: string
  bootDark: string
  number: string
  /** Jersey secondary + artwork hints (for sims that want to draw a pattern). */
  accent: string
  pattern: JerseyPattern
}

/** Derive the universal kit colours from an equipped jersey + cleats id. */
export function loadoutColors(jerseyId: string, cleatsId: string): LoadoutColors {
  const jc = COSMETICS_BY_ID[jerseyId]
  const cc = COSMETICS_BY_ID[cleatsId]
  const j = jc?.colors ?? FALLBACK_JERSEY
  const c = cc?.colors ?? FALLBACK_CLEATS
  const shorts = jc?.shorts ?? shade(j.primary, -0.45)
  return {
    jersey: j.primary,
    jerseyDark: shade(j.primary, -0.24),
    jerseyHi: shade(j.primary, 0.32),
    collar: shade(j.primary, -0.42),
    shorts,
    shortsDark: shade(shorts, -0.32),
    sock: j.primary,
    sockBand: j.accent,
    boot: c.primary,
    bootDark: shade(c.primary, -0.45),
    number: j.accent,
    accent: j.secondary,
    pattern: jc?.pattern ?? 'plain',
  }
}

// The loadout drives the jersey-top design, the SOCKS (always the same colour as the
// jersey), and the cleat colour. Everything else about the body (shorts = always white,
// collar, skin, hair) belongs to the individual sim so it can be drawn + animated
// correctly from the back. `sock` is derived from the jersey primary and `sockBand` from
// the jersey accent in loadoutColors(), so swapping the jersey re-colours the socks too.
const DESIGN_KEYS = new Set<keyof LoadoutColors>([
  'jersey', 'jerseyDark', 'jerseyHi', 'number', 'accent', 'pattern',
  'sock', 'sockBand', 'boot', 'bootDark',
])

/**
 * Merge ONLY the equipped loadout's jersey design + cleat colour onto a sim's base kit.
 * Shorts / socks / collar / skin / hair are left exactly as the sim declared them, so the
 * body stays anatomically correct while the shirt + boots re-skin with the loadout.
 * `pattern` and `accent` are always carried so sims can render the jersey artwork.
 */
export function applyLoadout<T extends object>(base: T, jerseyId: string, cleatsId: string): T {
  const colors = loadoutColors(jerseyId, cleatsId)
  const merged: Record<string, unknown> = { ...(base as Record<string, unknown>) }
  for (const [k, v] of Object.entries(colors)) {
    const key = k as keyof LoadoutColors
    if (!DESIGN_KEYS.has(key)) continue
    // override declared design fields, and always carry pattern + accent intent through
    if (k in (base as Record<string, unknown>) || k === 'pattern' || k === 'accent') merged[k] = v
  }
  return merged as T
}

/** Hook: give it a sim's base "your player" kit, get back the loadout-skinned kit. */
export function usePlayerKit<T extends object>(base: T): T {
  const { profile } = usePlayer()
  const jerseyId = profile.equipped.jersey
  const cleatsId = profile.equipped.cleats
  return useMemo(() => applyLoadout(base, jerseyId, cleatsId), [base, jerseyId, cleatsId])
}
