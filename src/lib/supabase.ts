import { createClient, type SupabaseClient } from '@supabase/supabase-js'

// Supabase is OPTIONAL. The app is local-first: every feature that touches
// Supabase already has a localStorage fallback. So we must never throw at module
// load just because env vars are missing — that would crash the whole app before
// the offline fallbacks can help. Instead we expose a nullable client and a small
// guard so callers can degrade gracefully.

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined
const supabasePublishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as
  | string
  | undefined

export const SUPABASE_URL = supabaseUrl ?? ''
export const SUPABASE_KEY = supabasePublishableKey ?? ''

export const isSupabaseConfigured = Boolean(supabaseUrl && supabasePublishableKey)

if (!isSupabaseConfigured && import.meta.env.DEV) {
  console.info(
    '[supabase] VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY not set — running in local-only mode.',
  )
}

// Lazily created so a misconfigured env never blocks startup.
let client: SupabaseClient | null = null

export function getSupabase(): SupabaseClient | null {
  if (!isSupabaseConfigured) return null
  if (!client) client = createClient(supabaseUrl as string, supabasePublishableKey as string)
  return client
}

// Backwards-compatible export for existing callers (scores.ts, profileMastery.ts).
// It is a real client when configured, and a harmless stand-in that resolves to
// empty results when not — so existing `await supabase.from(...)` chains simply
// fall back to local storage instead of crashing.
type ThenableResult = { data: null; error: { message: string } }
const offlineResult: ThenableResult = { data: null, error: { message: 'supabase-offline' } }

function offlineBuilder(): Record<string, unknown> {
  const builder: Record<string, unknown> = {}
  const chain = () => builder
  for (const key of ['select', 'insert', 'upsert', 'update', 'delete', 'eq', 'order', 'limit']) {
    builder[key] = chain
  }
  builder.maybeSingle = async () => offlineResult
  builder.single = async () => offlineResult
  builder.then = (resolve: (v: ThenableResult) => unknown) => resolve(offlineResult)
  return builder
}

const offlineClient = {
  from: () => offlineBuilder(),
} as unknown as SupabaseClient

export const supabase: SupabaseClient = getSupabase() ?? offlineClient
