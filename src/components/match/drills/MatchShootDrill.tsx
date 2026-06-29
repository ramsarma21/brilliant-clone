import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { usePlayerKit } from '../../../lib/playerKit'
import { Calculator } from '../../sims/Calculator'
import {
  project, drawWorld, drawVignette, drawWorldPlayer, drawWorldBall, drawGoal,
  buildStaticBackground, buildGradients, makeKit, BASE_YOU_KIT, BALL_R, W, H,
  clamp, lerp, easeOut, easeInOut,
  type Kit, type V3, type PlayerAction, type Gradients,
} from '../../../lib/pitch3d'
import { useCameraSettle, type MatchDrillProps } from '../matchDrill'
import './matchDrills.css'

// ============================================================================
// MATCH VERSION — Shooting (Kinematics) drill, "Finish the chance".
//
// The seamless, in-match version of KinematicsSim. It renders on the SAME shared
// third-person pitch (lib/pitch3d) as the bridging transitions, so when a
// "through on goal" animation hands off, this drill OPENS at the exact world state
// the transition ended in (DRILL_ENTRY['shoot']) and eases its camera into the
// shot framing while you take a settling touch onto the ball.
//
// The PHYSICS / question / grading / DIFFICULTY MODEL are lifted straight from
// KinematicsSim so it plays like the real sim, not a stripped clone:
//   • A RANDOM target spot is chosen each chance (dead-centre easy → corners hard)
//     so the placement scenario actually varies shot to shot.
//   • A Madden-style meter reads EASY (left) → HARD (right). Locking it sets ONE
//     variable AND the power difficulty (powerDiff = meterT·0.7).
//   • The solve ALTERNATES at random between the two scenarios:
//       – solve-for-v   : the meter sets the launch ANGLE θ, you work out the speed
//                         v = √( g·d² / (2·cos²θ·(d·tanθ − Δh)) ).
//       – solve-for-θ   : the meter sets the strike SPEED v, you work out the angle
//                         θ from the same projectile relation.
//   • Total difficulty D = placeDiff(0..0.3) + powerDiff(0..0.7) scales the solve
//     clock (harder shot → less time), exactly as in the sim.
// A correct answer (within tolerance) is a GUARANTEED goal → onResolve(true); a
// wrong answer or a timeout is saved / skied → turnover → onResolve(false). One
// attempt only, no loop / streak / onGoal.
// ============================================================================

const G = 9.8
const GOAL_W_HALF = 3.66
const CROSSBAR = 2.44
const ANGLE_MAX = 70

// ---- World anchors (MUST stay consistent with DRILL_ENTRY['shoot']) ----
// You settle a touch LEFT of the ball as you open your body to strike, so your
// near-camera avatar doesn't sit dead-centre occluding the goal mouth + keeper.
const YOU_HOME = { x: -0.8, z: 4.6 }
const BALL_START: V3 = { x: 0.25, y: BALL_R, z: 5.6 }
const RELEASE_Y = 0.2 // boot height the ball launches from
const GOAL_Z = 17 // the goal line, up-pitch and dead ahead
const KEEP_HOME: V3 = { x: 0.1, y: 0, z: GOAL_Z - 0.4 }

// ---- Difficulty model (copied from KinematicsSim) ----
const PLACE_DIFF_MAX = 0.3
const POWER_DIFF_MAX = 0.7
// Match-paced solve window: easiest shot (D=0) → 45 s, hardest (D=1) → 15 s.
const SOLVE_EASY_MS = 45000
const SOLVE_HARD_MS = 15000
const SOLVE_WARN_MS = 8000
const CALC_DRAIN = 1.25
const placeDiffFor = (x: number, h: number): number => {
  const nx = Math.abs(x) / GOAL_W_HALF
  const ny = Math.abs(h - CROSSBAR / 2) / (CROSSBAR / 2)
  const radial = Math.min(1, Math.hypot(nx, ny) / Math.SQRT2)
  return clamp(radial * PLACE_DIFF_MAX, 0, PLACE_DIFF_MAX)
}
const solveMsFor = (D: number): number => lerp(SOLVE_EASY_MS, SOLVE_HARD_MS, clamp(D, 0, 1))

