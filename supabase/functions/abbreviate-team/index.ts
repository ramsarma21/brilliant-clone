// Supabase Edge Function: generate a 3-letter broadcast ABBREVIATION for a club name.
//
// When the player's club needs a scorecard code (e.g. "Physics FC" → "PHY"), the browser
// sends the club name here and this function asks the cheapest configured chat model for a
// punchy 3-letter abbreviation, the way TV broadcasts label teams (COL, POR, ARG…). The AI
// key lives only here (never in the browser), matching moderate-name / generate-review.
//
// The whole feature is DORMANT until a key is configured: with no AI_API_KEY set the function
// returns an empty abbr and the client falls back to its own local derivation — so the app
// works the same as before you add your key. Opponent clubs are abbreviated locally on the
// client; only YOUR (free-text) club name is sent here.
//
// Deploy:   supabase functions deploy abbreviate-team
// Secrets:  supabase secrets set AI_API_KEY=... AI_BASE_URL=https://api.openai.com/v1 \
//                                AI_ABBREV_MODEL=gpt-4o-mini
//   (AI_ABBREV_MODEL falls back to AI_MODEL, then to gpt-4o-mini — set it to the cheapest
//    text model your account has, e.g. a *-mini / *-nano model.)
//
// Uses an OpenAI-compatible /chat/completions endpoint.

// deno-lint-ignore-file no-explicit-any
declare const Deno: { env: { get(key: string): string | undefined } }

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

type AbbrevReq = { name?: string }
type AbbrevResult = { abbr: string }

const MAX_NAME = 40

/** Keep only A–Z, force exactly 3 uppercase letters (pad from the source if needed). */
function sanitizeAbbr(raw: string, source: string): string {
  const letters = (raw || '').toUpperCase().replace(/[^A-Z]/g, '')
  if (letters.length >= 3) return letters.slice(0, 3)
  const fallback = (source || '').toUpperCase().replace(/[^A-Z]/g, '')
  return (letters + fallback).slice(0, 3).padEnd(3, 'X')
}

function buildPrompt(name: string): string {
  return [
    `You create 3-letter team abbreviations for a soccer scoreboard, like TV broadcasts do`,
    `(e.g. "Colombia" -> "COL", "Portugal" -> "POR", "Manchester United" -> "MUN").`,
    `Give the most recognizable 3-LETTER, ALL-CAPS code for this club name.`,
    `Use letters only (A-Z), exactly 3 of them, no spaces or punctuation.`,
    ``,
    `Club name: "${name}"`,
    ``,
    `Return ONLY JSON of the shape: {"abbr":"XYZ"}.`,
  ].join('\n')
}

async function abbreviate(name: string): Promise<AbbrevResult> {
  const trimmed = name.trim().slice(0, MAX_NAME)
  const apiKey = Deno.env.get('AI_API_KEY')
  // Dormant until a key is added: return empty so the client uses its local fallback.
  if (!apiKey || !trimmed) return { abbr: '' }

  const model = Deno.env.get('AI_ABBREV_MODEL') ?? Deno.env.get('AI_MODEL') ?? 'gpt-4o-mini'
  const baseUrl = Deno.env.get('AI_BASE_URL') ?? 'https://api.openai.com/v1'

  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      temperature: 0,
      max_tokens: 20,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: 'You output only valid JSON.' },
        { role: 'user', content: buildPrompt(trimmed) },
      ],
    }),
  })
  if (!res.ok) throw new Error(`model error ${res.status}`)
  const data: any = await res.json()
  const content: string = data?.choices?.[0]?.message?.content ?? '{"abbr":""}'
  const parsed = JSON.parse(content)
  return { abbr: sanitizeAbbr(String(parsed?.abbr ?? ''), trimmed) }
}

// @ts-ignore - Deno global is provided by the edge runtime
Deno.serve?.(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  try {
    const body = (await req.json()) as AbbrevReq
    const out = await abbreviate(body?.name ?? '')
    return new Response(JSON.stringify(out), {
      headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    // Fail soft on any error: empty abbr → client falls back to its local derivation.
    return new Response(JSON.stringify({ abbr: '', error: String(err) }), {
      status: 200,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  }
})
