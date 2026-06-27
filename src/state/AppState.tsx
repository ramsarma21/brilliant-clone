import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import type {
  LeagueStanding,
  LessonProgress,
  SimState,
  StepAnswer,
  UnitStatus,
  UserProfile,
  UserProgress,
} from '../types'
import { LESSONS, UNITS } from '../content/lessons'
import {
  clearTestSession,
  DEMO_PROFILE,
  loadAuthProfile,
  loadProgress,
  loadSession,
  saveAuthProfile,
  saveProgress,
  saveSession,
  todayKey,
} from '../lib/storage'
import { saveProfileMastery } from '../lib/profileMastery'
import { resetAllHighScores } from '../lib/scores'
import { ensureCloudProfile, loadCloudProgress, saveCloudProgress } from '../lib/cloudSync'
import { SEASON_GAMES, newLeagueSeed } from '../lib/leagueSeed'
import { initPointsWheel, spinPointsWheel } from '../lib/pointsWheel'
import { signInUser, signUpUser, type AuthProfile } from '../lib/auth'

/** Fired when gameplay state should reset (e.g. a brand-new account signs up). */
export const RESET_GAME_EVENT = 'physics:reset-game'

/**
 * A "real" signed-in account: has a username and is NOT the legacy demo
 * placeholder. This guard is what stops a phantom "logged in as `test`" state
 * (session flag set, but no real account stored) from auto-creating a `test`
 * profiles row in Supabase on load.
 */
function isRealAccount(p: UserProfile | null | undefined): p is UserProfile {
  if (!p || !p.username) return false
  if (p.id === DEMO_PROFILE.id) return false
  if (p.username.trim().toLowerCase() === DEMO_PROFILE.username.toLowerCase()) return false
  return true
}

function emptyLessonProgress(lessonId: string): LessonProgress {
  return {
    lessonId,
    currentStepIndex: 0,
    answers: [],
    masteryChecksCorrect: {},
    manipulationChallengeComplete: false,
    sandboxState: { ...LESSONS[lessonId].defaultSimState },
  }
}

function createInitialProgress(): UserProgress {
  const lessonState: Record<string, LessonProgress> = {}
  for (const unit of UNITS) {
    lessonState[unit.lessonId] = emptyLessonProgress(unit.lessonId)
  }
  const unitStatus: Record<string, UnitStatus> = {}
  UNITS.forEach((u, i) => {
    unitStatus[u.id] = i === 0 ? 'available' : 'locked'
  })
  return {
    userId: DEMO_PROFILE.id,
    currentLessonId: UNITS[0].lessonId,
    currentStepIndex: 0,
    completedLessonIds: [],
    unitStatus,
    streakCount: 0,
    lastActiveDate: '',
    mastery: {},
    lessonState,
    quantumMatchesPlayed: 0,
    leagueSeed: newLeagueSeed(),
  }
}

/** Ensure a league seed exists (older caches / cloud rows may predate it). */
function withLeagueSeed(p: UserProgress): UserProgress {
  if (p.leagueSeed != null) return p
  return { ...p, leagueSeed: newLeagueSeed() }
}

/**
 * Build a lesson-progress object that satisfies every mastery gate, so the unit reads as
 * mastered without the learner playing through it. Marks every step + manipulation gate
 * as complete (covers both the per-lesson hardcoded gate ids and the generic path).
 */
function masteredLessonProgress(lessonId: string): LessonProgress {
  const lp = emptyLessonProgress(lessonId)
  const checks: Record<string, boolean> = {}
  for (const step of LESSONS[lessonId].steps) checks[step.id] = true
  lp.masteryChecksCorrect = checks
  lp.manipulationChallengeComplete = true
  lp.currentStepIndex = Math.max(0, LESSONS[lessonId].steps.length - 1)
  lp.completedAt = new Date().toISOString()
  return lp
}

