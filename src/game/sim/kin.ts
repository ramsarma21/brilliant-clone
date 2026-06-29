import { PLAYER } from '../config'
import type { Player } from '../types'
import { clamp } from '../math'
import { q } from '../ratings'

// Top ground speed for a given pace (0-99), optionally sprinting.
export function topSpeed(pace: number, sprint: boolean): number {
  const base = PLAYER.BASE_SPEED * (0.85 + 0.55 * q(pace)) // ~4.8 .. 7.4 m/s
  return base * (sprint ? PLAYER.SPRINT_MULT : 1)
}

// Per-player top speed, including the AcceleRATE archetype top-end trim/bonus.
export function topSpeedP(p: Player, sprint: boolean): number {
  return topSpeed(p.attrs.pace, sprint) * p.topMult
}

// Arrive scaling: slow down within `slowR` of the target so AI doesn't oscillate.
export function arriveScale(distance: number, slowR: number): number {
  return clamp(distance / slowR, 0, 1)
}
