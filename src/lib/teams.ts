// Opponent team identities + the "never wear the same kit as the player" guard.
//
// Every generated club (the 25 Quantum League rivals, and the per-drill
// foes) is assigned a jersey colour from a fixed palette. When you go INTO a game, the
// opponent's colour is checked against YOUR equipped jersey — if they clash, the
// opponent is swapped to a different, clearly-contrasting kit so the two teams never
// look the same. This works for the lesson drills today and for the combined matchday
// games we build on top of the same sims.

import { useEffect } from 'react'
import { shade } from './playerKit'
import { useApp } from '../state/AppState'
import { UNITS } from '../content/lessons'

export type TeamColor = { id: string; name: string; primary: string; secondary: string; accent: string }

// A spread of distinct, vivid kit colours. Order matters: the clash-swap picks the FIRST
// entry that doesn't clash with the player, so earlier entries are preferred replacements.
export const OPPONENT_PALETTE: TeamColor[] = [
  { id: 'red', name: 'Crimson', primary: '#ef4444', secondary: '#b91c1c', accent: '#ffe8e8' },
  { id: 'royal', name: 'Royal Blue', primary: '#2f6df0', secondary: '#1d4ec0', accent: '#ffffff' },
  { id: 'emerald', name: 'Emerald', primary: '#13b074', secondary: '#0a7c54', accent: '#eafff5' },
  { id: 'violet', name: 'Violet', primary: '#7c4bff', secondary: '#5a2fd0', accent: '#f1ecff' },
  { id: 'orange', name: 'Orange', primary: '#ff7a1a', secondary: '#d65a00', accent: '#fff2e6' },
  { id: 'teal', name: 'Teal', primary: '#16b3c4', secondary: '#0c7e8c', accent: '#e8feff' },
  { id: 'magenta', name: 'Magenta', primary: '#e23a8f', secondary: '#b01f6c', accent: '#ffe9f4' },
  { id: 'amber', name: 'Amber', primary: '#f7c81f', secondary: '#caa00a', accent: '#1a1a1a' },
  { id: 'navy', name: 'Navy', primary: '#1b2a6b', secondary: '#0f1a45', accent: '#cdd6ff' },
  { id: 'slate', name: 'Slate', primary: '#3a4250', secondary: '#222831', accent: '#aab3c2' },
  { id: 'maroon', name: 'Maroon', primary: '#8c1f2f', secondary: '#5e1320', accent: '#ffd7dc' },
  { id: 'lime', name: 'Lime', primary: '#7bbf2a', secondary: '#558a16', accent: '#f2ffe0' },
]

// The 25 Quantum League rivals (none reuse the five lesson units). Together with YOUR
// club (Physics FC) that's a 26-team division; you play each rival twice (home + away)
// for a 50-match season — Premier-League style.
export const LEAGUE_TEAMS = [
  'Atlético Entropy', 'Real Relativity', 'Inertia City', 'Quantum Rovers', 'Photon FC',
  'Electron United', 'Sporting Gravitas', 'Dynamo Tesla', 'Inter Friction', 'Vector Wanderers',
  'Newton North End', 'Joule Town', 'Watt Albion', 'Plasma Rangers', 'Fusion Athletic',
  'Neutron County', 'Graviton FC', 'Boson Hotspur', 'Quark City', 'Terminal Velocity FC',
  'Torque United', 'Amplitude Athletic', 'Resonance Rovers', 'Pendulum FC', 'Vortex City',
] as const

// YOUR club — always part of the division + standings table.
export const PLAYER_CLUB = 'Physics FC'

// Generic words that don't make a good club shorthand (suffixes / common prefixes).
const GENERIC_WORDS = new Set([
  'fc', 'united', 'city', 'town', 'albion', 'rovers', 'athletic', 'wanderers', 'county',
  'rangers', 'hotspur', 'end', 'north', 'real', 'inter', 'sporting', 'dynamo', 'atlético',
  'atletico',
])

