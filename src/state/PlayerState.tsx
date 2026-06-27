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
  Appearance,
  AttemptInput,
  BankQuestion,
  EmblemConfig,
  PlayerProfile,
  PlayerSkills,
  ProficiencyMap,
  SkillId,
  TestAttempt,
  UnitProficiency,
} from '../types'
import { DEFAULT_APPEARANCE, normalizeAppearance } from '../lib/appearance'
import { defaultClubIdentity, normalizeClub } from '../lib/club'
import {
  MAX_RATING,
  SKILL_IDS,
  STARTING_RATING,
  defaultSkills,
  overallRating,
  spendSkillPoints,
} from '../lib/skills'
import { COSMETICS_BY_ID, STARTER_CLEATS, STARTER_JERSEY, STARTER_INVENTORY } from '../content/cosmetics'
import {
  addCoins as addCoinsTo,
  equipCosmetic,
  purchaseCosmetic,
  type PurchaseResult,
} from '../lib/economy'
import { recordAttempt, unitProficiencies, weakestConcepts } from '../lib/proficiency'
import { POINTS_FOR_70, POINTS_FOR_90, pointsForScore } from '../lib/questionBank'
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
    appearance: { ...DEFAULT_APPEARANCE },
    inventory: [...STARTER_INVENTORY],
    club: defaultClubIdentity(),
  }
}

/** Backfill any missing fields (e.g. appearance/club) on a profile loaded from an older cache. */
function withProfileDefaults(p: PlayerProfile): PlayerProfile {
  return { ...p, appearance: normalizeAppearance(p.appearance), club: normalizeClub(p.club) }
}

const randInt = (min: number, max: number) => min + Math.floor(Math.random() * (max - min + 1))

// ---- Season-sim synthetic career ----------------------------------------------------
// Simming the league also fabricates a full season's worth of player metadata so the
// dashboard isn't a hardcoded shell: a random per-unit proficiency rollup, a random skills
// spread, and `count` finished assessments. It's all random (different on each sim) and all
// stored in the cloud via the normal player sync — and wiped on reset like everything else.

/** Random per-unit proficiency (one synthetic concept per offered unit). */
function buildSimProficiency(): ProficiencyMap {
  const now = new Date().toISOString()
  const map: ProficiencyMap = {}
  for (const unitId of SKILL_IDS) {
    const attempts = randInt(28, 64)
    const accuracy = 0.55 + Math.random() * 0.4
    map[`${unitId}-season-sim`] = {
      conceptTag: `${unitId}-season-sim`,
      unitId,
      attempts,
      correct: Math.round(attempts * accuracy),
      proficiency: Math.round((52 + Math.random() * 43) * 10) / 10,
      avgTimeMs: randInt(11000, 26000),
      missStreak: 0,
      srBox: randInt(2, 4),
      nextDue: now,
      lastSeen: now,
    }
  }
  return map
}

/**
 * Spend `points` banked over the season across the five skills (each from the 50 base up
 * to the 99 cap), one point at a time into a random skill that still has headroom. Returns
 * the final spread and how many points were actually absorbed — any remainder (you can't
 * spend past a maxed-out card) is the caller's to convert to coins.
 */
function buildSimSkills(points: number): { skills: PlayerSkills; spent: number } {
  const ratings = SKILL_IDS.map(() => STARTING_RATING)
  let remaining = points
  let spent = 0
  while (remaining > 0) {
    const open = ratings.map((v, i) => ({ v, i })).filter((x) => x.v < MAX_RATING)
    if (open.length === 0) break
    ratings[open[Math.floor(Math.random() * open.length)].i]++
    remaining--
    spent++
  }
  const skills = {} as PlayerSkills
  SKILL_IDS.forEach((id, i) => (skills[id] = ratings[i]))
  return { skills, spent }
}

/** Randomly split `score` correct answers across `units` buckets, each capped at `cap`. */
function splitCorrect(score: number, units: number, cap: number): number[] {
  const arr = new Array(units).fill(0)
  let remaining = Math.min(score, units * cap)
  while (remaining > 0) {
    const open = arr.map((v, idx) => ({ v, idx })).filter((x) => x.v < cap)
    const pick = open[Math.floor(Math.random() * open.length)].idx
    arr[pick]++
    remaining--
  }
  return arr
}

