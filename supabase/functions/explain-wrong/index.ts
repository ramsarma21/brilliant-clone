// Supabase Edge Function: live "Explain why" for a wrong answer.
//
// The browser sends a question's STRUCTURED state plus the option the learner
// picked; this function asks the model for a short, plain-language explanation of
// why that specific answer is wrong and how to reason to the right one. The AI
// key lives only here (never in the browser), matching generate-review.
//
// Deploy:   supabase functions deploy explain-wrong
// Secrets:  supabase secrets set AI_API_KEY=... AI_MODEL=gpt-4o-mini \
//                                AI_BASE_URL=https://api.openai.com/v1
//
// Uses an OpenAI-compatible /chat/completions endpoint.

// deno-lint-ignore-file no-explicit-any
declare const Deno: { env: { get(key: string): string | undefined } }

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

type Choice = { id: string; label: string }
type ExplainReq = {
  unitId?: string
  conceptTag?: string
  difficulty?: number
  prompt?: string
  choices?: Choice[]
  correctChoiceId?: string
  yourChoiceId?: string | null
  correctValue?: number
  given?: Record<string, number>
  formulas?: string[]
  staticExplanation?: string
}

function labelFor(choices: Choice[], id?: string | null): string {
  if (!id) return '(left blank)'
  const c = choices.find((x) => x.id === id)
  return c ? `${id.toUpperCase()}) ${c.label}` : id
}

function buildPrompt(q: ExplainReq): string {
  const choices = q.choices ?? []
  const optionLines = choices.map((c) => `${c.id.toUpperCase()}) ${c.label}`).join('\n')
  const parts = [
    `You are an encouraging algebra-based intro physics tutor for a soccer-themed course.`,
    `A student answered a multiple-choice question INCORRECTLY. In 2-3 short sentences of plain language:`,
    `1) Explain why THEIR chosen answer is wrong — name the misconception if there is a common one.`,
    `2) Walk the correct reasoning briefly so they could get it next time.`,
    `Be concrete and supportive. Use g = 10 m/s^2. Do NOT just restate the question or list formulas mechanically.`,
    ``,
    `Unit: ${q.unitId ?? 'physics'} | Concept: ${q.conceptTag ?? 'n/a'}`,
    `Question: ${q.prompt ?? ''}`,
    `Options:`,
    optionLines,
    `Correct answer: ${labelFor(choices, q.correctChoiceId)}`,
    `Student's answer: ${labelFor(choices, q.yourChoiceId ?? null)}`,
  ]
  if (q.given && Object.keys(q.given).length > 0) parts.push(`Given: ${JSON.stringify(q.given)}`)
  if (typeof q.correctValue === 'number') parts.push(`Correct numeric value: ${q.correctValue}`)
  if (q.formulas && q.formulas.length > 0) parts.push(`Relevant: ${q.formulas.join('; ')}`)
  if (q.staticExplanation) parts.push(`Reference explanation (stay consistent with this): ${q.staticExplanation}`)
  parts.push(``, `Return ONLY JSON of the shape: {"explanation": "..."}`)
  return parts.join('\n')
}

async function explain(q: ExplainReq): Promise<{ explanation: string }> {
  const apiKey = Deno.env.get('AI_API_KEY')
  const model = Deno.env.get('AI_MODEL') ?? 'gpt-4o-mini'
  const baseUrl = Deno.env.get('AI_BASE_URL') ?? 'https://api.openai.com/v1'
  if (!apiKey) throw new Error('AI_API_KEY not configured')

  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      temperature: 0.4,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: 'You output only valid JSON.' },
        { role: 'user', content: buildPrompt(q) },
      ],
    }),
  })
  if (!res.ok) throw new Error(`model error ${res.status}`)
  const data: any = await res.json()
  const content: string = data?.choices?.[0]?.message?.content ?? '{"explanation":""}'
  const parsed = JSON.parse(content)
  return { explanation: String(parsed?.explanation ?? '') }
}

// @ts-ignore - Deno global is provided by the edge runtime
Deno.serve?.(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  try {
    const body = (await req.json()) as ExplainReq
    const out = await explain(body ?? {})
    return new Response(JSON.stringify(out), {
      headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err), explanation: '' }), {
      status: 200,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  }
})