function stripAccents(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
}

/** A 3-letter club shorthand (e.g. "Atlético Entropy" → "ENT"), Premier-League style. */
export function clubCode(name: string): string {
  const words = name.split(/\s+/)
  const distinctive =
    words
      .filter((w) => !GENERIC_WORDS.has(w.toLowerCase()))
      .sort((a, b) => b.length - a.length)[0] ?? words[0]
  return stripAccents(distinctive).replace(/[^a-zA-Z]/g, '').slice(0, 3).toUpperCase()
}

/** A 1-2 letter crest monogram from the club name's first words. */
export function clubMonogram(name: string): string {
  const words = name.split(/\s+/).filter(Boolean)
  if (words.length >= 2) return stripAccents(words[0][0] + words[1][0]).toUpperCase()
  return stripAccents(words[0] ?? '?').slice(0, 2).toUpperCase()
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '')
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h
  return [parseInt(full.slice(0, 2), 16), parseInt(full.slice(2, 4), 16), parseInt(full.slice(4, 6), 16)]
}

/**
 * Two kit colours "clash" if they're close enough that the teams would read as the same
 * side. Plain Euclidean RGB distance with a generous threshold catches exact matches AND
 * near-matches (e.g. two reds), which is what we want for kit legibility.
 */
export function colorsClash(a: string, b: string, threshold = 105): boolean {
  const [r1, g1, b1] = hexToRgb(a)
  const [r2, g2, b2] = hexToRgb(b)
  return Math.hypot(r1 - r2, g1 - g2, b1 - b2) < threshold
}

/** Deterministic (but arbitrary-looking) palette colour for a club name. */
function hashStr(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0
  return h
}

// A fixed, hand-tuned jersey colour for every club, set ONCE. No two primaries are the
// EXACT same hex; some live in the same colour family (there are only so many colours),
// but clubs that share a crest monogram are kept in clearly different hues so no two
// badges read as "too similar". The secondary (shade) + accent (auto contrast) are
// derived, so the crest + kit stay coherent. Physics FC isn't here — YOUR club always
// wears YOUR equipped jersey.
const TEAM_PRIMARY: Record<string, string> = {
  'Atlético Entropy': '#e02d2d', // red
  'Real Relativity': '#2563eb', // royal blue        (RR ↔ Resonance Rovers: olive)
  'Inertia City': '#06b6d4', // cyan
  'Quantum Rovers': '#7c3aed', // violet
  'Photon FC': '#f5b81f', // gold                    (PF ↔ Pendulum FC: blue-violet)
  'Electron United': '#059669', // emerald
  'Sporting Gravitas': '#8c1f2f', // maroon
  'Dynamo Tesla': '#0d9488', // teal
  'Inter Friction': '#ea580c', // orange
  'Vector Wanderers': '#4338ca', // indigo
  'Newton North End': '#15803d', // forest green
  'Joule Town': '#d97706', // amber
  'Watt Albion': '#38bdf8', // sky blue
  'Plasma Rangers': '#db2777', // magenta
  'Fusion Athletic': '#f43f5e', // coral red
  'Neutron County': '#64748b', // slate
  'Graviton FC': '#9333ea', // purple
  'Boson Hotspur': '#1e3a8a', // navy
  'Quark City': '#65a30d', // lime
  'Terminal Velocity FC': '#14b8a6', // turquoise
  'Torque United': '#b45309', // rust
  'Amplitude Athletic': '#ec4899', // pink
  'Resonance Rovers': '#4d7c0f', // olive green
  'Pendulum FC': '#6366f1', // blue-violet
  'Vortex City': '#0ea5e9', // azure
}

/** Pick a readable crest/number accent (dark on light primaries, white on dark ones). */
function autoAccent(primary: string): string {
  const [r, g, b] = hexToRgb(primary)
  const lum = 0.299 * r + 0.587 * g + 0.114 * b
  return lum > 150 ? '#1c1606' : '#ffffff'
}

