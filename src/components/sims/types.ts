import type { SimState } from '../../types'

export type SimProps = {
  state: SimState
  onChange: (next: SimState) => void
  /** When true, highlight the challenge goal target (e.g. target flag). */
  showGoal?: boolean
  /** Fired once when the challenge goal is achieved (used to auto-advance). */
  onGoal?: () => void
  /**
   * MATCH MODE — when true the sim is being played as ONE moment inside a live match
   * (see components/match/MatchGame). The drill plays its normal scene + the SAME
   * question(s), but as a SINGLE attempt: it must not loop, auto-restart, show a
   * remediation lesson, a "Next/Restart/continue" prompt, or the streak/best HUD, and
   * it must not persist high scores or fire `onGoal`. Instead it reports the outcome
   * once via `onResolve` and then holds its final frame; the match orchestrator handles
   * the celebration dwell, the transition animation, and what happens next.
   */
  matchMode?: boolean
  /**
   * In matchMode, fired EXACTLY ONCE when the single attempt settles:
   *   success = true  → the skill came off (shot scored, dribble beat the man, header
   *                     finished, pass connected, ball won, shot saved)
   *   success = false → wrong answer, miss, or the solve clock ran out (turnover)
   * A correct answer should be treated as a guaranteed positive on-field outcome (the
   * same gating `showGoal` uses), so the question result maps 1:1 to success/failure.
   */
  onResolve?: (success: boolean) => void
}

export const n = (s: SimState, k: string, fallback = 0): number =>
  Number(s[k] ?? fallback)
