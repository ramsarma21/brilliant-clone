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
  AttemptInput,
  BankQuestion,
  PlayerProfile,
  ProficiencyMap,
  SkillId,
  TestAttempt,
  UnitProficiency,
} from '../types'
import { defaultSkills, overallRating, spendSkillPoints } from '../lib/skills'
import { STARTER_CLEATS, STARTER_JERSEY, STARTER_INVENTORY } from '../content/cosmetics'
import {
  addCoins as addCoinsTo,
  equipCosmetic,
  purchaseCosmetic,
  type PurchaseResult,
} from '../lib/economy'
import { recordAttempt, unitProficiencies, weakestConcepts } from '../lib/proficiency'
import { pointsForScore } from '../lib/questionBank'
import { RESET_GAME_EVENT, useApp } from './AppState'
import {
  loadPlayerProfile,
  loadProficiency,
  loadTestHistory,
  savePlayerProfile,
  saveProficiency,
  saveTestHistory,
} from '../lib/storage'
import { loadCloudPlayer, saveCloudPlayer } from '../lib/cloudSync'

function freshProfile(): PlayerProfile {
  return {
    skills: defaultSkills(),
    coins: 0,
    skillPoints: 0,
    equipped: { jersey: STARTER_JERSEY, cleats: STARTER_CLEATS },
    inventory: [...STARTER_INVENTORY],
  }
}

type TestResultInput = {
  score: number
  total: number
  perUnit: Record<string, { correct: number; total: number; avgTimeMs: number }>
  questions?: BankQuestion[]
  answers?: (string | null)[]
  /** Whether the guided review is already satisfied (e.g. a perfect score with
   *  nothing to remediate). Defaults to false when there are missed questions. */
  reviewComplete?: boolean
}

type PlayerContextValue = {
  profile: PlayerProfile
  overall: number
  proficiency: ProficiencyMap
  unitProficiency: Record<SkillId, UnitProficiency>
  testHistory: TestAttempt[]
  /** Fold one solved/missed question into proficiency + spaced repetition. */
  recordAttempt: (input: AttemptInput) => void
  /** Record a finished test, award skill points. Returns the granted points and
   *  the new attempt's id (so the Skills review can mark it complete later). */
  recordTestResult: (input: TestResultInput) => { pointsAwarded: number; attemptId: string }
  /** Mark a recorded attempt's guided Skills review as finished. */
  completeReview: (attemptId: string) => void
  spendPoint: (skillId: SkillId, points: number) => void
  buyCosmetic: (itemId: string) => PurchaseResult
  equip: (itemId: string) => void
  addCoins: (amount: number) => void
  weakConcepts: (limit: number) => ReturnType<typeof weakestConcepts>
  resetPlayer: () => void
}

const PlayerContext = createContext<PlayerContextValue | null>(null)