/** The fixed colour scheme for a club: its set primary + a derived shade + accent. */
export function teamColor(name: string): TeamColor {
  const primary = TEAM_PRIMARY[name]
  if (primary) {
    return { id: name, name, primary, secondary: shade(primary, -0.34), accent: autoAccent(primary) }
  }
  // Fallback for any unmapped name (e.g. legacy data): deterministic palette pick.
  return OPPONENT_PALETTE[hashStr(name) % OPPONENT_PALETTE.length]
}

/**
 * The core check: given an opponent's PREFERRED jersey primary and the colour to AVOID
 * (the player's equipped jersey), return a primary that does not clash. Returns the
 * preferred colour untouched when there's no clash; otherwise the first palette colour
 * that's clearly different from the player's.
 */
export function pickNonClashingColor(preferred: string, avoid: string): string {
  if (!colorsClash(preferred, avoid)) return preferred
  for (const c of OPPONENT_PALETTE) {
    if (!colorsClash(c.primary, avoid)) return c.primary
  }
  return preferred // palette exhausted (shouldn't happen) — keep the original
}

/** Resolve a named team's jersey primary for a game, swapped if it clashes with the player. */
export function resolveTeamColor(name: string, playerPrimary: string): string {
  return pickNonClashingColor(teamColor(name).primary, playerPrimary)
}

// Kit objects that carry a recolourable jersey. The sims' FOE/GK kits all satisfy this.
type ColoredKit = { jersey: string; jerseyDark: string; jerseyHi: string; collar: string; sock: string }

function recolorOpponent(kit: ColoredKit, primary: string): void {
  kit.jersey = primary
  kit.jerseyDark = shade(primary, -0.3)
  kit.jerseyHi = shade(primary, 0.34)
  kit.collar = shade(primary, -0.5)
  kit.sock = primary
}

// Once the course is finished, every replayed drill is the "Training Ground": the
// opponent always wears RED (or ROYAL BLUE if you've equipped a red kit).
export const TRAINING_GROUND_PRIMARY = '#ef4444'

// Distinct opponent colours for the LESSON phase — each drill is a different club, so its
// opponent gets its own kit (avoid red, which is reserved for the Training Ground, and
// royal blue, which is the player's default/team colour).
export const DRILL_COLORS = {
  kinematics: '#e23a8f', // magenta keeper
  motion: '#7c4bff', // violet
  forces: '#ff7a1a', // orange
  energy: '#16b3c4', // teal
  energyKeeper: '#f7c81f', // amber keeper
  defense: '#13b074', // emerald
} as const

// True when all five lesson units are mastered → Quantum League / Training Ground mode.
function useCourseComplete(): boolean {
  const { progress } = useApp()
  return UNITS.every((u) => progress.unitStatus[u.id] === 'mastered')
}

/**
 * Hook: colour an opponent kit so it never matches the player's equipped jersey, and so
 * each phase reads right.
 *
 *  • BEFORE the Quantum League is unlocked, each drill is a DIFFERENT club, so pass that
 *    drill's distinct `lessonPrimary`.
 *  • ONCE unlocked (Training Ground), every opponent wears RED — unless YOU wear red, in
 *    which case the clash-guard swaps them to royal blue.
 *
 * The opponent's shirt + socks are recoloured IN PLACE so the canvas draw loop and any
 * `kit === FOE_KIT` identity checks in the sims keep working.
 */
export function useOpponentClashGuard(kit: ColoredKit, lessonPrimary: string, avoidPrimary: string): void {
  const trainingGround = useCourseComplete()
  useEffect(() => {
    const preferred = trainingGround ? TRAINING_GROUND_PRIMARY : lessonPrimary
    recolorOpponent(kit, pickNonClashingColor(preferred, avoidPrimary))
  }, [kit, lessonPrimary, avoidPrimary, trainingGround])
}
