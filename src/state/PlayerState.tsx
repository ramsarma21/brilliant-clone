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
  GkStatId,
  ProficiencyMap,
  SkillId,
  TestAttempt,
  UnitId,
  UnitProficiency,
} from '../types'
import { DEFAULT_APPEARANCE, normalizeAppearance } from '../lib/appearance'
import { defaultClubIdentity, normalizeClub } from '../lib/club'
import { SKILL_IDS } from '../lib/skills'
import { defaultSquad, migrateSquad, setSquadCleats, teamOverall, upgradeSquadStat } from '../lib/squad'
import { COSMETICS_BY_ID, STARTER_CLEATS, STARTER_JERSEY, STARTER_INVENTORY } from '../content/cosmetics'
import {
  addCoins as addCoinsTo,
  equipCosmetic,
  purchaseCosmetic,
  spendCoins as spendCoinsFrom,
  STARTER_COINS,
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
    squad: defaultSquad(),
    coins: STARTER_COINS,
    skillPoints: 0,
    equipped: { jersey: STARTER_JERSEY, cleats: STARTER_CLEATS },
    appearance: { ...DEFAULT_APPEARANCE },
    inventory: [...STARTER_INVENTORY],
    club: defaultClubIdentity(),
  }
}

/** Backfill any missing fields (e.g. appearance/club) on a profile loaded from an older cache. */
function withProfileDefaults(p: PlayerProfile): PlayerProfile {
  // Older caches may carry a single `skills` block instead of a squad — migrate it.
  const legacy = (p as unknown as { skills?: Record<string, number> }).skills
  return {
    ...p,
    squad: migrateSquad(p.squad, legacy),
    appearance: normalizeAppearance(p.appearance),
    club: normalizeClub(p.club),
  }
}