/** A unit is mastered when its required mastery gates pass. */
function isUnitMastered(lp: LessonProgress | undefined): boolean {
  if (!lp) return false
  if (lp.lessonId === 'lesson-projectile') {
    const checks =
      Boolean(lp.masteryChecksCorrect['proj-prediction']) &&
      Boolean(lp.masteryChecksCorrect['proj-numeric']) &&
      Boolean(lp.masteryChecksCorrect['proj-challenge']) &&
      lp.manipulationChallengeComplete
    const quizDone = Boolean(lp.masteryChecksCorrect['proj-quiz'])
    return checks && quizDone
  }
  if (lp.lessonId === 'lesson-motion-graphs') {
    const checks =
      Boolean(lp.masteryChecksCorrect['mg-prediction']) &&
      Boolean(lp.masteryChecksCorrect['mg-numeric']) &&
      Boolean(lp.masteryChecksCorrect['mg-challenge']) &&
      lp.manipulationChallengeComplete
    const quizDone = Boolean(lp.masteryChecksCorrect['mg-quiz'])
    return checks && quizDone
  }
  if (lp.lessonId === 'lesson-forces') {
    const checks =
      Boolean(lp.masteryChecksCorrect['force-prediction']) &&
      Boolean(lp.masteryChecksCorrect['force-numeric']) &&
      Boolean(lp.masteryChecksCorrect['force-challenge']) &&
      lp.manipulationChallengeComplete
    const quizDone = Boolean(lp.masteryChecksCorrect['force-quiz'])
    return checks && quizDone
  }
  if (lp.lessonId === 'lesson-energy') {
    const checks =
      Boolean(lp.masteryChecksCorrect['energy-prediction']) &&
      Boolean(lp.masteryChecksCorrect['energy-numeric']) &&
      Boolean(lp.masteryChecksCorrect['energy-challenge']) &&
      lp.manipulationChallengeComplete
    const quizDone = Boolean(lp.masteryChecksCorrect['energy-quiz'])
    return checks && quizDone
  }
  if (lp.lessonId === 'lesson-defense') {
    const checks =
      Boolean(lp.masteryChecksCorrect['def-prediction']) &&
      Boolean(lp.masteryChecksCorrect['def-numeric']) &&
      Boolean(lp.masteryChecksCorrect['def-challenge']) &&
      lp.manipulationChallengeComplete
    const quizDone = Boolean(lp.masteryChecksCorrect['def-quiz'])
    return checks && quizDone
  }
  if (lp.lessonId === 'lesson-goalie') {
    const checks =
      Boolean(lp.masteryChecksCorrect['gk-prediction']) &&
      Boolean(lp.masteryChecksCorrect['gk-numeric']) &&
      Boolean(lp.masteryChecksCorrect['gk-challenge']) &&
      lp.manipulationChallengeComplete
    const quizDone = Boolean(lp.masteryChecksCorrect['gk-quiz'])
    return checks && quizDone
  }
  const lesson = LESSONS[lp.lessonId]
  const checkStepIds = lesson.steps
    .filter((s) => s.kind === 'prediction' || s.kind === 'numeric' || s.kind === 'challenge')
    .map((s) => s.id)
  const allCorrect = checkStepIds.every((id) => lp.masteryChecksCorrect[id])
  return allCorrect && lp.manipulationChallengeComplete
}

function recomputeStatuses(progress: UserProgress): Record<string, UnitStatus> {
  const status: Record<string, UnitStatus> = {}
  let previousMastered = true
  for (const unit of UNITS) {
    const lp = progress.lessonState[unit.lessonId]
    const mastered = isUnitMastered(lp)
    if (mastered) {
      status[unit.id] = 'mastered'
    } else if (previousMastered) {
      const started = lp && (lp.answers.length > 0 || lp.currentStepIndex > 0)
      status[unit.id] = started ? 'in_progress' : 'available'
    } else {
      status[unit.id] = 'locked'
    }
    previousMastered = mastered
  }
  return status
}

/**
 * Daily-visit tracking. Uses the same date-rollover technique a streak would,
 * but instead of counting consecutive days it just stamps the last day this
 * account was seen. `firstToday` is true when this is the account's first visit
 * of the calendar day (useful for once-per-day hooks); `next` carries the
 * updated stamp. Deliberately does NOT touch any streak counter.
 */
function markDailyVisit(progress: UserProgress): { next: UserProgress; firstToday: boolean } {
  const today = todayKey()
  const firstToday = progress.lastActiveDate !== today
  if (!firstToday) return { next: progress, firstToday }
  return { next: { ...progress, lastActiveDate: today }, firstToday }
}

