import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Calculator } from '../../sims/Calculator'
import { usePlayerKit } from '../../../lib/playerKit'
import {
  BASE_YOU_KIT, makeKit, buildStaticBackground, buildGradients, drawWorld, drawVignette,
  drawWorldPlayer, drawWorldBall, project, roundRect, BALL_R, W, H,
  clamp, lerp, easeOut, easeInOut,
  type Kit, type Gradients, type PlayerAction, type P2, type V3,
} from '../../../lib/pitch3d'
import { drawPlayerLegs, drawPlayerShorts, bodyMetrics } from '../../../lib/playerCanvas'
import { useCameraSettle, type MatchDrillProps } from '../matchDrill'

// ============================================================================
// MATCH-VERSION of the DEFENDING / "Win the Ball" drill (Momentum unit).
//
// This is the in-match twin of components/sims/DefenseSim. It lives on the SAME
// shared third-person pitch (lib/pitch3d) as the bridging transitions, so the
// hand-off is seamless: it OPENS at the exact world state the `oppAttack`
// transition ended in (DRILL_ENTRY['defend'] — an attacker bearing down on you
// with the ball at his feet, you with your back to the camera), then eases the
// camera into the solve framing while the attacker drives in.
//
// It reuses DefenseSim's momentum physics (p = m·v, both/all directions, mass
// varying per challenge), its challenge menu (keys 1-3 Poke / Challenge / Dive),
// its grading/tolerance, and its per-move tackle choreography (incl. the grounded
// slide). Unlike the full sim it is a SINGLE attempt: no loop, no remediation, no
// streak/best HUD, no high-score persistence, no onGoal. It reports the outcome
// ONCE via onResolve, then holds its final frame for the match orchestrator.
// ============================================================================

// ---- Solve economy (FIXED — identical to DefenseSim) ----
const SOLVE_MS = 30000
const SOLVE_WARN_MS = 10000
const CALC_DRAIN = 1.25

// ---- Camera settle: ease from the handoff pan into the solve framing ----
const SOLVE_CAMX = 0
const SETTLE_MS = 700

// ---- World geometry (snapped to DRILL_ENTRY['defend']) ----
// YOU (the defender) open with your back to camera; the attacker enters up-pitch
// (larger z) and drives toward you (z shrinks). The tackle happens between you.
const YOU_HOME = { x: -0.2, z: 3.2 }
const ATT_START_Z = 6.0
const ATT_MIN = 4.9 // closest he gets before you have to commit
const ATT_APPROACH = 0.55 // m/s he drives in
const BALL_AHEAD = 0.6 // ball sits this far in front of his feet (toward you)
const TACKLE_Z = 4.6 // where the challenge resolves, a couple metres ahead of you

// ---- Animation timings (identical to DefenseSim) ----
const FLY_DUR = 1.7
const ROB_DUR_S = 1.7
const ROB_CLOSE_S = 0.8

const round1 = (x: number) => Math.round(x * 10) / 10
const parseNum = (s: string): number => { const v = parseFloat(s); return Number.isFinite(v) ? v : 0 }

// ============================================================================
// MOMENTUM PROBLEMS — copied wholesale from DefenseSim so the question, givens,
// grading and tolerance are IDENTICAL. p = m·v with the attacker's mass random
// per challenge; each challenge solves for one of p / v / m.
// ============================================================================
type Dir = 'findP' | 'findV' | 'findM'
const DIRS: Dir[] = ['findP', 'findV', 'findM']
type MoveId = 'poke' | 'challenge' | 'dive'

type MoveDef = { id: MoveId; key: string; name: string; emoji: string; blurb: string; who: string }

const MOVES: MoveDef[] = [
  { id: 'poke', key: '1', name: 'Poke', emoji: '🦶', blurb: 'Stay up, reach in and nick it', who: 'a quick winger' },
  { id: 'challenge', key: '2', name: 'Challenge', emoji: '💪', blurb: 'Shoulder-to-shoulder, ride him off', who: 'a strong striker' },
  { id: 'dive', key: '3', name: 'Dive', emoji: '🥅', blurb: 'Commit and slide in to win it', who: 'a driving target man' },
]

type Problem = {
  move: MoveDef
  dir: Dir
  m: number
  v: number
  p: number
  answer: number
  unit: string
}

const answerOf = (p: Problem) => p.answer
// Flat ±1 tolerance: every exact answer is a whole number (rounding up OR down passes).
const tolOf = () => 1.0001

const randMass = () => 60 + Math.floor(Math.random() * 31)
const randVel = () => 1 + Math.floor(Math.random() * 50)

function makeProblem(move: MoveDef, dir: Dir): Problem {
  const m = randMass()
  const v = randVel()
  const p = m * v
  const answer = dir === 'findP' ? p : dir === 'findV' ? v : m
  const unit = dir === 'findP' ? 'kg·m/s' : dir === 'findV' ? 'm/s' : 'kg'
  return { move, dir, m, v, p, answer, unit }
}

