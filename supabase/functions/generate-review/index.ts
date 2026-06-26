// Supabase Edge Function: live post-game review question generation.
//
// This is the ONLY place the AI key lives. The browser calls this function; the
// function calls the model and returns multiple-choice questions targeted at the
// learner's weak concepts. It is grounded in structured input (concept + unit +
// difficulty + a note about the mistake), never raw lesson text, and the client
// re-verifies any numeric answer against the physics engine before trusting it.
//
// Deploy:   supabase functions deploy generate-review
// Secrets:  supabase secrets set AI_API_KEY=... AI_MODEL=gpt-4o-mini \
//                                AI_BASE_URL=https://api.openai.com/v1
//
// Uses an OpenAI-compatible /chat/completions endpoint (works for OpenAI and many
// compatible providers). Swap AI_BASE_URL/AI_MODEL for another provider.

// deno-lint-ignore-file no-explicit-any
declare const Deno: { env: { get(key: string): string | undefined } }

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

type WeakConcept = {
  conceptTag: string
  unitId: string
  difficulty?: number
  note?: string
}

function buildPrompt(concepts: WeakConcept[], count: number): string {
  const lines = concepts
    .map(
      (c) =>
        `- unit "${c.unitId}", concept "${c.conceptTag}", difficulty ${c.difficulty ?? 2}` +
        (c.note ? ` (learner struggle: ${c.note})` : ''),
    )
    .join('\n')
  return [
    `You are an algebra-based intro physics tutor for a soccer-themed course.`,
    `Generate exactly ${count} multiple-choice review questions targeting these weak concepts:`,
    lines,
    ``,
    `Rules:`,
    `- Single-step, algebra only. Use soccer framing (shots, passes, headers, tackles, saves).`,
    `- Use g = 10 m/s^2. Keep numbers clean.`,
    `- Exactly 4 options each; exactly one correct.`,
    `- If the answer is numeric, include "correctValue" (number) and "given" (the input numbers).`,
    `- Write a one-sentence "explanation" of why the answer is right.`,
    ``,
    `Return ONLY JSON of the shape:`,
    `{"questions":[{"unitId","conceptTag","difficulty",` +
      `"prompt","choices":[{"id","label"}],"correctChoiceId","correctValue","given","explanation"}]}`,
  ].join('\n')
}

async function generate(concepts: WeakConcept[], count: number): Promise<unknown> {
  const apiKey = Deno.env.get('AI_API_KEY')
  const model = Deno.env.get('AI_MODEL') ?? 'gpt-4o-mini'
  const baseUrl = Deno.env.get('AI_BASE_URL') ?? 'https://api.openai.com/v1'
  if (!apiKey) throw new Error('AI_API_KEY not configured')

  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      temperature: 0.7,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: 'You output only valid JSON.' },
        { role: 'user', content: buildPrompt(concepts, count) },
      ],
    }),
  })
  if (!res.ok) throw new Error(`model error ${res.status}`)
  const data: any = await res.json()
  const content: string = data?.choices?.[0]?.message?.content ?? '{"questions":[]}'
  return JSON.parse(content)
}

// @ts-ignore - Deno global is provided by the edge runtime
Deno.serve?.(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  try {
    const { concepts, count } = (await req.json()) as { concepts: WeakConcept[]; count: number }
    const out = await generate(concepts ?? [], Math.min(Math.max(count ?? 5, 1), 10))
    return new Response(JSON.stringify(out), {
      headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err), questions: [] }), {
      status: 200,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  }
})
