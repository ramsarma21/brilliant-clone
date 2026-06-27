import type { PointsWheelState } from '../types'

// The 90+ "gamble your skill points" wheel.
//
// When you ace an assessment (≥90%) you can KEEP the safe +5, or gamble it on this wheel,
// which pays 1–10 skill points. Rather than fixed ranges (which leave an obvious fingerprint
// once enough players compare notes), the odds are a self-balancing RUBBER BAND keyed to how
// far ahead or behind the safe baseline the player currently sits:
//
//   • Each spin tilts its 1–7 distribution by the player's running surplus (`net` = points won
//     minus 5 per spin). Behind → odds lean UP (encouraging, win-it-back). Ahead → odds lean
//     DOWN (a gentle bleed that doesn't sting, because they're still up overall). The pull is
//     soft and bounded, so it self-corrects toward a small target surplus without ever feeling
//     scripted — every player sees a different sequence, so there's no pattern to reverse.
//   • The opening is warm: a small, DECAYING welcome boost makes the first few spins skew high
//     (≈5.7 average, spread across 5/6/7 — not a tell), so they bank a cushion early and a
//     later 4 reads as "I didn't lose anything" instead of a loss.
//   • Exactly ONE 10 is ever paid out, GUARANTEED on a pre-chosen spin between #6 and #8 (never
//     the first few). By then they're usually up, so it lands as a thrill, and the rubber band
//     calmly claws the +5 surplus back afterwards — i.e. it STABILISES after the jackpot.
//   • 8s and 9s appear only AFTER the 10, rarely, capped so that no more than THREE results are
//     ever 8+ across a whole career (the 10 included). Pure variance/excitement — the band
//     neutralises their average effect, so they can't be farmed.
//   • A quiet pity floor: after several cold spins (≤5) in a row, the next ordinary spin is a
//     6 or 7. Invisible, and rarely needed (the band already lifts a losing player).
//
// EVERYTHING is keyed off ACTUAL SPINS TAKEN, never assessment count — the player may bank the
// safe +5 on any ace, and the windows/caps/streaks advance only when they actually spin, so no
// spin-frequency strategy desyncs the rigging. The result is tuned to hover just above break-
// even (≈+2 over a full 50-spin career), bleeding a little early but statistically winning it
// back, and never bleeding crazy. It is *possible* to come out a few points ahead — that's
// fine, this isn't real money — it's just improbable to profit meaningfully, and impossible to
// do so without razor-thin advantage play that the audience won't find.

export const POINTS_WHEEL_MIN = 1
export const POINTS_WHEEL_MAX = 10
/** Hard lifetime cap on 8+ results (inclusive of the single guaranteed 10). */
export const POINTS_WHEEL_MAX_HIGH = 3
/** The safe alternative the wheel is gambled against. */
export const POINTS_WHEEL_SAFE = 5

// --- rubber-band tuning (validated by Monte-Carlo: ~251.8 avg over a full 50-spin career,
// encouraging open, gentle bleed, stabilises after the 10) ---
/** Strength of the pull back toward the target surplus (per point of deviation). */
const PULL = 0.07
/** Clamp on the tilt so a single spin's odds never swing to an extreme. */
const TILT_CAP = 0.7
/** Long-run surplus the band settles toward (kept just above break-even). */
const TARGET_NET = 1.5
/** Size of the opening encouragement boost (added to the tilt)… */
const WELCOME = 0.2
/** …which decays to zero over this many spins. */
const WELCOME_SPAN = 6
/** Per-spin chance of a rare 8/9 once the 10 has been paid and the high cap allows it. */
const HIGH_CHANCE = 0.04
/** After this many cold spins (≤5) in a row, the next ordinary spin is quietly nudged to 6/7. */
const LOW_STREAK_PITY = 3

// Base shape for an ordinary 1–7 draw (mean ≈4.9 at zero tilt); the rubber band tilts it.
const BASE_POOL: [number, number][] = [
  [1, 3],
  [2, 6],
  [3, 9],
  [4, 12],
  [5, 17],
  [6, 21],
  [7, 17],
]

const clamp = (x: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, x))

/** Exponentially tilt the base pool by `theta` (>0 favours high values) and sample it. */
function tiltedPick(theta: number): number {
  const weighted = BASE_POOL.map(([v, b]) => [v, b * Math.exp(theta * (v - 5))] as const)
  const total = weighted.reduce((s, [, w]) => s + w, 0)
  let r = Math.random() * total
  for (const [v, w] of weighted) {
    r -= w
    if (r < 0) return v
  }
  return weighted[weighted.length - 1][0]
}

/** A fresh tracker. `tenSpin` (6–8) is the spin the one guaranteed 10 will land on. */
export function initPointsWheel(): PointsWheelState {
  return { spins: 0, highs: 0, tenSpin: 6 + Math.floor(Math.random() * 3), tenDone: false, net: 0, lowStreak: 0 }
}

/**
 * Resolve the next spin. Pure: returns the drawn value and the advanced tracker; the caller
 * persists `next`. Honours the guaranteed-10 spin, the lifetime 8+ cap, the no-second-10 rule,
 * and the self-balancing rubber band. Defensive against missing fields on legacy state.
 */
export function spinPointsWheel(state: PointsWheelState): { value: number; next: PointsWheelState } {
  const n = state.spins + 1
  const tenSpin = state.tenSpin >= 2 ? state.tenSpin : 6 + Math.floor(Math.random() * 3)
  let highs = state.highs
  let tenDone = state.tenDone
  const net = state.net ?? 0
  const lowStreak = state.lowStreak ?? 0
  let value: number

  if (!tenDone && n >= tenSpin) {
    // The one guaranteed 10 (only fires on/after its chosen spin — #6–#8, never the first).
    value = 10
    highs += 1
    tenDone = true
  } else if (tenDone && highs < POINTS_WHEEL_MAX_HIGH && Math.random() < HIGH_CHANCE) {
    // Rare post-10 8/9 for excitement; the band absorbs their average so they can't be farmed.
    value = Math.random() < 0.6 ? 8 : 9
    highs += 1
  } else if (lowStreak >= LOW_STREAK_PITY) {
    // Quiet mercy after a cold run (the band usually handles this first).
    value = Math.random() < 0.7 ? 6 : 7
  } else {
    // Ordinary 1–7 draw, tilted by the running surplus plus a decaying opening boost.
    const welcome = WELCOME * Math.max(0, 1 - state.spins / WELCOME_SPAN)
    const theta = clamp(-PULL * (net - TARGET_NET) + welcome, -TILT_CAP, TILT_CAP)
    value = tiltedPick(theta)
  }

  const nextNet = net + (value - POINTS_WHEEL_SAFE)
  const nextLowStreak = value <= 5 ? lowStreak + 1 : 0
  return {
    value,
    next: { spins: n, highs, tenSpin, tenDone, net: nextNet, lowStreak: nextLowStreak },
  }
}
