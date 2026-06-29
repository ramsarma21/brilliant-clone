import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { usePlayerKit } from '../../../lib/playerKit'
import { Calculator } from '../../sims/Calculator'
import {
  project, drawWorld, drawVignette, drawWorldPlayer, drawWorldBall,
  buildStaticBackground, buildGradients, makeKit, BASE_YOU_KIT, BALL_R, W, H,
  clamp, lerp, easeOut, easeInOut,
  type Kit, type V3, type PlayerAction, type Gradients,
} from '../../../lib/pitch3d'
import { useCameraSettle, type MatchDrillProps } from '../matchDrill'
import './matchDrills.css'

// ============================================================================
// MATCH VERSION — Dribbling (Forces) drill, "Beat your man".
//
// This is the SEAMLESS, in-match version of ForcesSim. It renders on the SAME
// shared third-person pitch (lib/pitch3d) as the bridging transitions, so when a
// "feed you" animation hands off, this drill OPENS at the exact world state the
// transition ended in (DRILL_ENTRY['dribble']) and then eases its camera into the
// solve framing while you receive and the defender steps in.
//
// The PHYSICS / question / grading are lifted straight from ForcesSim: Newton's
// 2nd law F = m·a on the SAME constant regulation ball (m = 0.43 kg), three
// dribbling moves on keys 1/2/3, two solve directions (find F / find a), a flat
// 30 s solve and a ±1.0 tolerance. The difference is purely presentational: one
// pitch3d canvas, a settling camera, and a SINGLE attempt — correct ⇒ you beat
// your man (onResolve(true)); wrong / timeout ⇒ turnover (onResolve(false)).
// There is no looping, no remediation lesson, no streak/best HUD, no onGoal.
// ============================================================================

// ---- The constant: every move is the foot pushing the SAME regulation ball ----
const BALL_MASS = 0.43 // kg (FIFA Law 2 regulation mass) — never changes

// ---- Solve economy (FIXED — identical to ForcesSim) ----
const SOLVE_MS = 30000 // every picked move gets a flat 30 s to solve
const SOLVE_WARN_MS = 10000 // last 10 s get an urgent red countdown
const CALC_DRAIN = 1.25 // opening the calculator drains the clock at 1.25×

// ---- Camera framing ----
// Keep YOU a touch left of centre during the solve (matches ForcesSim's feel).
const SOLVE_CAMX = -0.1
const SETTLE_MS = 700

// ---- Receive beat / defender approach ----
const INTRO_S = 0.7 // brief "receive + defender steps in" beat (matches the camera settle)
const DEF_MENU_Z = 7.0 // where the defender has stepped in to by the time you can pick
const DEF_MIN = 4.4 // closest he gets while you size up the move
const DEF_APPROACH = 0.55 // m/s he keeps drifting in as he marks

// ---- Move animation ----
const FLY_DUR = 1.7 // seconds the executed move plays out

// ---- Timeout dispossession (the "too slow" turnover) ----
const ROB_CLOSE_S = 0.8
const ROB_DUR_S = 1.7

// World anchors for the dribble entry. These MUST match DRILL_ENTRY['dribble'] so
// the menu idle, the receive blend and the executed-move scenes all line up to the
// metre (the same way ForcesSim keeps YOU_HOME / RELEASE as its anchors).
const YOU_HOME = { x: -0.9, z: 0.45 }
const RELEASE = { y: BALL_R, z: 0.95 } // ground ball resting at your feet on receive

const round1 = (x: number) => Math.round(x * 10) / 10
const parseNum = (s: string): number => { const v = parseFloat(s); return Number.isFinite(v) ? v : 0 }
// A short triangular pulse centred on `c` with half-width `w` (contact cue / squash).
const pulse = (u: number, c: number, w: number) => Math.max(0, 1 - Math.abs(u - c) / w)

// ============================================================================
// The three dribbling moves (copied from ForcesSim). Each is an honest F = m·a
// question about the real motion of that move. Accelerations stay multiples of 10
// m/s² so with m = 0.43 kg, F = m·a is exact to one decimal AND a = F/m reverses.
// ============================================================================
type Dir = 'findF' | 'findA'
type MoveId = 'inout' | 'chip' | 'spin'

