import { useCallback, useEffect, useRef, useState } from 'react'
import {
  project, drawWorld, drawVignette, drawPitchMarkings, buildStaticBackground, buildGradients,
  drawWorldPlayer, drawWorldBall, makeKit, BASE_YOU_KIT, roundRect,
  W, H, HORIZON, EYE_Y, FOCAL, CAM_BACK, BALL_R,
  clamp, lerp, easeInOut,
  type Kit, type Gradients, type PlayerAction, type P2, type V3,
} from '../../../lib/pitch3d'
import { usePlayerKit } from '../../../lib/playerKit'
import { useCameraSettle, type MatchDrillProps } from '../matchDrill'
import { Calculator } from '../../sims/Calculator'
import './matchDrills.css'

// ============================================================================
// MATCH PASS DRILL — the seamless, in-match version of the Motion-Graphs
// through-ball ("lead the runner"). It opens at the EXACT world state the bridging
// transition ended in (DRILL_ENTRY['pass']) — you with the ball at your feet, a
// teammate beginning his run ahead, a marker on him — then eases the camera into the
// solve framing. It reuses MotionSim's proven mechanic verbatim:
//   1. PLACE the through ball (click the ground): judged in objective soccer terms —
//      led into the SPACE ahead of the runner (a sensible lead, on his line) = GOOD;
//      to his feet / behind / off-line / over-hit = BAD (a turnover, skips the
//      question).
//   2. SOLVE the motion-graph timing question (slope = velocity, v_b = D / t, …),
//      graded within ±1 whole number on a flat 30 s clock.
// A connected pass (good placement + correct answer) → onResolve(true); a bad pass,
// wrong answer, or a 30 s timeout → onResolve(false). onResolve fires EXACTLY ONCE
// (ref-guarded) and then the final frame is HELD. Rendered entirely through pitch3d.
// ============================================================================

// Camera framing the solve eases into from the handoff pan (entry.camX).
const SOLVE_CAMX = 0.1
const SETTLE_MS = 700

// ---- Solve economy (mirrors MotionSim) ----
const SOLVE_MS = 30000
const SOLVE_WARN_MS = 10000
const CALC_DRAIN = 1.25

// ---- Free-roam teammate (he wanders ahead until you commit a spot) ----
const ROAM = { x: 5, zMin: 7, zMax: 12.5, cx: 0, cz: 9.8 }
const ROAM_TURN = 1.6
const ROAM_ACCEL = 3.2
const HEADING_MAX = 0.85
// Marker (defender) shadows the runner a step goal-side + inside, eased toward.
const MARK_GAP = 1.7
const MARK_SIDE = 1.0
const MARK_EASE = 5.5

// ---- Through-ball judging (objective good vs bad placement) ----
const LEAD_MIN = 4
const LEAD_MAX = 18
const CHANNEL_HALF = 3.5

// Friendly integer sets the placement-derived givens snap to (one clean v_b).
const VR_SET = [3, 4, 5]
const T_SET = [2, 3, 4]

const ZONE_HALF = 1.7   // catch tolerance along the run for a "connected" thread
const T_MAX = 7         // fly-clock fallback (s)
const WINDUP_S = 0.36   // plant → swing → CONTACT at this instant

const parseNum = (s: string): number => { const v = parseFloat(s); return Number.isFinite(v) ? v : 0 }
const angWrap = (d: number) => { while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return d }

type Phase = 'settle' | 'aim' | 'solve' | 'fly' | 'robbed' | 'result'
type Outcome = 'connected' | 'early' | 'late' | 'soft'

type Play = {
  ox: number; oz: number    // pass origin (the ball's resting world spot)
  vr: number; tMeet: number; L: number; D: number; vb: number
  rx0: number; rz0: number  // runner position at click
  hx: number; hz: number    // runner heading (unit)
  bdx: number; bdz: number  // pass direction (unit)
  sx: number; sz: number    // the placed spot (world)
  along: number; across: number
  side: 1 | -1
  defD: number; defOff: number
}

// Objective judge of a placed spot relative to the runner's live pos + heading.
function judgePlacement(heading: number, rx: number, rz: number, gx: number, gz: number) {
  const hx = Math.sin(heading), hz = Math.cos(heading)
  const dx = gx - rx, dz = gz - rz
  const along = dx * hx + dz * hz
  const across = dx * hz - dz * hx
  const good = along >= LEAD_MIN && along <= LEAD_MAX && Math.abs(across) <= CHANNEL_HALF
  return { along, across, good }
}

// Build a full play from the runner's R0, the clicked spot, and the pass origin.
function buildPlacedPlay(ox: number, oz: number, rx0: number, rz0: number, gx: number, gz: number, along: number, across: number): Play {
  const dx = gx - rx0, dz = gz - rz0
  const runDist = Math.max(0.001, Math.hypot(dx, dz))
  const dirx = dx / runDist, dirz = dz / runDist
  let vr = VR_SET[0], tMeet = T_SET[0], bestErr = Infinity
  for (const v of VR_SET) for (const tm of T_SET) {
    const e = Math.abs(v * tm - runDist)
    if (e < bestErr) { bestErr = e; vr = v; tMeet = tm }
  }
  const L = vr * tMeet
  const sxt = rx0 + dirx * L, szt = rz0 + dirz * L
  const trueD = Math.max(0.001, Math.hypot(sxt - ox, szt - oz))
  const D = Math.max(4, Math.round(trueD * 2) / 2)
  const bdx = (sxt - ox) / trueD, bdz = (szt - oz) / trueD
  const side: 1 | -1 = dirx >= 0 ? 1 : -1
  return {
    ox, oz, vr, tMeet, L, D, vb: D / tMeet,
    rx0, rz0, hx: dirx, hz: dirz, bdx, bdz,
    sx: ox + bdx * D, sz: oz + bdz * D,
    along, across, side,
    defD: clamp(D * 0.58, 3, D - 1.5), defOff: -side * 2.2,
  }
}

