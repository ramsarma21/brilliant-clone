import type {
  AttemptInput,
  ConceptProficiency,
  ProficiencyMap,
  SkillId,
  UnitProficiency,
} from '../types'
import { SKILL_IDS } from './skills'
import { dueDateFor, nextBox, SR_INTERVALS_DAYS } from './spacedRepetition'

// ===========================================================================
// Learner model — the learning-science core that powers progressive,
// personalized assessments. Three ideas drive it:
//
//   1. RETRIEVAL + SPACING (Ebbinghaus forgetting curve, Leitner boxes):
//      what you know decays over time unless re-tested; well-learned concepts
//      decay slowly. We surface concepts as their memory "retrievability" drops.
//
//   2. DESIRABLE DIFFICULTY (Bjork; the "85% rule", Wilson et al. 2019):
//      learning is fastest when retrieval is effortful but mostly successful
//      (~80% correct). We pick each question's difficulty to sit in that zone
//      for the learner's current ability — not too easy, not crushing.
//
//   3. RELIABILITY VIA EVIDENCE (empirical-Bayes shrinkage):
//      an estimate from one or two attempts is noisy, so we regress it toward a
//      conservative prior until enough attempts accumulate. This stops a single
//      lucky/unlucky answer from yanking the whole test's difficulty around.
// ===========================================================================

// Recency-weighted proficiency. Each attempt contributes a raw score in [0,100]
// (correctness lightly modulated by speed), blended into the running value with
// an exponential moving average so recent performance dominates.
const EWMA_ALPHA = 0.4

// Per-attempt "fast enough" target. Beating it nudges the score up, dragging on
// it nudges it down — so slow-but-correct still counts, just a little less.
const TARGET_TIME_MS = 25_000

// --- Forgetting curve --------------------------------------------------------
// Retrievability R(t) = exp(-t / S), where stability S (days) grows with the
// Leitner box — so a concept drilled into box 5 stays retrievable for weeks,
// while a fresh/just-missed concept (box 0) fades within a day. Mirrors the SR
// intervals (with a small floor so box 0 still decays gracefully, not instantly).
const STABILITY_DAYS = SR_INTERVALS_DAYS.map((d) => Math.max(0.5, d))

// --- Evidence / confidence ---------------------------------------------------
// Confidence rises with attempts: c = n / (n + K). With K=4, one attempt ≈ 0.2
// confidence, five ≈ 0.56, twelve ≈ 0.75. Unknown concepts regress to a slightly
// cautious prior so brand-new material is introduced gently.
const CONFIDENCE_K = 4
const PRIOR_ABILITY = 35

// --- Desirable difficulty ----------------------------------------------------
// A logistic links ability A to the chance of answering a tier-d question:
//   p = 1 / (1 + exp(-(A - req_d) / SCALE))
// req_d is the ability at which tier d is a coin-flip. We aim for TARGET_SUCCESS
// (~80%), the effortful-but-successful sweet spot.
const TARGET_SUCCESS = 0.8
const ABILITY_SCALE = 15
// Ability at which each difficulty tier (1..5) is ~50/50. Linear, 20 pts apart.
const TIER_ABILITY = [10, 30, 50, 70, 90]

const DAY_MS = 86_400_000

function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x))
}

function daysSince(iso: string | undefined, now: Date): number {
  if (!iso) return 0
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return 0
  return Math.max(0, (now.getTime() - t) / DAY_MS)
}

function rawScore(isCorrect: boolean, timeMs: number): number {
  if (!isCorrect) return 0
  // 1.0 at/under target time, easing down to ~0.7 for very slow correct answers.
  const speed = Math.max(0.7, Math.min(1, TARGET_TIME_MS / Math.max(timeMs, 1)))
  return 100 * speed
}

/** Memory retrievability in [0,1] from the forgetting curve (1 = just practiced). */
export function retrievability(c: ConceptProficiency, now: Date = new Date()): number {
  const box = clamp(Math.round(c.srBox ?? 0), 0, STABILITY_DAYS.length - 1)
  const S = STABILITY_DAYS[box] ?? 1
  return Math.exp(-daysSince(c.lastSeen, now) / S)
}

/** Confidence in an estimate built from `attempts` observations, in [0,1). */
export function confidence(attempts: number): number {
  const n = Math.max(0, attempts)
  return n / (n + CONFIDENCE_K)
}

/**
 * Robust ability estimate (0..100) used to TARGET difficulty. Shrinks the raw
 * recency-weighted proficiency toward a conservative prior when evidence is thin
 * (empirical Bayes), so a single answer can't swing the next test wildly.
 */
export function conceptAbility(c: ConceptProficiency | undefined): number {
  if (!c) return PRIOR_ABILITY
  const w = confidence(c.attempts)
  return clamp(w * c.proficiency + (1 - w) * PRIOR_ABILITY, 0, 100)
}