// ---- Camera / pacing ----
const SOLVE_CAMX = 0.0
const SETTLE_MS = 700
const INTRO_S = 0.7 // settling touch onto the ball as the camera glides in
const METER_RATE = 0.5 // EASY→HARD sweep rate (per second)

const round1 = (x: number) => Math.round(x * 10) / 10
const parseNum = (s: string): number => { const v = parseFloat(s); return Number.isFinite(v) ? v : 0 }

// ---- Projectile solve (copied from KinematicsSim) ----------------------------
function minSpeed(d: number, dh: number): number { return Math.sqrt(G * (dh + Math.hypot(d, dh))) }
// Meter t∈[0,1] → a launch angle that keeps the strike speed comfortably solvable.
function meterToAngle(t: number, d: number, dh: number): number {
  const directDeg = (Math.atan2(dh, d) * 180) / Math.PI
  return clamp(directDeg + 8 + t * 26, 6, ANGLE_MAX)
}
// Meter t∈[0,1] → a strike speed above the minimum, so the direct (low) angle is the answer.
function meterToForce(t: number, d: number, dh: number): number {
  return clamp(minSpeed(d, dh) * (1.35 + t * 0.5), 6, 44)
}
// The one strike speed that drops the ball onto a target d away and dh above the boot.
function answerSpeed(d: number, dh: number, angleDeg: number): number {
  const th = (angleDeg * Math.PI) / 180
  const denom = Math.cos(th) ** 2 * (d * Math.tan(th) - dh)
  return denom > 0 ? Math.sqrt((G * d * d) / (2 * denom)) : 0
}
// The (low/direct) launch angle that drops a ball of speed v onto the spot.
function answerAngle(d: number, dh: number, v: number): number {
  const A = (G * d * d) / (2 * v * v)
  const disc = d * d - 4 * A * (dh + A)
  if (disc < 0) return 0
  const u = (d - Math.sqrt(disc)) / (2 * A)
  return (Math.atan(u) * 180) / Math.PI
}

// ---- Target spots — a varied spread so placement scenarios actually rotate ---
type Spot = { x: number; y: number; label: string }
const SPOTS: Spot[] = [
  { x: -2.5, y: 1.9, label: 'top-left corner' },
  { x: 2.5, y: 1.9, label: 'top-right corner' },
  { x: -2.7, y: 0.55, label: 'bottom-left corner' },
  { x: 2.7, y: 0.55, label: 'bottom-right corner' },
  { x: -1.5, y: 0.6, label: 'low to the left' },
  { x: 1.5, y: 0.6, label: 'low to the right' },
  { x: 0, y: 2.05, label: 'roof of the net' },
  { x: 1.7, y: 1.55, label: 'side netting, right' },
  { x: -1.7, y: 1.55, label: 'side netting, left' },
  { x: 0.4, y: 0.5, label: 'low down the middle' },
]

type SolveFor = 'v' | 'angle'
const TOL_V = 1.5 // ±1.5 m/s scores
const TOL_ANGLE = 3 // ±3° scores

type Outcome = 'goal' | 'save'
type Phase = 'intro' | 'aim' | 'solve' | 'fly' | 'over'
type Particle = { x: number; y: number; vx: number; vy: number; life: number; max: number; color: string; size: number; rot: number; vr: number }

type Game = {
  phase: Phase
  introT: number
  meterT: number
  meterDir: 1 | -1
  // locked by the meter; the OTHER is solved/typed:
  lockedAngle: number // deg (set when solveFor==='v')
  lockedV: number     // m/s (set when solveFor==='angle')
  correct: number     // the answer the player must type (v in m/s, or angle in deg)
  played: number      // what they typed
  D: number
  solveMs: number
  outcome: Outcome | null
  // the (angle, v) actually flown — correct values on a goal, played values on a miss:
  flyAngle: number
  flyV: number
  solveElapsedMs: number
  t: number
  flyDur: number
  particles: Particle[]
}

