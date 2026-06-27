// Pure, dependency-free league math + the per-account seed.
//
// This lives apart from lib/league.ts (which imports the team NAMES from lib/teams.ts)
// specifically so that state/AppState.tsx can use the seed + season helpers WITHOUT
// pulling in lib/teams.ts — which imports state/AppState.tsx and would otherwise form an
// import cycle (AppState → league → teams → AppState) that crashes at load time.

// A single season is the full double round-robin: every club plays the other 25 twice
// (home + away) for 50 games. There is exactly ONE season — no multi-season ladder.
export const TEAM_COUNT = 26
export const SEASON_GAMES = (TEAM_COUNT - 1) * 2 // 50 (double round-robin)
export const FIXTURES_PER_MATCHDAY = TEAM_COUNT / 2 // 13

/** A fresh random seed for one season simulation (different every call). */
export function newLeagueSeed(): number {
  return (Math.floor(Math.random() * 0xffffffff) ^ Date.now()) >>> 0
}
