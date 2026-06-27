import { supabase } from './supabase'
import { DEMO_PROFILE, loadAuthProfile } from './storage'

// Per-user, per-sim ALL-TIME high scores (best single-session result for each of
// the five drills). Source of truth is the Supabase `profiles` table — one column
// per sim, scoped to the signed-in user's `username` (see
// supabase/migrations/20260626_sim_high_scores.sql). If the table/columns don't
// exist yet or the request fails, we transparently fall back to localStorage so
// the feature still works offline / before the DB is migrated.

/** The five offered drills that track a high score (no goalie — it isn't offered). */
export type SimId = 'kinematics' | 'motion-graphs' | 'forces' | 'energy' | 'momentum'

// Each sim maps to a dedicated column on `profiles` and a local fallback key
// (the local keys match the ones the sim components already used).
const COLUMN: Record<SimId, string> = {
  kinematics: 'kinematics_high_score',
  'motion-graphs': 'motion_graphs_high_score',
  forces: 'forces_high_score',
  energy: 'energy_high_score',
  momentum: 'momentum_high_score',
}
const LOCAL_KEY: Record<SimId, string> = {
  kinematics: 'physics-demo-kinematics-high',
  'motion-graphs': 'physics-passing-best',
  forces: 'physics-dribble-best',
  energy: 'physics-headers-best',
  momentum: 'physics-defense-best',
}

/** The currently signed-in username, or '' if none (never writes to the demo/`test` row). */
function currentUsername(): string {
  const p = loadAuthProfile()
  if (!p || !p.username) return ''
  if (p.id === DEMO_PROFILE.id) return ''
  if (p.username.trim().toLowerCase() === DEMO_PROFILE.username.toLowerCase()) return ''
  return p.username
}

function localGet(sim: SimId): number {
  try {
    const v = Number(localStorage.getItem(LOCAL_KEY[sim]))
    return Number.isFinite(v) && v > 0 ? v : 0
  } catch {
    return 0
  }
}

function localSet(sim: SimId, score: number): void {
  try {
    localStorage.setItem(LOCAL_KEY[sim], String(score))
  } catch {
    // ignore (private mode, etc.)
  }
}

/** Read the all-time record for a sim, preferring Supabase and ensuring a profile row exists. */
export async function fetchHighScore(
  sim: SimId,
  username: string = currentUsername(),
): Promise<number> {
  const column = COLUMN[sim]
  const local = localGet(sim)
  if (!username) return local // not signed in → local cache only
  try {
    const { data, error } = await supabase
      .from('profiles')
      .select(column)
      .eq('username', username)
      .maybeSingle()

    if (error) return local // table/column missing / RLS / offline → use local

    if (!data) {
      // First visit for this user: create the profile row, seeded with any local record.
      await supabase
        .from('profiles')
        .upsert(
          { username, display_name: username, [column]: local },
          { onConflict: 'username' },
        )
      return local
    }

    const remote = ((data as unknown as Record<string, number | null>)[column] ?? 0) as number
    // Reconcile: keep the higher of the two and push it back if local is ahead.
    if (local > remote) {
      await supabase
        .from('profiles')
        .update({ [column]: local, updated_at: new Date().toISOString() })
        .eq('username', username)
      return local
    }
    if (remote > local) localSet(sim, remote)
    return remote
  } catch {
    return local
  }
}

/** Persist a new record for a sim if it beats the stored one. Returns the effective record. */
export async function saveHighScore(
  sim: SimId,
  score: number,
  username: string = currentUsername(),
): Promise<number> {
  const column = COLUMN[sim]
  if (score > localGet(sim)) localSet(sim, score)
  if (!username) return Math.max(score, localGet(sim)) // not signed in → local only
  try {
    const { data, error } = await supabase
      .from('profiles')
      .select(column)
      .eq('username', username)
      .maybeSingle()

    if (error) return Math.max(score, localGet(sim))

    const remote = ((data as unknown as Record<string, number | null> | null)?.[column] ?? 0) as number
    if (score <= remote) return remote

    await supabase
      .from('profiles')
      .upsert(
        { username, display_name: username, [column]: score, updated_at: new Date().toISOString() },
        { onConflict: 'username' },
      )
    return score
  } catch {
    return Math.max(score, localGet(sim))
  }
}

/** Wipe every sim high score back to 0 — both the cloud columns and the local
 *  cache — as part of a full account reset. */
export async function resetAllHighScores(username: string = currentUsername()): Promise<void> {
  const sims = Object.keys(COLUMN) as SimId[]
  for (const sim of sims) {
    try {
      localStorage.removeItem(LOCAL_KEY[sim])
    } catch {
      // ignore
    }
  }
  if (!username) return
  const zeroed = sims.reduce<Record<string, number>>((acc, sim) => {
    acc[COLUMN[sim]] = 0
    return acc
  }, {})
  try {
    await supabase
      .from('profiles')
      .update({ ...zeroed, updated_at: new Date().toISOString() })
      .eq('username', username)
  } catch {
    // offline — local cache already cleared
  }
}

// ---- Back-compat wrappers (KinematicsSim imports these by name) ----
export const fetchKinematicsHighScore = (username?: string) =>
  fetchHighScore('kinematics', username ?? currentUsername())
export const saveKinematicsHighScore = (score: number, username?: string) =>
  saveHighScore('kinematics', score, username ?? currentUsername())
