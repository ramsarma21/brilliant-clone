import type {
  BankQuestion,
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
export const AUTH_PROFILE_KEY = 'physics-auth-profile'
export const DATA_VERSION_KEY = 'physics-data-version'

// Bump this whenever the default starting state changes. On load, any device on
// an older version has its gameplay state (progress, player skills/coins,
// proficiency, test history) wiped back to the new defaults — this is how we
// "convert all existing accounts". Auth/accounts/session are intentionally kept.
const DATA_VERSION = '2026-06-26-five-units'

/** Reset gameplay state to defaults. Keeps the user signed in. */
export function resetGameStateStorage(): void {
  try {
    localStorage.removeItem(PROGRESS_KEY)
    localStorage.removeItem(PLAYER_KEY)
    localStorage.removeItem(PROFICIENCY_KEY)
    localStorage.removeItem(TEST_HISTORY_KEY)
  } catch {
    // ignore
  }
}

/** Run once at startup: migrate older saves to the current default state. */
export function runDataMigrations(): void {
  try {
    if (localStorage.getItem(DATA_VERSION_KEY) === DATA_VERSION) return
    resetGameStateStorage()
    localStorage.setItem(DATA_VERSION_KEY, DATA_VERSION)
  } catch {
    // ignore (private mode etc.)
  }
}

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

// ---- In-progress test session (resume on refresh, discard on leaving) ----
//
// Once the assessment is opened we snapshot enough to resume it after a page
// refresh: the exact questions, the picks so far, where they are, and the phase.
// NOTHING is written to the player's permanent record (testHistory / skill
// points / proficiency) until the assessment is fully finished — so abandoning
// it (navigating home / back) and clearing this snapshot leaves no trace, i.e.
// "as if it was never taken".

export const TEST_SESSION_KEY = 'physics-test-session'
const TEST_SESSION_VERSION = 1

export type SavedTestSession = {
  v: number
  username: string
  phase: 'intro' | 'quiz' | 'results' | 'review' | 'done'
  questions: BankQuestion[]
  answers: (string | null)[]
  current: number
  result:
    | {
        score: number
        total: number
        pointsAwarded: number
        perUnit: Record<string, { correct: number; total: number; avgTimeMs: number }>
      }
    | null
  /** Whether the finished attempt has already been committed to the record. */
  recorded: boolean
  attemptId: string | null
}

function sessionKey(username: string): string {
  return `${TEST_SESSION_KEY}:${username || 'guest'}`
}

export function loadTestSession(username: string): SavedTestSession | null {
  const s = loadJson<SavedTestSession>(sessionKey(username))
  if (!s || s.v !== TEST_SESSION_VERSION || s.username !== username) return null
  if (!Array.isArray(s.questions) || s.questions.length === 0) return null
  return s
}

export function saveTestSession(session: Omit<SavedTestSession, 'v'>): void {
  saveJson(sessionKey(session.username), { v: TEST_SESSION_VERSION, ...session })
}

export function clearTestSession(username: string): void {
  try {
    localStorage.removeItem(sessionKey(username))
  } catch {
    // ignore
  }
}

export function loadAuthProfile(): UserProfile | null {
  return loadJson<UserProfile>(AUTH_PROFILE_KEY)
}
export function saveAuthProfile(profile: UserProfile | null): void {
  if (!profile) {
    try {
      localStorage.removeItem(AUTH_PROFILE_KEY)
    } catch {
      // ignore
    }
    return
  }
  saveJson(AUTH_PROFILE_KEY, profile)
}
