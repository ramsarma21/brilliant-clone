import type { Cosmetic, PlayerProfile } from '../types'
import { COSMETICS_BY_ID } from '../content/cosmetics'

// Coin rewards (tunable). Match win is the headline payout; the optional
// post-game review pays per correct question to incentivize fixing weak spots.
export const COINS_PER_MATCH_WIN = 100
export const COINS_PER_REVIEW_CORRECT = 20
export const REVIEW_QUESTION_COUNT = 5

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