function spawnConfetti(g: Game, sx: number, sy: number) {
  const colors = ['#ffd23f', '#ff6ec7', '#7c5cff', '#4be3c0', '#ff5b6e', '#7ef0a0', '#3b82f6']
  for (let i = 0; i < 56; i++) {
    const ang = Math.random() * Math.PI * 2
    const sp = 110 + Math.random() * 340
    g.particles.push({
      x: sx + (Math.random() - 0.5) * 40, y: sy + (Math.random() - 0.5) * 30,
      vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp - 160,
      life: 1.1 + Math.random() * 1.1, max: 2.2,
      color: colors[(Math.random() * colors.length) | 0],
      size: 5 + Math.random() * 7, rot: Math.random() * 6.28, vr: (Math.random() - 0.5) * 12,
    })
  }
}

export function MatchShootDrill({ entry, oppColor, onResolve }: MatchDrillProps) {
  const youKit = usePlayerKit<Kit>(BASE_YOU_KIT)
  const keeperKit = useMemo<Kit>(() => makeKit(oppColor, { face: 'front', num: 1 }), [oppColor])
  const foeKit = useMemo<Kit>(() => makeKit(oppColor, { face: 'front', num: 5 }), [oppColor])

  // Per-chance scenario: a random spot + a random solve direction. Picked ONCE per mount
  // so every "finish the chance" rotates placement AND which variable you solve.
  const scenario = useMemo(() => {
    const spot = SPOTS[(Math.random() * SPOTS.length) | 0]
    const solveFor: SolveFor = Math.random() < 0.5 ? 'v' : 'angle'
    const target: V3 = { x: spot.x, y: spot.y, z: GOAL_Z }
    const d = Math.hypot(GOAL_Z - BALL_START.z, spot.x - BALL_START.x)
    const dh = spot.y - RELEASE_Y
    const placeDiff = placeDiffFor(spot.x, spot.y)
    return { spot, solveFor, target, d, dh, placeDiff }
  }, [])
  const scenarioRef = useRef(scenario); scenarioRef.current = scenario

  const { camX } = useCameraSettle(entry.camX, SOLVE_CAMX, SETTLE_MS)

  const onResolveRef = useRef(onResolve); onResolveRef.current = onResolve
  const resolvedOnceRef = useRef(false)
  const resolveOnce = useCallback((success: boolean) => {
    if (resolvedOnceRef.current) return
    resolvedOnceRef.current = true
    onResolveRef.current?.(success)
  }, [])

  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const bgRef = useRef<HTMLCanvasElement | null>(null)
  const gradRef = useRef<Gradients | null>(null)
  const rafRef = useRef<number | null>(null)

  const youKitRef = useRef(youKit); youKitRef.current = youKit
  const keeperKitRef = useRef(keeperKit); keeperKitRef.current = keeperKit
  const foeKitRef = useRef(foeKit); foeKitRef.current = foeKit
  const camXRef = useRef(camX); camXRef.current = camX
  const entryRef = useRef(entry); entryRef.current = entry

  const [phase, setPhase] = useState<Phase>('intro')
  const [answerStr, setAnswerStr] = useState('')
  const [showCalc, setShowCalc] = useState(false)
  const answerRef = useRef(answerStr); answerRef.current = answerStr
  const showCalcRef = useRef(showCalc); showCalcRef.current = showCalc

  const [, force] = useState(0)
  const rerender = useCallback(() => force((n) => n + 1), [])

  const gameRef = useRef<Game>({
    phase: 'intro', introT: 0, meterT: 0, meterDir: 1,
    lockedAngle: 0, lockedV: 0, correct: 0, played: 0, D: 0, solveMs: SOLVE_EASY_MS,
    outcome: null, flyAngle: 0, flyV: 0, solveElapsedMs: 0, t: 0, flyDur: 1.2, particles: [],
  })

  // ===== Actions =====
  // Lock the EASY→HARD meter: it sets ONE variable + the power difficulty; the other
  // variable becomes the one solvable answer the player must work out.
  const lockMeter = useCallback(() => {
    const g = gameRef.current
    if (g.phase !== 'aim') return
    const s = scenarioRef.current
    const powerDiff = g.meterT * POWER_DIFF_MAX
    g.D = clamp(s.placeDiff + powerDiff, 0, 1)
    g.solveMs = solveMsFor(g.D)
    if (s.solveFor === 'v') {
      // harder (right) = lower angle → needs more pace; solve for v
      g.lockedAngle = meterToAngle(1 - g.meterT, s.d, s.dh)
      g.correct = answerSpeed(s.d, s.dh, g.lockedAngle)
    } else {
      // harder (right) = more power; solve for the angle
      g.lockedV = meterToForce(g.meterT, s.d, s.dh)
      g.correct = answerAngle(s.d, s.dh, g.lockedV)
    }
    g.solveElapsedMs = 0
    g.phase = 'solve'
    setAnswerStr('')
    setPhase('solve')
  }, [])

  const strike = useCallback(() => {
    const g = gameRef.current
    if (g.phase !== 'solve') return
    const s = scenarioRef.current
    const v = parseNum(answerRef.current)
    g.played = v
    const tol = s.solveFor === 'v' ? TOL_V : TOL_ANGLE
    g.outcome = Math.abs(v - g.correct) <= tol ? 'goal' : 'save'
    // On a goal, fly the SCORING values so it tucks into the spot. On a miss, fly the
    // player's values so a wrong answer visibly sails over / drops into the keeper.
    if (s.solveFor === 'v') {
      g.flyAngle = g.lockedAngle
      g.flyV = g.outcome === 'goal' ? g.correct : clamp(v, 4, 60)
    } else {
      g.flyV = g.lockedV
      g.flyAngle = g.outcome === 'goal' ? g.correct : clamp(v, 4, 80)
    }
    const th = (g.flyAngle * Math.PI) / 180
    const T = s.d / Math.max(0.1, g.flyV * Math.cos(th))
    g.flyDur = clamp(T * 1.15, 0.85, 1.7)
    g.t = 0
    g.phase = 'fly'
    setPhase('fly')
  }, [])

  const timeout = useCallback(() => {
    const g = gameRef.current
    if (g.phase !== 'solve') return
    const s = scenarioRef.current
    g.outcome = 'save'
    g.played = 0
    g.flyAngle = s.solveFor === 'v' ? g.lockedAngle || 20 : 22
    g.flyV = s.solveFor === 'angle' ? g.lockedV || 20 : 18
    g.flyDur = 1.2
    g.t = 0
    g.phase = 'fly'
    setPhase('fly')
  }, [])

  const actionsRef = useRef({ lockMeter, strike, timeout })
  actionsRef.current = { lockMeter, strike, timeout }

  // ===== Input (Space/Enter to lock the meter, then to strike) =====
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      const g = gameRef.current
      const typing = (e.target as HTMLElement)?.tagName === 'INPUT'
      if (g.phase === 'aim' && (e.key === ' ' || e.code === 'Space' || e.key === 'Enter') && !typing) {
        e.preventDefault(); actionsRef.current.lockMeter(); return
      }
      if ((e.key === 'Enter' || e.key === ' ' || e.code === 'Space') && !typing) {
        if (g.phase === 'solve' && answerRef.current) { e.preventDefault(); actionsRef.current.strike() }
      }
    }
    window.addEventListener('keydown', down)
    return () => window.removeEventListener('keydown', down)
  }, [])

  // Ball world position at fly-fraction f, on the projectile (angle, v) toward the spot.
  const ballAtFraction = useCallback((f: number, angle: number, v: number, target: V3): V3 => {
    const th = (angle * Math.PI) / 180
    const vGround = Math.max(0.1, v * Math.cos(th))
    const vUp = v * Math.sin(th)
    const dGround = Math.hypot(target.z - BALL_START.z, target.x - BALL_START.x)
    const T = dGround / vGround
    const tt = T * f
    const x = lerp(BALL_START.x, target.x, f)
    const z = lerp(BALL_START.z, target.z, f)
    const y = Math.max(BALL_R, RELEASE_Y + vUp * tt - 0.5 * G * tt * tt)
    return { x, y, z }
  }, [])

  // ===== Draw =====
  const draw = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const g = gameRef.current
    const s = scenarioRef.current
    const now = performance.now()
    const cx = camXRef.current
    const e = entryRef.current
    const youK = youKitRef.current
    const keeperK = keeperKitRef.current
    const foeK = foeKitRef.current

    const dpr = Math.min(2, window.devicePixelRatio || 1)
    const rect = canvas.getBoundingClientRect()
    const bw = Math.max(1, Math.round(rect.width * dpr))
    const bh = Math.max(1, Math.round(rect.height * dpr))
    if (canvas.width !== bw || canvas.height !== bh) { canvas.width = bw; canvas.height = bh }
    ctx.setTransform(canvas.width / W, 0, 0, canvas.height / H, 0, 0)
    ctx.clearRect(0, 0, W, H)

    if (!gradRef.current) gradRef.current = buildGradients(ctx)
    if (!bgRef.current) bgRef.current = buildStaticBackground()
    const grad = gradRef.current

    drawWorld(ctx, bgRef.current, grad, cx)

    const shake = g.phase === 'fly' && g.outcome === 'goal' && g.t / g.flyDur > 0.98 ? 1 : 0
    drawGoal(ctx, GOAL_Z, cx, shake)

    const footAction = (target: V3, lean: number): PlayerAction => {
      const fp = project(target.x, target.y, target.z, cx)
      return { footX: fp.sx, footY: fp.sy, lean }
    }

    // --- target marker on the goal (where you're aiming) ---
    if (g.phase === 'intro' || g.phase === 'aim' || g.phase === 'solve') {
      const tp = project(s.target.x, s.target.y, s.target.z, cx)
      const r = Math.max(7, 0.32 * tp.scale)
      ctx.save()
      ctx.globalAlpha = g.phase === 'aim' ? 0.55 + 0.25 * Math.sin(now / 240) : 0.5
      ctx.strokeStyle = '#ffd23f'; ctx.lineWidth = Math.max(2, r * 0.16)
      ctx.beginPath(); ctx.arc(tp.sx, tp.sy, r, 0, Math.PI * 2); ctx.stroke()
      ctx.beginPath(); ctx.moveTo(tp.sx - r * 1.5, tp.sy); ctx.lineTo(tp.sx + r * 1.5, tp.sy)
      ctx.moveTo(tp.sx, tp.sy - r * 1.5); ctx.lineTo(tp.sx, tp.sy + r * 1.5); ctx.stroke()
      ctx.restore()
    }

    // --- the ball ---
    let ballPt: V3
    if (g.phase === 'fly') {
      const f = clamp(g.t / g.flyDur, 0, 1)
      ballPt = ballAtFraction(f, g.flyAngle, g.flyV, s.target)
    } else if (g.phase === 'intro') {
      const k = easeInOut(clamp(g.introT / INTRO_S, 0, 1))
      const idle: V3 = { x: BALL_START.x, y: BALL_R, z: BALL_START.z }
      ballPt = { x: lerp(e.ball.x, idle.x, k), y: lerp(e.ball.y, idle.y, k), z: lerp(e.ball.z, idle.z, k) }
    } else {
      ballPt = { x: BALL_START.x, y: BALL_R, z: BALL_START.z }
    }

    // --- the keeper: covers centre, then dives to smother (save) or the wrong way (goal) ---
    const tgtSide = Math.sign(s.target.x || 0.01)
    let keepX = KEEP_HOME.x
    if (g.phase === 'fly') {
      const f = clamp(g.t / g.flyDur, 0, 1)
      keepX = g.outcome === 'goal'
        ? KEEP_HOME.x - tgtSide * 1.6 * easeOut(f)            // committed the wrong way
        : lerp(KEEP_HOME.x, s.target.x * 0.78, easeOut(f))   // gets across to smother it
    }
    const keepReach = g.phase === 'fly' && g.outcome === 'save' && g.t / g.flyDur > 0.8 ? ballPt : null

    // --- you, the finisher (back to camera) ---
    const youRunning = g.phase === 'intro'
    const strikeLean = g.phase === 'fly' ? clamp(1 - g.t / g.flyDur * 3, 0, 1) * 0.4 : 0
    const youFoot = (g.phase !== 'fly' || g.t / g.flyDur < 0.15) ? footAction(ballPt, strikeLean) : undefined

    // depth order: goal/keeper far (high z), you near (low z) → keeper first
    drawWorldPlayer(ctx, { x: keepX, z: KEEP_HOME.z }, keeperK, now, false, false, keepReach ? footAction(keepReach, 0) : undefined, cx)
    if (g.phase !== 'fly') {
      const foeZ = lerp(entry.foe?.z ?? 4, 3.2, easeOut(clamp(g.introT / INTRO_S, 0, 1)))
      drawWorldPlayer(ctx, { x: entry.foe?.x ?? 2, z: foeZ }, foeK, now, g.phase === 'intro', false, undefined, cx)
    }
    drawWorldPlayer(ctx, { x: YOU_HOME.x, z: YOU_HOME.z }, youK, now, youRunning, false, youFoot, cx)

    if (g.phase !== 'fly' || g.outcome !== 'save' || g.t / g.flyDur < 0.85) {
      drawWorldBall(ctx, ballPt, g.phase === 'fly' ? g.t * 12 : now / 360, 0, cx)
    }

    drawVignette(ctx, grad)

    if (g.particles.length) {
      for (const pt of g.particles) {
        ctx.save(); ctx.globalAlpha = clamp(pt.life / pt.max, 0, 1)
        ctx.translate(pt.x, pt.y); ctx.rotate(pt.rot)
        ctx.fillStyle = pt.color; ctx.fillRect(-pt.size / 2, -pt.size / 2, pt.size, pt.size * 0.62)
        ctx.restore()
      }
      ctx.globalAlpha = 1
    }

    // --- EASY → HARD power meter ---
    if (g.phase === 'aim') {
      const bx = W / 2 - 180, by = H - 74, bw2 = 360, bh2 = 22
      ctx.fillStyle = 'rgba(8,12,28,0.84)'; rrect(ctx, bx - 6, by - 30, bw2 + 12, bh2 + 52, 14); ctx.fill()
      ctx.fillStyle = '#cfd6ea'; ctx.font = '700 12px Inter, sans-serif'; ctx.textAlign = 'center'
      ctx.fillText(`Aiming for the ${s.spot.label} — SPACE to set your power`, W / 2, by - 12)
      // bar
      ctx.fillStyle = 'rgba(255,255,255,0.14)'; rrect(ctx, bx, by, bw2, bh2, 8); ctx.fill()
      const grd = ctx.createLinearGradient(bx, 0, bx + bw2, 0)
      grd.addColorStop(0, '#4be3c0'); grd.addColorStop(0.6, '#ffd23f'); grd.addColorStop(1, '#ff5b6e')
      ctx.fillStyle = grd; rrect(ctx, bx, by, bw2 * g.meterT, bh2, 8); ctx.fill()
      const mk = bx + bw2 * g.meterT
      ctx.fillStyle = '#fff'; ctx.fillRect(mk - 2, by - 4, 4, bh2 + 8)
      // EASY / HARD end labels
      ctx.font = '800 10px Plus Jakarta Sans, sans-serif'; ctx.textAlign = 'left'
      ctx.fillStyle = '#7ef0c0'; ctx.fillText('EASY', bx + 2, by + bh2 + 14)
      ctx.textAlign = 'right'; ctx.fillStyle = '#ff8aa0'; ctx.fillText('HARD', bx + bw2 - 2, by + bh2 + 14)
      // live value the meter is setting
      const setLabel = s.solveFor === 'v'
        ? `θ = ${Math.round(meterToAngle(1 - g.meterT, s.d, s.dh))}°`
        : `v = ${Math.round(meterToForce(g.meterT, s.d, s.dh))} m/s`
      ctx.textAlign = 'center'; ctx.fillStyle = '#eaf1ff'; ctx.font = '800 13px Plus Jakarta Sans, sans-serif'
      ctx.fillText(setLabel, W / 2, by + bh2 + 15)
      ctx.textAlign = 'left'
    }

    // --- solve timer HUD ---
    if (g.phase === 'solve') {
      const total = g.solveMs / 1000
      const left = Math.max(0, (g.solveMs - g.solveElapsedMs) / 1000)
      const warn = left <= SOLVE_WARN_MS / 1000
      const calcLabel = showCalcRef.current ? ' (calc: 1.25× drain)' : ''
      const what = s.solveFor === 'v' ? 'strike speed v' : 'launch angle θ'
      drawTimer(ctx, left, total, warn ? `Hurry! ${Math.ceil(left)}s left` : `Solve the ${what}: ENTER to shoot${calcLabel}`, warn ? '#ff3b5f' : '#7ec8ff', warn)
    }
  }, [entry, ballAtFraction])

  // ===== Loop =====
  useEffect(() => {
    let last = performance.now()
    const update = (dt: number) => {
      const g = gameRef.current
      const act = actionsRef.current
      if (g.phase === 'intro') {
        g.introT += dt
        if (g.introT >= INTRO_S) { g.phase = 'aim'; setPhase('aim') }
      }
      if (g.phase === 'aim') {
        g.meterT += g.meterDir * METER_RATE * dt
        if (g.meterT >= 1) { g.meterT = 1; g.meterDir = -1 }
        else if (g.meterT <= 0) { g.meterT = 0; g.meterDir = 1 }
      }
      if (g.phase === 'solve') {
        g.solveElapsedMs += dt * 1000 * (showCalcRef.current ? CALC_DRAIN : 1)
        if (g.solveElapsedMs >= g.solveMs) act.timeout()
      }
      if (g.phase === 'fly') {
        g.t += dt
        if (g.t >= g.flyDur + 0.45) {
          const goal = g.outcome === 'goal'
          if (goal) {
            const p = project(scenarioRef.current.target.x, scenarioRef.current.target.y, scenarioRef.current.target.z, camXRef.current)
            spawnConfetti(g, p.sx, p.sy)
          }
          g.phase = 'over'
          setPhase('over')
          resolveOnce(goal)
        }
      }
      if (g.particles.length) {
        for (const pt of g.particles) { pt.x += pt.vx * dt; pt.y += pt.vy * dt; pt.vy += 760 * dt; pt.life -= dt; pt.rot += pt.vr * dt }
        g.particles = g.particles.filter((pt) => pt.life > 0)
      }
    }
    const loop = (now: number) => {
      const dt = Math.min(0.04, (now - last) / 1000); last = now
      update(dt)
      draw()
      const ph = gameRef.current.phase
      if (ph === 'intro' || ph === 'aim' || ph === 'solve' || ph === 'fly' || gameRef.current.particles.length) rerender()
      rafRef.current = requestAnimationFrame(loop)
    }
    rafRef.current = requestAnimationFrame(loop)
    return () => { if (rafRef.current != null) cancelAnimationFrame(rafRef.current) }
  }, [draw, rerender, resolveOnce])

  const g = gameRef.current
  const s = scenario
  const canvasMod = phase === 'solve' ? 'solve' : 'meter'
  const dStr = s.d.toFixed(1)
  const dhStr = s.dh.toFixed(2)

  return (
    <div className={`sim soccer mshoot${phase === 'solve' ? ' soccer--solving' : ''}`}>
      <div className="soccer__stage">
        <canvas ref={canvasRef} width={W} height={H} className={`soccer__canvas soccer__canvas--${canvasMod}`}
          onClick={() => { if (gameRef.current.phase === 'aim') lockMeter() }} />

        {phase === 'solve' && showCalc && <Calculator onClose={() => setShowCalc(false)} />}
      </div>

      <div className="soccer__side">
        {phase === 'solve' && (
          <>
            <div className="soccer__givens">
              <div className="is-key"><span>Aiming at</span><strong>{s.spot.label}</strong></div>
              {s.solveFor === 'v' ? (
                <div><span>Set angle</span><strong>θ = {g.lockedAngle.toFixed(0)}°</strong></div>
              ) : (
                <div><span>Set speed</span><strong>v = {g.lockedV.toFixed(0)} m/s</strong></div>
              )}
              <div><span>Distance to spot</span><strong>d = {dStr} m</strong></div>
              <div><span>Rise to spot</span><strong>Δh = {dhStr} m</strong></div>
              <div><span>Gravity</span><strong>g = {G} m/s²</strong></div>
            </div>
            <div className="soccer__method">
              <div className="soccer__method-head">
                <span>{s.solveFor === 'v' ? 'Solve for the strike speed v' : 'Solve for the launch angle θ'}</span>
                <button type="button" className="soccer__calc-toggle" onClick={() => setShowCalc((v) => !v)}>🧮 {showCalc ? 'Hide' : 'Calc'}</button>
              </div>
              <div className="soccer__steps">
                {s.solveFor === 'v' ? (
                  <code>v = √( g·d² / (2·cos²θ·(d·tanθ − Δh)) )</code>
                ) : (
                  <code>Δh = d·tanθ − g·d² / (2·v²·cos²θ)</code>
                )}
              </div>
              <p className="soccer__tip" style={{ margin: '6px 0 0' }}>
                {s.solveFor === 'v'
                  ? "You set the angle on the meter — now find the one strike speed that drops the ball onto the spot and beats the keeper."
                  : "You set the strike speed on the meter — now find the launch angle that drops the ball onto the spot."}
              </p>
              <div className="soccer__inputs">
                <label className="soccer__field">
                  <span>{s.solveFor === 'v' ? 'Strike speed v (m/s)' : 'Launch angle θ (°)'}</span>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={answerStr}
                    placeholder={round1(g.correct).toFixed(1)}
                    onChange={(ev) => setAnswerStr(ev.target.value)}
                  />
                </label>
              </div>
              <p className="soccer__tip" style={{ margin: '6px 0 0', fontSize: 11, opacity: 0.78 }}>
                {s.solveFor === 'v' ? 'Within ±1.5 m/s scores.' : 'Within ±3° scores.'} Round either way.
              </p>
            </div>
          </>
        )}

        <div className="sim__controls">
          <div className="soccer__buttons">
            {phase === 'intro' && <button type="button" className="btn btn--primary" disabled>Get set ▸</button>}
            {phase === 'aim' && <button type="button" className="btn btn--primary" onClick={lockMeter}>Set power ▸</button>}
            {phase === 'solve' && <button type="button" className="btn btn--primary" onClick={strike} disabled={!answerStr}>Strike ⚽</button>}
            {phase === 'fly' && <button type="button" className="btn btn--primary" disabled>Struck…</button>}
          </div>
        </div>
      </div>
    </div>
  )
}

