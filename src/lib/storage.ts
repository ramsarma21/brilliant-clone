import type {
  PlayerProfile,
  ProficiencyMap,
  TestAttempt,
  UserProgress,
  UserProfile,
} from '../types'

export const SESSION_KEY = 'physics-demo-session'
export const PROGRESS_KEY = 'physics-demo-progress'
export const PLAYER_KEY = 'physics-player-profile'
export const PROFICIENCY_KEY = 'physics-proficiency'
export const TEST_HISTORY_KEY = 'physics-test-history'

export const DEMO_PROFILE: UserProfile = {
  id: 'demo-user',
  displayName: 'Demo Learner',
  username: 'test',
  createdAt: '2026-01-01T00:00:00.000Z',
}

export function loadSession(): boolean {
  try {
    return localStorage.getItem(SESSION_KEY) === 'active'
  } catch {
    return false
  }
}

export function saveSession(active: boolean): void {
  try {
    if (active) localStorage.setItem(SESSION_KEY, 'active')
    else localStorage.removeItem(SESSION_KEY)
  } catch {
    // ignore storage failures (e.g. private mode)
  }
}

export function loadProgress(): UserProgress | null {
  try {
    const raw = localStorage.getItem(PROGRESS_KEY)
    if (!raw) return null
    return JSON.parse(raw) as UserProgress
  } catch {
    return null
  }
}

export function saveProgress(progress: UserProgress): void {
  try {
    localStorage.setItem(PROGRESS_KEY, JSON.stringify(progress))
  } catch {
    // ignore storage failures
  }
}

export function todayKey(): string {
  return new Date().toISOString().slice(0, 10)
}

// ---- Game layer persistence (player profile, proficiency, test history) ----

function loadJson<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : null
  } catch {
    return null
  }
}

function saveJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // ignore storage failures (private mode, quota, etc.)
  }
}

export function loadPlayerProfile(): PlayerProfile | null {
  return loadJson<PlayerProfile>(PLAYER_KEY)
}
export function savePlayerProfile(profile: PlayerProfile): void {
  saveJson(PLAYER_KEY, profile)
}

export function loadProficiency(): ProficiencyMap {
  return loadJson<ProficiencyMap>(PROFICIENCY_KEY) ?? {}
}
export function saveProficiency(map: ProficiencyMap): void {
  saveJson(PROFICIENCY_KEY, map)
}

export function loadTestHistory(): TestAttempt[] {
  return loadJson<TestAttempt[]>(TEST_HISTORY_KEY) ?? []
}
export function saveTestHistory(history: TestAttempt[]): void {
  saveJson(TEST_HISTORY_KEY, history)
}