const answerSpeed = (p: Play) => p.D / p.tMeet

function passResult(vb: number, p: Play): { tb: number; runOffset: number } | null {
  if (vb <= 0.001) return null
  const tb = p.D / vb
  return { tb, runOffset: p.vr * (tb - p.tMeet) }
}
function classify(r: { runOffset: number } | null): Outcome {
  if (!r) return 'soft'
  if (r.runOffset > ZONE_HALF * 3) return 'soft'
  if (r.runOffset > ZONE_HALF) return 'late'
  if (r.runOffset < -ZONE_HALF) return 'early'
  return 'connected'
}

// ---- Randomized motion-graph problem (copied from MotionSim; slope = velocity) ----
type ProblemKind = 'velocity' | 'position' | 'time' | 'passspeed'
type Given = { label: string; expr: string }
type Problem = {
  kind: ProblemKind
  givens: Given[]
  formula: string
  plug: string
  symbol: string
  varName: string
  unit: string
  answer: number
}
const GIVEN_MIN = 1
const GIVEN_MAX = 50
const randInt = () => GIVEN_MIN + Math.floor(Math.random() * (GIVEN_MAX - GIVEN_MIN + 1))
const round1 = (x: number) => Math.round(x * 10) / 10
const answerOf = (p: Problem) => p.answer
const tolOf = (_p: Problem) => 1.0001

function makeProblem(): Problem {
  const kinds: ProblemKind[] = ['velocity', 'position', 'time', 'passspeed']
  const kind = kinds[Math.floor(Math.random() * kinds.length)]
  if (kind === 'velocity') {
    const dx = randInt(), dt = randInt()
    return {
      kind, symbol: 'v', varName: 'velocity v', unit: 'm/s', answer: dx / dt,
      givens: [
        { label: 'Position change (rise)', expr: `Δx = ${dx} m` },
        { label: 'Time taken (run)', expr: `Δt = ${dt} s` },
      ],
      formula: 'v = Δx / Δt', plug: `${dx} / ${dt}`,
    }
  }
  if (kind === 'position') {
    const x0 = randInt(), v = randInt(), t = randInt()
    return {
      kind, symbol: 'x', varName: 'position x', unit: 'm', answer: x0 + v * t,
      givens: [
        { label: 'Start position', expr: `x₀ = ${x0} m` },
        { label: 'Velocity (slope)', expr: `v = ${v} m/s` },
        { label: 'Time', expr: `t = ${t} s` },
      ],
      formula: 'x = x₀ + v · t', plug: `${x0} + ${v} · ${t}`,
    }
  }
  if (kind === 'time') {
    const x0 = randInt(), v = randInt(), t = randInt()
    const x = x0 + v * t
    return {
      kind, symbol: 't', varName: 'time t', unit: 's', answer: (x - x0) / v,
      givens: [
        { label: 'Start position', expr: `x₀ = ${x0} m` },
        { label: 'Target position', expr: `x = ${x} m` },
        { label: 'Velocity (slope)', expr: `v = ${v} m/s` },
      ],
      formula: 't = (x − x₀) / v', plug: `(${x} − ${x0}) / ${v}`,
    }
  }
  const D = randInt(), t = randInt()
  return {
    kind, symbol: 'v_b', varName: 'pass speed v_b', unit: 'm/s', answer: D / t,
    givens: [
      { label: 'Pass distance to the spot', expr: `D = ${D} m` },
      { label: 'Runner reaches it at', expr: `t = ${t} s` },
    ],
    formula: 'v_b = D / t', plug: `${D} / ${t}`,
  }
}

function missText(p: Problem, used: number): string {
  const correct = round1(p.answer)
  return `${used > p.answer ? 'Too high' : 'Too low'} — you played ${round1(used)} ${p.unit}, but ${p.formula} = ${correct} ${p.unit}.`
}

// ============================================================================
// Game state (single attempt)
// ============================================================================
type Game = {
  phase: Phase
  play: Play
  problem: Problem
  played: number
  badPass: boolean
  solveElapsedMs: number
  vb: number
  t: number               // fly clock (0 at commit; travel clock = t − WINDUP_S)
  contacted: boolean
  outcome: Outcome | null
  crossT: number
  crossS: number
  interceptS: number
  interceptT: number
  resolved: boolean
  // free-roam (settle + aim)
  roamX: number; roamZ: number
  roamHeading: number; roamSpeed: number
  roamTargetHeading: number; roamTargetSpeed: number
  roamRetargetAt: number
  defX: number; defZ: number
  aimGX: number; aimGZ: number
  commitAt: number
  mountAt: number
}