type MoveDef = {
  id: MoveId
  key: string
  name: string
  emoji: string
  blurb: string
  ctxF: (a: number) => string
  ctxA: (f: number) => string
}

const MOVES: MoveDef[] = [
  {
    id: 'inout', key: '1', name: 'In & out', emoji: '↔️',
    blurb: 'Feint one way, shove it the other',
    ctxF: (a) => `The plant-and-shove cuts the ball sideways at a = ${a} m/s². What sideways force F is that?`,
    ctxA: (f) => `Your standing foot drives the ball sideways with F = ${f} N. What lateral acceleration a does it get?`,
  },
  {
    id: 'chip', key: '2', name: 'Chip over', emoji: '🆙',
    blurb: 'Scoop it up over his foot',
    ctxF: (a) => `Scoop under it to lift the ball, giving it an upward a = ${a} m/s². What force F does your foot apply?`,
    ctxA: (f) => `Your toe lifts the ball with F = ${f} N. What upward acceleration a does the ball leave with?`,
  },
  {
    id: 'spin', key: '3', name: 'Spin move', emoji: '🌀',
    blurb: 'Roulette past him and burst out',
    ctxF: (a) => `Coming out of the roulette turn you drive the ball into space at a = ${a} m/s². What force F does your foot put through it?`,
    ctxA: (f) => `You accelerate out of the spin with F = ${f} N. What acceleration a does the ball burst away at?`,
  },
]

const GIVEN_MIN = 1
const GIVEN_MAX = 50
const randGiven = () => GIVEN_MIN + Math.floor(Math.random() * (GIVEN_MAX - GIVEN_MIN + 1))
const randDir = (): Dir => (Math.random() < 0.5 ? 'findF' : 'findA')

type Problem = {
  move: MoveDef
  dir: Dir
  m: number
  a: number
  F: number
  answer: number
  unit: string
}

const answerOf = (p: Problem) => p.answer
// Flat tolerance: accept within 1.0 of the exact value (round either way).
const tolOf = (_p: Problem) => 1.0001

function makeProblem(move: MoveDef, dir: Dir): Problem {
  const given = randGiven()
  if (dir === 'findF') {
    const exactF = BALL_MASS * given
    return { move, dir, m: BALL_MASS, a: given, F: round1(exactF), answer: exactF, unit: 'N' }
  }
  const exactA = given / BALL_MASS
  return { move, dir, m: BALL_MASS, a: round1(exactA), F: given, answer: exactA, unit: 'm/s²' }
}

function makeRound(): { problems: Problem[]; openSide: 1 | -1 } {
  const problems = MOVES.map((move) => makeProblem(move, randDir()))
  return { problems, openSide: Math.random() < 0.5 ? 1 : -1 }
}

// ============================================================================
// Executed-move scene (copied from ForcesSim, anchored to the dribble entry).
// Each move traces a visibly different world path so the animation reads as the
// move named in the menu and matches the physics.
// ============================================================================
type SceneActor = { x: number; z: number; running: boolean; hasBall: boolean; reach: V3 | null }
type YouPose = { show: boolean; x: number; z: number; running: boolean; footTarget: V3 | null; lean: number }
type Scene = { ball: V3; def: SceneActor; you: YouPose; contact: number; contactPt: V3 | null }
type Outcome = 'beat' | 'lost'

function flyScene(moveId: MoveId, outcome: Outcome, openSide: number, defZ: number, u: number): Scene {
  return outcome === 'lost'
    ? lostScene(moveId, openSide, defZ, u)
    : beatScene(moveId, openSide, defZ, u)
}

