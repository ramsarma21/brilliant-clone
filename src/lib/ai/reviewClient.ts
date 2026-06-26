import type { ReviewQuestion, SkillId } from '../../types'
import { SUPABASE_URL, SUPABASE_KEY, isSupabaseConfigured } from '../supabase'

// Client for the ONE live-AI feature: the optional post-game review that targets
// the learner's weak concepts. It calls the Supabase Edge Function (which holds
// the AI key) and never the model directly — so no key is ever shipped to the
// browser. If the function is unavailable, callers fall back to local questions.

export type WeakConceptRequest = {
  conceptTag: string
  unitId: SkillId
  difficulty: 1 | 2 | 3
  /** Plain-language description of what the learner keeps getting wrong. */
  note?: string
}

const FUNCTION_PATH = '/functions/v1/generate-review'

type RawQuestion = {
  unitId?: string
  conceptTag?: string
  difficulty?: number
  prompt?: string
  choices?: { id: string; label: string }[]
  correctChoiceId?: string
  correctValue?: number
  given?: Record<string, number>
  explanation?: string
}

function isValid(q: RawQuestion): boolean {
  return Boolean(
    q.prompt &&
      q.conceptTag &&
      q.unitId &&
      Array.isArray(q.choices) &&
      q.choices.length >= 2 &&
      q.correctChoiceId &&
      q.choices.some((c) => c.id === q.correctChoiceId),
  )
}

function normalize(q: RawQuestion): ReviewQuestion {
  return {
    id: `review-${q.conceptTag}-${Math.random().toString(36).slice(2, 8)}`,
    unitId: q.unitId as SkillId,
    conceptTag: q.conceptTag as string,
    difficulty: (Math.min(3, Math.max(1, q.difficulty ?? 2)) as 1 | 2 | 3),
    prompt: q.prompt as string,
    choices: q.choices as { id: string; label: string }[],
    correctChoiceId: q.correctChoiceId as string,
    correctValue: q.correctValue,
    given: q.given,
    explanation: q.explanation ?? '',
    source: 'ai-review',
  }
}

/**
 * Request live review questions for the learner's weak concepts. Returns [] if
 * AI is unconfigured or the call fails, so the caller can fall back to the bank
 * or to locally generated skill questions.
 */
export async function generateReviewQuestions(
  concepts: WeakConceptRequest[],
  count: number,
): Promise<ReviewQuestion[]> {
  if (!isSupabaseConfigured || concepts.length === 0) return []
  try {
    const res = await fetch(`${SUPABASE_URL}${FUNCTION_PATH}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
      },
      body: JSON.stringify({ concepts, count }),
    })
    if (!res.ok) return []
    const json = (await res.json()) as { questions?: RawQuestion[] }
    const raw = json.questions ?? []
    return raw.filter(isValid).map(normalize).slice(0, count)
  } catch {
    return []
  }
}