function makeRound(): { problems: Problem[]; openSide: 1 | -1 } {
  const problems = MOVES.map((move) => makeProblem(move, DIRS[Math.floor(Math.random() * DIRS.length)]))
  return { problems, openSide: Math.random() < 0.5 ? 1 : -1 }
}

const unknownName = (dir: Dir) => (dir === 'findP' ? 'momentum p' : dir === 'findV' ? 'speed v' : 'mass m')
const formulaPlug = (p: Problem) =>
  p.dir === 'findP' ? `p = m · v = ${p.m} · ${p.v}`
    : p.dir === 'findV' ? `v = p / m = ${p.p} / ${p.m}`
      : `m = p / v = ${p.p} / ${p.v}`
const ctxText = (p: Problem) => {
  const name = p.move.name.toLowerCase()
  return p.dir === 'findP'
    ? `He drives in at v = ${p.v} m/s carrying m = ${p.m} kg. What momentum p = m·v are you timing the ${name} against?`
    : p.dir === 'findV'
      ? `He hits the ${name} with p = ${p.p} kg·m/s on an m = ${p.m} kg frame. How fast is he, v = p/m?`
      : `He carries p = ${p.p} kg·m/s at v = ${p.v} m/s. How heavy is he, m = p/v?`
}
function missText(p: Problem | null, used: number): string {
  if (!p) return 'Not quite — work the momentum again.'
  if (p.dir === 'findP') return `${round1(used)} kg·m/s misreads it. p = m·v = ${p.p} kg·m/s.`
  if (p.dir === 'findV') return `${round1(used)} m/s misreads it. v = p/m = ${p.v} m/s.`
  return `${round1(used)} kg misreads it. m = p/v = ${p.m} kg.`
}

// ============================================================================
// TACKLE CHOREOGRAPHY — the executed-challenge scenes, copied from DefenseSim
// (re-tuned to the match's YOU_HOME / TACKLE_Z). Returns where the ball, the
// attacker and "you" are at progress u ∈ [0,1].
// ============================================================================
type Outcome = 'beat' | 'lost'
type SceneActor = { x: number; z: number; running: boolean; lean: number }
type YouPose = { show: boolean; x: number; z: number; running: boolean; footTarget: V3 | null; lean: number; slide: number }
type Scene = { ball: V3; att: SceneActor; you: YouPose; contact: number; contactPt: V3 | null }

const pulse = (u: number, c: number, w: number) => Math.max(0, 1 - Math.abs(u - c) / w)

function flyScene(moveId: MoveId, outcome: Outcome, openSide: number, attZ: number, u: number): Scene {
  return outcome === 'lost' ? lostScene(moveId, openSide, attZ, u) : beatScene(moveId, openSide, attZ, u)
}

