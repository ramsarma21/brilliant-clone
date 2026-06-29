import type { GkSkills, PlayerSkills } from '../types'
import type { Archetype, Attributes, Role } from './types'
import { ARCH } from './config'
import { clamp, hashStr, invLerp, lerp } from './math'

// ============================================================================
// RATINGS — your six upgradable GAME SKILLS (shooting, passing, dribbling,
// heading, defending, stamina) map 1:1 to FIFA-style match attributes, and the
// rest of both squads are synthesised by role/overall. These numbers drive every
// move (speed, shot/pass quality, tackle odds, GK reach, stamina rate). They are
// fully decoupled from the physics learning units.
// ============================================================================

const OVERALL_OF = (s: PlayerSkills): number =>
  Math.round((s.shooting + s.passing + s.dribbling + s.heading + s.defending) / 5)

/** Your upgraded game skills → the attribute block for YOUR star (the player you mostly drive). */
export function attrsFromSkills(s: PlayerSkills): Attributes {
  const overall = OVERALL_OF(s)
  return {
    shooting: s.shooting,
    passing: s.passing,
    dribbling: s.dribbling,
    heading: s.heading,
    defending: s.defending,
    // Your star is an outfielder; the keeper is rebuilt from your overall in world.ts.
    gk: overall,
    pace: clamp(Math.round(overall * 0.6 + s.dribbling * 0.4), 30, 99),
    stamina: s.stamina,
  }
}

/**
 * YOUR keeper's three GK stats → a full attribute block. Reflexes/diving/handling
 * blend into the `gk` reach used for saves, diving also drives lateral pace, and
 * the rest of the block sits at a keeper-appropriate (low) baseline so he plays
 * like a goalie, not an outfielder.
 */
export function attrsFromGk(g: GkSkills): Attributes {
  const gkRating = clamp(Math.round(g.reflexes * 0.5 + g.diving * 0.3 + g.handling * 0.2), 20, 99)
  const base = attrsForRole(gkRating, 'GK')
  return {
    ...base,
    gk: gkRating,
    pace: clamp(Math.round(g.diving * 0.55 + g.reflexes * 0.45), 30, 99),
  }
}

const ROLE_BIAS: Record<Role, Partial<Attributes>> = {
  GK: { gk: 14, defending: 6, pace: -6, shooting: -20, dribbling: -16, stamina: -6 },
  DEF: { defending: 10, heading: 6, pace: 2, shooting: -8 },
  MID: { passing: 8, dribbling: 4, pace: 2, stamina: 6 },
  FWD: { shooting: 10, pace: 6, dribbling: 6, defending: -8 },
}

function biased(base: number, role: Role, key: keyof Attributes): number {
  return clamp(Math.round(base + (ROLE_BIAS[role][key] ?? 0)), 20, 99)
}

/** Build an attribute block around a single overall, tilted by role. */
export function attrsForRole(overall: number, role: Role, jitter = 0): Attributes {
  const b = clamp(overall + jitter, 20, 99)
  return {
    pace: biased(b, role, 'pace'),
    shooting: biased(b, role, 'shooting'),
    passing: biased(b, role, 'passing'),
    dribbling: biased(b, role, 'dribbling'),
    defending: biased(b, role, 'defending'),
    heading: biased(b, role, 'heading'),
    gk: biased(role === 'GK' ? b + 8 : b - 24, role, 'gk'),
    stamina: biased(b, role, 'stamina'),
  }
}

/**
 * Opponent team strength — centred on YOUR overall so matches are roughly even. A small
 * season ramp makes later matchdays a touch tougher, plus minor per-club variance.
 */
export function opponentStrength(yourOverall: number, matchday: number, opponentName: string): number {
  // Always pitch the opponent a notch BELOW you so a match is fun and winnable — the AI never has a
  // higher overall than you. The season ramp + per-club variance only change HOW MUCH easier it is
  // (tougher clubs / later in the season close the gap, but it stays at least a point in your favour).
  const seasonAdj = (invLerp(1, 50, matchday) - 0.5) * 4 // -2 (early) .. +2 (late) — gentle
  const variance = (hashStr(opponentName) - 0.5) * 3 // +/-1.5 per club
  const target = yourOverall - 3 + seasonAdj + variance
  return clamp(Math.round(target), yourOverall - 6, yourOverall - 1)
}

// ---- Attribute → effect curves (shared by the sim) ----
/** 0-99 attribute → 0..1 normalised quality. */
export const q = (a: number): number => clamp(a / 99, 0, 1)
/** Map an attribute through a min..max output range. */
export const curve = (a: number, min: number, max: number): number => lerp(min, max, q(a))

/**
 * AcceleRATE-style archetype. Quick-and-agile players (dribbling >> pace) are EXPLOSIVE:
 * high accel, slightly lower top speed. Rangy players (pace >> dribbling) are LENGTHY: slow
 * to wind up but quicker flat-out. Everyone else is CONTROLLED. Differentiates feel beyond
 * raw top speed and makes the pace/agility stats both matter.
 */
export function archetypeFor(attrs: Attributes): { archetype: Archetype; accel: number; topMult: number } {
  const gap = q(attrs.dribbling) - q(attrs.pace) // + = agile, - = rangy
  // t in [0,1]: 0 = fully lengthy, 1 = fully explosive
  const t = clamp(0.5 + gap / (ARCH.EXPLOSIVE_GAP * 2), 0, 1)
  const accel = lerp(ARCH.ACCEL_MIN, ARCH.ACCEL_MAX, t)
  const topMult = lerp(ARCH.TOP_MAX, ARCH.TOP_MIN, t) // lengthy (t→0) get the higher top end
  const archetype: Archetype = gap > ARCH.EXPLOSIVE_GAP ? 'explosive' : gap < ARCH.LENGTHY_GAP ? 'lengthy' : 'controlled'
  return { archetype, accel, topMult }
}

/** Strength/mass proxy for shoulder-to-shoulder duels (heading + defending physicality). */
export function massFor(attrs: Attributes): number {
  return lerp(0.8, 1.3, clamp((q(attrs.heading) * 0.55 + q(attrs.defending) * 0.45), 0, 1))
}