function newGame(entry: MatchDrillProps['entry']): Game {
  const ox = entry.ball.x, oz = entry.ball.z
  const seed = buildPlacedPlay(ox, oz, 0, ROAM.cz, 0, ROAM.cz + 4, 4, 0)
  return {
    phase: 'settle', play: seed, problem: makeProblem(), played: 0,
    badPass: false, solveElapsedMs: 0,
    vb: 0, t: 0, contacted: false, outcome: null,
    crossT: Infinity, crossS: 0, interceptS: NaN, interceptT: Infinity, resolved: false,
    roamX: -0.3, roamZ: 8.4, roamHeading: 0, roamSpeed: 3.6,
    roamTargetHeading: 0, roamTargetSpeed: 3.8, roamRetargetAt: 0,
    defX: entry.foe?.x ?? -1.1, defZ: entry.foe?.z ?? 6.8,
    aimGX: 0, aimGZ: 11, commitAt: 0, mountAt: 0,
  }
}

function updateRoam(g: Game, now: number, dt: number) {
  if (now >= g.roamRetargetAt) {
    g.roamTargetHeading = (Math.random() * 2 - 1) * HEADING_MAX
    g.roamTargetSpeed = 3.2 + Math.random() * 2.4
    g.roamRetargetAt = now + 1000 + Math.random() * 1500
  }
  let target = g.roamTargetHeading
  const nearEdge = Math.abs(g.roamX) > ROAM.x || g.roamZ < ROAM.zMin || g.roamZ > ROAM.zMax
  if (nearEdge) target = Math.atan2(ROAM.cx - g.roamX, ROAM.cz - g.roamZ)
  g.roamHeading += clamp(angWrap(target - g.roamHeading), -ROAM_TURN * dt, ROAM_TURN * dt)
  g.roamSpeed += clamp(g.roamTargetSpeed - g.roamSpeed, -ROAM_ACCEL * dt, ROAM_ACCEL * dt)
  g.roamX += Math.sin(g.roamHeading) * g.roamSpeed * dt
  g.roamZ += Math.cos(g.roamHeading) * g.roamSpeed * dt
  g.roamX = clamp(g.roamX, -ROAM.x - 1, ROAM.x + 1)
  g.roamZ = clamp(g.roamZ, ROAM.zMin - 1, ROAM.zMax + 1)
  // marker eases toward a goal-side + inside point on the runner
  const hx = Math.sin(g.roamHeading), hz = Math.cos(g.roamHeading)
  const sideSign = g.roamX >= 0 ? -1 : 1
  const off = sideSign * MARK_SIDE
  const tx = g.roamX + MARK_GAP * hx + off * hz
  const tz = g.roamZ + MARK_GAP * hz - off * hx
  const k = 1 - Math.exp(-dt * MARK_EASE)
  g.defX += (tx - g.defX) * k
  g.defZ += (tz - g.defZ) * k
}

