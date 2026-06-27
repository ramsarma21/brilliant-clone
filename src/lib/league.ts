// The Quantum League simulation.
//
// A 26-club division (YOUR club + the 25 rivals from lib/teams.ts) plays a SINGLE-season
// double round-robin: 50 matchdays, one fixture for you per matchday, 13 fixtures per
// matchday across the league. Everything (your schedule, your results, the standings) is a
// pure function of the account's `leagueSeed`, so playing matches one-by-one accumulates the
// same table the full sim reaches. `standingsAfter(seed, played)` gives the live table after
// N matchdays; `simulateSeason(seed)` is just `standingsAfter(seed, 50)`. A career reset
// rerolls the seed for fresh results. There is no multi-season ladder.

import { LEAGUE_TEAMS, PLAYER_CLUB } from './teams'
import { SEASON_GAMES, TEAM_COUNT, newLeagueSeed } from './leagueSeed'
import type { LeagueStanding } from '../types'

// Re-export the pure helpers so existing imports from './league' keep working.
export { TEAM_COUNT, SEASON_GAMES, FIXTURES_PER_MATCHDAY, newLeagueSeed } from './leagueSeed'

/** YOUR club is index 0; the 25 rivals follow. 26 clubs total. */
export const DIVISION: string[] = [PLAYER_CLUB, ...LEAGUE_TEAMS]

export type TeamRecord = LeagueStanding

export type Fixture = { home: number; away: number }
export type Scoreline = { home: number; away: number }

