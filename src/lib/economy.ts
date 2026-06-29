import type { Cosmetic, PlayerProfile } from '../types'
import { COSMETICS_BY_ID } from '../content/cosmetics'

// Number of questions in the optional post-game review.
export const REVIEW_QUESTION_COUNT = 5

// ===========================================================================
// COIN-FARM ECONOMY
//
// The loop: you can only EARN coins in the Coin Farm (a strict, perfect-or-
// nothing adaptive quiz), and you SPEND them to enter matchdays. A match only
// pays you back if you complete its (hard) objective — otherwise the entry coins
// are forfeit, win or lose. This makes coins mean mastery and gives every match
// real stakes.
// ===========================================================================

/** Coins a brand-new account starts with — zero. You earn your first coins in the
 *  Coin Farm (the first run pays a one-off welcome bonus). */
export const STARTER_COINS = 0

/** One-off welcome bonus coins paid for completing your very first Coin Farm run. */
export const FIRST_FARM_BONUS = 100

/** Flat coins it costs to enter a matchday. */
export const MATCH_ENTRY_COST = 25

/** Bonus coins for completing a matchday's objective. There is NO entry refund:
 *  the 25-coin entry is always spent, and a completed objective pays this flat bonus
 *  on top (a small reward, not a way to get rich — coins come from the training drills).
 *  Objectives come in two tiers: easy pays 5, hard pays 10. */
export const CHALLENGE_BONUS_EASY = 5
export const CHALLENGE_BONUS_HARD = 10

// ---- Training-ground drill payouts -----------------------------------------
// Drills (not the match) are the income engine: clearing a drill's full mastery
// set (solving every scenario) pays coins. The FIRST-ever clear of a drill pays a
// one-off mastery bonus; later "review" clears pay the base. A faded/"rusty" drill
// pays a spaced-review bonus to pull you back to it.
/** Base coins for clearing a drill's mastery set (every scenario solved). */
export const DRILL_CLEAR_PAYOUT = 20
/** One-off extra coins the first time you ever master a drill. */
export const DRILL_FIRST_MASTERY_BONUS = 30
/** Extra coins for clearing a drill that had gone "rusty" (due for spaced review). */
export const DRILL_RUSTY_BONUS = 10

// ---- Lesson payouts (the learning is the income engine) --------------------
// Learning happens in the interactive lessons; the match is a pure motivator you
// SPEND those coins on. Mastering a unit's lesson pays a one-off coin grant — the
// reward that funds matchday.
/** One-off coins paid the first time you MASTER a unit's lesson. */
export const LESSON_MASTERY_PAYOUT = 60

/** Coins to reroll a matchday's bonus objective to a different one. */
export const OBJECTIVE_SHUFFLE_COST = 5

/** Chance, rolled before a match, that entry is FREE (a "lucky drop"). */
export const LUCKY_DROP_CHANCE = 0.12

// ---- Coin Farm payouts -----------------------------------------------------
/** Number of questions in a standard farm run. */
export const FARM_QUESTIONS = 8
/** Base coins for a PERFECT standard run (before the streak multiplier). */
export const FARM_BASE_PAYOUT = 14
/** A perfect run on the "double my payout" (harder, weakness-targeting) set pays ×2. */
export const FARM_DOUBLE_MULT = 2
/** Per-perfect-run streak multiplier step (×1, ×1.25, ×1.5, … capped). */
export const FARM_STREAK_STEP = 0.25
export const FARM_STREAK_CAP = 2.5
/** Chance of a jackpot multiplier reveal on a perfect run. */
export const FARM_JACKPOT_CHANCE = 0.14
/** Per-question answer time limit (seconds) — timeout counts as wrong (anti-look-it-up). */
export const FARM_SECONDS_PER_Q = 30

/** The streak multiplier applied to a perfect run for the given current streak (0-based). */
export function streakMultiplier(perfectStreak: number): number {
  return Math.min(FARM_STREAK_CAP, 1 + Math.max(0, perfectStreak) * FARM_STREAK_STEP)
}

/** Roll a jackpot coin multiplier (×2/×3/×5) or 1 (no jackpot) for a perfect run. */
export function rollJackpot(rng: () => number = Math.random): number {
  if (rng() >= FARM_JACKPOT_CHANCE) return 1
  const r = rng()
  if (r < 0.6) return 2
  if (r < 0.9) return 3
  return 5
}

/**
 * Coins paid for a PERFECT farm run. Scales with the running perfect streak and
 * doubles on the harder weakness set; the jackpot multiplier is applied on top.
 * A non-perfect run pays 0 (handled by the caller).
 */
export function farmPayout(opts: {
  perfectStreak: number
  doubled: boolean
  jackpot: number
}): number {
  const base = FARM_BASE_PAYOUT * (opts.doubled ? FARM_DOUBLE_MULT : 1)
  return Math.round(base * streakMultiplier(opts.perfectStreak) * Math.max(1, opts.jackpot))
}

/** Roll whether this matchday's entry is a free "lucky drop". */
export function rollLuckyDrop(rng: () => number = Math.random): boolean {
  return rng() < LUCKY_DROP_CHANCE
}

export type PurchaseResult =
  | { ok: true; profile: PlayerProfile }
  | { ok: false; reason: 'unknown-item' | 'already-owned' | 'insufficient-coins' }

export function canAfford(profile: PlayerProfile, itemId: string): boolean {
  const item = COSMETICS_BY_ID[itemId]
  return Boolean(item) && profile.coins >= item.price
}

export function purchaseCosmetic(profile: PlayerProfile, itemId: string): PurchaseResult {
  const item = COSMETICS_BY_ID[itemId]
  if (!item) return { ok: false, reason: 'unknown-item' }
  if (profile.inventory.includes(itemId)) return { ok: false, reason: 'already-owned' }
  if (profile.coins < item.price) return { ok: false, reason: 'insufficient-coins' }
  return {
    ok: true,
    profile: {
      ...profile,
      coins: profile.coins - item.price,
      inventory: [...profile.inventory, itemId],
    },
  }
}

/** Equip an owned cosmetic into its slot. No-op if not owned. */
export function equipCosmetic(profile: PlayerProfile, itemId: string): PlayerProfile {
  const item: Cosmetic | undefined = COSMETICS_BY_ID[itemId]
  if (!item || !profile.inventory.includes(itemId)) return profile
  return { ...profile, equipped: { ...profile.equipped, [item.kind]: itemId } }
}

export function addCoins(profile: PlayerProfile, amount: number): PlayerProfile {
  return { ...profile, coins: Math.max(0, profile.coins + amount) }
}

/** Spend coins if affordable. Returns the (possibly unchanged) profile + whether it succeeded. */
export function spendCoins(
  profile: PlayerProfile,
  amount: number,
): { ok: boolean; profile: PlayerProfile } {
  if (amount <= 0) return { ok: true, profile }
  if (profile.coins < amount) return { ok: false, profile }
  return { ok: true, profile: { ...profile, coins: profile.coins - amount } }
}
