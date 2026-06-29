import { useEffect, useMemo, useRef } from 'react'
import { usePlayerKit } from '../../lib/playerKit'
import {
  BASE_YOU_KIT, makeKit, buildStaticBackground, buildGradients, drawWorld, drawVignette,
  drawPitchMarkings, drawGoal, drawWorldPlayer, drawWorldBall, project, BALL_R, W, H,
  type Kit, type Gradients, type PlayerAction,
} from '../../lib/pitch3d'
import { PLAYS, samplePlay, type PlayId, type Role, type ResolvedActor } from './matchPlays'

export type MatchAnimProps = {
  play: PlayId
  /** Your team's jersey primary (teammates wear it). */
  teamColor: string
  /** The opponent's jersey primary (already de-clashed by the orchestrator). */
  oppColor: string
  /** Fired once when the scripted play finishes. */
  onDone?: () => void
  /** DEV: render a single static frame at this normalised time (0..1) instead of animating. */
  frozenT?: number
}

const dist2 = (ax: number, az: number, bx: number, bz: number) => (ax - bx) ** 2 + (az - bz) ** 2

/**
 * Renders one scripted behind-view "soccer moment" (a Play) on the shared pitch, using
 * YOUR equipped player kit + your team / opponent colours. Reports completion via onDone.
 */
export function MatchAnim({ play, teamColor, oppColor, onDone, frozenT }: MatchAnimProps) {
  const youKit = usePlayerKit<Kit>(BASE_YOU_KIT)

  // Role → kit. YOU keep your true equipped look; teammates share your team colour (own
  // number); foes wear the de-clashed opponent kit.
  const kits = useMemo<Record<Role, Kit>>(() => ({
    you: youKit,
    mate: makeKit(teamColor, { face: 'back', hairStyle: 1, num: 8 }),
    foe: makeKit(oppColor, { face: 'front', num: 4 }),
    foe2: makeKit(oppColor, { face: 'front', hairStyle: 2, num: 11 }),
  }), [youKit, teamColor, oppColor])

  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const bgRef = useRef<HTMLCanvasElement | null>(null)
  const gradRef = useRef<Gradients | null>(null)
  const rafRef = useRef<number | null>(null)
  const startRef = useRef<number | null>(null)
  const doneRef = useRef(false)
  const onDoneRef = useRef(onDone); onDoneRef.current = onDone
  const ballSpinRef = useRef(0)
  const lastBallRef = useRef<{ x: number; z: number } | null>(null)
  const kitsRef = useRef(kits); kitsRef.current = kits
  const playRef = useRef(play); playRef.current = play
  const frozenRef = useRef(frozenT); frozenRef.current = frozenT

  useEffect(() => {
    doneRef.current = false
    startRef.current = null
    ballSpinRef.current = 0
    lastBallRef.current = null
    const def = PLAYS[playRef.current]
    const frozen = frozenRef.current

    const frame = (now: number) => {
      const canvas = canvasRef.current
      if (!canvas) { rafRef.current = requestAnimationFrame(frame); return }
      const ctx = canvas.getContext('2d')
      if (!ctx) { rafRef.current = requestAnimationFrame(frame); return }
      if (startRef.current == null) startRef.current = now
      const elapsed = now - startRef.current
      const t = frozen != null ? Math.min(1, Math.max(0, frozen)) : Math.min(1, elapsed / def.ms)

      if (!gradRef.current) gradRef.current = buildGradients(ctx)
      if (!bgRef.current) bgRef.current = buildStaticBackground()

      const dpr = Math.min(2, window.devicePixelRatio || 1)
      const rect = canvas.getBoundingClientRect()
      const bw = Math.max(1, Math.round(rect.width * dpr))
      const bh = Math.max(1, Math.round(rect.height * dpr))
      if (canvas.width !== bw || canvas.height !== bh) { canvas.width = bw; canvas.height = bh }
      ctx.setTransform(canvas.width / W, 0, 0, canvas.height / H, 0, 0)
      ctx.clearRect(0, 0, W, H)

      const scene = samplePlay(def, t)
      const camX = scene.camX

      drawWorld(ctx, bgRef.current, gradRef.current, camX)
      if (scene.marks) drawPitchMarkings(ctx, { camX, ...scene.marks })
      if (scene.goalZ != null) drawGoal(ctx, scene.goalZ, camX)

      // spin the ball based on how far it travelled along the ground this frame
      const lb = lastBallRef.current
      if (lb) ballSpinRef.current += Math.hypot(scene.ball.x - lb.x, scene.ball.z - lb.z) * 5
      lastBallRef.current = { x: scene.ball.x, z: scene.ball.z }
      const airborne = scene.ball.y > BALL_R + 0.05

      // depth-sort actors + ball (far → near) so nearer figures overlap
      type Drawable = { z: number; draw: () => void }
      const items: Drawable[] = []
      const K = kitsRef.current
      for (const a of scene.actors) {
        items.push({ z: a.z, draw: () => drawActor(ctx, a, K, now, scene.ball, camX) })
      }
      items.push({
        z: scene.ball.z,
        draw: () => drawWorldBall(ctx, scene.ball, ballSpinRef.current, airborne ? 0 : 0, camX),
      })
      items.sort((p, q) => q.z - p.z)
      for (const it of items) it.draw()

      drawVignette(ctx, gradRef.current)

      if (frozen != null) return // single static frame (dev screenshots)

      if (t >= 1) {
        if (!doneRef.current) {
          doneRef.current = true
          onDoneRef.current?.()
        }
        // hold the final frame (keep rendering so the freeze frame stays crisp)
      }
      rafRef.current = requestAnimationFrame(frame)
    }

    rafRef.current = requestAnimationFrame(frame)
    return () => { if (rafRef.current != null) cancelAnimationFrame(rafRef.current) }
    // restart cleanly whenever the play changes
  }, [play])

  return <canvas ref={canvasRef} className="manim__canvas" />
}

function drawActor(
  ctx: CanvasRenderingContext2D, a: ResolvedActor, kits: Record<string, Kit>, now: number,
  ball: { x: number; y: number; z: number }, camX: number,
) {
  const base = kits[a.role] ?? kits.foe
  const kit: Kit = { ...base, face: a.face, num: a.num ?? base.num }

  let action: PlayerAction | undefined
  // glue the near foot to the ball only for a grounded touch the actor can actually reach
  if (a.touch != null && ball.y < 0.7 && dist2(a.x, a.z, ball.x, ball.z) < 2.5 * 2.5) {
    const fp = project(ball.x, Math.max(BALL_R, ball.y), ball.z, camX)
    action = { footX: fp.sx, footY: fp.sy, lean: a.touch }
  }
  drawWorldPlayer(ctx, { x: a.x, z: a.z }, kit, now, a.running, false, action, camX)
}