// --- deterministic PRNG ---------------------------------------------------
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function mix(...parts: number[]): number {
  let h = 0x811c9dc5
  for (const p of parts) {
    h ^= p >>> 0
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

// --- fixtures (circle method) --------------------------------------------
let cachedRounds: Fixture[][] | null = null

/** First-leg schedule: TEAM_COUNT-1 rounds of FIXTURES_PER_MATCHDAY fixtures each. */
function firstLegRounds(): Fixture[][] {
  if (cachedRounds) return cachedRounds
  const n = TEAM_COUNT
  const rounds: Fixture[][] = []
  let rest = Array.from({ length: n - 1 }, (_, i) => i + 1) // indices 1..n-1
  const fixed = 0
  for (let r = 0; r < n - 1; r++) {
    const line = [fixed, ...rest]
    const pairs: Fixture[] = []
    for (let i = 0; i < n / 2; i++) {
      const a = line[i]
      const b = line[n - 1 - i]
      // Alternate home/away each round so nobody is stuck home or away every week.
      pairs.push(r % 2 === 0 ? { home: a, away: b } : { home: b, away: a })
    }
    rounds.push(pairs)
    rest = [rest[rest.length - 1], ...rest.slice(0, rest.length - 1)]
  }
  cachedRounds = rounds
  return rounds
}

/**
 * Seeded seating: which DIVISION team sits in each circle-method position (0..n-1). YOU
 * (index 0) keep the circle's fixed seat; the 25 rivals are shuffled across the rotating
 * seats per account `seed`. Because the WHOLE league's fixtures are built from this one
 * seating, your personal schedule and the league standings always agree — and every career
 * reset (which rerolls the seed) produces a brand-new fixture order.
 */
function seatToTeam(seed: number): number[] {
  const rivals = Array.from({ length: TEAM_COUNT - 1 }, (_, i) => i + 1)
  shuffle(rivals, mulberry32(mix(seed, 0x5ea7)))
  return [0, ...rivals]
}

/**
 * Fixtures for a 1-based matchday (1..SEASON_GAMES) for this account's `seed`. The positional
 * round-robin (circle method) is mapped through the seeded seating; the second leg mirrors
 * home/away. Returns all FIXTURES_PER_MATCHDAY pairings as DIVISION indices.
 */
export function matchdayFixtures(matchday: number, seed: number): Fixture[] {
  const rounds = firstLegRounds()
  const legLen = rounds.length // n-1
  const day = Math.max(1, Math.min(SEASON_GAMES, matchday))
  const positional =
    day <= legLen
      ? rounds[day - 1]
      : rounds[day - 1 - legLen].map((f) => ({ home: f.away, away: f.home }))
  const seat = seatToTeam(seed)
  return positional.map((f) => ({ home: seat[f.home], away: seat[f.away] }))
}

// --- result model ---------------------------------------------------------
// Each team has a stable per-account strength in ~[0.15, 0.95]; stronger teams score
// more and concede less. Home advantage nudges expected goals up.
function strengthOf(seed: number, teamIndex: number): number {
  const rng = mulberry32(mix(seed, teamIndex, 0x5eed))
  return 0.18 + rng() * 0.74
}

function poisson(rng: () => number, lambda: number): number {
  const L = Math.exp(-lambda)
  let k = 0
  let p = 1
  do {
    k++
    p *= rng()
  } while (p > L)
  return Math.min(k - 1, 7)
}

/** Scoreline for one fixture, seeded by (seed, matchday, fixtureIndex). */
export function fixtureScore(
  seed: number,
  matchday: number,
  fixtureIndex: number,
  fx: Fixture,
): Scoreline {
  const rng = mulberry32(mix(seed, matchday * 0x85eb, fixtureIndex * 0xc2b2))
  const sh = strengthOf(seed, fx.home)
  const sa = strengthOf(seed, fx.away)
  const base = 1.32
  const spread = 1.15
  const homeAdv = 0.32
  const lambdaH = Math.max(0.18, base + (sh - sa) * spread + homeAdv)
  const lambdaA = Math.max(0.18, base + (sa - sh) * spread)
  return { home: poisson(rng, lambdaH), away: poisson(rng, lambdaA) }
}

function blankRecord(index: number): TeamRecord {
  return {
    name: DIVISION[index],
    index,
    isPlayer: index === 0,
    pl: 0,
    w: 0,
    d: 0,
    l: 0,
    gf: 0,
    ga: 0,
    pts: 0,
  }
}

function applyResult(rec: TeamRecord, gf: number, ga: number): void {
  rec.pl++
  rec.gf += gf
  rec.ga += ga
  if (gf > ga) {
    rec.w++
    rec.pts += 3
  } else if (gf === ga) {
    rec.d++
    rec.pts += 1
  } else {
    rec.l++
  }
}

/** Sort a table by points → goal difference → goals for → name, like a real league. */
function sortTable(table: TeamRecord[]): TeamRecord[] {
  return table.sort((a, b) => {
    if (b.pts !== a.pts) return b.pts - a.pts
    const gdA = a.gf - a.ga
    const gdB = b.gf - b.ga
    if (gdB !== gdA) return gdB - gdA
    if (b.gf !== a.gf) return b.gf - a.gf
    return a.name.localeCompare(b.name)
  })
}

/** A blank, pre-season table (everyone level on 0), sorted by name. */
export function blankStandings(): TeamRecord[] {
  return sortTable(DIVISION.map((_, i) => blankRecord(i)))
}

/** 1-based ordinal helper for messaging (1→1st, 2→2nd, …). */
export function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0])
}

// TEMP testing hook: hand YOUR club a title-winning record (scaled to the games played) so
// it finishes top of the table.
function forcePlayerTop(table: TeamRecord[], games: number): void {
  const topPts = Math.max(...table.map((t) => t.pts))
  const me = table[0]
  const w = Math.round(games * 0.8)
  const d = Math.min(Math.round(games * 0.14), games - w)
  me.pl = games
  me.w = w
  me.d = d
  me.l = games - w - d
  me.gf = games * 2 + 24
  me.ga = Math.round(games * 0.52)
  me.pts = Math.max(me.w * 3 + me.d, topPts + 3)
}

/**
 * The league table after the first `played` matchdays for this account's `seed`. Standings are
 * a pure function of the seed + matchdays played, so playing matches one-by-one accumulates the
 * exact same table the full sim would reach (and a played week's score matches your schedule).
 * Pass `forcePlayerFirst` (testing only) to guarantee YOUR club tops the table.
 */
