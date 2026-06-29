import type {
  Appearance,
  GkSkills,
  GkStatId,
  PlayerSkills,
  SkillId,
  Squad,
  SquadPlayer,
  SquadRole,
} from '../types'
import {
  CORE_SKILL_IDS,
  GK_STAT_IDS,
  MAX_RATING,
  STARTING_RATING,
  defaultSkills,
  migrateSkills,
} from './skills'
import { normalizeAppearance, randomAppearance } from './appearance'
import { randomName } from './names'
import { STARTER_CLEATS } from '../content/cosmetics'

// ===========================================================================
// YOUR CLUB — FIFA-Ultimate-Team-style squad of 8 individually-rated players.
//
// The roster is ordered to line up 1:1 with the in-match FORMATION (1 GK, 2 DEF,
// 3 MID, 2 FWD); index 7 (num 10) is the striker YOU control by default. Each
// outfielder carries the six outfield skills; the keeper carries three GK stats.
// All ratings are stored per user and drive that player's match attributes.
// ===========================================================================

type SquadSlot = { id: string; role: SquadRole; num: number }

/** The fixed club roster shape: order + numbers, aligned 1:1 with the FORMATION. */
export const SQUAD_TEMPLATE: SquadSlot[] = [
  { id: 's0', role: 'GK', num: 1 },
  { id: 's1', role: 'DEF', num: 2 },
  { id: 's2', role: 'DEF', num: 5 },
  { id: 's3', role: 'MID', num: 7 },
  { id: 's4', role: 'MID', num: 6 },
  { id: 's5', role: 'MID', num: 8 },
  { id: 's6', role: 'FWD', num: 9 },
  { id: 's7', role: 'FWD', num: 10 },
]

/** Index of the striker you control by default (num 10). */
export const STAR_INDEX = 7

export function defaultGkSkills(): GkSkills {
  const out = {} as GkSkills
  for (const id of GK_STAT_IDS) out[id] = STARTING_RATING
  return out
}

type SlotExtras = { name?: string; appearance?: Appearance; cleats?: string; stats?: PlayerSkills; gk?: GkSkills }

function makePlayer(slot: SquadSlot, x: SlotExtras = {}): SquadPlayer {
  const name = x.name ?? randomName().full
  const appearance = x.appearance ?? randomAppearance()
  const cleats = x.cleats ?? STARTER_CLEATS
  if (slot.role === 'GK') {
    return { id: slot.id, role: 'GK', name, num: slot.num, appearance, cleats, gk: x.gk ?? defaultGkSkills() }
  }
  return {
    id: slot.id,
    role: slot.role,
    name,
    num: slot.num,
    appearance,
    cleats,
    stats: x.stats ?? defaultSkills(),
  }
}

/** A brand-new club: starting ratings, but a freshly RANDOM name + look per player. */
export function defaultSquad(): Squad {
  return SQUAD_TEMPLATE.map((slot) => makePlayer(slot))
}

function normalizeGk(raw: Partial<Record<string, number>> | null | undefined): GkSkills {
  const out = defaultGkSkills()
  if (raw) {
    for (const id of GK_STAT_IDS) {
      const v = raw[id]
      if (typeof v === 'number') out[id] = v
    }
  }
  return out
}

/**
 * Normalise whatever was loaded from the cloud / cache into a valid 8-player
 * squad. Handles three cases:
 *   1. A stored squad array → re-keyed against the template (names preserved).
 *   2. No squad yet but a LEGACY single skill block → applied to all outfielders
 *      (so a returning user's one trained block seeds the whole team).
 *   3. Nothing → a fresh default squad.
 */