/**
 * `count` PASSED assessments (every one ≥70%, some ≥90%), newest first. Each season rolls a
 * random "form" — how many of the assessments were ≥90% — so the total points earned spans
 * the full band (count×3 up to count×5) and the resulting overall differs noticeably every
 * sim, instead of clustering at the average like independent per-assessment rolls would.
 */
function buildSimHistory(count: number): TestAttempt[] {
  const out: TestAttempt[] = []
  const perUnitTotal = 4
  const total = SKILL_IDS.length * perUnitTotal // 20
  const ninetyCount = randInt(0, count) // this season's form
  for (let i = 0; i < count; i++) {
    const elite = i < ninetyCount // ≥90% assessment
    const score = elite ? randInt(18, total) : randInt(14, 17)
    const split = splitCorrect(score, SKILL_IDS.length, perUnitTotal)
    const perUnit: Record<string, { correct: number; total: number; avgTimeMs: number }> = {}
    SKILL_IDS.forEach((unitId, idx) => {
      perUnit[unitId] = { correct: split[idx], total: perUnitTotal, avgTimeMs: randInt(11000, 25000) }
    })
    const pct = score / total
    out.push({
      id: `sim-${Date.now()}-${i}`,
      takenAt: new Date(Date.now() - i * 36e5).toISOString(),
      score,
      total,
      passed70: pct >= 0.7,
      passed90: pct >= 0.9,
      pointsAwarded: elite ? POINTS_FOR_90 : POINTS_FOR_70,
      perUnit,
      reviewComplete: true,
    })
  }
  return out
}

/** Coin cost to skip a failed exam's retake and auto-pass it (no skill points awarded). */
export const AUTO_PASS_COST = 200