// ============================================================================
// Canvas chrome (meter box + solve clock) — same look as the sibling match drills.
// ============================================================================
function rrect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath(); ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath()
}

function drawTimer(ctx: CanvasRenderingContext2D, left: number, total: number, label: string, color: string, urgent = false) {
  ctx.fillStyle = urgent ? 'rgba(78, 10, 24, 0.9)' : 'rgba(8,12,28,0.82)'
  rrect(ctx, W / 2 - 170, 12, 340, urgent ? 64 : 50, 14); ctx.fill()
  if (urgent) {
    ctx.strokeStyle = '#ff8aa0'; ctx.lineWidth = 2
    rrect(ctx, W / 2 - 170, 12, 340, 64, 14); ctx.stroke()
    ctx.textAlign = 'center'
    ctx.fillStyle = '#ffd7df'; ctx.font = '900 10px Plus Jakarta Sans, sans-serif'
    ctx.fillText('WINDOW CLOSING', W / 2, 24)
  }
  ctx.textAlign = 'center'; ctx.fillStyle = color; ctx.font = '800 22px Plus Jakarta Sans, sans-serif'
  ctx.fillText(`${left.toFixed(1)}s`, W / 2, urgent ? 45 : 36)
  ctx.fillStyle = urgent ? '#ffe1e7' : '#cfd6ea'; ctx.font = '600 11px Inter, sans-serif'; ctx.fillText(label, W / 2, urgent ? 61 : 52)
  const by = urgent ? 66 : 56
  ctx.fillStyle = 'rgba(255,255,255,0.15)'; rrect(ctx, W / 2 - 150, by, 300, 4, 2); ctx.fill()
  ctx.fillStyle = color; rrect(ctx, W / 2 - 150, by, 300 * clamp(left / total, 0, 1), 4, 2); ctx.fill()
  ctx.textAlign = 'left'
}
