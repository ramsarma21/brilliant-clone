import type { UserProgress, UserProfile } from '../types'

export const SESSION_KEY = 'physics-demo-session'
export const PROGRESS_KEY = 'physics-demo-progress'

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