function beatScene(moveId: MoveId, openSide: number, attZ: number, u: number): Scene {
  const goSide = openSide
  const cF = moveId === 'challenge' ? 0.48 : moveId === 'dive' ? 0.40 : 0.42
  const TZ = TACKLE_Z

  const attAt = (uu: number): { x: number; z: number; lean: number; run: boolean } => {
    if (uu < cF) return { x: 0, z: lerp(attZ, TZ, easeOut(uu / cF)), lean: 0, run: true }
    const k = easeOut((uu - cF) / (1 - cF))
    if (moveId === 'poke') {
      return { x: lerp(0, -goSide * 0.5, k), z: lerp(TZ, TZ - 1.4, k), lean: -goSide * 0.6 * (1 - 0.3 * k), run: k < 0.78 }
    }
    if (moveId === 'challenge') {
      return { x: lerp(0, goSide * 1.7, k), z: lerp(TZ, TZ + 0.5, k), lean: goSide * 0.9, run: k < 0.4 }
    }
    return { x: lerp(0, goSide * 0.95, k), z: lerp(TZ, TZ - 0.7, k), lean: goSide * 0.7 * (1 - 0.5 * k), run: k < 0.55 }
  }

  const youAt = (uu: number): { x: number; z: number; slide: number } => {
    if (moveId === 'poke') {
      const stepZ = TZ - 0.85
      if (uu < cF) { const a = easeOut(uu / cF); return { x: lerp(YOU_HOME.x, goSide * 0.05, a), z: lerp(YOU_HOME.z, stepZ, a), slide: 0 } }
      const k = easeOut((uu - cF) / (1 - cF))
      return { x: lerp(goSide * 0.05, goSide * 0.12, k), z: lerp(stepZ, stepZ + 0.45, k), slide: 0 }
    }
    if (moveId === 'challenge') {
      const sideZ = TZ - 0.55
      if (uu < cF) { const a = easeOut(uu / cF); return { x: lerp(YOU_HOME.x, goSide * 0.28, a), z: lerp(YOU_HOME.z, sideZ, a), slide: 0 } }
      const k = easeOut((uu - cF) / (1 - cF))
      return { x: lerp(goSide * 0.28, YOU_HOME.x + 0.1, k * 0.8), z: lerp(sideZ, YOU_HOME.z + 0.35, k * 0.8), slide: 0 }
    }
    const slideZ = TZ - 0.3
    const a = easeOut(clamp(uu / cF, 0, 1))
    let x = lerp(YOU_HOME.x, -goSide * 0.05, a)
    let z = lerp(YOU_HOME.z, slideZ, a)
    if (uu >= cF) { const k = clamp((uu - cF) / (1 - cF), 0, 1); x = lerp(-goSide * 0.05, goSide * 0.12, k * 0.4); z = lerp(slideZ, slideZ + 0.3, k * 0.4) }
    const slide = uu < cF
      ? easeOut(clamp((uu - (cF - 0.22)) / 0.22, 0, 1))
      : 1 - easeInOut(clamp((uu - 0.8) / 0.2, 0, 1))
    return { x, z, slide }
  }

  const youEnd = youAt(1)
  const a = attAt(u)
  const y = youAt(u)

  const ballAt = (uu: number): V3 => {
    if (uu < cF) { const aa = attAt(uu); return { x: aa.x, y: BALL_R, z: aa.z - 0.45 } }
    const k = easeOut((uu - cF) / (1 - cF))
    if (moveId === 'poke') {
      return { x: lerp(0, goSide * 0.95, k), y: BALL_R, z: lerp(TZ - 0.45, TZ + 2.9, k) }
    }
    const viaX = moveId === 'dive' ? goSide * 0.6 : goSide * 0.45
    const mid = 0.45
    if (k < mid) { const kk = k / mid; return { x: lerp(0, viaX, kk), y: BALL_R, z: lerp(TZ - 0.45, TZ - 0.2, kk) } }
    const kk = (k - mid) / (1 - mid)
    return { x: lerp(viaX, youEnd.x, kk), y: BALL_R, z: lerp(TZ - 0.2, youEnd.z + 0.5, kk) }
  }

  const ball = ballAt(u)
  const contactPt: V3 = { x: 0, y: BALL_R + 0.25, z: TZ - 0.35 }
  const contact = pulse(u, cF, 0.07)
  const youWon = u >= 0.82

  let footTarget: V3 | null = null
  if (moveId === 'dive') { if (y.slide > 0.1 || youWon) footTarget = ball }
  else if (u > cF - 0.12 && u < cF + 0.16) footTarget = ball
  else if (youWon && moveId === 'challenge') footTarget = ball

  const leanDir = moveId === 'challenge' ? goSide : moveId === 'poke' ? goSide * 0.5 : 0
  const att: SceneActor = { x: a.x, z: a.z, running: a.run, lean: a.lean }
  const you: YouPose = {
    show: true, x: y.x, z: y.z,
    running: y.slide < 0.1 && footTarget == null && u > 0.04 && u < 0.95,
    footTarget,
    lean: leanDir * pulse(u, cF, 0.25),
    slide: y.slide,
  }
  return { ball, att, you, contact, contactPt }
}

function lostScene(moveId: MoveId, openSide: number, attZ: number, u: number): Scene {
  const goSide = openSide
  const cF = moveId === 'challenge' ? 0.44 : 0.40
  const k = easeOut(u)
  const ax = lerp(0, goSide * 1.5, k)
  const az = lerp(attZ, -0.4, k) // bursts past you toward the camera (goal-side)
  const ball: V3 = { x: ax + goSide * 0.32, y: BALL_R, z: az - 0.3 }

  let yx: number, yz: number, slide = 0
  if (moveId === 'dive') {
    const a = easeOut(clamp(u / cF, 0, 1))
    yx = lerp(YOU_HOME.x, goSide * 0.25, a)
    yz = lerp(YOU_HOME.z, TACKLE_Z - 0.4, a)
    if (u >= cF) { const kk = clamp((u - cF) / (1 - cF), 0, 1); yx = lerp(goSide * 0.25, goSide * 0.55, kk); yz = lerp(TACKLE_Z - 0.4, TACKLE_Z - 0.1, kk) }
    slide = u < cF ? easeOut(clamp((u - (cF - 0.22)) / 0.22, 0, 1)) : 1 - easeInOut(clamp((u - 0.72) / 0.28, 0, 1))
  } else {
    const lungeP = easeOut(clamp(u / 0.6, 0, 1))
    yx = lerp(YOU_HOME.x, goSide * 0.5, lungeP * 0.7)
    yz = lerp(YOU_HOME.z, YOU_HOME.z + 0.55, easeOut(clamp(u / 0.5, 0, 1)))
  }
  const reaching = moveId !== 'dive' && u > cF - 0.1 && u < cF + 0.14

  const att: SceneActor = { x: ax, z: az, running: u < 0.95, lean: moveId === 'challenge' ? -goSide * 0.3 : 0 }
  const you: YouPose = {
    show: true, x: yx, z: yz,
    running: slide < 0.1 && u > 0.08 && u < 0.7,
    footTarget: reaching ? { x: goSide * 0.7, y: BALL_R, z: yz + 0.55 } : null,
    lean: moveId === 'dive' ? 0 : goSide * pulse(u, cF, 0.16),
    slide,
  }
  return { ball, att, you, contact: 0, contactPt: null }
}