function beatScene(moveId: MoveId, openSide: number, defZ: number, u: number): Scene {
  const goSide = openSide
  const cF = moveId === 'chip' ? 0.22 : moveId === 'spin' ? 0.55 : 0.30
  const leanDir = moveId === 'chip' ? 0 : goSide
  const endZ = defZ + 2.4
  const LANE = 1.3

  const ballAt = (uu: number): V3 => {
    if (moveId === 'inout') {
      if (uu < 0.16) return { x: -goSide * 0.5 * easeOut(uu / 0.16), y: BALL_R, z: RELEASE.z }
      if (uu < cF) return { x: lerp(-goSide * 0.5, -goSide * 0.15, (uu - 0.16) / (cF - 0.16)), y: BALL_R, z: RELEASE.z }
      const k = easeOut((uu - cF) / (1 - cF))
      return { x: lerp(-goSide * 0.15, goSide * LANE, k), y: BALL_R, z: lerp(RELEASE.z, endZ, k) }
    }
    if (moveId === 'chip') {
      if (uu < cF) return { x: 0, y: BALL_R, z: RELEASE.z }
      const k = easeOut((uu - cF) / (1 - cF))
      return { x: lerp(0, goSide * LANE, k), y: BALL_R + 1.7 * Math.sin(Math.PI * Math.min(1, k)), z: lerp(RELEASE.z, endZ, k) }
    }
    if (uu < cF) {
      const ang = Math.PI * 2 * (uu / cF)
      const rad = 0.7
      return { x: goSide * rad * Math.sin(ang), y: BALL_R, z: RELEASE.z + rad * 0.5 * (1 - Math.cos(ang)) }
    }
    const k = easeOut((uu - cF) / (1 - cF))
    return { x: lerp(0, goSide * LANE, k), y: BALL_R, z: lerp(RELEASE.z, endZ, k) }
  }

  const ball = ballAt(u)
  const contactPt = ballAt(cF)
  const contact = pulse(u, cF, 0.07)

  let footTarget: V3 | null = null
  if (u <= cF) footTarget = ball
  else if (u <= cF + 0.14) {
    const k = (u - cF) / 0.14
    footTarget = {
      x: lerp(contactPt.x, ball.x, 0.35 * k),
      y: lerp(contactPt.y, ball.y, 0.2 * k),
      z: lerp(contactPt.z, ball.z, 0.35 * k),
    }
  } else {
    const cu = clamp((u - (cF + 0.14)) / (1 - (cF + 0.14)), 0, 1)
    const grounded = ball.y <= BALL_R + 0.2
    if (grounded && Math.sin(cu * Math.PI * 3) > 0.5) footTarget = ball
  }
  const strikeP = clamp((u - (cF - 0.12)) / 0.12, 0, 1)
  const lean = leanDir * Math.max(contact, u > cF - 0.12 && u <= cF + 0.14 ? strikeP : 0)

  const commit = easeOut(clamp(u / 0.45, 0, 1))
  const recover = easeInOut(clamp((u - 0.45) / 0.55, 0, 1))
  const def: SceneActor = { x: 0, z: defZ, running: u < 0.98, hasBall: false, reach: null }
  if (moveId === 'inout') {
    def.x = lerp(0, -goSide * 1.8, commit) + lerp(0, goSide * 2.2, recover)
    def.z = defZ + lerp(0, 0.7, commit) - lerp(0, 1.7, recover)
  } else if (moveId === 'chip') {
    def.x = lerp(0, goSide * 0.35, recover)
    def.z = defZ + lerp(0, 0.9, commit) - lerp(0, 1.5, recover)
  } else {
    def.x = lerp(0, -goSide * 1.5, commit) + lerp(0, goSide * 1.9, recover)
    def.z = defZ + lerp(0, 0.5, commit) - lerp(0, 1.8, recover)
  }

  const plantX = contactPt.x - goSide * 0.25
  const plantZ = contactPt.z - 0.45
  let youX: number, youZ: number
  if (u <= cF) {
    const ap = easeOut(u / cF)
    youX = lerp(YOU_HOME.x, plantX, ap)
    youZ = lerp(YOU_HOME.z, plantZ, ap)
  } else {
    const cu = easeOut(clamp((u - cF) / (1 - cF), 0, 1))
    youX = lerp(plantX, ball.x - goSide * 0.18, cu)
    youZ = lerp(plantZ, ball.z - 0.5, cu)
  }
  const you: YouPose = {
    show: true,
    x: youX,
    z: youZ,
    running: footTarget == null && u < 0.98,
    footTarget,
    lean,
  }
  return { ball, def, you, contact, contactPt }
}

