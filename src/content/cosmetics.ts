import type { Cosmetic } from '../types'

// Cosmetics catalog. Starter items (price 0) are owned + equipped from the
// first run — the "shitty jersey + cleats" the player begins with. Everything
// else is unlocked with coins earned from winning matches and reviews.

export const STARTER_JERSEY = 'jersey-starter'
export const STARTER_CLEATS = 'cleats-starter'

export const COSMETICS: Cosmetic[] = [
  // ---- Jerseys ----
  {
    id: STARTER_JERSEY,
    kind: 'jersey',
    name: 'Training Bib (worn)',
    rarity: 'starter',
    price: 0,
    colors: { primary: '#8a8f99', secondary: '#6b7079', accent: '#c2c7d0' },
  },
  {
    id: 'jersey-sunday',
    kind: 'jersey',
    name: 'Sunday League Red',
    rarity: 'common',
    price: 300,
    colors: { primary: '#d6314b', secondary: '#a31f35', accent: '#ff7a8c' },
  },
  {
    id: 'jersey-azure',
    kind: 'jersey',
    name: 'Azure Classic',
    rarity: 'common',
    price: 300,
    colors: { primary: '#2f6df0', secondary: '#1d4ec0', accent: '#6f9bff' },
  },
  {
    id: 'jersey-emerald',
    kind: 'jersey',
    name: 'Emerald Strike',
    rarity: 'rare',
    price: 800,
    colors: { primary: '#10b981', secondary: '#0c8f66', accent: '#5ff0bd' },
  },
  {
    id: 'jersey-galaxy',
    kind: 'jersey',
    name: 'Galaxy Kit',
    rarity: 'epic',
    price: 2000,
    colors: { primary: '#7c5cff', secondary: '#5a32d6', accent: '#ff6ec7' },
  },

  // ---- Cleats ----
  {
    id: STARTER_CLEATS,
    kind: 'cleats',
    name: 'Scuffed Trainers',
    rarity: 'starter',
    price: 0,
    colors: { primary: '#3a3f48', secondary: '#22262d', accent: '#5a606b' },
  },
  {
    id: 'cleats-bolt',
    kind: 'cleats',
    name: 'Bolt Yellow',
    rarity: 'common',
    price: 250,
    colors: { primary: '#ffd23f', secondary: '#d99316', accent: '#fff0a8' },
  },
  {
    id: 'cleats-crimson',
    kind: 'cleats',
    name: 'Crimson Speed',
    rarity: 'rare',
    price: 700,
    colors: { primary: '#ff5b6e', secondary: '#c4313f', accent: '#ffb3bb' },
  },
  {
    id: 'cleats-phantom',
    kind: 'cleats',
    name: 'Phantom Black',
    rarity: 'epic',
    price: 1800,
    colors: { primary: '#11141d', secondary: '#000000', accent: '#7c5cff' },
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