// ============================================================================
// Minimal sound (same toolkit as DefenseSim).
// ============================================================================
class Sfx {
  ctx: AudioContext | null = null
  noise: AudioBuffer | null = null
  ensure() {
    if (!this.ctx) {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
      this.ctx = new AC()
      const len = this.ctx.sampleRate * 0.5
      const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate)
      const d = buf.getChannelData(0)
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1
      this.noise = buf
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume()
  }
  private burst(freq: number, q: number, dur: number, vol: number) {
    if (!this.ctx || !this.noise) return
    const src = this.ctx.createBufferSource(); src.buffer = this.noise
    const f = this.ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = q
    const g = this.ctx.createGain(); const t = this.ctx.currentTime
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur)
    src.connect(f).connect(g).connect(this.ctx.destination); src.start(t); src.stop(t + dur)
  }
  private tone(freq: number, dur: number, type: OscillatorType, vol: number, delay = 0) {
    if (!this.ctx) return
    const o = this.ctx.createOscillator(); const g = this.ctx.createGain()
    o.type = type; o.frequency.value = freq
    const t = this.ctx.currentTime + delay
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur)
    o.connect(g).connect(this.ctx.destination); o.start(t); o.stop(t + dur)
  }
  tackle() { this.burst(300, 0.5, 0.16, 0.3); this.tone(120, 0.12, 'sine', 0.2) }
  cheer() { this.burst(900, 0.4, 0.6, 0.28) }
  beaten() { this.tone(150, 0.22, 'sawtooth', 0.2) }
  miss() { this.burst(240, 1, 0.18, 0.26) }
}

// ============================================================================
// Render state machine.
// ============================================================================
type Phase = 'approach' | 'menu' | 'solve' | 'fly' | 'robbed' | 'done'

type Game = {
  phase: Phase
  problems: Problem[]
  picked: Problem | null
  openSide: 1 | -1
  approachT: number
  attZ: number
  solveElapsedMs: number
  t: number
  outcome: Outcome | null
  robbed: boolean
  played: number
}

