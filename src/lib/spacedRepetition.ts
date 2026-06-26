// Lightweight Leitner-style spaced repetition. Concepts answered correctly move
// up a box (longer interval before they resurface); a miss drops them to box 0
// so they come back next session. Intervals are in days.

export const SR_INTERVALS_DAYS = [0, 1, 3, 7, 16, 35]
export const SR_MAX_BOX = SR_INTERVALS_DAYS.length - 1

const DAY_MS = 86_400_000

export function nextBox(currentBox: number, isCorrect: boolean): number {
  if (!isCorrect) return 0
  return Math.min(SR_MAX_BOX, currentBox + 1)
}

export function dueDateFor(box: number, from: Date = new Date()): string {
  const idx = Math.min(SR_MAX_BOX, Math.max(0, box))
  return new Date(from.getTime() + SR_INTERVALS_DAYS[idx] * DAY_MS).toISOString()
}

export function isDue(nextDueIso: string | undefined, now: Date = new Date()): boolean {
  if (!nextDueIso) return true
  const due = Date.parse(nextDueIso)
  return Number.isNaN(due) || due <= now.getTime()
}
