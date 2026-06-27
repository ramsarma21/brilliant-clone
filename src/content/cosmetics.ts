import type { Cosmetic } from '../types'

// Cosmetics catalog. Starter items (price 0) are owned + equipped from the
// first run — the "shitty jersey + cleats" the player begins with. Everything
// else is unlocked with coins earned from winning matches and reviews.

export const STARTER_JERSEY = 'jersey-starter'
export const STARTER_CLEATS = 'cleats-starter'

export const COSMETICS: Cosmetic[] = [
  // ---- Jerseys ----
  // Default = the BLUE home kit worn by the in-drill character (the penalty taker).
  {
    id: STARTER_JERSEY,
    kind: 'jersey',
    name: 'Home Kit',
    rarity: 'starter',
    price: 0,
    colors: { primary: '#2f6df0', secondary: '#1d4ec0', accent: '#ffffff' },
    pattern: 'plain',
    shorts: '#eef2fb',
  },
  {
    id: 'jersey-sunday',
    kind: 'jersey',
    name: 'Crimson Classic',
    rarity: 'common',
    price: 300,
    // bold red body, crisp white sleeves + gold trim
    colors: { primary: '#e2263f', secondary: '#ffffff', accent: '#ffd23f' },
    pattern: 'plain',
    shorts: '#ffffff',
  },
  {
    id: 'jersey-azure',
    kind: 'jersey',
    name: 'Azure Pinstripe',
    rarity: 'common',
    price: 300,
    colors: { primary: '#1f6fe0', secondary: '#0f3f8c', accent: '#ffffff' },
    pattern: 'stripes',
    shorts: '#ffffff',
  },
  {
    id: 'jersey-emerald',
    kind: 'jersey',
    name: 'Emerald Sash',
    rarity: 'rare',
    price: 800,
    colors: { primary: '#0fae77', secondary: '#0a7c54', accent: '#ffd23f' },
    pattern: 'sash',
    shorts: '#0e1726',
  },
  {
    id: 'jersey-galaxy',
    kind: 'jersey',
    name: 'Galaxy Kit',
    rarity: 'epic',
    price: 2000,
    // cosmic gradient with star speckle
    colors: { primary: '#6d4bff', secondary: '#ff5fc4', accent: '#ffffff' },
    pattern: 'galaxy',
    shorts: '#160f33',
  },

  // ---- Cleats ----
  {
    id: STARTER_CLEATS,
    kind: 'cleats',
    name: 'Scuffed Trainers',
    rarity: 'starter',
    price: 0,
    colors: { primary: '#2b2f37', secondary: '#15171f', accent: '#5a606b' },
  },
  {
    id: 'cleats-bolt',
    kind: 'cleats',
    name: 'Bolt Yellow',
    rarity: 'common',
    price: 250,
    colors: { primary: '#ffd23f', secondary: '#d99316', accent: '#1b1d24' },
  },
  {
    id: 'cleats-crimson',
    kind: 'cleats',
    name: 'Crimson Speed',
    rarity: 'rare',
    price: 700,
    colors: { primary: '#ff3b54', secondary: '#c4313f', accent: '#ffffff' },
  },
  {
    id: 'cleats-phantom',
    kind: 'cleats',
    name: 'Phantom Black',
    rarity: 'epic',
    price: 1800,
    colors: { primary: '#15171f', secondary: '#000000', accent: '#7c5cff' },
  },
]

export const COSMETICS_BY_ID: Record<string, Cosmetic> = Object.fromEntries(
  COSMETICS.map((c) => [c.id, c]),
)

export function cosmeticsOfKind(kind: Cosmetic['kind']): Cosmetic[] {
  return COSMETICS.filter((c) => c.kind === kind)
}

/** Items the player owns the moment they start (the starter kit). */
export const STARTER_INVENTORY: string[] = COSMETICS.filter((c) => c.rarity === 'starter').map(
  (c) => c.id,
)
