import { supabase, isSupabaseConfigured } from './supabase'
import { teamOverall } from './squad'
import type {
  Appearance,
  ClubIdentity,
  PlayerProfile,
  PlayerSkills,
  ProficiencyMap,
  Squad,
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
  appearance: Appearance | null
  club: ClubIdentity | null
  /** The current per-player club roster. */
  squad: Squad | null
  /** Legacy single skill block (pre-squad) — read only so it can be migrated to a squad. */
  skills: PlayerSkills | null
  inventory: string[] | null
  proficiency: ProficiencyMap | null
  testHistory: TestAttempt[] | null
}

/** Load the player slice (skills, economy, cosmetics, learning data) for a user. */
export async function loadCloudPlayer(username: string): Promise<CloudResult<CloudPlayerData>> {
  if (!isSupabaseConfigured) return { status: 'unavailable' }
  try {
    // Select * (not an explicit column list) so a not-yet-applied migration for a
    // NEWER optional column (e.g. appearance / club_identity) can't fail the whole
    // read — missing columns simply come back undefined and fall back to defaults.
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('username', username)
      .maybeSingle()
    if (error) {
      console.warn('[cloudSync] loadCloudPlayer failed:', error.message)
      return { status: 'unavailable' }
    }
    if (!data) return { status: 'empty' }
    const d = data as unknown as Record<string, unknown>
    return {
      status: 'ok',
      data: {
        coins: (d.coins as number | null) ?? null,
        skillPoints: (d.skill_points as number | null) ?? null,
        equippedJersey: (d.equipped_jersey as string | null) ?? null,
        equippedCleats: (d.equipped_cleats as string | null) ?? null,
        appearance: (d.appearance as Appearance | null) ?? null,
        club: (d.club_identity as ClubIdentity | null) ?? null,
        squad: (d.squad as Squad | null) ?? null,
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
  const stamp = new Date().toISOString()

  // CORE columns — guaranteed by the base schema (20260623 / 20260626 migrations).
  // These MUST always persist, so they go in their own upsert that can't be blocked
  // by a newer optional column whose migration may not be applied yet.
  try {
    const { error } = await supabase.from('profiles').upsert(
      {
        username,
        coins: profile.coins,
        skill_points: profile.skillPoints,
        overall: teamOverall(profile.squad),
        equipped_jersey: profile.equipped.jersey,
        equipped_cleats: profile.equipped.cleats,
        inventory: profile.inventory,
        proficiency,
        test_history: testHistory,
        updated_at: stamp,
      },
      { onConflict: 'username' },
    )
    if (error) console.warn('[cloudSync] saveCloudPlayer (core) failed:', error.message)
  } catch (e) {
    console.warn('[cloudSync] saveCloudPlayer (core) threw:', e)
  }

  // The SQUAD (names, looks, ratings, boots of all 8 players) is your team and MUST
  // persist so it never re-randomizes on refresh. It gets its OWN upsert so that a
  // missing/older optional column elsewhere (appearance / club_identity) can never
  // block the team from saving. Requires the 20260628_squad.sql migration.
  try {
    const { error } = await supabase
      .from('profiles')
      .upsert({ username, squad: profile.squad, updated_at: stamp }, { onConflict: 'username' })
    if (error) {
      console.warn(
        '[cloudSync] squad not saved — run the 20260628_squad.sql migration in Supabase ' +
          '(your team will fall back to the per-device cache until then):',
        error.message,
      )
    }
  } catch (e) {
    console.warn('[cloudSync] saveCloudPlayer (squad) threw:', e)
  }

  // NEWER optional cosmetic columns (appearance: 20260627_appearance, club_identity:
  // 20260627_club_identity). Best-effort in their own upsert so a not-yet-applied
  // migration here can't block the core save above OR the squad save.
  try {
    const { error } = await supabase.from('profiles').upsert(
      {
        username,
        appearance: profile.appearance,
        club_identity: profile.club,
        updated_at: stamp,
      },
      { onConflict: 'username' },
    )
    if (error) {
      console.warn(
        '[cloudSync] appearance/club_identity not saved — run the 20260627_appearance.sql ' +
          'and 20260627_club_identity.sql migrations in Supabase:',
        error.message,
      )
    }
  } catch (e) {
    console.warn('[cloudSync] saveCloudPlayer (appearance/club) threw:', e)
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
    if (error) {
      console.warn('[cloudSync] loadCloudProgress failed:', error.message)
      return { status: 'unavailable' }
    }
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
    const { error } = await supabase.from('profiles').upsert(
      { username, progress, updated_at: new Date().toISOString() },
      { onConflict: 'username' },
    )
    if (error) console.warn('[cloudSync] saveCloudProgress failed:', error.message)
  } catch (e) {
    console.warn('[cloudSync] saveCloudProgress threw:', e)
  }
}
