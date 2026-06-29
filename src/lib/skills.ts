import type { GkStatId, PlayerSkills, SkillId, UnitDef, UnitId } from '../types'

// ===========================================================================
// TWO SEPARATE THINGS live in this file:
//
//  1. LEARNING UNITS (`UNITS` / `SKILL_IDS` / `SKILLS_BY_ID`) — the physics
//     units behind the lessons, the mini soccer games and the assessment.
//     They are a soccer-themed WAY TO LEARN and award generic skill points.
//
//  2. GAME SKILLS (`GAME_SKILLS`) — the six upgradable attributes of YOUR 3D
//     FIFA-style player (shooting, passing, dribbling, heading, defending,
//     stamina). These are stored per user and drive the 3D match directly.
//
// The two are fully DECOUPLED: which unit you trained has nothing to do with
// which attribute you spend the earned points on.
// ===========================================================================

// ---- 1. Learning units -----------------------------------------------------
// Historical export name kept (`SKILLS`) so the lessons/test/schedule imports
// don't churn, but each entry is a learning UNIT, not a player attribute.
export const SKILLS: UnitDef[] = [
  { id: 'kinematics', name: 'Shooting', action: 'Take a shot', primaryConceptTag: 'projectile-range' },
  { id: 'motion-graphs', name: 'Passing', action: 'Play a through-ball', primaryConceptTag: 'graph-slope-as-velocity' },
  { id: 'forces', name: 'Dribbling', action: 'Beat your man', primaryConceptTag: 'force-net-force' },
  { id: 'energy', name: 'Heading', action: 'Win the header', primaryConceptTag: 'energy-conservation' },
  { id: 'momentum', name: 'Defending', action: 'Win the ball', primaryConceptTag: 'momentum-collisions' },
]

// Goalkeeping (impulse) is RETAINED in code (the keeper sim + its lesson/quiz still
// build and resolve via SKILLS_BY_ID) but is NOT offered as a unit, so it never
// appears on the card, in the test, or in the schedule.
const GOALKEEPING: UnitDef = {
  id: 'impulse',
  name: 'Goalkeeping',
  action: 'Make the save',
  primaryConceptTag: 'impulse-momentum',
}

/** Every unit definition, including the unoffered goalkeeping (for keeper-sim lookups). */
export const ALL_SKILLS: UnitDef[] = [...SKILLS, GOALKEEPING]

/** Offered unit ids only (5). Drives the lessons, the test, and proficiency. */
export const SKILL_IDS: UnitId[] = SKILLS.map((s) => s.id)
/** Lookups cover ALL units so retained keeper code can still resolve 'impulse'. */
export const SKILLS_BY_ID: Record<UnitId, UnitDef> = Object.fromEntries(
  ALL_SKILLS.map((s) => [s.id, s]),
) as Record<UnitId, UnitDef>

// ---- 2. Game skills (your 3D player's upgradable attributes) ----------------
export type GameSkillDef = {
  id: SkillId
  /** Display name on the player card / locker. */
  name: string
  /** FIFA-style 3-letter abbreviation. */
  abbr: string
  /** What raising it does in the 3D match. */
  blurb: string
}

export const GAME_SKILLS: GameSkillDef[] = [
  { id: 'shooting', name: 'Shooting', abbr: 'SHO', blurb: 'Harder, more accurate finishing' },
  { id: 'passing', name: 'Passing', abbr: 'PAS', blurb: 'Crisper, better-weighted passes & crosses' },
  { id: 'dribbling', name: 'Dribbling', abbr: 'DRI', blurb: 'Tighter close control and agility' },
  { id: 'heading', name: 'Heading', abbr: 'HEA', blurb: 'Win more aerial duels & headers' },
  { id: 'defending', name: 'Defending', abbr: 'DEF', blurb: 'Stronger tackling and interceptions' },
  { id: 'stamina', name: 'Stamina', abbr: 'STA', blurb: 'Drains slower & refills faster when sprinting' },
]

/** All six outfield game-skill ids. */
export const GAME_SKILL_IDS: SkillId[] = GAME_SKILLS.map((s) => s.id)

export type GkSkillDef = {
  id: GkStatId
  name: string
  abbr: string
  blurb: string
}

/** The goalkeeper's three upgradable attributes (replace the six outfield ones). */
export const GK_SKILLS: GkSkillDef[] = [
  { id: 'diving', name: 'Diving', abbr: 'DIV', blurb: 'Lateral reach and dive range across goal' },
  { id: 'handling', name: 'Handling', abbr: 'HAN', blurb: 'Holds shots cleanly instead of parrying' },
  { id: 'reflexes', name: 'Reflexes', abbr: 'REF', blurb: 'Reaction speed and shot-stopping reach' },
]
export const GK_STAT_IDS: GkStatId[] = GK_SKILLS.map((s) => s.id)
/**
 * The five OUTFIELD performance skills that define the headline overall. Stamina
 * is a conditioning stat and is intentionally excluded from the OVR average.
 */
export const CORE_SKILL_IDS: SkillId[] = ['shooting', 'passing', 'dribbling', 'heading', 'defending']

export const STARTING_RATING = 50
export const MAX_RATING = 99
export const MIN_RATING = 1

export function defaultSkills(): PlayerSkills {
  const out = {} as PlayerSkills
  for (const id of GAME_SKILL_IDS) out[id] = STARTING_RATING
  return out
}

/** Overall rating = rounded average across the five core (non-stamina) skills. */
export function overallRating(skills: PlayerSkills): number {
  const vals = CORE_SKILL_IDS.map((id) => skills[id] ?? STARTING_RATING)
  return Math.round(vals.reduce((a, b) => a + b, 0) / vals.length)
}

// Legacy unit-keyed skill maps (kinematics → shooting, etc.) are migrated to the
// new game-attribute keys so returning users keep their trained ratings.
const LEGACY_SKILL_MAP: Record<string, SkillId> = {
  kinematics: 'shooting',
  'motion-graphs': 'passing',
  forces: 'dribbling',
  energy: 'heading',
  momentum: 'defending',
}

/**
 * Normalise a skills object loaded from the cloud / local cache into the current
 * six game-attribute keys. Handles three cases: already-new keys, legacy
 * unit-keyed ratings (mapped across), and missing keys (defaulted to 50).
 */
export function migrateSkills(raw: Partial<Record<string, number>> | null | undefined): PlayerSkills {
  const out = defaultSkills()
  if (!raw) return out
  // 1) Carry over any already-new game-skill keys.
  for (const id of GAME_SKILL_IDS) {
    const v = raw[id]
    if (typeof v === 'number') out[id] = v
  }
  // 2) Map any legacy unit-keyed ratings onto the matching attribute (only when
  //    the new key wasn't already present, so new data always wins).
  for (const [legacy, target] of Object.entries(LEGACY_SKILL_MAP)) {
    const v = raw[legacy]
    if (typeof v === 'number' && typeof raw[target] !== 'number') out[target] = v
  }
  return out
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