export function MatchDefendDrill({ entry, oppColor, onResolve }: MatchDrillProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [phase, setPhase] = useState<Phase>('approach')
  const [answerStr, setAnswerStr] = useState('')
  const [showCalc, setShowCalc] = useState(false)
  const [sound, setSound] = useState(true)

  // YOUR equipped kit drives YOUR player; the attacker is the de-clashed opponent.
  const youKit = usePlayerKit<Kit>(BASE_YOU_KIT)
  const attKit = useMemo<Kit>(() => makeKit(oppColor, { face: 'front', num: 9 }), [oppColor])
  const youKitRef = useRef(youKit); youKitRef.current = youKit
  const attKitRef = useRef(attKit); attKitRef.current = attKit

  // Camera eases from the handoff pan into the solve framing during the settle.
  const { camX } = useCameraSettle(entry.camX, SOLVE_CAMX, SETTLE_MS)
  const camXRef = useRef(camX); camXRef.current = camX

  const sfx = useRef(new Sfx())
  const soundRef = useRef(sound); soundRef.current = sound
  const showCalcRef = useRef(showCalc); showCalcRef.current = showCalc
  const answerRef = useRef(answerStr); answerRef.current = answerStr

  const onResolveRef = useRef(onResolve); onResolveRef.current = onResolve
  const resolvedOnceRef = useRef(false)

  const gameRef = useRef<Game>((() => {
    const r = makeRound()
    return {
      phase: 'approach', problems: r.problems, picked: null, openSide: r.openSide,
      approachT: 0, attZ: ATT_START_Z, solveElapsedMs: 0, t: 0,
      outcome: null, robbed: false, played: 0,
    }
  })())

  const rafRef = useRef<number | null>(null)
  const bgRef = useRef<HTMLCanvasElement | null>(null)
  const gradRef = useRef<Gradients | null>(null)

  const resolveOnce = useCallback((success: boolean) => {
    if (resolvedOnceRef.current) return
    resolvedOnceRef.current = true
    onResolveRef.current?.(success)
  }, [])

  // ===== Actions =====
  const pickMove = useCallback((p: Problem) => {
    const g = gameRef.current
    if (g.phase !== 'menu') return
    g.picked = p
    g.solveElapsedMs = 0
    g.phase = 'solve'
    if (soundRef.current) sfx.current.ensure()
    setAnswerStr('')
    setPhase('solve')
  }, [])

  const fire = useCallback((value: number) => {
    const g = gameRef.current
    const p = g.picked
    if (!p) return
    g.played = value
    g.outcome = Math.abs(value - answerOf(p)) <= tolOf() ? 'beat' : 'lost'
    g.t = 0
    g.phase = 'fly'
    if (soundRef.current) sfx.current.ensure()
    setPhase('fly')
  }, [])

  const playMove = useCallback(() => {
    const g = gameRef.current
    if (g.phase !== 'solve') return
    fire(parseNum(answerRef.current))
  }, [fire])

  // The fly animation has finished: report the single outcome once and hold.
  const resolve = useCallback(() => {
    const g = gameRef.current
    if (g.phase !== 'fly') return
    g.phase = 'done'
    if (g.outcome === 'beat') {
      if (soundRef.current) { sfx.current.tackle(); sfx.current.cheer() }
      resolveOnce(true)
    } else {
      if (soundRef.current) { sfx.current.beaten(); sfx.current.miss() }
      resolveOnce(false)
    }
    setPhase('done')
  }, [resolveOnce])

  // Solve clock ran out: he knocks it past you and drives off — a turnover.
  const dispossess = useCallback(() => {
    const g = gameRef.current
    if (g.phase !== 'solve') return
    g.robbed = true
    g.t = 0
    g.phase = 'robbed'
    if (soundRef.current) { sfx.current.ensure(); sfx.current.beaten() }
    setPhase('robbed')
  }, [])

  const endRobbery = useCallback(() => {
    const g = gameRef.current
    if (g.phase !== 'robbed') return
    g.phase = 'done'
    if (soundRef.current) sfx.current.miss()
    resolveOnce(false)
    setPhase('done')
  }, [resolveOnce])

  const actionsRef = useRef({ pickMove, playMove, dispossess, resolve, endRobbery })
  actionsRef.current = { pickMove, playMove, dispossess, resolve, endRobbery }

  // ===== Input =====
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

    const youKitNow = youKitRef.current
    const attKitNow = attKitRef.current

    const planted = (x: number, z: number, lean: number): PlayerAction => {
      const fp = project(x, 0, z, cx)
      return { footX: fp.sx, footY: fp.sy, lean }
    }
    const footAt = (target: V3, lean: number): PlayerAction => {
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

    if (g.phase === 'fly' || (g.phase === 'done' && g.outcome && !g.robbed)) {
      const u = g.phase === 'fly' ? clamp(g.t / FLY_DUR, 0, 1) : 1
      const sc = flyScene(g.picked!.move.id, g.outcome!, g.openSide, g.attZ, u)
      const drawAtt = () => {
        const act = Math.abs(sc.att.lean) > 0.02 ? planted(sc.att.x, sc.att.z, sc.att.lean) : undefined
        drawWorldPlayer(ctx, { x: sc.att.x, z: sc.att.z }, attKitNow, now, sc.att.running, false, act, cx)
      }
      const drawYou = () => {
        if (!sc.you.show) return
        if (sc.you.slide > 0.05) {
          const feet = project(sc.you.x, 0, sc.you.z, cx)
          const head = project(sc.you.x, 1.84, sc.you.z, cx)
          const fa = sc.you.footTarget
            ? footAt(sc.you.footTarget, sc.you.lean)
            : { footX: null, footY: 0, lean: sc.you.lean }
          drawSlideYou(ctx, feet, head, youKitNow, fa, sc.you.slide)
          return
        }
        const act = sc.you.footTarget ? footAt(sc.you.footTarget, sc.you.lean)
          : Math.abs(sc.you.lean) > 0.02 ? planted(sc.you.x, sc.you.z, sc.you.lean)
            : undefined
        drawWorldPlayer(ctx, { x: sc.you.x, z: sc.you.z }, youKitNow, now, sc.you.running, false, act, cx)
      }
      if (sc.att.z >= sc.you.z) { drawAtt(); drawYou() } else { drawYou(); drawAtt() }
      drawWorldBall(ctx, sc.ball, g.t * 9, sc.contact * 0.4, cx)
      if (sc.contactPt) drawContact(sc.contactPt, sc.contact)
    } else if (g.phase === 'robbed' || (g.phase === 'done' && g.robbed)) {
      const tu = g.phase === 'robbed' ? clamp(g.t / ROB_CLOSE_S, 0, 1) : 1
      const e = easeInOut(tu)
      const az = lerp(g.attZ, -0.3, e)
      const ax = lerp(0, g.openSide * 1.2, e)
      const ball: V3 = { x: ax + g.openSide * 0.3, y: BALL_R, z: az - 0.3 }
      const drawAtt = () => drawWorldPlayer(ctx, { x: ax, z: az }, attKitNow, now, tu < 0.96, false, undefined, cx)
      const drawYou = () => drawWorldPlayer(ctx, { x: YOU_HOME.x, z: YOU_HOME.z }, youKitNow, now, tu < 0.3, false, undefined, cx)
      if (az >= YOU_HOME.z) { drawAtt(); drawYou() } else { drawYou(); drawAtt() }
      drawWorldBall(ctx, ball, now / 300, 0, cx)
    } else {
      // approach / menu / solve: the attacker drives in with the ball at his feet,
      // while you hold a defensive stance and shuffle to stay in front of him.
      const attX = lerp(entry.foe?.x ?? 0, 0, easeOut(g.approachT))
      const ph = (now / 1000) / 0.5 * Math.PI * 2
      const shuffle = Math.sin(ph) * 0.1
      drawWorldPlayer(ctx, { x: attX, z: g.attZ }, attKitNow, now, true, false, undefined, cx)
      drawWorldBall(ctx, { x: attX, y: BALL_R, z: g.attZ - BALL_AHEAD }, now / 320, 0, cx)
      drawWorldPlayer(ctx, { x: YOU_HOME.x + shuffle, z: YOU_HOME.z }, youKitNow, now, false, false, undefined, cx)
    }

    drawVignette(ctx, gradRef.current)

    if (g.phase === 'solve') {
      const total = SOLVE_MS / 1000
      const left = Math.max(0, (SOLVE_MS - g.solveElapsedMs) / 1000)
      const warn = left <= SOLVE_WARN_MS / 1000
      const calcLabel = showCalcRef.current ? ' (calc: 1.25× drain)' : ''
      const solveName = g.picked ? unknownName(g.picked.dir) : 'momentum p'
      const label = `Solve the ${solveName}: ENTER to challenge` + calcLabel
      drawTimer(ctx, left, total, warn ? `Hurry! ${Math.ceil(left)}s left` : label, warn ? '#ff3b5f' : '#7ec8ff', warn)
    }
  }, [entry])

  // ===== Loop =====
  useEffect(() => {
    let last = performance.now()
    const update = (dt: number) => {
      const g = gameRef.current
      const act = actionsRef.current
      if (g.phase === 'approach') {
        g.approachT = Math.min(1, g.approachT + dt / (SETTLE_MS / 1000))
        g.attZ = Math.max(ATT_MIN, g.attZ - ATT_APPROACH * dt)
        if (g.approachT >= 1) { g.phase = 'menu'; setPhase('menu') }
      } else if (g.phase === 'menu' || g.phase === 'solve') {
        g.attZ = Math.max(ATT_MIN, g.attZ - ATT_APPROACH * dt)
      }
      if (g.phase === 'solve') {
        g.solveElapsedMs += dt * 1000 * (showCalcRef.current ? CALC_DRAIN : 1)
        if (g.solveElapsedMs >= SOLVE_MS) act.dispossess()
      }
      if (g.phase === 'fly') {
        g.t += dt
        if (g.t >= FLY_DUR + 0.35) act.resolve()
      }
      if (g.phase === 'robbed') {
        g.t += dt
        if (g.t >= ROB_DUR_S) act.endRobbery()
      }
    }
    const loop = (now: number) => {
      const dt = Math.min(0.04, (now - last) / 1000); last = now
      update(dt)
      draw()
      rafRef.current = requestAnimationFrame(loop)
    }
    rafRef.current = requestAnimationFrame(loop)
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current) }
  }, [draw])

  function toggleSound() { setSound((v) => { if (!v) sfx.current.ensure(); return !v }) }

  // ===== Side-panel data =====
  const g = gameRef.current
  const p = g.picked
  const solving = phase === 'solve'

  return (
    <div className={`sim soccer${solving ? ' soccer--solving' : ''}`}>
      <div className="soccer__stage">
        <canvas
          ref={canvasRef}
          width={W}
          height={H}
          className={`soccer__canvas soccer__canvas--${phase === 'menu' ? 'meter' : phase}`}
        />
        <button type="button" className="soccer__sound" onClick={toggleSound} aria-label="Toggle sound">{sound ? '🔊' : '🔈'}</button>

        {/* CHALLENGE MENU — pick a challenge with the key shown, or click it. */}
        {phase === 'menu' && (
          <div style={{ position: 'absolute', left: 0, right: 0, bottom: 16, display: 'flex', gap: 10, justifyContent: 'center', padding: '0 16px', pointerEvents: 'auto' }}>
            {g.problems.map((pr) => (
              <button
                key={pr.move.id}
                type="button"
                onClick={() => pickMove(pr)}
                style={{
                  flex: '1 1 0', maxWidth: 196, background: 'rgba(8,12,28,0.88)',
                  border: '2px solid rgba(126,200,255,0.55)', borderRadius: 14,
                  padding: '10px 12px', color: '#fff', cursor: 'pointer', textAlign: 'left',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                  <span style={{ background: '#7ec8ff', color: '#06223f', fontWeight: 800, borderRadius: 7, padding: '1px 8px', fontSize: 14 }}>{pr.move.key}</span>
                  <strong style={{ fontSize: 14.5 }}>{pr.move.emoji} {pr.move.name}</strong>
                </div>
                <span style={{ fontSize: 11, opacity: 0.82, lineHeight: 1.25, display: 'block' }}>{pr.move.blurb} ({pr.move.who})</span>
                <span style={{ fontSize: 10.5, opacity: 0.7, display: 'block', marginTop: 3 }}>{pr.dir === 'findP' ? 'find the momentum p = m·v' : pr.dir === 'findV' ? 'find the speed v = p/m' : 'find the mass m = p/v'}</span>
              </button>
            ))}
          </div>
        )}

        {/* SINGLE-ATTEMPT RESULT — a brief broadcast banner; the match moves on. */}
        {phase === 'done' && g.outcome === 'beat' && !g.robbed && (
          <div className="soccer__banner soccer__banner--goal">
            <strong>WON THE BALL! 🛡️</strong>
            <span>{p?.move.name} timed perfectly.</span>
          </div>
        )}
        {phase === 'done' && g.outcome === 'lost' && !g.robbed && (
          <div className="soccer__banner soccer__banner--save">
            <strong>BEATEN 😖</strong>
            <span>{missText(p, g.played)}</span>
          </div>
        )}
        {phase === 'done' && g.robbed && (
          <div className="soccer__banner soccer__banner--save">
            <strong>TOO SLOW ⛔</strong>
            <span>He knocked it past you and went.</span>
          </div>
        )}

        {phase === 'solve' && showCalc && <Calculator onClose={() => setShowCalc(false)} />}
      </div>

      <div className="soccer__side">
        {phase === 'solve' && p && (
          <>
            <div className="soccer__givens">
              <div className="is-key"><span>Challenge</span><strong>{p.move.emoji} {p.move.name}</strong></div>
              {p.dir === 'findM'
                ? <div><span>His momentum</span><strong>p = {p.p} kg·m/s</strong></div>
                : <div><span>Attacker mass</span><strong>m = {p.m} kg</strong></div>}
              {p.dir === 'findP'
                ? <div className="is-key"><span>His speed</span><strong>v = {p.v} m/s</strong></div>
                : p.dir === 'findV'
                  ? <div className="is-key"><span>His momentum</span><strong>p = {p.p} kg·m/s</strong></div>
                  : <div className="is-key"><span>His speed</span><strong>v = {p.v} m/s</strong></div>}
            </div>
            <div className="soccer__method">
              <div className="soccer__method-head">
                <span>Solve for the {unknownName(p.dir)}</span>
                <button type="button" className="soccer__calc-toggle" onClick={() => setShowCalc((v) => !v)}>🧮 {showCalc ? 'Hide' : 'Calc'}</button>
              </div>
              <div className="soccer__steps">
                <code>{formulaPlug(p)}</code>
              </div>
              <p className="soccer__tip" style={{ margin: '6px 0 0' }}>{ctxText(p)}</p>
              <div className="soccer__inputs">
                <label className="soccer__field">
                  <span>{p.dir === 'findP' ? 'Momentum p (kg·m/s)' : p.dir === 'findV' ? 'Speed v (m/s)' : 'Mass m (kg)'}</span>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={answerStr}
                    placeholder={answerOf(p).toFixed(1)}
                    onChange={(e) => setAnswerStr(e.target.value)}
                  />
                </label>
              </div>
              <p className="soccer__tip" style={{ margin: '4px 0 0', opacity: 0.75 }}>Round to the nearest whole number — up or down is fine.</p>
            </div>
          </>
        )}

        <div className="sim__controls">
          <div className="soccer__buttons">
            {phase === 'solve' && <button type="button" className="btn btn--primary" onClick={playMove} disabled={!answerStr}>Make the challenge 🛡️</button>}
            {phase === 'fly' && <button type="button" className="btn btn--primary" disabled>Going in…</button>}
          </div>
        </div>
      </div>
    </div>
  )
}

// ============================================================================
// Grounded slide-tackle pose — adapted from DefenseSim.drawSlidePlayer to draw
// through pitch3d's projected anchors + Kit. pitch3d's drawWorldPlayer has no
// slide pose, so the dive tackle is rendered here. It is always YOUR player
// (back to camera), so only the back-of-head is drawn.
// ============================================================================
type SlideAction = { footX: number | null; footY: number; lean: number }

function drawLimb(
  ctx: CanvasRenderingContext2D,
  sx: number, sy: number, ex: number, ey: number,
  bx: number, by: number, wProx: number, wDist: number, color: string,
) {
  const jx = (sx + ex) / 2 + bx
  const jy = (sy + ey) / 2 + by
  ctx.lineCap = 'round'; ctx.strokeStyle = color
  ctx.lineWidth = wProx; ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(jx, jy); ctx.stroke()
  ctx.lineWidth = wDist; ctx.beginPath(); ctx.moveTo(jx, jy); ctx.lineTo(ex, ey); ctx.stroke()
}

function drawBackHead(ctx: CanvasRenderingContext2D, cx: number, headY: number, headR: number, kit: Kit, detail: boolean) {
  ctx.fillStyle = kit.skin; ctx.beginPath(); ctx.arc(cx, headY, headR, 0, Math.PI * 2); ctx.fill()
  if (detail) {
    ctx.fillStyle = kit.skin
    ctx.beginPath(); ctx.arc(cx - headR * 0.9, headY + headR * 0.05, headR * 0.24, 0, Math.PI * 2); ctx.fill()
    ctx.beginPath(); ctx.arc(cx + headR * 0.9, headY + headR * 0.05, headR * 0.24, 0, Math.PI * 2); ctx.fill()
  }
  ctx.fillStyle = kit.hair
  ctx.beginPath(); ctx.arc(cx, headY - headR * 0.04, headR * 0.98, Math.PI * 0.82, Math.PI * 2.18); ctx.fill()
  ctx.fillStyle = 'rgba(0,0,0,0.12)'
  ctx.beginPath(); ctx.arc(cx, headY + headR * 0.16, headR * 0.5, 0, Math.PI * 2); ctx.fill()
}

function drawSlideYou(ctx: CanvasRenderingContext2D, feet: P2, head: P2, kit: Kit, action: SlideAction, s: number) {
  const scale = feet.scale
  if (scale < 4 || scale > 360) return
  const mb = bodyMetrics(head.sy, feet.sy)
  const wBody = Math.max(5, 0.4 * scale)
  const lw = mb.legW
  const headR = mb.headR
  const torsoW = (mb.shoulderW + mb.waistW) / 2
  const groundY = feet.sy
  const dir = action.footX != null ? (Math.sign(action.footX - feet.sx) || 1) : 1
  const detail = headR > 6.5

  ctx.fillStyle = 'rgba(0,0,0,0.28)'
  ctx.beginPath(); ctx.ellipse(feet.sx, groundY + 1, wBody * (1.1 + 0.5 * s), wBody * 0.32, 0, 0, Math.PI * 2); ctx.fill()

  const hipX = feet.sx - dir * wBody * 0.18 * s
  const hipY = groundY - wBody * (0.06 + 0.18 * s)
  const leadX = action.footX != null ? action.footX : feet.sx + dir * wBody * (0.8 + 0.7 * s)
  const leadY = action.footX != null ? action.footY : groundY - wBody * 0.04
  const trailX = hipX - dir * wBody * (0.3 + 0.35 * s)
  const trailY = groundY
  const shoX = hipX - dir * wBody * 0.7 * s
  const shoY = hipY - wBody * (0.96 - 0.5 * s)
  const headX = shoX - dir * wBody * 0.42 * s
  const headY = shoY - wBody * (0.4 - 0.04 * s) - headR * 0.2

  const slidePose = {
    hipX, hipY,
    lFootX: leadX, lFootY: leadY, rFootX: trailX, rFootY: trailY,
    legW: lw,
    sock: kit.sock,
    boot: kit.boot,
    bootDark: kit.bootDark ?? kit.boot,
    skin: kit.skin,
    shorts: kit.shorts,
    shortsDark: kit.shortsDark,
    detail,
  }
  drawPlayerLegs(ctx, slidePose)

  ctx.lineCap = 'round'
  ctx.strokeStyle = kit.skin; ctx.lineWidth = headR * 0.9
  ctx.beginPath(); ctx.moveTo(shoX, shoY); ctx.lineTo(headX, headY + headR * 0.85); ctx.stroke()

  ctx.strokeStyle = kit.jersey; ctx.lineWidth = torsoW
  ctx.beginPath(); ctx.moveTo(hipX, hipY); ctx.lineTo(shoX, shoY); ctx.stroke()
  ctx.strokeStyle = kit.jerseyDark; ctx.lineWidth = torsoW * 0.33
  ctx.beginPath(); ctx.moveTo(hipX + dir * wBody * 0.18, hipY); ctx.lineTo(shoX + dir * wBody * 0.18, shoY); ctx.stroke()
  ctx.strokeStyle = kit.jerseyHi; ctx.lineWidth = torsoW * 0.13
  ctx.beginPath(); ctx.moveTo(hipX - dir * wBody * 0.22, hipY); ctx.lineTo(shoX - dir * wBody * 0.22, shoY); ctx.stroke()
  ctx.lineCap = 'butt'

  drawPlayerShorts(ctx, slidePose)

  const armProx = Math.max(2, mb.armW * 1.05), armDist = Math.max(1.6, mb.armW * 0.9)
  const leadHandX = shoX + dir * wBody * 0.85, leadHandY = shoY + wBody * 0.16
  const trailHandX = shoX - dir * wBody * 0.45, trailHandY = shoY - wBody * 0.55
  drawLimb(ctx, shoX, shoY, leadHandX, leadHandY, 0, wBody * 0.08, armProx, armDist, kit.skin)
  drawLimb(ctx, shoX, shoY, trailHandX, trailHandY, -dir * wBody * 0.05, -wBody * 0.04, armProx, armDist, kit.skin)
  ctx.fillStyle = kit.skin
  ctx.beginPath(); ctx.arc(leadHandX, leadHandY, armDist * 0.85, 0, Math.PI * 2); ctx.fill()
  ctx.beginPath(); ctx.arc(trailHandX, trailHandY, armDist * 0.85, 0, Math.PI * 2); ctx.fill()
  ctx.lineCap = 'butt'

  drawBackHead(ctx, headX, headY, headR, kit, detail)
  ctx.lineCap = 'butt'
}

// ============================================================================
// On-canvas solve timer (copied from DefenseSim).
// ============================================================================
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
  ctx.fillText(`${left.toFixed(1)}s`, W / 2, urgent ? 45 : 36)
  ctx.fillStyle = urgent ? '#ffe1e7' : '#cfd6ea'; ctx.font = '600 11px Inter, sans-serif'; ctx.fillText(label, W / 2, urgent ? 61 : 52)
  const by = urgent ? 66 : 56
  ctx.fillStyle = 'rgba(255,255,255,0.15)'; roundRect(ctx, W / 2 - 150, by, 300, 4, 2); ctx.fill()
  ctx.fillStyle = color; roundRect(ctx, W / 2 - 150, by, 300 * clamp(left / total, 0, 1), 4, 2); ctx.fill()
  ctx.textAlign = 'left'
}
