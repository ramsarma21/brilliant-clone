import { supabase } from './supabase'
import { DEMO_PROFILE } from './storage'

// All-time kinematics high score (most goals scored in a single session).
//
// Source of truth is the Supabase `profiles` table (see
// supabase/migrations/20260623_profiles.sql). If that table doesn't exist yet
// or the request fails, we transparently fall back to localStorage so the
// feature still works offline and during local development.

const LOCAL_KEY = 'physics-demo-kinematics-high'

function localGet(): number {
  try {
    const v = Number(localStorage.getItem(LOCAL_KEY))
    return Number.isFinite(v) && v > 0 ? v : 0
  } catch {
    return 0
  }
}

function localSet(score: number): void {
  try {
    localStorage.setItem(LOCAL_KEY, String(score))
  } catch {
    // ignore (private mode, etc.)
  }
}

/** Read the all-time record, preferring Supabase and ensuring a profile row exists. */
export async function fetchKinematicsHighScore(
  username: string = DEMO_PROFILE.username,
): Promise<number> {
  const local = localGet()
  try {
    const { data, error } = await supabase
      .from('profiles')
      .select('kinematics_high_score')
      .eq('username', username)
      .maybeSingle()

    if (error) return local // table missing / RLS / offline → use local

    if (!data) {
      // First visit: create the profile row, seeded with any local record.
      await supabase
        .from('profiles')
        .upsert(
          { username, display_name: DEMO_PROFILE.displayName, kinematics_high_score: local },
          { onConflict: 'username' },
        )
      return local
    }

    const remote = data.kinematics_high_score ?? 0
    // Reconcile: keep the higher of the two and push it back if local is ahead.
    if (local > remote) {
      await supabase
        .from('profiles')
        .update({ kinematics_high_score: local, updated_at: new Date().toISOString() })
        .eq('username', username)
      return local
    }
    if (remote > local) localSet(remote)
    return remote
  } catch {
    return local
  }
}

/** Persist a new record if it beats the stored one. Returns the effective record. */
export async function saveKinematicsHighScore(
  score: number,
  username: string = DEMO_PROFILE.username,
): Promise<number> {
  if (score > localGet()) localSet(score)
  try {
    const { data, error } = await supabase
      .from('profiles')
      .select('kinematics_high_score')
      .eq('username', username)
      .maybeSingle()

    if (error) return Math.max(score, localGet())

    const remote = data?.kinematics_high_score ?? 0
    if (score <= remote) return remote

    await supabase
      .from('profiles')
      .upsert(
        { username, display_name: DEMO_PROFILE.displayName, kinematics_high_score: score, updated_at: new Date().toISOString() },
        { onConflict: 'username' },
      )
    return score
  } catch {
    return Math.max(score, localGet())
  }
}
