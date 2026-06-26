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
import { DEMO_PROFILE } from '../lib/storage'
import {
  loadPlayerProfile,
  loadProficiency,
  loadTestHistory,
  savePlayerProfile,
  saveProficiency,
  saveTestHistory,
} from '../lib/storage'
import { supabase, isSupabaseConfigured } from '../lib/supabase'

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
}

type PlayerContextValue = {
  profile: PlayerProfile
  overall: number
  proficiency: ProficiencyMap
  unitProficiency: Record<SkillId, UnitProficiency>
  testHistory: TestAttempt[]
  /** Fold one solved/missed question into proficiency + spaced repetition. */
  recordAttempt: (input: AttemptInput) => void
  /** Record a finished test, award skill points, return points granted. */
  recordTestResult: (input: TestResultInput) => number
  spendPoint: (skillId: SkillId, points: number) => void
  buyCosmetic: (itemId: string) => PurchaseResult
  equip: (itemId: string) => void
  addCoins: (amount: number) => void
  weakConcepts: (limit: number) => ReturnType<typeof weakestConcepts>
  resetPlayer: () => void
}

const PlayerContext = createContext<PlayerContextValue | null>(null)

export function PlayerProvider({ children }: { children: ReactNode }) {
  const [profile, setProfile] = useState<PlayerProfile>(() => loadPlayerProfile() ?? freshProfile())
  const [proficiency, setProficiency] = useState<ProficiencyMap>(() => loadProficiency())
  const [testHistory, setTestHistory] = useState<TestAttempt[]>(() => loadTestHistory())

  useEffect(() => {
    savePlayerProfile(profile)
  }, [profile])
  useEffect(() => {
    saveProficiency(proficiency)
  }, [proficiency])
  useEffect(() => {
    saveTestHistory(testHistory)
  }, [testHistory])

  // Best-effort sync of the economy/meta columns to Supabase. Local storage
  // remains the source of truth; failures are silently ignored (offline-first).
  const syncTimer = useRef<number | null>(null)
  useEffect(() => {
    if (!isSupabaseConfigured) return
    if (syncTimer.current) window.clearTimeout(syncTimer.current)
    syncTimer.current = window.setTimeout(() => {
      void (async () => {
        try {
          await supabase.from('profiles').upsert(
            {
              username: DEMO_PROFILE.username,
              display_name: DEMO_PROFILE.displayName,
              coins: profile.coins,
              skill_points: profile.skillPoints,
              overall: overallRating(profile.skills),
              equipped_jersey: profile.equipped.jersey,
              equipped_cleats: profile.equipped.cleats,
              updated_at: new Date().toISOString(),
            },
            { onConflict: 'username' },
          )
        } catch {
          // offline / table missing — local storage is authoritative
        }
      })()
    }, 600)
    return () => {
      if (syncTimer.current) window.clearTimeout(syncTimer.current)
    }
  }, [profile])

  const recordAttemptCb = useCallback((input: AttemptInput) => {
    setProficiency((prev) => recordAttempt(prev, input))
  }, [])

  const recordTestResult = useCallback((input: TestResultInput): number => {
    const points = pointsForScore(input.score, input.total)
    const pct = input.total > 0 ? input.score / input.total : 0
    const attempt: TestAttempt = {
      id: `test-${Date.now()}`,
      takenAt: new Date().toISOString(),
      score: input.score,
      total: input.total,
      passed70: pct >= 0.7,
      passed90: pct >= 0.9,
      pointsAwarded: points,
      perUnit: input.perUnit,
    }
    setTestHistory((prev) => [attempt, ...prev].slice(0, 50))
    if (points > 0) setProfile((p) => ({ ...p, skillPoints: p.skillPoints + points }))
    return points
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

  const value = useMemo<PlayerContextValue>(
    () => ({
      profile,
      overall: overallRating(profile.skills),
      proficiency,
      unitProficiency: unitProficiencies(proficiency),
      testHistory,
      recordAttempt: recordAttemptCb,
      recordTestResult,
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
