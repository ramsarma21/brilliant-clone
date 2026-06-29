import type { BankQuestion, ConceptProficiency, ProficiencyMap, QuestionDiagram, UnitId } from '../types'
import { SKILL_IDS } from './skills'
import { conceptAbility, retrievability, targetDifficulty, weakestConcepts } from './proficiency'
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
    unitId: r.unit_id as UnitId,
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
// Of the 4 questions per unit, up to this many are reserved for spaced RETRIEVAL
// of the learner's weakest/most-faded concepts in that unit; the rest are
// on-level, desirable-difficulty coverage of (preferably newer) concepts.
const MAX_REVIEW_SLOTS = 2
// A concept counts as "needs retrieval" once its memory has faded past this
// retrievability, or if it has any active miss streak.
const REVIEW_RETRIEVABILITY = 0.7

type SelectOpts = {
  /** Deterministic RNG (seed it per-account for a unique-but-stable test). */
  rng?: () => number
  /**
   * Starter/base test: every question is difficulty 1 (a level playing field for
   * a brand-new account) instead of being weighted by proficiency.
   */
  starter?: boolean
  /** Injected clock so the forgetting-curve math is testable/deterministic. */
  now?: Date
}

/**
 * Pick the unseen question whose difficulty is closest to `targetDiff`. STABLE:
 * ties (same difficulty gap) keep the caller's order, so callers pre-shuffle for
 * randomness or pre-sort to express a preference (e.g. least-practised concept).
 */
function pickNearestDifficulty(
  candidates: BankQuestion[],
  targetDiff: number,
  taken: Set<string>,
): BankQuestion | null {
  const pool = candidates.filter((q) => !taken.has(q.id))
  if (pool.length === 0) return null
  const minGap = Math.min(...pool.map((q) => Math.abs(q.difficulty - targetDiff)))
  return pool.find((q) => Math.abs(q.difficulty - targetDiff) === minGap) ?? null
}

/**
 * Build the gating test: 4 questions per OFFERED unit (5 units → 20 questions),
 * personalized by the learner model (see lib/proficiency):
 *
 *   • DESIRABLE DIFFICULTY — each question's level targets the learner's shrunk
 *     ability so expected success sits in the ~80% effortful-but-winnable zone;
 *     ability rises → questions get harder, automatically and progressively.
 *   • SPACED RETRIEVAL — up to {@link MAX_REVIEW_SLOTS} slots per unit go to the
 *     weakest / most-faded concepts (forgetting curve + miss streaks), scaffolded
 *     a touch easier so the learner can actually rebuild them.
 *   • COVERAGE / INTERLEAVING — remaining slots favour less-practised concepts and
 *     the whole 20 are shuffled so units (and difficulties) interleave.
 *
 * The `starter` test (brand-new account, no evidence) is all difficulty 1.
 * Everything is driven by the supplied `rng`, so a per-account seed makes the
 * test unique-but-stable with nothing hardcoded.
 */
export function selectTestQuestions(
  bank: BankQuestion[],
  proficiency: ProficiencyMap,
  opts: SelectOpts = {},
): BankQuestion[] {
  const rng = opts.rng ?? Math.random
  const now = opts.now ?? new Date()
  const out: BankQuestion[] = []

  for (const unitId of SKILL_IDS) {
    const pool = bank.filter((q) => q.unitId === unitId)
    if (pool.length === 0) continue

    const taken = new Set<string>()
    const chosen: BankQuestion[] = []

    // Starter test: a flat, gentle difficulty-1 sheet across every unit.
    if (opts.starter) {
      const easy = shuffle(pool.filter((q) => q.difficulty === 1), rng)
      chosen.push(...easy.slice(0, PER_UNIT))
    } else {
      // Learner state for this unit's concepts.
      const unitConcepts = Object.values(proficiency).filter((c) => c.unitId === unitId)
      const unitAbility =
        unitConcepts.length > 0
          ? unitConcepts.reduce((s, c) => s + conceptAbility(c), 0) / unitConcepts.length
          : conceptAbility(undefined)
      const unitTarget = targetDifficulty(unitAbility)

      // 1) SPACED RETRIEVAL — weakest/faded concepts first, scaffolded easier.
      const needsReview = weakestConcepts(
        Object.fromEntries(unitConcepts.map((c) => [c.conceptTag, c])) as ProficiencyMap,
        MAX_REVIEW_SLOTS,
        now,
      ).filter(
        (c: ConceptProficiency) => retrievability(c, now) < REVIEW_RETRIEVABILITY || c.missStreak > 0,
      )
      for (const c of needsReview) {
        if (chosen.length >= PER_UNIT) break
        const scaffold = c.missStreak > 0 ? 1 : 0 // ease off after a miss
        const diff = Math.round(targetDifficulty(conceptAbility(c))) - scaffold
        // Pre-shuffle so the chosen question within the target tier varies per seed.
        const conceptPool = shuffle(pool.filter((q) => q.conceptTag === c.conceptTag), rng)
        const q = pickNearestDifficulty(conceptPool, diff, taken)
        if (q) {
          chosen.push(q)
          taken.add(q.id)
        }
      }

      // 2) ON-LEVEL COVERAGE — fill the rest at the unit's desirable difficulty,
      //    preferring concepts NOT already used and those with the least practice.
      const slots = PER_UNIT - chosen.length
      if (slots > 0) {
        const usedConcepts = new Set(chosen.map((q) => q.conceptTag))
        const attemptsByConcept = new Map(unitConcepts.map((c) => [c.conceptTag, c.attempts]))
        // Slight difficulty spread around the target for interleaving variety.
        const spread = [0, 1, -1, 2].slice(0, slots)
        // Rank remaining questions: fresh concepts (fewest attempts) first, then
        // a deterministic shuffle within ties.
        const remaining = shuffle(pool.filter((q) => !taken.has(q.id)), rng).sort(
          (a, b) =>
            (usedConcepts.has(a.conceptTag) ? 1 : 0) - (usedConcepts.has(b.conceptTag) ? 1 : 0) ||
            (attemptsByConcept.get(a.conceptTag) ?? 0) - (attemptsByConcept.get(b.conceptTag) ?? 0),
        )
        for (let i = 0; i < slots; i++) {
          const diff = Math.round(unitTarget + (spread[i] ?? 0))
          const q = pickNearestDifficulty(remaining, diff, taken)
          if (q) {
            chosen.push(q)
            taken.add(q.id)
          }
        }
      }
    }

    // Top up from anything left in the unit if a bucket came up short.
    if (chosen.length < PER_UNIT) {
      const fill = shuffle(pool.filter((q) => !taken.has(q.id)), rng)
      for (const q of fill) {
        if (chosen.length >= PER_UNIT) break
        chosen.push(q)
        taken.add(q.id)
      }
    }
    out.push(...chosen.slice(0, PER_UNIT))
  }

  // Interleave units into a per-account order (mixed problem types, not four in a row).
  return shuffle(out, rng)
}

export const TEST_TOTAL = SKILL_IDS.length * PER_UNIT
export const TEST_PASS_70 = 0.7
export const TEST_PASS_90 = 0.9
export const POINTS_FOR_70 = 3
export const POINTS_FOR_90 = 5

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
  base: { unitId: UnitId; conceptTag: string; difficulty: 1 | 2 | 3 | 4 | 5 },
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