const randInt = (min: number, max: number) => min + Math.floor(Math.random() * (max - min + 1))

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
  unitProficiency: Record<UnitId, UnitProficiency>
  testHistory: TestAttempt[]
  /** Fold one solved/missed question into proficiency + spaced repetition. */
  recordAttempt: (input: AttemptInput) => void
  /** Record a finished test, award skill points. Returns the granted points and
   *  the new attempt's id (so the Skills review can mark it complete later). */
  recordTestResult: (input: TestResultInput) => { pointsAwarded: number; attemptId: string }
  /** Mark a recorded attempt's guided Skills review as finished. */
  completeReview: (attemptId: string) => void
  /** Spend skill points to raise one stat on one squad player. */
  upgradePlayer: (playerId: string, statId: SkillId | GkStatId, points: number) => void
  /** Adjust unspent skill points by a signed delta (floored at 0). */
  adjustSkillPoints: (delta: number) => void
  buyCosmetic: (itemId: string) => PurchaseResult
  equip: (itemId: string) => void
  /** Equip a boots cosmetic on a single squad player. */
  equipPlayerCleats: (playerId: string, cleatsId: string) => void
  /** Grant + equip a cosmetic for free (no coin cost). */
  grantCosmetic: (itemId: string) => void
  /** Update the player's physical look (skin tone / hair colour). */
  customizeAppearance: (patch: Partial<Appearance>) => void
  /** Rename your club (FC name). */
  renameClub: (name: string) => void
  /** Cache the 3-letter broadcast abbreviation for the club name. */
  setClubAbbr: (abbr: string) => void
  /** Update your club crest (shape / motif / colour overrides). */
  setEmblem: (patch: Partial<EmblemConfig>) => void
  addCoins: (amount: number) => void
  /** Spend coins if affordable (e.g. match entry). Returns whether the spend succeeded. */
  spendCoins: (amount: number) => boolean
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
        setProfile((prev) => {
          const fresh = freshProfile()
          // The squad (names, looks, ratings, boots) must only ever change on a CAREER
          // RESET — never on a refresh. So only (re)build it from a squad we actually
          // have: if the cloud row has a stored squad, use it; otherwise KEEP the squad
          // we already loaded from the local cache (`prev`) instead of generating a new
          // random team. (A genuinely new user with no cache keeps the one fresh squad
          // made at init, which then persists.)
          const hasCloudSquad = Array.isArray(res.data.squad) && res.data.squad.length > 0
          const squad = hasCloudSquad
            ? migrateSquad(res.data.squad, res.data.skills)
            : prev.squad
          return {
            squad,
            coins: res.data.coins ?? 0,
            skillPoints: res.data.skillPoints ?? 0,
            equipped: {
              jersey: res.data.equippedJersey ?? fresh.equipped.jersey,
              cleats: res.data.equippedCleats ?? fresh.equipped.cleats,
            },
            appearance: normalizeAppearance(res.data.appearance),
            inventory: res.data.inventory ?? fresh.inventory,
            club: normalizeClub(res.data.club),
          }
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

  const upgradePlayer = useCallback(
    (playerId: string, statId: SkillId | GkStatId, points: number) => {
      setProfile((p) => {
        const budget = Math.min(points, p.skillPoints)
        if (budget <= 0) return p
        const { squad, used } = upgradeSquadStat(p.squad, playerId, statId, budget)
        if (used === 0) return p
        return { ...p, squad, skillPoints: p.skillPoints - used }
      })
    },
    [],
  )

  const buyCosmetic = useCallback((itemId: string): PurchaseResult => {
    const result = purchaseCosmetic(profile, itemId)
    if (result.ok) setProfile(result.profile)
    return result
  }, [profile])

  const equip = useCallback((itemId: string) => {
    setProfile((p) => equipCosmetic(p, itemId))
  }, [])

  // Equip a boots cosmetic on ONE squad player (boots are per-player). Grants ownership
  // so any boot can be assigned; the shared inventory still tracks what you've unlocked.
  const equipPlayerCleats = useCallback((playerId: string, cleatsId: string) => {
    setProfile((p) => {
      const item = COSMETICS_BY_ID[cleatsId]
      if (!item || item.kind !== 'cleats') return p
      const inventory = p.inventory.includes(cleatsId) ? p.inventory : [...p.inventory, cleatsId]
      return { ...p, inventory, squad: setSquadCleats(p.squad, playerId, cleatsId) }
    })
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

  // Rename your club. Persists + syncs like any other profile change. The broadcast
  // abbreviation is cleared so it regenerates for the new name on the next matchday.
  const renameClub = useCallback((name: string) => {
    setProfile((p) => ({ ...p, club: normalizeClub({ ...p.club, name, abbr: undefined }) }))
  }, [])

  // Cache the AI-generated (or locally-derived) 3-letter scorecard abbreviation.
  const setClubAbbr = useCallback((abbr: string) => {
    setProfile((p) => (p.club.abbr === abbr ? p : { ...p, club: normalizeClub({ ...p.club, abbr }) }))
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

  // Spend coins if affordable. Reads the live coin balance synchronously so the caller
  // (e.g. a match-entry click) gets an immediate yes/no, then commits the deduction.
  const spendCoins = useCallback(
    (amount: number): boolean => {
      const { ok } = spendCoinsFrom(profile, amount)
      if (ok) setProfile((p) => spendCoinsFrom(p, amount).profile)
      return ok
    },
    [profile],
  )

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
      overall: teamOverall(profile.squad),
      proficiency,
      unitProficiency: unitProficiencies(proficiency),
      testHistory,
      recordAttempt: recordAttemptCb,
      recordTestResult,
      completeReview,
      upgradePlayer,
      adjustSkillPoints,
      buyCosmetic,
      equip,
      equipPlayerCleats,
      grantCosmetic,
      customizeAppearance,
      renameClub,
      setClubAbbr,
      setEmblem,
      addCoins,
      spendCoins,
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
      upgradePlayer,
      adjustSkillPoints,
      buyCosmetic,
      equip,
      equipPlayerCleats,
      grantCosmetic,
      customizeAppearance,
      renameClub,
      setClubAbbr,
      setEmblem,
      addCoins,
      spendCoins,
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
