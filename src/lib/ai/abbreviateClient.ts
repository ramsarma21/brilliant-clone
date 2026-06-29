import { SUPABASE_URL, SUPABASE_KEY, isSupabaseConfigured } from '../supabase'
import { clubCode } from '../teams'

// Client for the broadcast-abbreviation feature. Like the other AI clients, this calls a
// Supabase Edge Function that holds the AI key — the model is never called from the browser.
// It is DORMANT until you add a key: every path below falls back to a LOCAL derivation
// (lib/teams clubCode), so a club always has a usable 3-letter code even with no AI:
//   • Supabase not configured        → local clubCode(name)
//   • function/AI key not configured → function returns "" → local clubCode(name)
//   • call fails / network error     → local clubCode(name)
// Opponent clubs are always abbreviated locally (no need to spend tokens on fixed names);
// only YOUR free-text club name benefits from the smarter AI code.

const FUNCTION_PATH = '/functions/v1/abbreviate-team'

/** A guaranteed 3-letter, A–Z, uppercase code (local, no network). */
export function localAbbr(name: string): string {
  const code = clubCode(name)
  return (code || 'PHY').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 3).padEnd(3, 'X')
}

/**
 * Resolve a 3-letter abbreviation for a (player-chosen) club name. Tries the AI Edge
 * Function and always resolves — falling back to the local derivation when the AI is
 * unavailable or returns nothing usable.
 */
export async function abbreviateClub(name: string): Promise<string> {
  const fallback = localAbbr(name)
  if (!isSupabaseConfigured) return fallback
  try {
    const res = await fetch(`${SUPABASE_URL}${FUNCTION_PATH}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
      },
      body: JSON.stringify({ name }),
    })
    if (!res.ok) return fallback
    const json = (await res.json()) as { abbr?: string }
    const abbr = (json.abbr ?? '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 3)
    return abbr.length === 3 ? abbr : fallback
  } catch {
    return fallback
  }
}
