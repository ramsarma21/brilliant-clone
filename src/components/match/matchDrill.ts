// MATCH-DRILL CONTRACT — the seam between a bridging animation and a playable drill.
//
// In a match, each drill is played as a "match version" that lives on the SAME shared
// third-person pitch (lib/pitch3d) as the transition animations. The flow is:
//
//   transition play  ──ends at──▶  DrillEntry  ──opens at──▶  match drill
//
// The transition's FINAL frame and the drill's FIRST frame are the SAME world state
// (DrillEntry), so the handoff is seamless: a short crossfade hides the canvas swap, and
// the drill then eases its camera from `entry.camX` into its own solve framing while the
// question slides in. The drill reuses its sim's proven physics / question / grading, but
// renders through pitch3d and is built to be HANDED INTO rather than cut to.

import { useEffect, useRef, useState } from 'react'
import type { ComponentType } from 'react'
import { easeInOut, type V3 } from '../../lib/pitch3d'

export type DrillId = 'dribble' | 'pass' | 'shoot' | 'header' | 'defend' | 'goalie'

/** The exact world state a transition ends in and a match drill opens from. */
export type DrillEntry = {
  /** Camera lateral pan (world metres) at the moment of handoff. */
  camX: number
  /** The ball's world position at handoff. */
  ball: V3
  /** Your player's ground position at handoff. */
  you: { x: number; z: number }
  /** The primary opponent's ground position at handoff (if the drill has one on screen). */
  foe?: { x: number; z: number }
}

export type MatchDrillProps = {
  /** The handoff state to open in (matches the just-finished transition's final frame). */
  entry: DrillEntry
  /** Your team's jersey primary (your equipped kit still drives YOUR player). */
  teamColor: string
  /** The opponent's jersey primary (already de-clashed by the orchestrator). */
  oppColor: string
  /**
   * Fire EXACTLY ONCE when the single attempt settles (same contract as SimProps.onResolve):
   *   true  → the skill came off (scored / beat the man / connected / won it / saved)
   *   false → wrong answer, miss, or the solve clock ran out (turnover)
   */
  onResolve: (success: boolean) => void
}

export type MatchDrillComponent = ComponentType<MatchDrillProps>

// ============================================================================
// HANDOFF STATES — the single source of truth for where each drill connects.
// Both the transition (its final keyframe) and the match drill (its opening frame)
// use these, so the seam lines up to the metre. Keep these natural for BOTH sides:
// a position that the incoming move can plausibly end on AND the drill can solve from.
// Behind-view convention: +z is up-pitch (away from camera); YOU sit low-z, near camera.
// ============================================================================
const G = 0.13 // ball resting height (radius)

export const DRILL_ENTRY: Record<DrillId, DrillEntry> = {
  // You receive in space with a defender stepping up — take him on.
  dribble: { camX: -0.2, you: { x: -0.9, z: 0.45 }, ball: { x: -0.45, y: G, z: 0.95 }, foe: { x: 0.0, z: 8.0 } },
  // You've skinned your man and are in space, head up for the through ball.
  pass: { camX: 0.25, you: { x: 0.4, z: 2.4 }, ball: { x: 0.8, y: G, z: 2.95 }, foe: { x: -1.1, z: 6.8 } },
  // You're through, driving at the keeper's goal up-pitch.
  shoot: { camX: 0.0, you: { x: 0.0, z: 4.8 }, ball: { x: 0.25, y: G, z: 5.6 }, foe: { x: 2.0, z: 4.0 } },
  // The cross is dropping into the box and you're arriving to meet it.
  header: { camX: 0.2, you: { x: 0.35, z: 8.6 }, ball: { x: 0.6, y: 1.4, z: 9.0 }, foe: { x: 1.0, z: 9.0 } },
  // They're bearing down on you — step in and win the ball.
  defend: { camX: 0.0, you: { x: -0.2, z: 3.2 }, ball: { x: 0.2, y: G, z: 5.4 }, foe: { x: 0.2, z: 6.0 } },
  // He's clean through and bearing down from distance; it's down to you in goal.
  goalie: { camX: 0.0, you: { x: 0.0, z: 1.7 }, ball: { x: 1.7, y: G, z: 11.0 }, foe: { x: 2.2, z: 11.5 } },
}

// ============================================================================
// CAMERA SETTLE — drills call this on mount to ease the camera from the handoff
// pan (entry.camX) into their own solve framing over `ms`, so the view glides in
// rather than snapping. Returns the current camX each frame; `settled` flags done.
// ============================================================================
export function useCameraSettle(fromCamX: number, toCamX: number, ms = 700) {
  const [camX, setCamX] = useState(fromCamX)
  const [settled, setSettled] = useState(ms <= 0)
  const startRef = useRef<number | null>(null)
  const rafRef = useRef<number | null>(null)

  useEffect(() => {
    if (ms <= 0) { setCamX(toCamX); setSettled(true); return }
    const tick = (now: number) => {
      if (startRef.current == null) startRef.current = now
      const t = Math.min(1, (now - startRef.current) / ms)
      setCamX(fromCamX + (toCamX - fromCamX) * easeInOut(t))
      if (t >= 1) { setSettled(true); return }
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => { if (rafRef.current != null) cancelAnimationFrame(rafRef.current) }
  }, [fromCamX, toCamX, ms])

  return { camX, settled }
}

// ============================================================================
// REGISTRY — match-drill components, filled in as each specialist delivers one.
// MatchGame consults this; any drill without a match version falls back to the
// existing sim mounted in matchMode, so the match keeps playing throughout.
// ============================================================================
export const MATCH_DRILLS: Partial<Record<DrillId, MatchDrillComponent>> = {}
