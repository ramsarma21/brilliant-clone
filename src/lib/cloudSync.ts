import { supabase, isSupabaseConfigured } from './supabase'
import { overallRating } from './skills'
import type {
  PlayerProfile,
  PlayerSkills,
  ProficiencyMap,
  TestAttempt,
  UserProgress,
} from '../types'

// ===========================================================================
// Per-user game state sync.
//
// The single source of truth for everything measurable in the app is the
// Supabase `profiles` row keyed by the signed-in `username`. localStorage is a
// per-device cache only. Every loader returns a three-state result so callers
// can tell apart:
//   'ok'          – row exists, here is the (possibly partially-defaulted) data
//   'empty'       – Supabase is reachable but this user has no row yet → defaults
//   'unavailable' – Supabase not configured / offline / errored → keep local cache
//
// This split is what makes the per-user reset safe offline: we never wipe a
// returning user back to defaults just because the network was down.
// ===========================================================================

export type CloudResult<T> =
  | { status: 'ok'; data: T }
  | { status: 'empty' }
  | { status: 'unavailable' }

/**
 * Make sure the signed-in user has exactly one profiles row, keyed by username,
 * WITHOUT touching any existing data (insert-or-ignore). Call this at login so
 * the row exists up front and every later save updates that same row instead of
 * lazily creating one on the first write (which looked like "a new account").
 */
export async function ensureCloudProfile(username: string): Promise<void> {
  if (!isSupabaseConfigured || !username) return
  try {
    await supabase
      .from('profiles')
      .upsert({ username }, { onConflict: 'username', ignoreDuplicates: true })
  } catch {
    // offline — row will be created on the next successful save
  }
}

export type CloudPlayerData = {
  coins: number | null
  skillPoints: number | null
  equippedJersey: string | null
  equippedCleats: string | null
  skills: PlayerSkills | null
  inventory: string[] | null
  proficiency: ProficiencyMap | null
  testHistory: TestAttempt[] | null
}

const PLAYER_COLUMNS =
  'coins, skill_points, equipped_jersey, equipped_cleats, skills, inventory, proficiency, test_history'

/** Load the player slice (skills, economy, cosmetics, learning data) for a user. */
export async function loadCloudPlayer(username: string): Promise<CloudResult<CloudPlayerData>> {
  if (!isSupabaseConfigured) return { status: 'unavailable' }
  try {
    const { data, error } = await supabase
      .from('profiles')
      .select(PLAYER_COLUMNS)
      .eq('username', username)
      .maybeSingle()
    if (error) return { status: 'unavailable' }
    if (!data) return { status: 'empty' }
    const d = data as unknown as Record<string, unknown>
    return {
      status: 'ok',
      data: {
        coins: (d.coins as number | null) ?? null,
        skillPoints: (d.skill_points as number | null) ?? null,
        equippedJersey: (d.equipped_jersey as string | null) ?? null,
        equippedCleats: (d.equipped_cleats as string | null) ?? null,
        skills: (d.skills as PlayerSkills | null) ?? null,
        inventory: (d.inventory as string[] | null) ?? null,
        proficiency: (d.proficiency as ProficiencyMap | null) ?? null,
        testHistory: (d.test_history as TestAttempt[] | null) ?? null,
      },
    }
  } catch {
    return { status: 'unavailable' }
  }
}

/** Persist the whole player slice. Only touches player columns (never high scores/progress). */
export async function saveCloudPlayer(
  username: string,
  profile: PlayerProfile,
  proficiency: ProficiencyMap,
  testHistory: TestAttempt[],
): Promise<void> {
  if (!isSupabaseConfigured) return
  try {
    await supabase.from('profiles').upsert(
      {
        username,
        coins: profile.coins,
        skill_points: profile.skillPoints,
        overall: overallRating(profile.skills),
        equipped_jersey: profile.equipped.jersey,
        equipped_cleats: profile.equipped.cleats,
        skills: profile.skills,
        inventory: profile.inventory,
        proficiency,
        test_history: testHistory,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'username' },
    )
  } catch {
    // offline — localStorage cache remains
  }
}

/** Load the lesson/unit progress slice for a user. */
export async function loadCloudProgress(username: string): Promise<CloudResult<UserProgress>> {
  if (!isSupabaseConfigured) return { status: 'unavailable' }
  try {
    const { data, error } = await supabase
      .from('profiles')
      .select('progress')
      .eq('username', username)
      .maybeSingle()
    if (error) return { status: 'unavailable' }
    if (!data) return { status: 'empty' }
    const progress = (data as unknown as Record<string, unknown>).progress as UserProgress | null
    if (!progress) return { status: 'empty' }
    return { status: 'ok', data: progress }
  } catch {
    return { status: 'unavailable' }
  }
}

/** Persist the progress slice. Only touches the `progress` column. */
export async function saveCloudProgress(username: string, progress: UserProgress): Promise<void> {
  if (!isSupabaseConfigured) return
  try {
    await supabase.from('profiles').upsert(
      { username, progress, updated_at: new Date().toISOString() },
      { onConflict: 'username' },
    )
  } catch {
    // offline — localStorage cache remains
  }
}
