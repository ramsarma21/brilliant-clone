import { SUPABASE_URL, SUPABASE_KEY, isSupabaseConfigured } from '../supabase'

// Client for the "Explain why" feature: when a learner gets a question wrong,
// they can ask for a tailored, plain-language explanation of *their* mistake.
// Like the review generator, this calls a Supabase Edge Function that holds the
// AI key — the model is never called directly from the browser. The request is
// grounded entirely in the question's structured state (prompt, options, the
// correct answer, and the learner's chosen answer), never raw lesson text. If
// the function is unavailable, callers fall back to the question's static
// explanation.

export type ExplainRequest = {
  unitId: string
  conceptTag: string
  difficulty?: number
  prompt: string
  choices: { id: string; label: string }[]
  correctChoiceId: string
  /** The option the learner picked, or null if they left it blank. */
  yourChoiceId: string | null
  correctValue?: number
  given?: Record<string, number>
  formulas?: string[]
  /** The authored one-liner, passed as reference so the model stays on-topic. */
  staticExplanation?: string
}

const FUNCTION_PATH = '/functions/v1/explain-wrong'

/**
 * Ask the LLM why the learner's answer was wrong. Returns the explanation text,
 * or null if AI is unconfigured / the call fails (caller shows the static one).
 */
export async function explainWrongAnswer(req: ExplainRequest): Promise<string | null> {
  if (!isSupabaseConfigured) return null
  try {
    const res = await fetch(`${SUPABASE_URL}${FUNCTION_PATH}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
      },
      body: JSON.stringify(req),
    })
    if (!res.ok) return null
    const json = (await res.json()) as { explanation?: string }
    const text = (json.explanation ?? '').trim()
    return text.length > 0 ? text : null
  } catch {
    return null
  }
}