export function standingsAfter(
  seed: number,
  played: number,
  forcePlayerFirst = false,
): TeamRecord[] {
  const table = DIVISION.map((_, i) => blankRecord(i))
  const n = Math.max(0, Math.min(SEASON_GAMES, Math.floor(played)))
  for (let day = 1; day <= n; day++) {
    matchdayFixtures(day, seed).forEach((fx, idx) => {
      const s = fixtureScore(seed, day, idx, fx)
      applyResult(table[fx.home], s.home, s.away)
      applyResult(table[fx.away], s.away, s.home)
    })
  }
  if (forcePlayerFirst && n > 0) forcePlayerTop(table, n)
  return sortTable(table)
}

/**
 * Simulate the ENTIRE 50-game season for this `seed` and return the final table. Deterministic
 * for a given seed (so it matches match-by-match play); reset rerolls the seed for fresh
 * results. Pass `forcePlayerFirst` (testing only) to guarantee YOUR club tops the table.
 */
export function simulateSeason(seed: number = newLeagueSeed(), forcePlayerFirst = false): TeamRecord[] {
  return standingsAfter(seed, SEASON_GAMES, forcePlayerFirst)
}

/** In-place seeded Fisher–Yates shuffle. */
function shuffle<T>(arr: T[], rng: () => number): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
  }
  return arr
}

/**
 * Locate YOUR fixture within a matchday's pairings: its index in the matchday array, the raw
 * fixture, your opponent's DIVISION index, and whether you're at home. Everything about your
 * season (schedule, results, standings) is derived from this single seeded source.
 */
function yourFixtureIndexed(
  matchday: number,
  seed: number,
): { fixtureIndex: number; fx: Fixture; opponentIdx: number; home: boolean } {
  const fixtures = matchdayFixtures(matchday, seed)
  for (let i = 0; i < fixtures.length; i++) {
    const fx = fixtures[i]
    if (fx.home === 0) return { fixtureIndex: i, fx, opponentIdx: fx.away, home: true }
    if (fx.away === 0) return { fixtureIndex: i, fx, opponentIdx: fx.home, home: false }
  }
  const fx = fixtures[0]
  return { fixtureIndex: 0, fx, opponentIdx: fx.away, home: true }
}

/**
 * YOUR personal 50-match schedule for a given account seed, read straight off the league's
 * seeded fixtures (so it stays in sync with the standings). Every career reset rerolls the
 * seed and produces a different opponent order.
 */
export function yourSchedule(seed: number): { opponent: string; home: boolean }[] {
  return Array.from({ length: SEASON_GAMES }, (_, m) => {
    const { opponentIdx, home } = yourFixtureIndexed(m + 1, seed)
    return { opponent: DIVISION[opponentIdx], home }
  })
}

/** The team you face on a 1-based matchday for this account's `seed`, and whether you're home. */
export function yourFixture(matchday: number, seed: number): { opponent: string; home: boolean } {
  const { opponentIdx, home } = yourFixtureIndexed(matchday, seed)
  return { opponent: DIVISION[opponentIdx], home }
}

export type YourMatch = { matchday: number; opponent: string; home: boolean; gf: number; ga: number }

/**
 * YOUR deterministic result for a 1-based matchday: opponent, home/away, and the scoreline
 * from the same seeded fixture the standings use — so a played week always shows the same
 * plausible score AND matches your row in the table, with no per-match storage needed.
 */
export function yourResult(matchday: number, seed: number): YourMatch {
  const md = Math.max(1, Math.min(SEASON_GAMES, matchday))
  const { fixtureIndex, fx, opponentIdx, home } = yourFixtureIndexed(md, seed)
  const s = fixtureScore(seed, md, fixtureIndex, fx)
  const gf = home ? s.home : s.away
  const ga = home ? s.away : s.home
  return { matchday: md, opponent: DIVISION[opponentIdx], home, gf, ga }
}
