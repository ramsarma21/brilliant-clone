// Supabase Edge Function: appropriateness check for a user-chosen CLUB NAME.
//
// When the player renames their club, the browser sends the proposed name here and
// this function asks the cheapest configured chat model whether it's appropriate for
// a kid-friendly educational soccer game. The AI key lives only here (never in the
// browser), matching generate-review / explain-wrong.
//
// The whole feature is DORMANT until a key is configured: with no AI_API_KEY set the
// function allows every name (so the app works the same as before you add your key).
// Once you set the key, every rename is checked.
//
// Deploy:   supabase functions deploy moderate-name
// Secrets:  supabase secrets set AI_API_KEY=... AI_BASE_URL=https://api.openai.com/v1 \
//                                AI_MODERATION_MODEL=gpt-4o-mini
//   (AI_MODERATION_MODEL falls back to AI_MODEL, then to gpt-4o-mini — set it to the
//    cheapest text model your account has access to, e.g. a *-mini / *-nano model.)
//
// Uses an OpenAI-compatible /chat/completions endpoint.

// deno-lint-ignore-file no-explicit-any
declare const Deno: { env: { get(key: string): string | undefined } }

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

type ModerateReq = { name?: string }
type ModerateResult = { allowed: boolean; reason: string }

const MAX_NAME = 40

function buildPrompt(name: string): string {
  return [
    `You are a strict content moderator for a KID-FRIENDLY educational soccer game.`,
    `Decide whether the following proposed CLUB NAME is appropriate to display publicly.`,
    ``,
    `Disallow it if it contains or implies ANY of: profanity, slurs, hate speech, sexual or`,
    `adult content, drugs, graphic violence, harassment or bullying, personal/contact info,`,
    `or impersonation of a real company/brand/person. Allow normal creative or silly team`,
    `names, physics/science puns, and ordinary words. When in doubt about something clearly`,
    `harmless, allow it.`,
    ``,
    `Proposed club name: "${name}"`,
    ``,
    `Return ONLY JSON of the shape: {"allowed": true|false, "reason": "..."} where "reason"`,
    `is a short, kid-friendly explanation (max ~12 words) ONLY when not allowed; otherwise "".`,
  ].join('\n')
}

async function moderate(name: string): Promise<ModerateResult> {
  const apiKey = Deno.env.get('AI_API_KEY')
  // Dormant until a key is added: allow everything so behaviour is unchanged.
  if (!apiKey) return { allowed: true, reason: '' }

  const trimmed = name.trim().slice(0, MAX_NAME)
  if (!trimmed) return { allowed: false, reason: 'Name cannot be empty.' }

  const model =
    Deno.env.get('AI_MODERATION_MODEL') ?? Deno.env.get('AI_MODEL') ?? 'gpt-4o-mini'
  const baseUrl = Deno.env.get('AI_BASE_URL') ?? 'https://api.openai.com/v1'

  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      temperature: 0,
      max_tokens: 60,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: 'You output only valid JSON.' },
        { role: 'user', content: buildPrompt(trimmed) },
      ],
    }),
  })
  if (!res.ok) throw new Error(`model error ${res.status}`)
  const data: any = await res.json()
  const content: string = data?.choices?.[0]?.message?.content ?? '{"allowed":true,"reason":""}'
  const parsed = JSON.parse(content)
  return {
    allowed: parsed?.allowed !== false,
    reason: String(parsed?.reason ?? ''),
  }
}

// @ts-ignore - Deno global is provided by the edge runtime
Deno.serve?.(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  try {
    const body = (await req.json()) as ModerateReq
    const out = await moderate(body?.name ?? '')
    return new Response(JSON.stringify(out), {
      headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    // Fail OPEN on transient errors so a flaky moderation call never hard-blocks a
    // legitimate rename; the client treats a thrown/!ok response as "allowed".
    return new Response(JSON.stringify({ allowed: true, reason: '', error: String(err) }), {
      status: 200,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  }
})
