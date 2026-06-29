// YOUR club's identity (FC name + crest). Editable in the locker and stored per user.
// Defaults to "Physics FC" with a ball-on-a-shield badge; the crest follows your equipped
// jersey colours unless you pick explicit override colours.

import type { ClubIdentity, EmblemConfig, EmblemMotif, EmblemShape } from '../types'
import { LEAGUE_TEAMS, PLAYER_CLUB, teamColor } from './teams'
import { specFor } from '../components/ClubEmblem'

export const EMBLEM_SHAPES: EmblemShape[] = ['shield', 'classic', 'hex', 'roundel']
export const EMBLEM_MOTIFS: EmblemMotif[] = [
  'ball', 'atom', 'bolt', 'orbit', 'wave', 'star',
  'flame', 'arrow', 'mountain', 'pendulum', 'torque', 'spiral', 'sun',
]

export const SHAPE_LABEL: Record<EmblemShape, string> = {
  shield: 'Shield',
  classic: 'Classic',
  hex: 'Hexagon',
  roundel: 'Roundel',
}

export const MOTIF_LABEL: Record<EmblemMotif, string> = {
  ball: 'Football',
  atom: 'Atom',
  bolt: 'Bolt',
  orbit: 'Orbit',
  wave: 'Wave',
  star: 'Star',
  flame: 'Flame',
  arrow: 'Arrow',
  mountain: 'Peak',
  pendulum: 'Pendulum',
  torque: 'Torque',
  spiral: 'Spiral',
  sun: 'Sun',
}

export const DEFAULT_EMBLEM: EmblemConfig = { shape: 'shield', motif: 'ball' }
export const DEFAULT_CLUB_NAME = PLAYER_CLUB
export const MAX_CLUB_NAME = 22

export function defaultClubIdentity(): ClubIdentity {
  return { name: DEFAULT_CLUB_NAME, emblem: { ...DEFAULT_EMBLEM } }
}

type CrestColors = { primary: string; secondary: string; accent: string }

function normHex(c: string): string {
  return c.trim().toLowerCase()
}

/** A crest's full visual signature: silhouette + motif + the three colours. */
function emblemSignature(shape: EmblemShape, motif: EmblemMotif, colors: CrestColors): string {
  return [shape, motif, normHex(colors.primary), normHex(colors.secondary), normHex(colors.accent)].join('|')
}

/**
 * If the given crest would be IDENTICAL (same shape + motif + all three colours) to one of
 * the league rivals, return that rival's name; otherwise null. `fallback` supplies the
 * resolved colours for any emblem field left to "match kit" (undefined). Used to stop a
 * player picking a crest that's indistinguishable from another club's.
 */
export function emblemClashName(emblem: EmblemConfig, fallback: CrestColors): string | null {
  const colors: CrestColors = {
    primary: emblem.primary ?? fallback.primary,
    secondary: emblem.secondary ?? fallback.secondary,
    accent: emblem.accent ?? fallback.accent,
  }
  const mine = emblemSignature(emblem.shape, emblem.motif, colors)
  for (const name of LEAGUE_TEAMS) {
    const spec = specFor(name)
    const tc = teamColor(name)
    if (emblemSignature(spec.shape, spec.motif, tc) === mine) return name
  }
  return null
}

/** Backfill / sanitise a club identity loaded from an older cache or the cloud. */
export function normalizeClub(c?: Partial<ClubIdentity> | null): ClubIdentity {
  const name = (c?.name ?? '').trim() || DEFAULT_CLUB_NAME
  const e = c?.emblem
  const shape = e && EMBLEM_SHAPES.includes(e.shape) ? e.shape : DEFAULT_EMBLEM.shape
  const motif = e && EMBLEM_MOTIFS.includes(e.motif) ? e.motif : DEFAULT_EMBLEM.motif
  const abbr = (c?.abbr ?? '').trim().toUpperCase().slice(0, 3) || undefined
  return {
    name: name.slice(0, MAX_CLUB_NAME),
    emblem: { shape, motif, primary: e?.primary, secondary: e?.secondary, accent: e?.accent },
    abbr,
  }
}
