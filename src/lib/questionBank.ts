import type { BankQuestion, SkillId, UnitProficiency } from '../types'
import { SKILL_IDS } from './skills'
import { supabase, isSupabaseConfigured } from './supabase'
import seed from '../content/questionBank.seed.json'

// The pre-authored bank (6 units x 4 problems x 3 difficulties = 72). Source of
// truth is the `question_bank` table; we transparently fall back to the bundled
// JSON seed so the test works offline / before the DB is seeded.

const SEED_BANK = seed as unknown as BankQuestion[]

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
  explanation: string | null
}

function rowToQuestion(r: DbRow): BankQuestion {
  return {
    id: r.id,
    unitId: r.unit_id as SkillId,
    conceptTag: r.concept_tag,
    difficulty: Math.min(3, Math.max(1, r.difficulty)) as 1 | 2 | 3,
    prompt: r.prompt,
    choices: r.choices,
    correctChoiceId: r.correct_choice,
    correctValue: r.correct_value ?? undefined,
    given: r.given ?? undefined,
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

// Map a unit proficiency (0..100) to how many of the 4 questions should be
// easy / medium / hard. Weak units lean easy (scaffolding), strong units lean
// hard (desirable difficulty).
function difficultyMix(proficiency: number): [number, number, number] {
  if (proficiency < 40) return [3, 1, 0]
  if (proficiency < 70) return [1, 2, 1]
  return [0, 2, 2]
}

function shuffle<T>(items: T[], rng: () => number): T[] {
  const out = [...items]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

const PER_UNIT = 4

/**
 * Build a 24-question test: 4 per unit, difficulty-weighted by the learner's
 * current proficiency in that unit. Falls back gracefully when the bank is thin.
 */
export function selectTestQuestions(
  bank: BankQuestion[],
  unitProf: Record<SkillId, UnitProficiency>,
  rng: () => number = Math.random,
): BankQuestion[] {
  const out: BankQuestion[] = []
  for (const unitId of SKILL_IDS) {
    const pool = bank.filter((q) => q.unitId === unitId)
    if (pool.length === 0) continue
    const byDiff: Record<number, BankQuestion[]> = { 1: [], 2: [], 3: [] }
    for (const q of pool) byDiff[q.difficulty]?.push(q)
    const mix = difficultyMix(unitProf[unitId]?.proficiency ?? 0)

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
  return out
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