type RecordAnswerArgs = {
  lessonId: string
  stepId: string
  answer: unknown
  isCorrect: boolean
  feedback: string
  isMasteryCheck: boolean
  isChallenge?: boolean
  conceptTags?: string[]
}

type AuthOutcome = { ok: boolean; needsSignup?: boolean; error?: string }

type AppContextValue = {
  isLoggedIn: boolean
  profile: UserProfile
  progress: UserProgress
  loginError: string | null
  authPending: boolean
  /** Last calendar day (YYYY-MM-DD) this account was seen, or '' if never. */
  lastVisitDate: string
  /** Whether this account has been seen at all today. */
  visitedToday: boolean
  /** Whether this session was the account's first visit of the day. */
  firstVisitToday: boolean
  /** Whether the daily wheel hasn't been spun yet today. */
  wheelAvailable: boolean
  login: (username: string, password: string) => Promise<AuthOutcome>
  signup: (username: string, password: string) => Promise<AuthOutcome>
  logout: () => void
  setCurrentLesson: (lessonId: string) => void
  setCurrentStep: (lessonId: string, index: number) => void
  setSandboxState: (lessonId: string, state: SimState) => void
  recordAnswer: (args: RecordAnswerArgs) => void
  completeLesson: (lessonId: string) => void
  isUnitMastered: (lessonId: string) => boolean
  resetProgress: () => void
  skipAllLessons: () => void
  /** Record a played Quantum League match (advances the league ladder by one). */
  playQuantumMatch: () => void
  /** Persist a simulated final league table (or null to clear it). */
  setLeagueTable: (table: LeagueStanding[] | null) => void
  /** Mark the daily wheel as spun + collected for today (hides it until tomorrow). */
  claimDailyWheel: () => void
  /** Testing only: force the daily wheel back even if it was already spun today. */
  resetDailyWheel: () => void
  /** True when today's once-a-day practice coin bonus hasn't been claimed yet. */
  practiceBonusAvailable: boolean
  /** Mark today's practice coin bonus as claimed (hides it until tomorrow). */
  claimPracticeBonus: () => void
  /** Resolve one 90+ skill-point gamble spin (1–10), advancing the rigged tracker. */
  rollPointsWheel: () => number
}

const AppContext = createContext<AppContextValue | null>(null)