function lostScene(moveId: MoveId, openSide: number, defZ: number, u: number): Scene {
  const ez = easeOut(u)
  const STEAL = moveId === 'spin' ? 0.42 : moveId === 'chip' ? 0.46 : 0.5
  const cF = moveId === 'chip' ? 0.2 : moveId === 'spin' ? 0.3 : 0.28
  const dz = lerp(defZ, defZ - 1.2, easeInOut(clamp(u / 0.72, 0, 1)))
  let dx = 0
  let bx = 0, by = BALL_R, bz = RELEASE.z

  if (moveId === 'inout') {
    dx = -openSide * 1.7 * easeOut(clamp(u / STEAL, 0, 1))
    if (u < cF) { const k = easeOut(u / cF); bx = openSide * 1.3 * k; bz = RELEASE.z + 1.0 * k }
    else if (u < STEAL) { const k = (u - cF) / (STEAL - cF); bx = lerp(openSide * 1.3, -openSide * 1.4, k); bz = RELEASE.z + 1.0 + 1.0 * k }
    else { const k = easeOut((u - STEAL) / (1 - STEAL)); bx = lerp(-openSide * 1.4, dx, k); bz = lerp(RELEASE.z + 2.0, dz, k) }
  } else if (moveId === 'chip') {
    if (u < STEAL) { const k = u / STEAL; bx = openSide * 0.4 * k; by = BALL_R + 0.7 * Math.sin(Math.PI * k); bz = lerp(RELEASE.z, dz, k) }
    else { const k = easeOut((u - STEAL) / (1 - STEAL)); bx = lerp(openSide * 0.4, dx, k); by = BALL_R; bz = dz }
  } else {
    dx = -openSide * 0.9 * easeOut(clamp(u / STEAL, 0, 1))
    const turn = Math.PI * 1.15, rad = 0.85
    if (u < STEAL) { const ang = turn * (u / STEAL); bx = openSide * rad * Math.sin(ang); bz = RELEASE.z + rad * 0.6 * (1 - Math.cos(ang)) }
    else { const k = easeOut((u - STEAL) / (1 - STEAL)); bx = lerp(openSide * rad * Math.sin(turn), dx, k); bz = lerp(RELEASE.z + rad * 0.6 * (1 - Math.cos(turn)), dz, k) }
  }

  const won = u >= 0.86
  const ball: V3 = { x: bx, y: by, z: bz }
  const def: SceneActor = {
    x: dx, z: dz, running: u < 0.9, hasBall: won,
    reach: !won && u > STEAL - 0.14 && u < STEAL + 0.16 ? ball : null,
  }

  const you: YouPose = {
    show: true,
    x: lerp(YOU_HOME.x, -openSide * 0.2, ez * 0.5),
    z: lerp(YOU_HOME.z, RELEASE.z - 0.3, ez * 0.5),
    running: u >= STEAL && u < 0.72,
    footTarget: u < STEAL ? ball : null,
    lean: openSide * pulse(u, cF, 0.12),
  }

  const cSteal = pulse(u, STEAL, 0.06)
  const cTouch = pulse(u, cF, 0.06) * 0.65
  const contact = won ? 0 : Math.max(cSteal, cTouch)
  const contactPt = won ? null : ball

  return { ball, def, you, contact, contactPt }
}

// ---- game model ----
type Phase = 'intro' | 'menu' | 'solve' | 'fly' | 'robbed' | 'over'
type Particle = { x: number; y: number; vx: number; vy: number; life: number; max: number; color: string; size: number; rot: number; vr: number }

