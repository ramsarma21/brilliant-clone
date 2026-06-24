import type { SimState } from '../../types'

export type SimProps = {
  state: SimState
  onChange: (next: SimState) => void
  /** When true, highlight the challenge goal target (e.g. target flag). */
  showGoal?: boolean
  /** Fired once when the challenge goal is achieved (used to auto-advance). */
  onGoal?: () => void
}

export const n = (s: SimState, k: string, fallback = 0): number =>
  Number(s[k] ?? fallback)
