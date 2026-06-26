import type {
  AttemptInput,
  ConceptProficiency,
  ProficiencyMap,
  SkillId,
  UnitProficiency,
} from '../types'
import { SKILL_IDS } from './skills'
import { dueDateFor, isDue, nextBox } from './spacedRepetition'

// Recency-weighted proficiency. Each attempt contributes a raw score in [0,100]
// (correctness lightly modulated by speed), blended into the running value with
// an exponential moving average so recent performance dominates.
const EWMA_ALPHA = 0.4

// Per-attempt "fast enough" target. Beating it nudges the score up, dragging on
// it nudges it down — so slow-but-correct still counts, just a little less.
const TARGET_TIME_MS = 25_000

function rawScore(isCorrect: boolean, timeMs: number): number {
  if (!isCorrect) return 0
  // 1.0 at/under target time, easing down to ~0.7 for very slow correct answers.
  const speed = Math.max(0.7, Math.min(1, TARGET_TIME_MS / Math.max(timeMs, 1)))
  return 100 * speed
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

/** Roll the per-concept map up into one proficiency value per unit. */
export function unitProficiencies(map: ProficiencyMap): Record<SkillId, UnitProficiency> {
  const out = {} as Record<SkillId, UnitProficiency>
  for (const unitId of SKILL_IDS) {
    out[unitId] = { unitId, proficiency: 0, accuracy: 0, attempts: 0 }
  }
  const sums: Record<string, { prof: number; correct: number; attempts: number; n: number }> = {}
  for (const c of Object.values(map)) {
    const s = (sums[c.unitId] ??= { prof: 0, correct: 0, attempts: 0, n: 0 })
    s.prof += c.proficiency
    s.correct += c.correct
    s.attempts += c.attempts
    s.n += 1
  }
  for (const unitId of SKILL_IDS) {
    const s = sums[unitId]
    if (!s || s.n === 0) continue
    out[unitId] = {
      unitId,
      proficiency: Math.round((s.prof / s.n) * 10) / 10,
      accuracy: s.attempts > 0 ? Math.round((s.correct / s.attempts) * 100) : 0,
      attempts: s.attempts,
    }
  }
  return out
}

/**
 * Weakest concepts for review targeting: prioritizes overdue items and recent
 * miss streaks, then lowest proficiency. Used by the post-game review and the
 * test's difficulty selection.
 */
export function weakestConcepts(map: ProficiencyMap, limit: number): ConceptProficiency[] {
  const now = new Date()
  return Object.values(map)
    .map((c) => ({
      c,
      rank:
        (isDue(c.nextDue, now) ? 1000 : 0) +
        c.missStreak * 100 +
        (100 - c.proficiency),
    }))
    .sort((a, b) => b.rank - a.rank)
    .slice(0, limit)
    .map((x) => x.c)
}