export function AppProvider({ children }: { children: ReactNode }) {
  // Only restore a session if a REAL account is stored. A stale session flag
  // with no real account (e.g. a leftover demo login) must NOT count as logged
  // in, or the hydrate effect would auto-create a `test` profiles row.
  const storedAuth = loadAuthProfile()
  const storedReal = isRealAccount(storedAuth)
  const [isLoggedIn, setIsLoggedIn] = useState<boolean>(() => loadSession() && storedReal)
  const [loginError, setLoginError] = useState<string | null>(null)
  const [authPending, setAuthPending] = useState<boolean>(false)
  const [profile, setProfile] = useState<UserProfile>(() => (storedReal ? (storedAuth as UserProfile) : DEMO_PROFILE))

  // One-time cleanup: scrub any leftover demo/phantom session from this device
  // so it can never re-create a `test` row on the server.
  useEffect(() => {
    if (!isRealAccount(loadAuthProfile())) {
      saveSession(false)
      saveAuthProfile(null)
    }
    // run once on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const [progress, setProgress] = useState<UserProgress>(
    () => loadProgress() ?? createInitialProgress(),
  )

  // True when the signed-in account's first visit of the current day was this
  // session (a daily-rollover signal; not a streak). Recomputed on each hydrate.
  const [firstVisitToday, setFirstVisitToday] = useState(false)

  // Always-current snapshot of progress for actions that must read-then-write synchronously
  // (e.g. the points wheel needs to return the drawn value to its caller right away).
  const progressRef = useRef(progress)
  useEffect(() => {
    progressRef.current = progress
  }, [progress])

  // Persist progress to the per-device cache whenever it changes.
  const firstRender = useRef(true)
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false
    }
    saveProgress(progress)
  }, [progress])

  // Which username `progress` currently reflects. Gates the cloud save below so
  // we never push one user's progress into another's row (or write defaults over
  // real cloud data before hydration finishes).
  const hydratedUser = useRef<string | null>(null)

  // Hydrate lesson/unit progress for the signed-in user from the cloud. 'empty'
  // (no row yet) → starter defaults; 'unavailable' (offline) → keep local cache.
  useEffect(() => {
    if (!isLoggedIn || !isRealAccount(profile)) return
    const user = profile.username
    let alive = true
    hydratedUser.current = null
    void (async () => {
      // Make the user's single profiles row up front so every later save updates
      // it instead of lazily spawning a row on first write.
      await ensureCloudProfile(user)
      const res = await loadCloudProgress(user)
      if (!alive) return
      if (res.status === 'ok') {
        const { next, firstToday } = markDailyVisit(withLeagueSeed(res.data))
        next.unitStatus = recomputeStatuses(next)
        setFirstVisitToday(firstToday)
        setProgress(next)
      } else if (res.status === 'empty') {
        const fresh = createInitialProgress()
        fresh.userId = profile.id
        fresh.unitStatus = recomputeStatuses(fresh)
        setFirstVisitToday(true)
        setProgress(fresh)
      } else {
        setProgress((prev) => {
          const { next, firstToday } = markDailyVisit(withLeagueSeed(prev))
          next.unitStatus = recomputeStatuses(next)
          setFirstVisitToday(firstToday)
          return next
        })
      }
      hydratedUser.current = user
    })()
    return () => {
      alive = false
    }
  }, [profile.username, profile.id, isLoggedIn])

  // Debounced per-user sync of progress to the cloud, gated on hydration.
  const progressSyncTimer = useRef<number | null>(null)
  useEffect(() => {
    if (!isLoggedIn || hydratedUser.current !== profile.username) return
    if (progressSyncTimer.current) window.clearTimeout(progressSyncTimer.current)
    progressSyncTimer.current = window.setTimeout(() => {
      void saveCloudProgress(profile.username, progress)
      void saveProfileMastery(progress.unitStatus, profile.username)
    }, 600)
    return () => {
      if (progressSyncTimer.current) window.clearTimeout(progressSyncTimer.current)
    }
  }, [progress, profile.username, isLoggedIn])

  const update = useCallback((updater: (p: UserProgress) => UserProgress) => {
    setProgress((prev) => {
      const next = updater(prev)
      next.unitStatus = recomputeStatuses(next)
      return next
    })
  }, [])

  const applyAuth = useCallback((auth: AuthProfile) => {
    const nextProfile: UserProfile = {
      id: auth.id,
      displayName: auth.displayName,
      username: auth.username,
      createdAt: new Date().toISOString(),
    }
    setProfile(nextProfile)
    saveAuthProfile(nextProfile)
    setIsLoggedIn(true)
    saveSession(true)
    setLoginError(null)
    // Progress is hydrated per-user from the cloud by the effect keyed on
    // profile.username (which just changed), so we don't carry over whatever the
    // previous session had in state here.
  }, [])

  const login = useCallback(
    async (username: string, password: string): Promise<AuthOutcome> => {
      setAuthPending(true)
      const res = await signInUser(username, password)
      setAuthPending(false)
      if (res.ok) {
        applyAuth(res.profile)
        return { ok: true }
      }
      setLoginError(res.message)
      return { ok: false, needsSignup: res.reason === 'no-account', error: res.message }
    },
    [applyAuth],
  )

  const signup = useCallback(
    async (username: string, password: string): Promise<AuthOutcome> => {
      setAuthPending(true)
      const res = await signUpUser(username, password)
      setAuthPending(false)
      if (res.ok) {
        applyAuth(res.profile)
        // Materialize the new account's single profiles row right away so it
        // exists the instant the account is made (not lazily on first save).
        void ensureCloudProfile(res.profile.username)
        // A brand-new account always starts from the default state: no lessons
        // done, only the first unit unlocked, default ratings, no coins.
        const fresh = createInitialProgress()
        fresh.userId = res.profile.id
        fresh.unitStatus = recomputeStatuses(fresh)
        setProgress(fresh)
        window.dispatchEvent(new Event(RESET_GAME_EVENT))
        return { ok: true }
      }
      setLoginError(res.message)
      return { ok: false, error: res.message }
    },
    [applyAuth],
  )

  const logout = useCallback(() => {
    setIsLoggedIn(false)
    saveSession(false)
    saveAuthProfile(null)
    setLoginError(null)
  }, [])

  const setCurrentLesson = useCallback(
    (lessonId: string) => {
      update((p) => ({
        ...p,
        currentLessonId: lessonId,
        currentStepIndex: p.lessonState[lessonId]?.currentStepIndex ?? 0,
      }))
    },
    [update],
  )

  const setCurrentStep = useCallback(
    (lessonId: string, index: number) => {
      update((p) => {
        const lp = p.lessonState[lessonId] ?? emptyLessonProgress(lessonId)
        return {
          ...p,
          currentLessonId: lessonId,
          currentStepIndex: index,
          lessonState: {
            ...p.lessonState,
            [lessonId]: { ...lp, currentStepIndex: index },
          },
        }
      })
    },
    [update],
  )

  const setSandboxState = useCallback(
    (lessonId: string, state: SimState) => {
      update((p) => {
        const lp = p.lessonState[lessonId] ?? emptyLessonProgress(lessonId)
        return {
          ...p,
          lessonState: {
            ...p.lessonState,
            [lessonId]: { ...lp, sandboxState: state },
          },
        }
      })
    },
    [update],
  )

  const recordAnswer = useCallback(
    (args: RecordAnswerArgs) => {
      update((p) => {
        const lp = p.lessonState[args.lessonId] ?? emptyLessonProgress(args.lessonId)
        const priorAttempts = lp.answers.filter((a) => a.stepId === args.stepId).length
        const answer: StepAnswer = {
          stepId: args.stepId,
          answer: args.answer,
          isCorrect: args.isCorrect,
          attemptNumber: priorAttempts + 1,
          feedbackShown: args.feedback,
          answeredAt: new Date().toISOString(),
        }
        const masteryChecksCorrect = { ...lp.masteryChecksCorrect }
        if (args.isMasteryCheck && args.isCorrect) {
          masteryChecksCorrect[args.stepId] = true
        }
        const mastery = { ...p.mastery }
        if (args.isCorrect && args.conceptTags) {
          for (const tag of args.conceptTags) {
            mastery[tag] = 1
          }
        }
        return {
          ...p,
          mastery,
          lessonState: {
            ...p.lessonState,
            [args.lessonId]: {
              ...lp,
              answers: [...lp.answers, answer],
              masteryChecksCorrect,
              manipulationChallengeComplete:
                args.isChallenge && args.isCorrect
                  ? true
                  : lp.manipulationChallengeComplete,
            },
          },
        }
      })
    },
    [update],
  )

  const completeLesson = useCallback(
    (lessonId: string) => {
      update((p) => {
        const lp = p.lessonState[lessonId] ?? emptyLessonProgress(lessonId)
        const completed = p.completedLessonIds.includes(lessonId)
          ? p.completedLessonIds
          : [...p.completedLessonIds, lessonId]
        return {
          ...p,
          completedLessonIds: completed,
          lessonState: {
            ...p.lessonState,
            [lessonId]: { ...lp, completedAt: lp.completedAt ?? new Date().toISOString() },
          },
        }
      })
    },
    [update],
  )

  const resetProgress = useCallback(() => {
    const fresh = createInitialProgress()
    fresh.userId = profile.id
    fresh.unitStatus = recomputeStatuses(fresh)
    setProgress(fresh)
    // Drop any in-progress/finished test session so a reset is a clean slate — otherwise a
    // stale snapshot (e.g. a half-finished quiz, or a committed 'done' screen) could resume
    // and reopen the old assessment after everything else was wiped.
    clearTestSession(profile.username)
    // Push the cleared career state to the cloud IMMEDIATELY rather than waiting
    // on the debounced sync effect — otherwise the profiles row's *_mastered
    // flags (and progress jsonb) could keep stale "mastered" values. Also zero
    // out the sim high scores so a reset is a true back-to-default wipe.
    if (isRealAccount(profile)) {
      const user = profile.username
      void saveCloudProgress(user, fresh)
      void saveProfileMastery(fresh.unitStatus, user)
      void resetAllHighScores(user)
    }
    // Also wipe the player slice (skills, coins, cosmetics, proficiency, AND
    // test history) so "clear my account" truly resets everything measurable
    // back to a brand-new account. PlayerState listens for this and persists
    // the cleared state to Supabase + localStorage.
    window.dispatchEvent(new Event(RESET_GAME_EVENT))
  }, [profile])

  const skipAllLessons = useCallback(() => {
    setProgress((prev) => {
      const lessonState = { ...prev.lessonState }
      for (const unit of UNITS) lessonState[unit.lessonId] = masteredLessonProgress(unit.lessonId)
      const next: UserProgress = {
        ...prev,
        lessonState,
        completedLessonIds: UNITS.map((u) => u.lessonId),
      }
      next.unitStatus = recomputeStatuses(next)
      return next
    })
  }, [])

  const playQuantumMatch = useCallback(() => {
    // Single 50-game season — the match counter is capped at SEASON_GAMES.
    update((p) => ({
      ...p,
      quantumMatchesPlayed: Math.min(SEASON_GAMES, (p.quantumMatchesPlayed ?? 0) + 1),
    }))
  }, [update])

  // Store a freshly-simulated final league table (the sim itself runs in the Dashboard,
  // which can safely import lib/league; AppState only persists the result). A simmed season
  // also marks all 50 matches as played; passing null clears both. Saved to the cloud with
  // the rest of `progress`.
  const setLeagueTable = useCallback((table: LeagueStanding[] | null) => {
    update((p) => ({
      ...p,
      leagueTable: table,
      quantumMatchesPlayed: table && table.length > 0 ? SEASON_GAMES : 0,
    }))
  }, [update])

  const claimDailyWheel = useCallback(() => {
    update((p) => ({ ...p, lastWheelSpinDate: todayKey() }))
  }, [update])

  // Testing hook: stamp the wheel as "spun yesterday" so it reappears immediately.
  const resetDailyWheel = useCallback(() => {
    update((p) => ({ ...p, lastWheelSpinDate: '' }))
  }, [update])

  // Same once-a-day pattern as the daily wheel: stamp today's date when the practice coin
  // bonus is collected so it can't be claimed again until tomorrow.
  const claimPracticeBonus = useCallback(() => {
    update((p) => ({ ...p, lastPracticeBonusDate: todayKey() }))
  }, [update])

  // Resolve one 90+ skill-point gamble spin: advances the rigged tracker (persisted to the
  // cloud) and returns the drawn 1–10 value synchronously so the wheel can animate to it.
  const rollPointsWheel = useCallback((): number => {
    const current = progressRef.current.pointsWheel ?? initPointsWheel()
    const { value, next } = spinPointsWheel(current)
    update((p) => ({ ...p, pointsWheel: next }))
    return value
  }, [update])

  const masteredCheck = useCallback(
    (lessonId: string) => isUnitMastered(progress.lessonState[lessonId]),
    [progress],
  )

  const value = useMemo<AppContextValue>(
    () => ({
      isLoggedIn,
      profile,
      progress,
      loginError,
      authPending,
      lastVisitDate: progress.lastActiveDate,
      visitedToday: progress.lastActiveDate === todayKey(),
      firstVisitToday,
      wheelAvailable: (progress.lastWheelSpinDate ?? '') !== todayKey(),
      practiceBonusAvailable: (progress.lastPracticeBonusDate ?? '') !== todayKey(),
      login,
      signup,
      logout,
      setCurrentLesson,
      setCurrentStep,
      setSandboxState,
      recordAnswer,
      completeLesson,
      isUnitMastered: masteredCheck,
      resetProgress,
      skipAllLessons,
      playQuantumMatch,
      setLeagueTable,
      claimDailyWheel,
      resetDailyWheel,
      claimPracticeBonus,
      rollPointsWheel,
    }),
    [
      isLoggedIn,
      profile,
      progress,
      loginError,
      authPending,
      firstVisitToday,
      login,
      signup,
      logout,
      setCurrentLesson,
      setCurrentStep,
      setSandboxState,
      recordAnswer,
      completeLesson,
      masteredCheck,
      resetProgress,
      skipAllLessons,
      playQuantumMatch,
      setLeagueTable,
      claimDailyWheel,
      resetDailyWheel,
      claimPracticeBonus,
      rollPointsWheel,
    ],
  )

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>
}

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext)
  if (!ctx) throw new Error('useApp must be used within AppProvider')
  return ctx
}
