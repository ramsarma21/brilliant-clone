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
  LessonProgress,
  SimState,
  StepAnswer,
  UnitStatus,
  UserProfile,
  UserProgress,
} from '../types'
import { LESSONS, UNITS } from '../content/lessons'
import {
  DEMO_PROFILE,
  loadProgress,
  loadSession,
  saveProgress,
  saveSession,
  todayKey,
} from '../lib/storage'

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
  }
}

/** A unit is mastered when all 3 mastery checks pass and the challenge is met. */
function isUnitMastered(lp: LessonProgress | undefined): boolean {
  if (!lp) return false
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

function computeStreakOnLogin(progress: UserProgress): UserProgress {
  const today = todayKey()
  if (progress.lastActiveDate === today) return progress
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10)
  let streak = progress.streakCount
  if (progress.lastActiveDate === yesterday) streak += 1
  else streak = Math.max(1, 1)
  return { ...progress, streakCount: streak, lastActiveDate: today }
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

type AppContextValue = {
  isLoggedIn: boolean
  profile: UserProfile
  progress: UserProgress
  loginError: string | null
  login: (username: string, password: string) => boolean
  logout: () => void
  setCurrentLesson: (lessonId: string) => void
  setCurrentStep: (lessonId: string, index: number) => void
  setSandboxState: (lessonId: string, state: SimState) => void
  recordAnswer: (args: RecordAnswerArgs) => void
  completeLesson: (lessonId: string) => void
  isUnitMastered: (lessonId: string) => boolean
  resetProgress: () => void
}

const AppContext = createContext<AppContextValue | null>(null)

export function AppProvider({ children }: { children: ReactNode }) {
  const [isLoggedIn, setIsLoggedIn] = useState<boolean>(() => loadSession())
  const [loginError, setLoginError] = useState<string | null>(null)
  const [progress, setProgress] = useState<UserProgress>(
    () => loadProgress() ?? createInitialProgress(),
  )

  // Persist progress whenever it changes.
  const firstRender = useRef(true)
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false
    }
    saveProgress(progress)
  }, [progress])

  const update = useCallback((updater: (p: UserProgress) => UserProgress) => {
    setProgress((prev) => {
      const next = updater(prev)
      next.unitStatus = recomputeStatuses(next)
      return next
    })
  }, [])

  const login = useCallback((username: string, password: string): boolean => {
    if (username.trim() === 'test' && password === 'test') {
      setIsLoggedIn(true)
      saveSession(true)
      setLoginError(null)
      setProgress((prev) => {
        const next = computeStreakOnLogin(prev)
        next.unitStatus = recomputeStatuses(next)
        return next
      })
      return true
    }
    setLoginError('Incorrect username or password. Try test / test.')
    return false
  }, [])

  const logout = useCallback(() => {
    setIsLoggedIn(false)
    saveSession(false)
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
    fresh.unitStatus = recomputeStatuses(fresh)
    setProgress(fresh)
  }, [])

  const masteredCheck = useCallback(
    (lessonId: string) => isUnitMastered(progress.lessonState[lessonId]),
    [progress],
  )

  const value = useMemo<AppContextValue>(
    () => ({
      isLoggedIn,
      profile: DEMO_PROFILE,
      progress,
      loginError,
      login,
      logout,
      setCurrentLesson,
      setCurrentStep,
      setSandboxState,
      recordAnswer,
      completeLesson,
      isUnitMastered: masteredCheck,
      resetProgress,
    }),
    [
      isLoggedIn,
      progress,
      loginError,
      login,
      logout,
      setCurrentLesson,
      setCurrentStep,
      setSandboxState,
      recordAnswer,
      completeLesson,
      masteredCheck,
      resetProgress,
    ],
  )

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>
}

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext)
  if (!ctx) throw new Error('useApp must be used within AppProvider')
  return ctx
}
