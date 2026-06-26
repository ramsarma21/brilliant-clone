import type { PlayerSkills, SkillDef, SkillId } from '../types'

// The six trainable skills, one per physics unit. `primaryConceptTag` is the
// concept an in-match question of this skill draws from by default.
export const SKILLS: SkillDef[] = [
  { id: 'kinematics', name: 'Shooting', action: 'Take a shot', primaryConceptTag: 'projectile-range' },
  { id: 'motion-graphs', name: 'Passing', action: 'Play a through-ball', primaryConceptTag: 'graph-slope-as-velocity' },
  { id: 'forces', name: 'Dribbling', action: 'Beat your man', primaryConceptTag: 'force-net-force' },
  { id: 'energy', name: 'Heading', action: 'Win the header', primaryConceptTag: 'energy-conservation' },
  { id: 'momentum', name: 'Defending', action: 'Win the ball', primaryConceptTag: 'momentum-collisions' },
  { id: 'impulse', name: 'Goalkeeping', action: 'Make the save', primaryConceptTag: 'impulse-momentum' },
]

export const SKILL_IDS: SkillId[] = SKILLS.map((s) => s.id)
export const SKILLS_BY_ID: Record<SkillId, SkillDef> = Object.fromEntries(
  SKILLS.map((s) => [s.id, s]),
) as Record<SkillId, SkillDef>

export const STARTING_RATING = 50
export const MAX_RATING = 99
export const MIN_RATING = 1

export function defaultSkills(): PlayerSkills {
  const out = {} as PlayerSkills
  for (const id of SKILL_IDS) out[id] = STARTING_RATING
  return out
}

/** Overall rating = rounded average across the six skills. */
export function overallRating(skills: PlayerSkills): number {
  const vals = SKILL_IDS.map((id) => skills[id] ?? STARTING_RATING)
  return Math.round(vals.reduce((a, b) => a + b, 0) / vals.length)
}

/**
 * Probability that attempting this skill's move REQUIRES solving a question.
 * Inverse to rating: 50 -> 0.50, and 99 (max) -> 0 (free play). This is the core
 * incentive to do well on the test.
 */
export function questionProbability(rating: number): number {
  if (rating >= MAX_RATING) return 0
  const p = (100 - rating) / 100
  return Math.min(1, Math.max(0, p))
}

/** Roll whether a question is required for an attempt at the given rating. */
export function needsQuestion(rating: number, rng: () => number = Math.random): boolean {
  return rng() < questionProbability(rating)
}

/**
 * Spend skill points to raise one skill, capped at MAX_RATING. Returns the new
 * skills map and how many points were actually consumed (can't overspend or
 * push a skill past the cap).
 */
export function spendSkillPoints(
  skills: PlayerSkills,
  id: SkillId,
  points: number,
): { skills: PlayerSkills; used: number } {
  const current = skills[id] ?? STARTING_RATING
  const headroom = Math.max(0, MAX_RATING - current)
  const used = Math.max(0, Math.min(points, headroom))
  if (used === 0) return { skills, used: 0 }
  return { skills: { ...skills, [id]: current + used }, used }
}