export function MatchPassDrill({ entry, teamColor, oppColor, onResolve }: MatchDrillProps) {
  const youKit = usePlayerKit<Kit>(BASE_YOU_KIT)
  const mateKit = useRef(makeKit(teamColor, { face: 'back', hairStyle: 1, num: 8 }))
  const foeKit = useRef(makeKit(oppColor, { face: 'front', num: 4 }))
  mateKit.current = makeKit(teamColor, { face: 'back', hairStyle: 1, num: 8 })
  foeKit.current = makeKit(oppColor, { face: 'front', num: 4 })
  const youKitRef = useRef(youKit); youKitRef.current = youKit

  // Camera eases from the handoff pan into the solve framing.
  const { camX, settled } = useCameraSettle(entry.camX, SOLVE_CAMX, SETTLE_MS)
  const camXRef = useRef(camX); camXRef.current = camX

  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const gameRef = useRef<Game>(newGame(entry))
  const [phase, setPhase] = useState<Phase>('settle')
  const [answerStr, setAnswerStr] = useState('')
  const [showCalc, setShowCalc] = useState(false)
  const [missMsg, setMissMsg] = useState<string | null>(null)
  const [resultKind, setResultKind] = useState<'connected' | 'bad' | 'wrong' | 'robbed' | null>(null)
  const [, force] = useState(0)
  const rerender = useCallback(() => force((n) => n + 1), [])

  const answerRef = useRef(answerStr); answerRef.current = answerStr
  const showCalcRef = useRef(showCalc); showCalcRef.current = showCalc
  const rafRef = useRef<number | null>(null)
  const bgRef = useRef<HTMLCanvasElement | null>(null)
  const gradRef = useRef<Gradients | null>(null)

  // onResolve EXACTLY once.
  const onResolveRef = useRef(onResolve); onResolveRef.current = onResolve
  const resolvedOnceRef = useRef(false)
  const finish = useCallback((success: boolean) => {
    if (resolvedOnceRef.current) return
    resolvedOnceRef.current = true
    onResolveRef.current?.(success)
  }, [])

  useEffect(() => { gameRef.current.mountAt = performance.now() }, [])

  // settle → aim once the camera has glided in
  useEffect(() => {
    if (settled && gameRef.current.phase === 'settle') {
      gameRef.current.phase = 'aim'
      setPhase('aim')
    }
  }, [settled])

  // ===== Actions =====
  const fire = useCallback((value: number) => {
    const g = gameRef.current
    const p = g.play
    const correct = Math.abs(value - answerOf(g.problem)) <= tolOf(g.problem)
    const thread = answerSpeed(p)
    const vb = correct ? thread : thread * (Math.random() < 0.5 ? 0.6 : 1.55)
    g.vb = vb; g.played = value; g.badPass = false
    const cr = passResult(vb, p)
    let outcome = classify(cr)
    if (correct) outcome = 'connected'
    else if (outcome === 'connected') outcome = 'late'
    g.outcome = outcome
    g.crossT = cr ? cr.tb : Infinity
    g.crossS = p.D
    if (outcome === 'connected') { g.interceptS = NaN; g.interceptT = Infinity }
    else if (vb > 0.05) { g.interceptS = clamp(Math.min(p.defD, p.D - 0.5), 1.5, p.D); g.interceptT = g.interceptS / vb }
    else { g.interceptS = 0.7; g.interceptT = 1.0 }
    g.t = 0; g.contacted = false; g.resolved = false
    g.phase = 'fly'; setPhase('fly')
  }, [])

  const fireBad = useCallback(() => {
    const g = gameRef.current
    const p = g.play
    const vb = Math.max(6, p.D / p.tMeet)
    g.vb = vb; g.badPass = true; g.outcome = null
    g.crossT = Infinity; g.crossS = p.D
    g.interceptS = clamp(p.D * 0.5, 1.5, p.D - 0.5); g.interceptT = g.interceptS / vb
    g.t = 0; g.contacted = false; g.resolved = false
    g.phase = 'fly'; setPhase('fly')
  }, [])

  const placePass = useCallback(() => {
    const g = gameRef.current
    if (g.phase !== 'aim') return
    const now = performance.now()
    const gx = g.aimGX, gz = g.aimGZ
    const { along, across, good } = judgePlacement(g.roamHeading, g.roamX, g.roamZ, gx, gz)
    g.play = buildPlacedPlay(g.play.ox, g.play.oz, g.roamX, g.roamZ, gx, gz, along, across)
    // seed the defender loiter from his live marker spot, projected onto the pass line
    const rx = g.defX - g.play.ox, rz = g.defZ - g.play.oz
    g.play.defD = clamp(rx * g.play.bdx + rz * g.play.bdz, 2, g.play.D)
    g.play.defOff = rx * g.play.bdz - rz * g.play.bdx
    g.commitAt = now
    if (good) {
      g.solveElapsedMs = 0
      g.phase = 'solve'; setAnswerStr(''); setPhase('solve')
    } else {
      fireBad()
    }
  }, [fireBad])

  const playPass = useCallback(() => {
    const g = gameRef.current
    if (g.phase !== 'solve') return
    fire(parseNum(answerRef.current))
  }, [fire])

  const resolve = useCallback(() => {
    const g = gameRef.current
    if (g.resolved) return
    g.resolved = true
    g.phase = 'result'
    if (g.badPass) { setResultKind('bad'); setPhase('result'); finish(false); return }
    if (g.outcome === 'connected') {
      setResultKind('connected'); setPhase('result'); finish(true)
    } else {
      setMissMsg(missText(g.problem, g.played)); setResultKind('wrong'); setPhase('result'); finish(false)
    }
  }, [finish])

  const dispossess = useCallback(() => {
    const g = gameRef.current
    if (g.phase !== 'solve') return
    g.phase = 'robbed'; g.t = 0; setPhase('robbed'); finish(false)
  }, [finish])

  const actionsRef = useRef({ placePass, playPass, resolve, dispossess })
  actionsRef.current = { placePass, playPass, resolve, dispossess }

  // ===== Input =====
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      const g = gameRef.current
      const typing = (e.target as HTMLElement)?.tagName === 'INPUT'
      if ((e.key === ' ' || e.code === 'Space') && !typing) {
        e.preventDefault()
        if (g.phase === 'aim') actionsRef.current.placePass()
        else if (g.phase === 'solve' && answerRef.current) actionsRef.current.playPass()
      }
    }
    window.addEventListener('keydown', down)
    return () => window.removeEventListener('keydown', down)
  }, [])

  function onPointerMove(e: React.PointerEvent) {
    const g = gameRef.current
    if (g.phase !== 'aim') return
    const c = canvasRef.current; if (!c) return
    const r = c.getBoundingClientRect()
    const sx = ((e.clientX - r.left) / r.width) * W
    const sy = ((e.clientY - r.top) / r.height) * H
    if (sy <= HORIZON + 6) return
    // Inverse of pitch3d.project for a ground point (y = 0), with the camX term:
    //   scale = (sy − HORIZON) / EYE_Y ; z = FOCAL/scale − CAM_BACK ; x = (sx − W/2)/scale + camX
    const scale = (sy - HORIZON) / EYE_Y
    const z = clamp(FOCAL / scale - CAM_BACK, 5, 18)
    const x = clamp((sx - W / 2) / scale + camXRef.current, -ROAM.x - 2, ROAM.x + 2)
    g.aimGX = x; g.aimGZ = z
  }
  function onPointerDown() {
    if (gameRef.current.phase === 'aim') actionsRef.current.placePass()
  }

  // ===== Draw =====
  const draw = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const g = gameRef.current
    const p = g.play
    const now = performance.now()
    const cx = camXRef.current

    const dpr = Math.min(2, window.devicePixelRatio || 1)
    const rect = canvas.getBoundingClientRect()
    const bw = Math.max(1, Math.round(rect.width * dpr))
    const bh = Math.max(1, Math.round(rect.height * dpr))
    if (canvas.width !== bw || canvas.height !== bh) { canvas.width = bw; canvas.height = bh }
    ctx.setTransform(canvas.width / W, 0, 0, canvas.height / H, 0, 0)
    ctx.clearRect(0, 0, W, H)

    if (!gradRef.current) gradRef.current = buildGradients(ctx)
    if (!bgRef.current) bgRef.current = buildStaticBackground()
    drawWorld(ctx, bgRef.current, gradRef.current, cx)
    drawPitchMarkings(ctx, { camX: cx, boxZ: 17 })

    const commitFade = g.phase === 'aim' || g.phase === 'settle' ? 0 : clamp((now - g.commitAt) / 320, 0, 1)
    const tf = Math.max(0, g.t - WINDUP_S)
    const cleanThread = g.outcome === 'connected' && !g.badPass
    const cutOut = g.badPass || (!!g.outcome && !cleanThread)

    // SAFE ZONE (the space a good ball must land in) — during aim only.
    if (g.phase === 'aim') drawSafeZone(ctx, g.roamX, g.roamZ, g.roamHeading, now, cx)

    // placed spot ring (after commit)
    if (g.phase !== 'aim' && g.phase !== 'settle') {
      ctx.save(); ctx.globalAlpha = commitFade
      drawSpotRing(ctx, project(p.sx, 0.02, p.sz, cx), now, g.badPass)
      ctx.restore()
    }

    // ---- figures + ball, depth-sorted (far → near) ----
    type Drawable = { z: number; draw: () => void }
    const items: Drawable[] = []

    // YOU — at the entry spot; a touch during settle, a kick swing during fly.
    {
      const youAt = entry.you
      let action: PlayerAction | undefined
      if (g.phase === 'settle') {
        const fp = project(p.ox, Math.max(BALL_R, entry.ball.y), p.oz, cx)
        action = { footX: fp.sx, footY: fp.sy, lean: 0.32 }
      } else if (g.phase === 'fly' && !g.badPass) {
        const u = clamp(g.t / WINDUP_S, 0, 1)
        const fp = ballAt(p, 0, BALL_R, 0, cx)
        action = { footX: fp.sx, footY: fp.sy, lean: 0.2 + 0.5 * easeInOut(u) }
      } else if (g.phase === 'fly' && g.badPass) {
        const fp = ballAt(p, 0, BALL_R, 0, cx)
        action = { footX: fp.sx, footY: fp.sy, lean: 0.4 }
      }
      const cheer = g.phase === 'result' && cleanThread
      items.push({ z: youAt.z, draw: () => drawWorldPlayer(ctx, youAt, youKitRef.current, now, false, false, cheer ? undefined : action, cx) })
    }

    // RUNNER (teammate)
    {
      let rFeet: { x: number; z: number }; let running: boolean
      let alpha = 1
      if (g.phase === 'settle') {
        rFeet = { x: g.roamX, z: g.roamZ }; running = true
        alpha = clamp((now - g.mountAt) / 420, 0, 1)
      } else if (g.phase === 'aim') {
        rFeet = { x: g.roamX, z: g.roamZ }; running = true
      } else if (g.badPass || g.phase === 'robbed') {
        rFeet = { x: p.rx0, z: p.rz0 }; running = false
      } else if (g.phase === 'fly' || g.phase === 'result') {
        const runnerS = clamp(p.vr * tf, 0, p.L + 6)
        const wx = p.rx0 + p.hx * runnerS, wz = p.rz0 + p.hz * runnerS
        rFeet = { x: wx, z: wz }
        running = g.phase === 'fly' && !(cleanThread && g.contacted && tf >= g.crossT)
      } else { // solve
        rFeet = { x: p.rx0, z: p.rz0 }; running = true
      }
      const a = alpha
      items.push({ z: rFeet.z, draw: () => { ctx.save(); ctx.globalAlpha = a; drawWorldPlayer(ctx, rFeet, mateKit.current, now, running, false, undefined, cx); ctx.restore() } })
    }

    // DEFENDER (marker → interceptor)
    {
      let dWorld: { x: number; z: number }; let dRun = true; let action: PlayerAction | undefined
      if (g.phase === 'settle' || g.phase === 'aim') {
        dWorld = { x: g.defX, z: g.defZ }
      } else if (g.phase === 'robbed') {
        const u = clamp(g.t / 0.75, 0, 1); const e = easeInOut(u)
        const s = lerp(p.defD, 1.0, e), lat = lerp(p.defOff, 0, e)
        dWorld = ballLineWorld(p, s, lat)
        dRun = u < 0.86
        const reach = clamp((u - 0.6) / 0.4, 0, 1)
        if (reach > 0) {
          const fp = ballAt(p, s, 0, lat, cx); const linePt = ballAt(p, 0, 0, 0, cx)
          action = { footX: lerp(fp.sx, linePt.sx, reach), footY: fp.sy, lean: Math.sign(linePt.sx - fp.sx) * 0.5 }
        }
      } else if ((g.phase === 'fly' || g.phase === 'result') && cutOut && g.contacted) {
        const lunge = Math.min(0.9, Math.max(0.25, g.interceptT))
        const tp = clamp((tf - (g.interceptT - lunge)) / lunge, 0, 1); const e = easeInOut(tp)
        const s = lerp(p.defD, g.interceptS, e); const lat = lerp(p.defOff, 0, e)
        const fp = ballAt(p, s, 0, lat, cx); const linePt = ballAt(p, s, 0, 0, cx)
        dWorld = ballLineWorld(p, s, lat)
        dRun = tp > 0.02 && tp < 0.84
        const reach = clamp((tp - 0.58) / 0.42, 0, 1)
        if (reach > 0) action = { footX: lerp(fp.sx, linePt.sx, reach), footY: fp.sy, lean: Math.sign(linePt.sx - fp.sx) * 0.5 }
      } else { // solve, or clean-thread loiter
        dWorld = ballLineWorld(p, p.defD, p.defOff)
        if (cleanThread && g.contacted) dRun = tf < g.crossT
      }
      items.push({ z: dWorld.z, draw: () => drawWorldPlayer(ctx, dWorld, foeKit.current, now, dRun, false, action, cx) })
    }

    // BALL — one authoritative ball.
    {
      let bWorld: V3; let spin = now / 600; let squash = 0
      if (g.phase === 'fly' && g.contacted) {
        let bs = Math.max(0, g.vb * tf)
        if (cleanThread) bs = Math.min(bs, g.crossS)
        else if (cutOut) bs = Math.min(bs, g.interceptS)
        else bs = Math.min(bs, p.D)
        const w = ballLineWorld(p, bs, 0)
        bWorld = { x: w.x, y: BALL_R, z: w.z }; spin = bs * 2.2; squash = Math.max(0, 0.35 - tf * 4)
      } else if (g.phase === 'result' && cleanThread) {
        const w = ballLineWorld(p, g.crossS, 0); bWorld = { x: w.x, y: BALL_R, z: w.z }
      } else if (g.phase === 'result' && cutOut) {
        const w = ballLineWorld(p, isFinite(g.interceptS) ? g.interceptS : p.D * 0.5, 0); bWorld = { x: w.x, y: BALL_R, z: w.z }
      } else {
        bWorld = { x: p.ox, y: entry.ball.y, z: p.oz }
      }
      const bw2 = bWorld
      items.push({ z: bw2.z, draw: () => drawWorldBall(ctx, bw2, spin, squash, cx) })
    }

    items.sort((a, b) => b.z - a.z)
    for (const it of items) it.draw()

    // aim reticle (drawn over the turf, follows the pointer)
    if (g.phase === 'aim') {
      const live = judgePlacement(g.roamHeading, g.roamX, g.roamZ, g.aimGX, g.aimGZ)
      drawReticle(ctx, project(g.aimGX, 0.02, g.aimGZ, cx), now, live.good)
    }

    // position–time graph cue (solve + fly + result)
    if (g.phase === 'solve' || g.phase === 'fly' || g.phase === 'result' || g.phase === 'robbed') {
      drawGraph(ctx, p, g.phase === 'fly' || g.phase === 'result' ? g.vb : null, tf, g.contacted)
    }

    drawVignette(ctx, gradRef.current)

    // solve timer
    if (g.phase === 'solve') {
      const total = SOLVE_MS / 1000
      const left = Math.max(0, (SOLVE_MS - g.solveElapsedMs) / 1000)
      const warn = left <= SOLVE_WARN_MS / 1000
      const label = warn ? `Hurry! ${Math.ceil(left)}s left` : `Lead the runner — solve for ${g.problem.varName}`
      drawTimer(ctx, left, total, label, warn ? '#ff3b5f' : '#7ec8ff', warn)
    }
  }, [entry])

  // ===== Loop =====
  useEffect(() => {
    let last = performance.now()
    const update = (now: number, dt: number) => {
      const g = gameRef.current
      const act = actionsRef.current
      if (g.phase === 'settle' || g.phase === 'aim') updateRoam(g, now, dt)
      if (g.phase === 'solve') {
        g.solveElapsedMs += dt * 1000 * (showCalcRef.current ? CALC_DRAIN : 1)
        if (g.solveElapsedMs >= SOLVE_MS) act.dispossess()
      }
      if (g.phase === 'robbed') {
        g.t += dt
        if (g.t >= 1.7) { g.phase = 'result'; setResultKind('robbed'); setPhase('result') }
      }
      if (g.phase === 'fly') {
        g.t += dt
        if (!g.contacted && g.t >= WINDUP_S) g.contacted = true
        const tf = g.t - WINDUP_S
        if (tf >= 0) {
          const clean = g.outcome === 'connected' && !g.badPass
          const end = clean
            ? (Number.isFinite(g.crossT) ? g.crossT + 0.3 : T_MAX)
            : g.interceptT + 0.45
          if (tf >= end) act.resolve()
        }
      }
    }
    const loop = (now: number) => {
      const dt = Math.min(0.04, (now - last) / 1000); last = now
      update(now, dt)
      draw()
      if (gameRef.current.phase === 'fly') rerender()
      rafRef.current = requestAnimationFrame(loop)
    }
    rafRef.current = requestAnimationFrame(loop)
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current) }
  }, [draw, rerender])

  const g = gameRef.current
  const prob = g.problem
  const solving = phase === 'solve'

  return (
    <div className={`mpass${solving ? ' mpass--solving' : ''}`}>
      <div className="mpass__layout">
        <div className="mpass__stage">
          <canvas
            ref={canvasRef}
            width={W}
            height={H}
            className={`mpass__canvas${phase === 'aim' ? ' mpass__canvas--aim' : ''}`}
            onPointerMove={onPointerMove}
            onPointerDown={onPointerDown}
          />

          {phase === 'result' && resultKind === 'connected' && (
            <div className="soccer__banner soccer__banner--goal">
              <strong>THREADED!</strong>
              <span>Led him into space — he ran onto it.</span>
            </div>
          )}
          {phase === 'result' && resultKind === 'bad' && (
            <div className="soccer__banner soccer__banner--miss">
              <strong>Cut out</strong>
              <span>That ball didn't lead him into space.</span>
            </div>
          )}
          {phase === 'result' && resultKind === 'wrong' && (
            <div className="soccer__banner soccer__banner--miss">
              <strong>Intercepted</strong>
              <span>{missMsg}</span>
            </div>
          )}
          {phase === 'result' && resultKind === 'robbed' && (
            <div className="soccer__banner soccer__banner--save">
              <strong>Too slow</strong>
              <span>He checked his run — dispossessed.</span>
            </div>
          )}
          {phase === 'robbed' && (
            <div className="soccer__banner soccer__banner--save">
              <strong>Closing you down…</strong>
            </div>
          )}

          {solving && showCalc && <Calculator onClose={() => setShowCalc(false)} />}
        </div>

        {solving && (
          <div className="mpass__side soccer__side">
            <div className="soccer__givens">
              {prob.givens.map((gv, i) => (
                <div key={i} className={i === 0 ? 'is-key' : undefined}><span>{gv.label}</span><strong>{gv.expr}</strong></div>
              ))}
            </div>
            <div className="soccer__method">
              <div className="soccer__method-head">
                <span>Solve for the {prob.varName}</span>
                <button type="button" className="soccer__calc-toggle" onClick={() => setShowCalc((v) => !v)}>🧮 {showCalc ? 'Hide' : 'Calc'}</button>
              </div>
              <div className="soccer__steps">
                <code>{prob.formula} = {prob.plug}</code>
              </div>
              <div className="soccer__inputs">
                <label className="soccer__field">
                  <span>{prob.varName} ({prob.unit})</span>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={answerStr}
                    placeholder={round1(answerOf(prob)).toFixed(1)}
                    onChange={(e) => setAnswerStr(e.target.value)}
                  />
                </label>
              </div>
              <p className="soccer__tip" style={{ margin: '6px 0 0' }}>Round to the nearest whole number — up or down is fine.</p>
            </div>
            <div className="soccer__buttons">
              <button type="button" className="btn btn--primary" onClick={playPass} disabled={!answerStr}>Play the pass ⚽</button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ---- pure helpers used only for drawing ----
function ballLineWorld(p: Play, s: number, lat: number): { x: number; z: number } {
  return { x: p.ox + p.bdx * s + p.bdz * lat, z: p.oz + p.bdz * s - p.bdx * lat }
}
// A projected point on the pass line, `s` metres from the origin, `lat` to the side.
function ballAt(p: Play, s: number, y: number, lat: number, cx: number): P2 {
  const w = ballLineWorld(p, s, lat)
  return project(w.x, y, w.z, cx)
}

function drawSafeZone(ctx: CanvasRenderingContext2D, rx: number, rz: number, heading: number, now: number, camX: number) {
  const hx = Math.sin(heading), hz = Math.cos(heading)
  const pulse = 0.18 + 0.06 * Math.sin(now / 320)
  const corners: P2[] = []
  const adds: [number, number][] = [
    [LEAD_MIN, -CHANNEL_HALF], [LEAD_MAX, -CHANNEL_HALF], [LEAD_MAX, CHANNEL_HALF], [LEAD_MIN, CHANNEL_HALF],
  ]
  for (const [along, across] of adds) {
    const gx = rx + hx * along + hz * across
    const gz = rz + hz * along - hx * across
    corners.push(project(gx, 0.02, gz, camX))
  }
  ctx.save()
  ctx.beginPath()
  corners.forEach((c, i) => (i === 0 ? ctx.moveTo(c.sx, c.sy) : ctx.lineTo(c.sx, c.sy)))
  ctx.closePath()
  ctx.fillStyle = `rgba(80, 230, 140, ${pulse})`
  ctx.fill()
  ctx.strokeStyle = 'rgba(120, 255, 170, 0.7)'
  ctx.lineWidth = 2
  ctx.stroke()
  ctx.restore()
}

function drawReticle(ctx: CanvasRenderingContext2D, p: P2, now: number, good: boolean) {
  const r = Math.max(10, 0.7 * p.scale * 0.5)
  const pulse = 1 + 0.12 * Math.sin(now / 160)
  ctx.save()
  ctx.translate(p.sx, p.sy)
  ctx.scale(1, 0.45)
  ctx.strokeStyle = good ? 'rgba(90, 240, 150, 0.95)' : 'rgba(255, 90, 110, 0.95)'
  ctx.lineWidth = 3
  ctx.beginPath(); ctx.arc(0, 0, r * pulse, 0, Math.PI * 2); ctx.stroke()
  ctx.beginPath(); ctx.arc(0, 0, r * 0.4, 0, Math.PI * 2); ctx.stroke()
  ctx.restore()
}

function drawSpotRing(ctx: CanvasRenderingContext2D, p: P2, now: number, bad: boolean) {
  const r = Math.max(8, 0.55 * p.scale * 0.5)
  const pulse = 1 + 0.1 * Math.sin(now / 200)
  ctx.save()
  ctx.translate(p.sx, p.sy)
  ctx.scale(1, 0.45)
  ctx.strokeStyle = bad ? 'rgba(255, 110, 120, 0.9)' : 'rgba(255, 220, 110, 0.95)'
  ctx.lineWidth = 3
  ctx.beginPath(); ctx.arc(0, 0, r * pulse, 0, Math.PI * 2); ctx.stroke()
  ctx.restore()
}

function drawTimer(ctx: CanvasRenderingContext2D, left: number, total: number, label: string, color: string, warn: boolean) {
  const w = 280, h = 40, x = (W - w) / 2, y = 14
  ctx.save()
  ctx.fillStyle = 'rgba(8,12,28,0.8)'; roundRect(ctx, x, y, w, h, 12); ctx.fill()
  const frac = clamp(left / total, 0, 1)
  ctx.fillStyle = warn ? 'rgba(255,59,95,0.32)' : 'rgba(126,200,255,0.28)'
  roundRect(ctx, x, y, w * frac, h, 12); ctx.fill()
  ctx.fillStyle = color
  ctx.font = '800 14px Plus Jakarta Sans, sans-serif'
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
  ctx.fillText(label, W / 2, y + h / 2)
  ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic'
  ctx.restore()
}

// The synchronized position–time graph: slope = velocity. The runner's run is a
// straight line (slope v_r) from his head start; your pass is a line from the origin
// (slope v_b) that must cross it inside the highlighted SPACE. Drawn 1-D along the lane:
// lane position 0 = you, D = the spot; the runner starts at D−L and reaches D at t_meet.
function drawGraph(ctx: CanvasRenderingContext2D, p: Play, vbPlayed: number | null, tf: number, contacted: boolean) {
  const gw = 250, gh = 150, gx0 = 18, gy0 = H - gh - 18
  const padL = 30, padB = 22
  const cx0 = gx0 + padL, cy0 = gy0 + 8
  const cw = gw - padL - 10, ch = gh - padB - 8
  const Tmax = Math.max(0.5, p.tMeet * 1.5)
  const Pmax = Math.max(1, p.D * 1.2)
  const X = (t: number) => cx0 + (clamp(t, 0, Tmax) / Tmax) * cw
  const Y = (pos: number) => cy0 + ch - (clamp(pos, 0, Pmax) / Pmax) * ch
  // raw (unclamped) mappers for slope-true lines, clipped by a rect region
  const Xr = (t: number) => cx0 + (t / Tmax) * cw
  const Yr = (pos: number) => cy0 + ch - (pos / Pmax) * ch

  ctx.save()
  ctx.fillStyle = 'rgba(8,12,28,0.74)'; roundRect(ctx, gx0, gy0, gw, gh, 12); ctx.fill()

  // axes
  ctx.strokeStyle = 'rgba(255,255,255,0.4)'; ctx.lineWidth = 1.5
  ctx.beginPath(); ctx.moveTo(cx0, cy0); ctx.lineTo(cx0, cy0 + ch); ctx.lineTo(cx0 + cw, cy0 + ch); ctx.stroke()
  ctx.fillStyle = 'rgba(200,215,255,0.8)'; ctx.font = '700 10px Plus Jakarta Sans, sans-serif'
  ctx.textAlign = 'left'
  ctx.fillText('position', gx0 + 6, gy0 + 14)
  ctx.textAlign = 'right'
  ctx.fillText('time', gx0 + gw - 8, gy0 + gh - 6)

  // clip to the plot area so slope-true lines are clipped (not bent) at the edges
  ctx.save()
  ctx.beginPath(); ctx.rect(cx0, cy0, cw, ch); ctx.clip()

  // SPACE band — the connected catch window around the crossing (t_meet, D)
  const dtZone = ZONE_HALF / Math.max(0.5, p.vr)
  ctx.fillStyle = 'rgba(80,230,140,0.22)'
  ctx.fillRect(X(p.tMeet - dtZone), Y(p.D + ZONE_HALF), X(p.tMeet + dtZone) - X(p.tMeet - dtZone), Y(p.D - ZONE_HALF) - Y(p.D + ZONE_HALF))

  // RUNNER line: pos(t) = (D − L) + v_r·t  (slope = v_r)
  ctx.strokeStyle = 'rgba(120,255,170,0.95)'; ctx.lineWidth = 2.4
  ctx.beginPath(); ctx.moveTo(Xr(0), Yr(p.D - p.L)); ctx.lineTo(Xr(Tmax), Yr(p.D - p.L + p.vr * Tmax)); ctx.stroke()

  // PASS line: pos(t) = v_b·t from the origin (slope = v_b) — only once struck
  if (vbPlayed != null && contacted && vbPlayed > 0.01) {
    ctx.strokeStyle = 'rgba(126,200,255,0.95)'; ctx.lineWidth = 2.4
    ctx.beginPath(); ctx.moveTo(Xr(0), Yr(0)); ctx.lineTo(Xr(Tmax), Yr(vbPlayed * Tmax)); ctx.stroke()
    // live ball marker on the pass line
    const bt = clamp(tf, 0, Tmax)
    ctx.fillStyle = '#fff'
    ctx.beginPath(); ctx.arc(Xr(bt), Yr(vbPlayed * bt), 3.2, 0, Math.PI * 2); ctx.fill()
  }
  ctx.restore()

  // origin + runner-start dots
  ctx.fillStyle = '#7ec8ff'
  ctx.beginPath(); ctx.arc(X(0), Y(0), 3, 0, Math.PI * 2); ctx.fill()
  ctx.fillStyle = '#78ffaa'
  ctx.beginPath(); ctx.arc(X(0), Y(p.D - p.L), 3, 0, Math.PI * 2); ctx.fill()

  ctx.restore()
}