/** Probability a learner of `ability` answers a tier-`difficulty` (1..5) question. */
export function successProb(ability: number, difficulty: number): number {
  const req = TIER_ABILITY[clamp(Math.round(difficulty) - 1, 0, 4)]
  return 1 / (1 + Math.exp(-(ability - req) / ABILITY_SCALE))
}

/**
 * The difficulty tier (continuous, 1..5) whose expected success ≈ TARGET_SUCCESS
 * for this ability — the desirable-difficulty sweet spot. Higher ability → harder
 * target; a beginner is steered toward tier ~1–2, an expert toward ~4–5.
 */
export function targetDifficulty(ability: number): number {
  const logit = Math.log(TARGET_SUCCESS / (1 - TARGET_SUCCESS))
  const reqAbility = ability - ABILITY_SCALE * logit
  // TIER_ABILITY is linear (10,30,…,90) → invert to a continuous tier.
  const tier = (reqAbility - TIER_ABILITY[0]) / 20 + 1
  return clamp(tier, 1, 5)
}

function blankConcept(conceptTag: string, unitId: SkillId): ConceptProficiency {
  return {
    conceptTag,
    unitId,
    attempts: 0,
    correct: 0,
    proficiency: 0,
    avgTimeMs: 0,
    missStreak: 0,
    srBox: 0,
    nextDue: new Date().toISOString(),
    lastSeen: new Date().toISOString(),
  }
}

/** Pure update: fold one attempt into the proficiency map, returning a new map. */
export function recordAttempt(map: ProficiencyMap, input: AttemptInput): ProficiencyMap {
  const prev = map[input.conceptTag] ?? blankConcept(input.conceptTag, input.unitId)
  const attempts = prev.attempts + 1
  const correct = prev.correct + (input.isCorrect ? 1 : 0)
  const score = rawScore(input.isCorrect, input.timeMs)
  const proficiency =
    prev.attempts === 0 ? score : EWMA_ALPHA * score + (1 - EWMA_ALPHA) * prev.proficiency
  const avgTimeMs = Math.round((prev.avgTimeMs * prev.attempts + input.timeMs) / attempts)
  const box = nextBox(prev.srBox, input.isCorrect)
  const now = new Date()

  const next: ConceptProficiency = {
    ...prev,
    unitId: input.unitId,
    attempts,
    correct,
    proficiency: Math.round(proficiency * 10) / 10,
    avgTimeMs,
    missStreak: input.isCorrect ? 0 : prev.missStreak + 1,
    srBox: box,
    nextDue: dueDateFor(box, now),
    lastSeen: now.toISOString(),
  }
  return { ...map, [input.conceptTag]: next }
}

/**
 * Roll the per-concept map up into one proficiency value per unit. The headline
 * `proficiency` uses the confidence-shrunk ability (so thin or noisy evidence
 * reads conservatively), which is exactly what drives the test's difficulty.
 */
export function unitProficiencies(map: ProficiencyMap): Record<SkillId, UnitProficiency> {
  const out = {} as Record<SkillId, UnitProficiency>
  for (const unitId of SKILL_IDS) {
    out[unitId] = { unitId, proficiency: 0, accuracy: 0, attempts: 0 }
  }
  const sums: Record<string, { ability: number; correct: number; attempts: number; n: number }> = {}
  for (const c of Object.values(map)) {
    const s = (sums[c.unitId] ??= { ability: 0, correct: 0, attempts: 0, n: 0 })
    s.ability += conceptAbility(c)
    s.correct += c.correct
    s.attempts += c.attempts
    s.n += 1
  }
  for (const unitId of SKILL_IDS) {
    const s = sums[unitId]
    if (!s || s.n === 0) continue
    out[unitId] = {
      unitId,
      proficiency: Math.round((s.ability / s.n) * 10) / 10,
      accuracy: s.attempts > 0 ? Math.round((s.correct / s.attempts) * 100) : 0,
      attempts: s.attempts,
    }
  }
  return out
}

/**
 * Weakest concepts for review targeting. Ranks by a blend of learning-science
 * signals: how much the memory has FADED (1 − retrievability, the dominant
 * term — overdue concepts bubble up), recent MISS STREAKS, and low shrunk
 * ABILITY. Used by the post-game review and the test's spaced-retrieval slots.
 */
export function weakestConcepts(
  map: ProficiencyMap,
  limit: number,
  now: Date = new Date(),
): ConceptProficiency[] {
  return Object.values(map)
    .map((c) => ({
      c,
      rank:
        (1 - retrievability(c, now)) * 600 +
        c.missStreak * 120 +
        (100 - conceptAbility(c)) * 1.5,
    }))
    .sort((a, b) => b.rank - a.rank)
    .slice(0, limit)
    .map((x) => x.c)
}