export function migrateSquad(
  rawSquad: unknown,
  legacySkills?: Partial<Record<string, number>> | null,
): Squad {
  if (Array.isArray(rawSquad) && rawSquad.length > 0) {
    const byId = new Map<string, Record<string, unknown>>()
    const byNum = new Map<number, Record<string, unknown>>()
    for (const r of rawSquad as Record<string, unknown>[]) {
      if (r && typeof r === 'object') {
        if (typeof r.id === 'string') byId.set(r.id, r)
        if (typeof r.num === 'number') byNum.set(r.num, r)
      }
    }
    return SQUAD_TEMPLATE.map((slot) => {
      const r = byId.get(slot.id) ?? byNum.get(slot.num)
      const extras: SlotExtras = {
        name: typeof r?.name === 'string' ? (r.name as string) : undefined,
        appearance: r?.appearance ? normalizeAppearance(r.appearance as Partial<Appearance>) : undefined,
        cleats: typeof r?.cleats === 'string' ? (r.cleats as string) : undefined,
      }
      if (slot.role === 'GK') return makePlayer(slot, { ...extras, gk: normalizeGk(r?.gk as never) })
      return makePlayer(slot, { ...extras, stats: migrateSkills(r?.stats as never) })
    })
  }
  // No squad stored — seed from the legacy single skill block (or defaults), random looks.
  const base = legacySkills ? migrateSkills(legacySkills) : defaultSkills()
  return SQUAD_TEMPLATE.map((slot) =>
    slot.role === 'GK' ? makePlayer(slot) : makePlayer(slot, { stats: { ...base } }),
  )
}

/** Read a single stat off any squad player (outfield stat or GK stat). */
export function statOf(p: SquadPlayer, id: SkillId | GkStatId): number {
  if (p.role === 'GK') return p.gk[id as GkStatId] ?? STARTING_RATING
  return p.stats[id as SkillId] ?? STARTING_RATING
}

/** A player's overall: outfielders = mean of the 5 core skills; GK = mean of his 3 stats. */
export function playerOverall(p: SquadPlayer): number {
  if (p.role === 'GK') {
    const g = p.gk
    return Math.round((g.diving + g.handling + g.reflexes) / 3)
  }
  const vals = CORE_SKILL_IDS.map((id) => p.stats[id] ?? STARTING_RATING)
  return Math.round(vals.reduce((a, b) => a + b, 0) / vals.length)
}

const mean = (xs: number[]): number =>
  xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : STARTING_RATING

/** FIFA-style team meter: overall plus per-line ATK / MID / DEF averages. */
export function teamRatings(squad: Squad): { ovr: number; atk: number; mid: number; def: number } {
  const ovrOf = (r: SquadRole) => squad.filter((p) => p.role === r).map(playerOverall)
  return {
    ovr: mean(squad.map(playerOverall)),
    atk: mean(ovrOf('FWD')),
    mid: mean(ovrOf('MID')),
    def: mean([...ovrOf('DEF'), ...ovrOf('GK')]),
  }
}

/** Team overall (used for opponent matchmaking + the card OVR badge). */
export function teamOverall(squad: Squad): number {
  return mean(squad.map(playerOverall))
}

/**
 * Spend points to raise one stat on one player, capped at MAX_RATING. Returns the
 * new squad and how many points were actually consumed.
 */
export function upgradeSquadStat(
  squad: Squad,
  playerId: string,
  statId: SkillId | GkStatId,
  points: number,
): { squad: Squad; used: number } {
  const idx = squad.findIndex((p) => p.id === playerId)
  if (idx < 0) return { squad, used: 0 }
  const p = squad[idx]
  const current = statOf(p, statId)
  const used = Math.max(0, Math.min(points, MAX_RATING - current))
  if (used === 0) return { squad, used: 0 }
  const next = squad.slice()
  next[idx] =
    p.role === 'GK'
      ? { ...p, gk: { ...p.gk, [statId]: current + used } }
      : { ...p, stats: { ...p.stats, [statId]: current + used } }
  return { squad: next, used }
}

/** Equip a boots cosmetic on one player. */
export function setSquadCleats(squad: Squad, playerId: string, cleatsId: string): Squad {
  const idx = squad.findIndex((p) => p.id === playerId)
  if (idx < 0) return squad
  const next = squad.slice()
  next[idx] = { ...next[idx], cleats: cleatsId }
  return next
}