/** A bare 70% PASS with NO skill points — what buying your way past a failed exam records. */
function buildAutoPassAttempt(): TestAttempt {
  const perUnitTotal = 4
  const total = SKILL_IDS.length * perUnitTotal // 20
  const score = Math.ceil(total * 0.7) // 14/20 = exactly 70%
  const split = splitCorrect(score, SKILL_IDS.length, perUnitTotal)
  const perUnit: Record<string, { correct: number; total: number; avgTimeMs: number }> = {}
  SKILL_IDS.forEach((unitId, idx) => {
    perUnit[unitId] = { correct: split[idx], total: perUnitTotal, avgTimeMs: randInt(11000, 25000) }
  })
  return {
    id: `autopass-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    takenAt: new Date().toISOString(),
    score,
    total,
    passed70: true,
    passed90: false,
    pointsAwarded: 0,
    perUnit,
    reviewComplete: true,
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
  /** Adjust unspent skill points by a signed delta (floored at 0). */
  adjustSkillPoints: (delta: number) => void
  buyCosmetic: (itemId: string) => PurchaseResult
  equip: (itemId: string) => void
  /** Grant + equip a cosmetic for free (no coin cost). */
  grantCosmetic: (itemId: string) => void
  /** Update the player's physical look (skin tone / hair colour). */
  customizeAppearance: (patch: Partial<Appearance>) => void
  /** Rename your club (FC name). */
  renameClub: (name: string) => void
  /** Update your club crest (shape / motif / colour overrides). */
  setEmblem: (patch: Partial<EmblemConfig>) => void
  addCoins: (amount: number) => void
  /** Fabricate a finished-season career (random skills, proficiency + `count` assessments). */
  simSeasonStats: (assessments: number) => void
  /** Spend AUTO_PASS_COST coins to auto-pass a failed exam (no skill points). Returns success. */
  autoPassAssessment: () => boolean
  weakConcepts: (limit: number) => ReturnType<typeof weakestConcepts>
  resetPlayer: () => void
}

const PlayerContext = createContext<PlayerContextValue | null>(null)

export function PlayerProvider({ children }: { children: ReactNode }) {
  const { profile: authProfile, isLoggedIn } = useApp()
  const username = authProfile.username

  const [profile, setProfile] = useState<PlayerProfile>(() => {
    const cached = loadPlayerProfile()
    return cached ? withProfileDefaults(cached) : freshProfile()
  })
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
          appearance: normalizeAppearance(res.data.appearance),
          inventory: res.data.inventory ?? fresh.inventory,
          club: normalizeClub(res.data.club),
        })
        setProficiency(res.data.proficiency ?? {})
        setTestHistory(res.data.testHistory ?? [])
      } else if (res.status === 'empty') {
        setProfile(freshProfile())
        setProficiency({})
        setTestHistory([])
      } else {
        // offline: fall back to whatever this device cached for the session.
        const cached = loadPlayerProfile()
        setProfile(cached ? withProfileDefaults(cached) : freshProfile())
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

  // Buy your way past a failed exam: spend AUTO_PASS_COST coins to record a bare 70% pass
  // (no skill points), unlocking the matchday. Returns false (and does nothing) if too poor.
  const autoPassAssessment = useCallback((): boolean => {
    if (profile.coins < AUTO_PASS_COST) return false
    setProfile((p) => ({ ...p, coins: Math.max(0, p.coins - AUTO_PASS_COST) }))
    const attempt = buildAutoPassAttempt()
    setTestHistory((prev) => [attempt, ...prev].slice(0, 50))
    return true
  }, [profile.coins])

  // Adjust unspent skill points by a (possibly negative) delta, floored at 0. Used by the
  // 90+ gamble wheel to swap the safe +5 for the spun 1–10 result.
  const adjustSkillPoints = useCallback((delta: number) => {
    setProfile((p) => ({ ...p, skillPoints: Math.max(0, p.skillPoints + delta) }))
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

  // Grant + equip a cosmetic for FREE (no coin cost). Used by the free-testing path in
  // the locker so any jersey/boot can be tried without coins.
  const grantCosmetic = useCallback((itemId: string) => {
    setProfile((p) => {
      const item = COSMETICS_BY_ID[itemId]
      if (!item) return p
      const inventory = p.inventory.includes(itemId) ? p.inventory : [...p.inventory, itemId]
      return { ...p, inventory, equipped: { ...p.equipped, [item.kind]: itemId } }
    })
  }, [])

  // Patch the player's physical look (skin tone / hair colour). Persists + syncs like any
  // other profile change, so the new look propagates to the card, locker and every drill.
  const customizeAppearance = useCallback((patch: Partial<Appearance>) => {
    setProfile((p) => ({ ...p, appearance: normalizeAppearance({ ...p.appearance, ...patch }) }))
  }, [])

  // Rename your club. Persists + syncs like any other profile change.
  const renameClub = useCallback((name: string) => {
    setProfile((p) => ({ ...p, club: normalizeClub({ ...p.club, name }) }))
  }, [])

  // Patch your crest (shape / motif / colour overrides).
  const setEmblem = useCallback((patch: Partial<EmblemConfig>) => {
    setProfile((p) => ({
      ...p,
      club: normalizeClub({ ...p.club, emblem: { ...p.club.emblem, ...patch } }),
    }))
  }, [])

  const addCoins = useCallback((amount: number) => {
    setProfile((p) => addCoinsTo(p, amount))
  }, [])

  const simSeasonStats = useCallback((assessments: number) => {
    // A finished season = `assessments` passes, each banking POINTS_FOR_70 (≥70%) or
    // POINTS_FOR_90 (≥90%). Those points get spent across the five skills; anything that
    // can't fit (you're already a 99 overall) becomes 5 coins per leftover point. Nothing
    // is left dangling as unspent skill points.
    const history = buildSimHistory(assessments)
    const earned = history.reduce((sum, a) => sum + a.pointsAwarded, 0)
    const { skills, spent } = buildSimSkills(earned)
    const overflowCoins = (earned - spent) * 5
    setProfile((p) => ({
      ...p,
      skills,
      skillPoints: 0,
      coins: p.coins + overflowCoins,
    }))
    setProficiency(buildSimProficiency())
    setTestHistory(history)
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
      adjustSkillPoints,
      buyCosmetic,
      equip,
      grantCosmetic,
      customizeAppearance,
      renameClub,
      setEmblem,
      addCoins,
      simSeasonStats,
      autoPassAssessment,
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
      adjustSkillPoints,
      buyCosmetic,
      equip,
      grantCosmetic,
      customizeAppearance,
      renameClub,
      setEmblem,
      addCoins,
      simSeasonStats,
      autoPassAssessment,
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