export function PlayerProvider({ children }: { children: ReactNode }) {
  const { profile: authProfile, isLoggedIn } = useApp()
  const username = authProfile.username

  const [profile, setProfile] = useState<PlayerProfile>(() => loadPlayerProfile() ?? freshProfile())
  const [proficiency, setProficiency] = useState<ProficiencyMap>(() => loadProficiency())
  const [testHistory, setTestHistory] = useState<TestAttempt[]>(() => loadTestHistory())

  // localStorage acts as a per-device cache only; the cloud (keyed by username)
  // is the source of truth and is hydrated below on login.
  useEffect(() => {
    savePlayerProfile(profile)
  }, [profile])
  useEffect(() => {
    saveProficiency(proficiency)
  }, [proficiency])
  useEffect(() => {
    saveTestHistory(testHistory)
  }, [testHistory])

  // Which username the local state currently reflects. The save effect is gated
  // on this so we never write one user's state into another's row (or push
  // defaults over real cloud data before hydration finishes).
  const hydratedUser = useRef<string | null>(null)

  // Hydrate the player slice for the signed-in user from the cloud. 'empty' (no
  // row yet) → starter defaults; 'unavailable' (offline) → keep the local cache.
  useEffect(() => {
    if (!isLoggedIn || !username) return
    let alive = true
    hydratedUser.current = null
    void (async () => {
      const res = await loadCloudPlayer(username)
      if (!alive) return
      if (res.status === 'ok') {
        const fresh = freshProfile()
        setProfile({
          skills: res.data.skills ?? fresh.skills,
          coins: res.data.coins ?? 0,
          skillPoints: res.data.skillPoints ?? 0,
          equipped: {
            jersey: res.data.equippedJersey ?? fresh.equipped.jersey,
            cleats: res.data.equippedCleats ?? fresh.equipped.cleats,
          },
          inventory: res.data.inventory ?? fresh.inventory,
        })
        setProficiency(res.data.proficiency ?? {})
        setTestHistory(res.data.testHistory ?? [])
      } else if (res.status === 'empty') {
        setProfile(freshProfile())
        setProficiency({})
        setTestHistory([])
      } else {
        // offline: fall back to whatever this device cached for the session.
        setProfile(loadPlayerProfile() ?? freshProfile())
        setProficiency(loadProficiency())
        setTestHistory(loadTestHistory())
      }
      hydratedUser.current = username
    })()
    return () => {
      alive = false
    }
  }, [username, isLoggedIn])

  // Debounced per-user sync of the full player slice (skills, economy, cosmetics,
  // proficiency, test history) to the cloud. Gated on hydration so a half-loaded
  // state can't clobber the row.
  const syncTimer = useRef<number | null>(null)
  useEffect(() => {
    if (!isLoggedIn || hydratedUser.current !== username) return
    if (syncTimer.current) window.clearTimeout(syncTimer.current)
    syncTimer.current = window.setTimeout(() => {
      void saveCloudPlayer(username, profile, proficiency, testHistory)
    }, 600)
    return () => {
      if (syncTimer.current) window.clearTimeout(syncTimer.current)
    }
  }, [profile, proficiency, testHistory, username, isLoggedIn])

  const recordAttemptCb = useCallback((input: AttemptInput) => {
    setProficiency((prev) => recordAttempt(prev, input))
  }, [])

  const recordTestResult = useCallback((input: TestResultInput): { pointsAwarded: number; attemptId: string } => {
    const points = pointsForScore(input.score, input.total)
    const pct = input.total > 0 ? input.score / input.total : 0
    const id = `test-${Date.now()}`
    const attempt: TestAttempt = {
      id,
      takenAt: new Date().toISOString(),
      score: input.score,
      total: input.total,
      passed70: pct >= 0.7,
      passed90: pct >= 0.9,
      pointsAwarded: points,
      perUnit: input.perUnit,
      questions: input.questions,
      answers: input.answers,
      reviewComplete: input.reviewComplete ?? false,
    }
    setTestHistory((prev) => [attempt, ...prev].slice(0, 50))
    if (points > 0) setProfile((p) => ({ ...p, skillPoints: p.skillPoints + points }))
    return { pointsAwarded: points, attemptId: id }
  }, [])

  const completeReview = useCallback((attemptId: string) => {
    setTestHistory((prev) =>
      prev.map((a) => (a.id === attemptId ? { ...a, reviewComplete: true } : a)),
    )
  }, [])

  const spendPoint = useCallback((skillId: SkillId, points: number) => {
    setProfile((p) => {
      const budget = Math.min(points, p.skillPoints)
      if (budget <= 0) return p
      const { skills, used } = spendSkillPoints(p.skills, skillId, budget)
      if (used === 0) return p
      return { ...p, skills, skillPoints: p.skillPoints - used }
    })
  }, [])

  const buyCosmetic = useCallback((itemId: string): PurchaseResult => {
    const result = purchaseCosmetic(profile, itemId)
    if (result.ok) setProfile(result.profile)
    return result
  }, [profile])

  const equip = useCallback((itemId: string) => {
    setProfile((p) => equipCosmetic(p, itemId))
  }, [])

  const addCoins = useCallback((amount: number) => {
    setProfile((p) => addCoinsTo(p, amount))
  }, [])

  const weakConcepts = useCallback(
    (limit: number) => weakestConcepts(proficiency, limit),
    [proficiency],
  )

  const resetPlayer = useCallback(() => {
    setProfile(freshProfile())
    setProficiency({})
    setTestHistory([])
  }, [])

  // Reset the player when a brand-new account signs up.
  useEffect(() => {
    const onReset = () => resetPlayer()
    window.addEventListener(RESET_GAME_EVENT, onReset)
    return () => window.removeEventListener(RESET_GAME_EVENT, onReset)
  }, [resetPlayer])

  const value = useMemo<PlayerContextValue>(
    () => ({
      profile,
      overall: overallRating(profile.skills),
      proficiency,
      unitProficiency: unitProficiencies(proficiency),
      testHistory,
      recordAttempt: recordAttemptCb,
      recordTestResult,
      completeReview,
      spendPoint,
      buyCosmetic,
      equip,
      addCoins,
      weakConcepts,
      resetPlayer,
    }),
    [
      profile,
      proficiency,
      testHistory,
      recordAttemptCb,
      recordTestResult,
      completeReview,
      spendPoint,
      buyCosmetic,
      equip,
      addCoins,
      weakConcepts,
      resetPlayer,
    ],
  )

  return <PlayerContext.Provider value={value}>{children}</PlayerContext.Provider>
}

export function usePlayer(): PlayerContextValue {
  const ctx = useContext(PlayerContext)
  if (!ctx) throw new Error('usePlayer must be used within PlayerProvider')
  return ctx
}