type Game = {
  phase: Phase
  problems: Problem[]
  picked: Problem | null
  openSide: 1 | -1
  introT: number
  solveElapsedMs: number
  defZ: number
  t: number // fly / robbed timer
  outcome: Outcome | null
  played: number
  robbed: boolean
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

export function MatchDribbleDrill({ entry, oppColor, onResolve }: MatchDrillProps) {
  // YOUR player always wears the live equipped loadout (same as MatchAnim / ForcesSim);
  // the defender is the de-clashed opponent colour, facing the camera, #4.
  const youKit = usePlayerKit<Kit>(BASE_YOU_KIT)
  const foeKit = useMemo<Kit>(() => makeKit(oppColor, { face: 'front', num: 4 }), [oppColor])

  // Ease the camera from the handoff pan into the solve framing (purely visual).
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

  const gameRef = useRef<Game>((() => {
    const r = makeRound()
    return {
      phase: 'intro', problems: r.problems, picked: null, openSide: r.openSide,
      introT: 0, solveElapsedMs: 0, defZ: entry.foe?.z ?? 8, t: 0,
      outcome: null, played: 0, robbed: false, particles: [],
    }
  })())

  // ===== Actions =====
  const pickMove = useCallback((p: Problem) => {
    const g = gameRef.current
    if (g.phase !== 'menu') return
    g.picked = p
    g.solveElapsedMs = 0
    g.phase = 'solve'
    setAnswerStr('')
    setPhase('solve')
  }, [])

  const fire = useCallback((value: number) => {
    const g = gameRef.current
    const p = g.picked
    if (!p) return
    g.played = value
    g.outcome = Math.abs(value - answerOf(p)) <= tolOf(p) ? 'beat' : 'lost'
    g.t = 0
    g.phase = 'fly'
    setPhase('fly')
  }, [])

  const playMove = useCallback(() => {
    const g = gameRef.current
    if (g.phase !== 'solve') return
    fire(parseNum(answerRef.current))
  }, [fire])

  const dispossess = useCallback(() => {
    const g = gameRef.current
    if (g.phase !== 'solve') return
    g.robbed = true
    g.t = 0
    g.phase = 'robbed'
    setPhase('robbed')
  }, [])

  const actionsRef = useRef({ pickMove, playMove, dispossess })
  actionsRef.current = { pickMove, playMove, dispossess }

  // ===== Input (keys 1/2/3 to pick, Enter/Space to commit) =====
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      const g = gameRef.current
      const typing = (e.target as HTMLElement)?.tagName === 'INPUT'
      if (g.phase === 'menu' && !typing) {
        const m = g.problems.find((pr) => pr.move.key === e.key)
        if (m) { e.preventDefault(); actionsRef.current.pickMove(m) }
        return
      }
      if ((e.key === 'Enter' || e.key === ' ' || e.code === 'Space') && !typing) {
        if (g.phase === 'solve' && answerRef.current) { e.preventDefault(); actionsRef.current.playMove() }
      }
    }
    window.addEventListener('keydown', down)
    return () => window.removeEventListener('keydown', down)
  }, [])

  // ===== Draw =====
  const draw = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const g = gameRef.current
    const now = performance.now()
    const cx = camXRef.current
    const e = entryRef.current
    const youK = youKitRef.current
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

    const footAction = (target: V3, lean: number): PlayerAction => {
      const fp = project(target.x, target.y, target.z, cx)
      return { footX: fp.sx, footY: fp.sy, lean }
    }
    const drawContact = (pt: V3, intensity: number) => {
      if (intensity <= 0.03) return
      const p = project(pt.x, pt.y, pt.z, cx)
      const r = Math.max(7, BALL_R * p.scale)
      const k = clamp(intensity, 0, 1)
      const cy = p.sy - r * 0.4
      ctx.save()
      ctx.globalAlpha = k * 0.85
      ctx.fillStyle = 'rgba(255,255,255,0.95)'
      ctx.beginPath(); ctx.arc(p.sx, cy, r * (0.5 + 0.45 * k), 0, Math.PI * 2); ctx.fill()
      ctx.globalAlpha = k * 0.7
      ctx.strokeStyle = 'rgba(255,236,180,0.95)'; ctx.lineWidth = Math.max(1.5, r * 0.14)
      ctx.beginPath(); ctx.arc(p.sx, cy, r * (1.05 + (1 - k) * 1.5), 0, Math.PI * 2); ctx.stroke()
      ctx.restore()
    }

    const animating = g.phase === 'fly' || (g.phase === 'over' && !g.robbed && g.outcome !== null)
    const u = g.phase === 'fly' ? clamp(g.t / FLY_DUR, 0, 1) : 1

    if (g.robbed) {
      // TIMEOUT ROBBERY: the defender steps all the way up and nicks the ball off
      // your feet. ONE ball only — loose until he wins it, then his foot-ball.
      const robT = g.phase === 'robbed' ? g.t : ROB_DUR_S
      const tu = clamp(robT / ROB_CLOSE_S, 0, 1)
      const ev = easeInOut(tu)
      const robZ = lerp(g.defZ, 2.0, ev)
      const robHasBall = robT >= ROB_CLOSE_S
      const jit = Math.sin(now / 70) * Math.min(0.06, robT * 0.12)
      const bz = lerp(YOU_HOME.z + 0.5, robZ - 0.5, ev)
      const ballPt: V3 = { x: jit, y: BALL_R, z: bz }
      const reaching = !robHasBall && tu > 0.6
      drawWorldPlayer(ctx, { x: 0, z: robZ }, foeK, now, tu < 0.92, robHasBall, reaching ? footAction(ballPt, 0) : undefined, cx)
      drawWorldPlayer(ctx, { x: YOU_HOME.x, z: YOU_HOME.z }, youK, now, tu < 0.4, false, undefined, cx)
      if (!robHasBall) {
        const nick = pulse(tu, 0.92, 0.12)
        drawWorldBall(ctx, ballPt, now / 320, nick * 0.4, cx)
        drawContact(ballPt, nick)
      }
    } else if (animating && g.picked && g.outcome) {
      const sc = flyScene(g.picked.move.id, g.outcome, g.openSide, g.defZ, u)
      const drawDef = () => drawWorldPlayer(ctx, { x: sc.def.x, z: sc.def.z }, foeK, now, sc.def.running, sc.def.hasBall, sc.def.reach ? footAction(sc.def.reach, 0) : undefined, cx)
      const drawYou = () => { if (sc.you.show) drawWorldPlayer(ctx, { x: sc.you.x, z: sc.you.z }, youK, now, sc.you.running, false, sc.you.footTarget ? footAction(sc.you.footTarget, sc.you.lean) : undefined, cx) }
      if (sc.def.z >= sc.you.z) { drawDef(); drawYou() } else { drawYou(); drawDef() }
      if (!sc.def.hasBall) drawWorldBall(ctx, sc.ball, g.t * 9, sc.contact * 0.4, cx)
      if (sc.contactPt) drawContact(sc.contactPt, sc.contact)
    } else {
      // INTRO (receive + defender steps in) / MENU / SOLVE: your man closes while you
      // idle-dribble the ball at your feet with small touches. On the intro beat the
      // ball eases from the handoff position to your feet. ONE ball only.
      drawWorldPlayer(ctx, { x: 0, z: g.defZ }, foeK, now, true, false, undefined, cx)
      const ph = (now / 1000) / 0.5 * Math.PI * 2 // ~0.5 s dribble cycle
      const side = Math.sin(ph)
      const idle: V3 = {
        x: YOU_HOME.x + 0.5 + side * 0.22,
        y: BALL_R,
        z: YOU_HOME.z + 0.55 + Math.abs(Math.sin(ph)) * 0.1,
      }
      let ballPt = idle
      if (g.phase === 'intro') {
        const k = easeInOut(clamp(g.introT / INTRO_S, 0, 1))
        const eb = e.ball
        ballPt = { x: lerp(eb.x, idle.x, k), y: lerp(eb.y, idle.y, k), z: lerp(eb.z, idle.z, k) }
      }
      drawWorldBall(ctx, ballPt, now / 360, 0, cx)
      drawWorldPlayer(ctx, { x: YOU_HOME.x, z: YOU_HOME.z }, youK, now, false, false, footAction(ballPt, side * 0.35), cx)
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

    // ---- solve timer HUD (no streak/best HUD in a match) ----
    if (g.phase === 'solve') {
      const total = SOLVE_MS / 1000
      const left = Math.max(0, (SOLVE_MS - g.solveElapsedMs) / 1000)
      const warn = left <= SOLVE_WARN_MS / 1000
      const calcLabel = showCalcRef.current ? ' (calc: 1.25× drain)' : ''
      const label = (g.picked?.dir === 'findF' ? 'Solve the force F: ENTER to do the move' : 'Solve the acceleration a: ENTER to do the move') + calcLabel
      drawTimer(ctx, left, total, warn ? `Hurry! ${Math.ceil(left)}s left` : label, warn ? '#ff3b5f' : '#7ec8ff', warn)
    }
  }, [])

  // ===== Loop =====
  useEffect(() => {
    let last = performance.now()
    const update = (dt: number) => {
      const g = gameRef.current
      const act = actionsRef.current
      if (g.phase === 'intro') {
        g.introT += dt
        g.defZ = lerp(entryRef.current.foe?.z ?? 8, DEF_MENU_Z, easeOut(clamp(g.introT / INTRO_S, 0, 1)))
        if (g.introT >= INTRO_S) { g.defZ = DEF_MENU_Z; g.phase = 'menu'; setPhase('menu') }
      }
      if (g.phase === 'menu' || g.phase === 'solve') {
        g.defZ = Math.max(DEF_MIN, g.defZ - DEF_APPROACH * dt)
      }
      if (g.phase === 'solve') {
        g.solveElapsedMs += dt * 1000 * (showCalcRef.current ? CALC_DRAIN : 1)
        if (g.solveElapsedMs >= SOLVE_MS) act.dispossess()
      }
      if (g.phase === 'fly') {
        g.t += dt
        if (g.t >= FLY_DUR) {
          const beat = g.outcome === 'beat'
          if (beat && g.picked) {
            const sc = flyScene(g.picked.move.id, 'beat', g.openSide, g.defZ, 1)
            const p = project(sc.ball.x, 1.0, sc.ball.z, camXRef.current)
            spawnConfetti(g, p.sx, p.sy)
          }
          g.phase = 'over'
          setPhase('over')
          resolveOnce(beat)
        }
      }
      if (g.phase === 'robbed') {
        g.t += dt
        if (g.t >= ROB_DUR_S) {
          g.phase = 'over'
          setPhase('over')
          resolveOnce(false)
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
      // keep React in step with the timer/menu during live phases (and while confetti falls)
      if (ph === 'intro' || ph === 'menu' || ph === 'solve' || ph === 'fly' || ph === 'robbed' || gameRef.current.particles.length) rerender()
      rafRef.current = requestAnimationFrame(loop)
    }
    rafRef.current = requestAnimationFrame(loop)
    return () => { if (rafRef.current != null) cancelAnimationFrame(rafRef.current) }
  }, [draw, rerender, resolveOnce])

  // ===== side-panel data =====
  const g = gameRef.current
  const p = g.picked
  const canvasMod = phase === 'menu' || phase === 'intro' ? 'meter' : phase

  return (
    <div className={`sim soccer mdribble${phase === 'solve' ? ' soccer--solving' : ''}`}>
      <div className="soccer__stage">
        <canvas ref={canvasRef} width={W} height={H} className={`soccer__canvas soccer__canvas--${canvasMod}`} />

        {/* MOVE MENU — pick a move with the key shown, or click it. */}
        {phase === 'menu' && (
          <div className="mdribble__menu">
            {g.problems.map((pr) => (
              <button
                key={pr.move.id}
                type="button"
                onClick={() => pickMove(pr)}
                style={{
                  flex: '1 1 0', maxWidth: 188, background: 'rgba(8,12,28,0.88)',
                  border: '2px solid rgba(126,200,255,0.55)', borderRadius: 14,
                  padding: '10px 12px', color: '#fff', cursor: 'pointer', textAlign: 'left',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                  <span style={{ background: '#7ec8ff', color: '#06223f', fontWeight: 800, borderRadius: 7, padding: '1px 8px', fontSize: 14 }}>{pr.move.key}</span>
                  <strong style={{ fontSize: 14.5 }}>{pr.move.emoji} {pr.move.name}</strong>
                </div>
                <span style={{ fontSize: 11, opacity: 0.82, lineHeight: 1.25, display: 'block' }}>{pr.move.blurb}</span>
                <span style={{ fontSize: 10.5, opacity: 0.7, display: 'block', marginTop: 3 }}>{pr.dir === 'findF' ? 'find the force F = m·a' : 'find the acceleration a = F/m'}</span>
              </button>
            ))}
          </div>
        )}

        {/* In-game calculator overlay during solve. */}
        {phase === 'solve' && showCalc && <Calculator onClose={() => setShowCalc(false)} />}
      </div>

      <div className="soccer__side">
        {phase === 'solve' && p && (
          <>
            <div className="soccer__givens">
              <div className="is-key"><span>Move</span><strong>{p.move.emoji} {p.move.name}</strong></div>
              <div><span>Ball mass</span><strong>m = {p.m} kg</strong></div>
              {p.dir === 'findF'
                ? <div className="is-key"><span>Acceleration</span><strong>a = {p.a} m/s²</strong></div>
                : <div className="is-key"><span>Foot force</span><strong>F = {p.F} N</strong></div>}
            </div>
            <div className="soccer__method">
              <div className="soccer__method-head">
                <span>{p.dir === 'findF' ? 'Solve for the force F' : 'Solve for the acceleration a'}</span>
                <button type="button" className="soccer__calc-toggle" onClick={() => setShowCalc((v) => !v)}>🧮 {showCalc ? 'Hide' : 'Calc'}</button>
              </div>
              <div className="soccer__steps">
                <code>{p.dir === 'findF' ? `F = m · a = ${p.m} · ${p.a}` : `a = F / m = ${p.F} / ${p.m}`}</code>
              </div>
              <p className="soccer__tip" style={{ margin: '6px 0 0' }}>{p.dir === 'findF' ? p.move.ctxF(p.a) : p.move.ctxA(p.F)}</p>
              <div className="soccer__inputs">
                <label className="soccer__field">
                  <span>{p.dir === 'findF' ? 'Force F (N)' : 'Acceleration a (m/s²)'}</span>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={answerStr}
                    placeholder={answerOf(p).toFixed(1)}
                    onChange={(ev) => setAnswerStr(ev.target.value)}
                  />
                </label>
              </div>
              <p className="soccer__tip" style={{ margin: '6px 0 0', fontSize: 11, opacity: 0.78 }}>Round to the nearest whole number (up or down is fine).</p>
            </div>
          </>
        )}

        <div className="sim__controls">
          <div className="soccer__buttons">
            {(phase === 'intro' || phase === 'menu') && <button type="button" className="btn btn--primary" disabled>Pick a move ▸</button>}
            {phase === 'solve' && <button type="button" className="btn btn--primary" onClick={playMove} disabled={!answerStr}>Do the move ⚽</button>}
            {phase === 'fly' && <button type="button" className="btn btn--primary" disabled>On the move…</button>}
          </div>
        </div>
      </div>
    </div>
  )
}

// ============================================================================
// Solve-clock HUD (copied from ForcesSim's drawTimer).
// ============================================================================
function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath(); ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath()
}

function drawTimer(ctx: CanvasRenderingContext2D, left: number, total: number, label: string, color: string, urgent = false) {
  ctx.fillStyle = urgent ? 'rgba(78, 10, 24, 0.9)' : 'rgba(8,12,28,0.82)'
  roundRect(ctx, W / 2 - 170, 12, 340, urgent ? 64 : 50, 14); ctx.fill()
  if (urgent) {
    ctx.strokeStyle = '#ff8aa0'; ctx.lineWidth = 2
    roundRect(ctx, W / 2 - 170, 12, 340, 64, 14); ctx.stroke()
    ctx.textAlign = 'center'
    ctx.fillStyle = '#ffd7df'; ctx.font = '900 10px Plus Jakarta Sans, sans-serif'
    ctx.fillText('WINDOW CLOSING', W / 2, 24)
  }
  ctx.textAlign = 'center'; ctx.fillStyle = color; ctx.font = '800 22px Plus Jakarta Sans, sans-serif'
  const txt = total >= 90 ? `${Math.floor(left / 60)}:${String(Math.floor(left % 60)).padStart(2, '0')}` : `${left.toFixed(1)}s`
  ctx.fillText(txt, W / 2, urgent ? 45 : 36)
  ctx.fillStyle = urgent ? '#ffe1e7' : '#cfd6ea'; ctx.font = '600 11px Inter, sans-serif'; ctx.fillText(label, W / 2, urgent ? 61 : 52)
  const by = urgent ? 66 : 56
  ctx.fillStyle = 'rgba(255,255,255,0.15)'; roundRect(ctx, W / 2 - 150, by, 300, 4, 2); ctx.fill()
  ctx.fillStyle = color; roundRect(ctx, W / 2 - 150, by, 300 * clamp(left / total, 0, 1), 4, 2); ctx.fill()
  ctx.textAlign = 'left'
}
