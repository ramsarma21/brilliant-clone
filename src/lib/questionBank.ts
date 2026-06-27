import type { BankQuestion, QuestionDiagram, SkillId, UnitProficiency } from '../types'
import { SKILL_IDS } from './skills'
import { supabase, isSupabaseConfigured } from './supabase'
import { generateReviewQuestions } from './ai/reviewClient'
import kinematics from '../content/bank/kinematics.json'
import motionGraphs from '../content/bank/motion-graphs.json'
import forces from '../content/bank/forces.json'
import energy from '../content/bank/energy.json'
import momentum from '../content/bank/momentum.json'

// The pre-authored bank: 5 OFFERED units x 100 questions x 5 difficulty levels
// = 500, one file per unit. The old goalie/impulse content is folded into the
// single `momentum` unit. Source of truth is the `question_bank` table; we
// transparently fall back to these bundled JSON files so the test works offline
// / before the DB is seeded.

export const SEED_BANK = [
  ...kinematics,
  ...motionGraphs,
  ...forces,
  ...energy,
  ...momentum,
] as unknown as BankQuestion[]

type DbRow = {
  id: string
  unit_id: string
  concept_tag: string
  difficulty: number
  prompt: string
  choices: { id: string; label: string }[]
  correct_choice: string
  correct_value: number | null
  given: Record<string, number> | null
  formulas: string[] | null
  diagram: QuestionDiagram | null
  check_rel: string | null
  explanation: string | null
}

function rowToQuestion(r: DbRow): BankQuestion {
  return {
    id: r.id,
    unitId: r.unit_id as SkillId,
    conceptTag: r.concept_tag,
    difficulty: Math.min(5, Math.max(1, r.difficulty)) as 1 | 2 | 3 | 4 | 5,
    prompt: r.prompt,
    choices: r.choices,
    correctChoiceId: r.correct_choice,
    correctValue: r.correct_value ?? undefined,
    given: r.given ?? undefined,
    formulas: r.formulas ?? undefined,
    diagram: r.diagram ?? undefined,
    check: r.check_rel ?? undefined,
    explanation: r.explanation ?? '',
  }
}

export async function fetchBank(): Promise<BankQuestion[]> {
  if (!isSupabaseConfigured) return SEED_BANK
  try {
    const { data, error } = await supabase.from('question_bank').select('*')
    if (error || !data || (data as DbRow[]).length === 0) return SEED_BANK
    return (data as DbRow[]).map(rowToQuestion)
  } catch {
    return SEED_BANK
  }
}

// Map a unit proficiency (0..100) to how many of the 4 questions come from each
// of the 5 difficulty levels [L1..L5]. Weak units lean easy (scaffolding),
// strong units lean hard (desirable difficulty). Each row sums to PER_UNIT (4).
function difficultyMix(proficiency: number): [number, number, number, number, number] {
  if (proficiency < 30) return [2, 2, 0, 0, 0]
  if (proficiency < 50) return [1, 2, 1, 0, 0]
  if (proficiency < 70) return [0, 1, 2, 1, 0]
  if (proficiency < 85) return [0, 0, 1, 2, 1]
  return [0, 0, 0, 2, 2]
}

