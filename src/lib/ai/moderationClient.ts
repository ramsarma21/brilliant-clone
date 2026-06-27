import { SUPABASE_URL, SUPABASE_KEY, isSupabaseConfigured } from '../supabase'

// Client for the club-name appropriateness check. Like the other AI clients, this
// calls a Supabase Edge Function that holds the AI key — the model is never called
// directly from the browser. The whole feature is DORMANT until you add a key:
//   • Supabase not configured        → allowed (skip the check)
//   • function/AI key not configured → the function itself returns allowed
//   • call fails / network error     → allowed (fail-open, never hard-block a rename)
// So names commit exactly as before until you wire up your key, after which every
// rename is screened.

export type NameModeration = { allowed: boolean; reason?: string }

const FUNCTION_PATH = '/functions/v1/moderate-name'

/**
 * Ask the moderation function whether a proposed club name is appropriate. Returns
 * { allowed: true } whenever moderation is unavailable so callers can commit the name.
 */
export async function checkClubNameAppropriate(name: string): Promise<NameModeration> {
  if (!isSupabaseConfigured) return { allowed: true }
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
    if (!res.ok) return { allowed: true }
    const json = (await res.json()) as { allowed?: boolean; reason?: string }
    return { allowed: json.allowed !== false, reason: json.reason }
  } catch {
    return { allowed: true }
  }
}