function shuffle<T>(items: T[], rng: () => number): T[] {
  const out = [...items]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

// FNV-1a hash → 32-bit unsigned seed from any string (e.g. a username).
function hashSeed(str: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/**
 * Deterministic PRNG (mulberry32) seeded from a string. Same seed → same stream,
 * so a given account always gets the same shuffle, while different accounts get
 * different ones. This is how each learner's test is unique to them without any
 * hardcoded question list.
 */
export function seededRng(seed: string): () => number {
  let a = hashSeed(seed)
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const PER_UNIT = 4

type SelectOpts = {
  /** Deterministic RNG (seed it per-account for a unique-but-stable test). */
  rng?: () => number
  /**
   * Starter/base test: every question is difficulty 1 (a level playing field for
   * a brand-new account) instead of being weighted by proficiency.
   */
  starter?: boolean
}

/**
 * Build the gating test: 4 questions per OFFERED unit (5 units → 20 questions).
 * Normally difficulty-weighted by the learner's proficiency in each unit; for the
 * `starter` test every question is difficulty 1. Selection + final order are
 * driven entirely by the supplied `rng`, so seeding it from the account makes the
 * test unique to that account with nothing hardcoded. The old impulse/goalie
 * questions are folded into the single `momentum` unit.
 */
export function selectTestQuestions(
  bank: BankQuestion[],
  unitProf: Record<SkillId, UnitProficiency>,
  opts: SelectOpts = {},
): BankQuestion[] {
  const rng = opts.rng ?? Math.random
  const out: BankQuestion[] = []
  for (const unitId of SKILL_IDS) {
    const pool = bank.filter((q) => q.unitId === unitId)
    if (pool.length === 0) continue
    const byDiff: Record<number, BankQuestion[]> = { 1: [], 2: [], 3: [], 4: [], 5: [] }
    for (const q of pool) byDiff[q.difficulty]?.push(q)
    const mix: number[] = opts.starter
      ? [PER_UNIT, 0, 0, 0, 0]
      : difficultyMix(unitProf[unitId]?.proficiency ?? 0)

    const chosen: BankQuestion[] = []
    mix.forEach((count, idx) => {
      const diff = idx + 1
      const available = shuffle(byDiff[diff] ?? [], rng)
      chosen.push(...available.slice(0, count))
    })
    // Top up from anything left in the unit if a difficulty bucket was short.
    if (chosen.length < PER_UNIT) {
      const remaining = shuffle(
        pool.filter((q) => !chosen.includes(q)),
        rng,
      )
      chosen.push(...remaining.slice(0, PER_UNIT - chosen.length))
    }
    out.push(...chosen.slice(0, PER_UNIT))
  }
  // Interleave the units into a per-account order (also satisfies interleaving:
  // mixed problem types rather than four-in-a-row of one unit).
  return shuffle(out, rng)
}

export const TEST_TOTAL = SKILL_IDS.length * PER_UNIT
export const TEST_PASS_70 = 0.7
export const TEST_PASS_90 = 0.9
export const POINTS_FOR_70 = 5
export const POINTS_FOR_90 = 10

/** Skill points awarded for a given correct-count out of the total. */
export function pointsForScore(score: number, total: number): number {
  const pct = total > 0 ? score / total : 0
  if (pct >= TEST_PASS_90) return POINTS_FOR_90
  if (pct >= TEST_PASS_70) return POINTS_FOR_70
  return 0
}

/**
 * Produce the NEXT practice question on the same concept as a missed question —
 * "the same idea, slightly different". Used by the guided Skills review and by
 * the per-question Practice loop in test history.
 *
 * Strategy:
 *   1. Ask the live AI (generate-review) for one fresh question on this concept.
 *   2. If AI is unconfigured / offline / returns nothing, fall back to the bank:
 *      another unseen question with the same conceptTag (nearest difficulty),
 *      widening to the same unit only if the concept pool is exhausted.
 *
 * `excludeIds` prevents repeats within a session. Returns null only if the bank
 * has no more candidates at all (extremely unlikely with 100 per unit).
 */
export async function nextPracticeQuestion(
  bank: BankQuestion[],
  base: { unitId: SkillId; conceptTag: string; difficulty: 1 | 2 | 3 | 4 | 5 },
  excludeIds: Set<string>,
  rng: () => number = Math.random,
): Promise<BankQuestion | null> {
  // 1) Live AI, grounded in the concept's structured tags. To save credits we
  //    force a TEXT-ONLY question (never an image/diagram, which is costly to
  //    generate) and pin its difficulty to the question it branches off of.
  try {
    const ai = await generateReviewQuestions(
      [{ conceptTag: base.conceptTag, unitId: base.unitId, difficulty: base.difficulty }],
      1,
    )
    const fresh = ai.find((q) => !excludeIds.has(q.id))
    if (fresh) return { ...fresh, difficulty: base.difficulty, diagram: undefined }
  } catch {
    // fall through to the bank
  }

  // 2) Bank fallback — same concept first, then same unit.
  const sameConcept = bank.filter((q) => q.conceptTag === base.conceptTag && !excludeIds.has(q.id))
  const pool =
    sameConcept.length > 0
      ? sameConcept
      : bank.filter((q) => q.unitId === base.unitId && !excludeIds.has(q.id))
  if (pool.length === 0) return null
  // Prefer the closest difficulty to the original miss.
  const minGap = Math.min(...pool.map((q) => Math.abs(q.difficulty - base.difficulty)))
  const tier = pool.filter((q) => Math.abs(q.difficulty - base.difficulty) === minGap)
  return tier[Math.floor(rng() * tier.length)] ?? null
}
