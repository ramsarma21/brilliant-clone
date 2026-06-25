import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { SimProps } from './types'
import { Calculator } from './Calculator'
import { fetchKinematicsHighScore, saveKinematicsHighScore } from '../../lib/scores'

// ---- World (meters) ----
const G = 9.8
const RELEASE = { y: 0.22, z: 0.8 } // ball at the player's feet (first-person)
const GOAL_W_HALF = 3.66
const CROSSBAR = 2.44
const BALL_R = 0.11

// ---- Camera / canvas ----
const W = 900
const H = 560
const HORIZON = H * 0.4
const EYE_Y = 1.6
const FOCAL = 560

// ---- Gameplay tuning (penalty shootout) ----
const PENALTY_DIST = 11      // m — fixed distance from the penalty spot to the goal line
const SOLVE_MAX_MS = 180000  // easiest shot (D=0): 3 minutes to work it out
const SOLVE_MIN_MS = 30000   // hardest shot (D=1): 30 seconds
const SOLVE_WARN_MS = 30000  // last 30 seconds get an urgent red countdown
const TARGET_R = 0.28 // m — land inside this (small, strict) circle to score
const METER_RATE = 0.45 // base meter sweep rate (per second) at the easy end; ramps to 1.4× at the hard end

type P2 = { sx: number; sy: number; scale: number }
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v))
const parseNum = (s: string): number => { const v = parseFloat(s); return Number.isFinite(v) ? v : 0 }

// ---- Difficulty model ----
// Two weighted inputs sum to total difficulty D ∈ [0, 1].
//  • placeDiff — how hard the chosen target spot is (dead-centre = 0, corners → 0.3).
//  • powerDiff — how hard the locked meter value is (easy-left → hard-right, max 0.7).
// D drives BOTH the answer time and the keeper's save probability, and NOTHING else.
const PLACE_DIFF_MAX = 0.3
const POWER_DIFF_MAX = 0.7
const placeDiffFor = (x: number, h: number): number => {
  const nx = Math.abs(x) / GOAL_W_HALF                   // 0 centre → 1 at a post
  const ny = Math.abs(h - CROSSBAR / 2) / (CROSSBAR / 2) // 0 mid-height → 1 at bar / turf
  const radial = Math.min(1, Math.hypot(nx, ny) / Math.SQRT2)
  return clamp(radial * PLACE_DIFF_MAX, 0, PLACE_DIFF_MAX)
}
// Answer time: 3 min at D=0 down to 30 s at D=1 (linear), computed once the meter locks.
const solveMsFor = (D: number): number =>
  clamp(SOLVE_MAX_MS - (SOLVE_MAX_MS - SOLVE_MIN_MS) * D, SOLVE_MIN_MS, SOLVE_MAX_MS)
// Keeper save probability depends ONLY on D: easy shots (low D) are easy to save, hard
// shots (high D) are hard to save. scoreChance = 1 − saveProb. Applied ONLY to a CORRECT
// shot, rolled once with a clean Math.random() < scoreChance (independent of shot power).
const saveProbFor = (D: number): number => clamp(0.85 - 0.8 * D, 0.05, 0.9)

const ANGLE_MAX = 70 // typed/used angle is capped so a high-lob alt solution can't sneak a goal

// A Madden-style meter lets the player FREELY set one variable (angle on one run,
// velocity the next). The other variable then has exactly one solution to the spot.
// Minimum launch speed that can reach a point d away and dh above the boot.
function minSpeed(d: number, dh: number): number {
  return Math.sqrt(G * (dh + Math.hypot(d, dh)))
}
// Meter fraction t∈[0,1] → a launch angle that keeps the required force solvable.
function meterToAngle(t: number, d: number, dh: number): number {
  const directDeg = (Math.atan2(dh, d) * 180) / Math.PI
  return clamp(directDeg + 8 + t * 26, 6, ANGLE_MAX)
}
// Meter fraction t∈[0,1] → a strike force comfortably above the minimum, so the
// direct (low) launch angle is the one valid answer and the lob exceeds ANGLE_MAX.
function meterToForce(t: number, d: number, dh: number): number {
  return clamp(minSpeed(d, dh) * (1.35 + t * 0.5), 6, 44)
}
// Correct answers (shown as a placeholder for testing).
function answerForce(d: number, dh: number, angleDeg: number): number {
  const th = (angleDeg * Math.PI) / 180
  const denom = Math.cos(th) ** 2 * (d * Math.tan(th) - dh)
  return denom > 0 ? Math.sqrt((G * d * d) / (2 * denom)) : 0
}
function answerAngle(d: number, dh: number, v: number): number {
  const A = (G * d * d) / (2 * v * v)
  const disc = d * d - 4 * A * (dh + A)
  if (disc < 0) return 0
  const u = (d - Math.sqrt(disc)) / (2 * A) // low (direct) solution
  return (Math.atan(u) * 180) / Math.PI
}

type Phase = 'aim' | 'meter' | 'solve' | 'fly' | 'result'

// The keeper wears a clearly different kit (amber) with emphasised padded gloves.
// (The outfield-defender kit/variety palettes were archived to dribbleRunup.archive.txt.)
const GK_KIT = {
  jersey: '#ffd23f', jerseyDark: '#d99316', jerseyHi: '#ffe27a',
  collar: '#7a4e07', shorts: '#1b1f2a', sock: '#ffd23f', sockBand: '#1b1f2a',
  boot: '#11141d', glove: '#ffffff', gloveCuff: '#ff5c7a', skin: '#e8b48a',
}
type Ball = { x: number; y: number; z: number; vx: number; vy: number; vz: number; spin: number; squash: number }
type Result = { kind: 'goal' | 'save' | 'miss'; text: string; lucky?: boolean }
type Review = { angle: number; force: number; d: number; h: number; vx: number; vy: number; t: number; y: number; dist: number; kind: 'goal' | 'save' | 'miss' }
type Particle = { x: number; y: number; vx: number; vy: number; life: number; max: number; color: string; size: number; rot: number; vr: number }

type Game = {
  phase: Phase
  distToGoal: number // fixed penalty distance to the goal line
  playerX: number    // the penalty taker stands centred (0)
  // The outcome decided ONCE at shoot time (closed-form prediction): 'goal' = a correct
  // answer that lands in the ring, 'save' = on-target-but-wrong, 'miss' = off-frame. The
  // fly loop APPLIES this (it never re-judges goal/save from live physics), so nothing
  // but the answer + luck roll affects the result.
  shotKind: 'goal' | 'save' | 'miss'
  // True when THIS shot is correct (shotKind 'goal') but the difficulty-based luck roll
  // failed → the keeper saves it instead. Rolled once in `shoot()`. Never set by the
  // sandbox or by wrong answers.
  luckFail: boolean
  // Difficulty weights (place [0, 0.3], power [0, 0.7]) and their sum D ∈ [0, 1]. placeDiff is set when the
  // target spot is locked; powerDiff / diff / solveMs are set when the meter is locked.
  placeDiff: number
  powerDiff: number
  diff: number
  solveMs: number
  // Effective solve time spent, accrued per-frame: 1× normally, 1.25× while the calculator
  // is open (so opening it is a real time tradeoff). Drives the countdown + auto-shoot.
  solveElapsedMs: number
  aimStart: number
  shotDist: number
  cross: { x: number; y: number }
  target: { x: number; h: number } | null
  shotD: number
  solveStart: number
  aimX: number
  meterStart: number
  meterT: number
  meterDir: 1 | -1 // single sweep: 1 = SLOW→FAST, then one rebound -1 = FAST→SLOW
  solveFor: 'v' | 'angle'
  lockedV: number
  ball: Ball | null
  trail: { x: number; y: number; z: number }[]
  force: number
  launchAngle: number
  goalZ: number
  flyT: number
  impactT: number
  diveStart: number
  diveDur: number
  resolved: boolean
  caught: boolean
  pending: { res: Result; review: Review } | null
  holdUntil: number
  dive: { dir: number; t: number; x: number; y: number; z: number; beaten?: boolean } | null
  netShake: number
  scored: boolean
  netBulge: number
  particles: Particle[]
  // Sandbox "try for yourself" shot: reuses the real fly mechanics but never logs an
  // attempt or touches the score. `sandboxResetAt` schedules the return to aiming so
  // the student can fire again. Real shots leave `sandbox` false.
  sandbox: boolean
  sandboxResetAt: number
}

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
  kick() { this.burst(420, 0.7, 0.12, 0.3); this.tone(120, 0.1, 'sine', 0.2) }
  whistle() { this.tone(2100, 0.18, 'square', 0.08); this.tone(2400, 0.18, 'square', 0.06, 0.04) }
  steal() { this.tone(150, 0.22, 'sawtooth', 0.18) }
  net() { this.burst(1600, 1.5, 0.2, 0.18) }
  cheer() { this.burst(900, 0.4, 0.6, 0.28) }
  save() { this.burst(260, 1, 0.18, 0.3) }
}

const newGame = (dist: number): Game => ({
  phase: 'aim', distToGoal: dist, playerX: 0,
  shotKind: 'miss', luckFail: false,
  placeDiff: 0, powerDiff: 0, diff: 0, solveMs: SOLVE_MAX_MS, solveElapsedMs: 0,
  aimStart: 0, shotDist: dist, cross: { x: 0, y: 1.2 }, target: null, shotD: dist - RELEASE.z,
  solveStart: 0, aimX: 0, meterStart: 0, meterT: 0, meterDir: 1, solveFor: 'v', lockedV: 22,
  ball: null, trail: [], force: 22, launchAngle: 18, goalZ: dist, resolved: false,
  flyT: 0, impactT: 0, diveStart: 0, diveDur: 0.42,
  caught: false, pending: null, holdUntil: 0, dive: null, netShake: 0,
  scored: false, netBulge: 0, particles: [],
  sandbox: false, sandboxResetAt: 0,
})

export function KinematicsSim({ state, onChange, showGoal, onGoal }: SimProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [phase, setPhase] = useState<Phase>('aim')
  const [message, setMessage] = useState<Result | null>(null)
  const [review, setReview] = useState<Review | null>(null)
  const [shotInfo, setShotInfo] = useState<{ d: number; h: number; x: number; angle: number; vGiven: number; solveFor: 'v' | 'angle'; diff: number } | null>(null)
  const [goals, setGoals] = useState(0)
  const [sound, setSound] = useState(true)
  const [showCalc, setShowCalc] = useState(false)
  // Mirror for the rAF loop: the solve countdown drains 1.25× while the calc is open.
  const showCalcRef = useRef(showCalc); showCalcRef.current = showCalc
  // True while a sandbox "try for yourself" shot is mid-flight (disables re-firing).
  const [sandboxBusy, setSandboxBusy] = useState(false)
  // The outcome of the last sandbox shot — surfaces the same over/saved/scored message
  // as the real game. A 'goal' result shows a persistent congrats screen.
  const [sandboxResult, setSandboxResult] = useState<{ kind: 'goal' | 'save' | 'miss'; text: string } | null>(null)
  const [record, setRecord] = useState(0)
  const recordRef = useRef(0); recordRef.current = record
  // The meter sets one variable; the player works out and types the other.
  const [answerStr, setAnswerStr] = useState('')
  const answer = parseNum(answerStr)
  // Alternates each run: 'v' = meter sets the angle, solve for force; 'angle' = meter sets the force, solve for angle.
  const solveModeRef = useRef<'v' | 'angle'>('v')

  const sfx = useRef<Sfx>(new Sfx())
  const soundRef = useRef(sound); soundRef.current = sound
  const gameRef = useRef<Game>(newGame(PENALTY_DIST))
  const rafRef = useRef<number | null>(null)
  const timeoutRef = useRef<number | null>(null)
  // Cached static backdrop + scene gradients so we don't rebuild them 60×/sec.
  const bgRef = useRef<HTMLCanvasElement | null>(null)
  const gradRef = useRef<{ grass: CanvasGradient; vignette: CanvasGradient } | null>(null)
  // Sandbox "try for yourself" preview: when active the draw loop renders a live
  // ball-trajectory arc for `value` (the variable the student was solving) instead
  // of the frozen shot. Read-only — it never logs an attempt or changes the score.
  const previewRef = useRef<{ active: boolean; value: number }>({ active: false, value: 0 })
  const setPreview = useCallback((p: { active: boolean; value: number } | null) => {
    previewRef.current = p ?? { active: false, value: 0 }
    // Leaving the sandbox aiming view (back to lesson / unmount): abandon any
    // in-flight sandbox shot so it can't keep animating behind the lesson.
    if (!previewRef.current.active) {
      const g = gameRef.current
      if (g.sandbox) {
        g.ball = null; g.dive = null; g.trail = []; g.particles = []
        g.scored = false; g.caught = false; g.resolved = false; g.pending = null
        g.holdUntil = 0; g.netShake = 0; g.netBulge = 0; g.sandboxResetAt = 0
        if (g.phase === 'fly') g.phase = 'result'
      }
      setSandboxBusy(false)
      setSandboxResult(null)
    }
  }, [])

  const sceneRef = useRef({ onChange, state, showGoal })
  sceneRef.current = { onChange, state, showGoal }
  const onGoalRef = useRef(onGoal); onGoalRef.current = onGoal
  const goalSignaledRef = useRef(false)
  const inputsRef = useRef({ answer })
  inputsRef.current = { answer }
  const goalsRef = useRef(goals)
  goalsRef.current = goals

  // All-time record (top-left), backed by Supabase with a local fallback.
  useEffect(() => { void fetchKinematicsHighScore().then(setRecord) }, [])
  useEffect(() => {
    if (goals > recordRef.current) { setRecord(goals); void saveKinematicsHighScore(goals) }
  }, [goals])

  // ---- projection helpers ----
  const project = useCallback((x: number, y: number, z: number): P2 => {
    const cz = Math.max(0.05, z)
    const scale = FOCAL / cz
    return { sx: W / 2 + x * scale, sy: HORIZON - (y - EYE_Y) * scale, scale }
  }, [])
  const rel = useCallback((absX: number, y: number, z: number): P2 => project(absX - gameRef.current.playerX, y, z), [project])

  // ===== Actions =====
  const scheduleReset = useCallback((ms: number) => {
    if (timeoutRef.current) window.clearTimeout(timeoutRef.current)
    timeoutRef.current = window.setTimeout(() => {
      previewRef.current = { active: false, value: 0 }
      gameRef.current = newGame(PENALTY_DIST)
      gameRef.current.aimStart = performance.now()
      setPhase('aim'); setMessage(null); setShotInfo(null); setReview(null); setAnswerStr('')
      setSandboxBusy(false); setSandboxResult(null)
    }, ms)
  }, [])

  const restartRun = useCallback(() => {
    if (timeoutRef.current) window.clearTimeout(timeoutRef.current)
    previewRef.current = { active: false, value: 0 }
    gameRef.current = newGame(PENALTY_DIST)
    gameRef.current.aimStart = performance.now()
    setPhase('aim'); setMessage(null); setShotInfo(null)
    setReview(null); setAnswerStr(''); setShowCalc(false); goalSignaledRef.current = false
    setSandboxBusy(false); setSandboxResult(null)
  }, [])

  const finishShot = useCallback((res: Result) => {
    const g = gameRef.current
    if (g.resolved) return
    g.resolved = true; g.phase = 'result'
    if (res.kind === 'goal') {
      g.netShake = 14
      if (soundRef.current) { sfx.current.net(); sfx.current.cheer() }
      const s = sceneRef.current
      const next = (Number(s.state.goals) || 0) + 1
      s.onChange({ ...s.state, power: gameRef.current.force, angle: gameRef.current.launchAngle, goals: next })
      setGoals((p) => p + 1)
      // Signal lesson-level goal completion after the celebration. `showGoal`
      // only controls the small Goals 0/1 HUD; callers can still listen quietly.
      if (onGoalRef.current && !goalSignaledRef.current) {
        goalSignaledRef.current = true
        onGoalRef.current()
      }
    } else if (soundRef.current) sfx.current.save()
    setMessage(res); setPhase('result')
    // Goals auto-advance after the celebration; saves/misses wait for a click.
    if (res.kind === 'goal') scheduleReset(2400)
  }, [scheduleReset])

  // Lock the chosen target spot → start the power meter. placeDiff is fixed here from
  // the spot (centre easy, corners hard).
  const lockTarget = useCallback(() => {
    const g = gameRef.current
    if (g.phase !== 'aim') return
    g.target = { x: g.cross.x, h: g.cross.y }
    g.aimX = g.cross.x
    g.shotD = g.shotDist - RELEASE.z
    g.goalZ = g.shotDist
    g.placeDiff = placeDiffFor(g.target.x, g.target.h)
    g.solveFor = solveModeRef.current // alternate which variable the meter sets
    solveModeRef.current = g.solveFor === 'v' ? 'angle' : 'v'
    g.phase = 'meter'; g.meterStart = performance.now(); g.meterT = 0; g.meterDir = 1
    if (soundRef.current) sfx.current.ensure()
    setPhase('meter')
  }, [])

  // Lock the swinging meter. The bar always reads EASY (left) → HARD (right), so
  // powerDiff = meterT · POWER_DIFF_MAX in BOTH modes. Only the locked value's meaning differs:
  //  • velocity-locked (solve for angle): right/hard = HIGHER velocity (meterToForce rises with t).
  //  • angle-locked (solve for velocity): right/hard = LOWER angle, so we sample meterToAngle
  //    at (1 − meterT) — a higher meterT yields a lower locked angle while the bar stays easy-left.
  const lockMeter = useCallback(() => {
    const g = gameRef.current
    if (g.phase !== 'meter' || !g.target) return
    const dh = g.target.h - RELEASE.y
    if (g.solveFor === 'v') g.launchAngle = meterToAngle(1 - g.meterT, g.shotD, dh)
    else g.lockedV = meterToForce(g.meterT, g.shotD, dh)
    g.powerDiff = g.meterT * POWER_DIFF_MAX
    g.diff = clamp(g.placeDiff + g.powerDiff, 0, 1)
    g.solveMs = solveMsFor(g.diff)
    g.phase = 'solve'; g.solveStart = performance.now(); g.solveElapsedMs = 0
    setShotInfo({ d: g.shotD, h: g.target.h, x: g.target.x, angle: g.launchAngle, vGiven: g.lockedV, solveFor: g.solveFor, diff: g.diff })
    setAnswerStr('') // fresh, typed answer
    if (soundRef.current) sfx.current.whistle()
    setPhase('solve')
  }, [])

  const shoot = useCallback(() => {
    const g = gameRef.current
    if (g.phase !== 'solve' || !g.target) return
    // The meter set one variable; the typed answer is the other.
    const angleVal = g.solveFor === 'v' ? g.launchAngle : clamp(inputsRef.current.answer, 1, ANGLE_MAX)
    const f = g.solveFor === 'v' ? clamp(inputsRef.current.answer, 1, 45) : g.lockedV
    const a = (angleVal * Math.PI) / 180
    const vForward = f * Math.cos(a)
    const vUp = f * Math.sin(a)
    const tCross = vForward > 0.1 ? g.shotD / vForward : 999
    const vLat = (g.target.x - g.playerX) / tCross // auto-aimed at your chosen spot
    g.ball = { x: g.playerX, y: RELEASE.y, z: RELEASE.z, vx: vLat, vy: vUp, vz: vForward, spin: 0, squash: 0.32 }
    g.trail = []
    g.force = f; g.launchAngle = angleVal; g.resolved = false; g.phase = 'fly'

    // Predict the whole flight now so the keeper can time ONE smooth dive that meets
    // the ball exactly where/when it arrives (a save) or just misses it (a goal).
    const discG = vUp * vUp + 2 * G * (RELEASE.y - BALL_R)
    const tGround = discG >= 0 ? (vUp + Math.sqrt(discG)) / G : Infinity // descending ground-hit time
    let impactT: number, impKind: 'goal' | 'save' | 'miss', impX: number, impY: number, impZ: number
    if (tGround < tCross) {
      impactT = tGround; impKind = 'save'
      impX = g.playerX + vLat * tGround; impY = BALL_R; impZ = RELEASE.z + vForward * tGround
    } else {
      impactT = tCross; impX = g.target.x; impZ = g.goalZ
      impY = RELEASE.y + vUp * tCross - 0.5 * G * tCross * tCross
      const inFrame = impY > 0.05 && impY < CROSSBAR && Math.abs(impX) < GOAL_W_HALF - 0.05
      impKind = !inFrame ? 'miss' : Math.abs(impY - g.target.h) <= TARGET_R ? 'goal' : 'save'
    }
    // Outcome decided ONCE, here. `shotKind` is the closed-form prediction; the fly loop
    // applies it verbatim. Distance/position luck: a CORRECT shot (shotKind 'goal') only
    // beats the keeper by chance, rolled ONCE with a clean Math.random() < chance. A failed
    // roll turns it into a save (keeper catches it, no lesson). Wrong shots never roll.
    g.shotKind = impKind
    g.luckFail = false
    // First attempt (showGoal): a correct shot scores with 100% certainty (no luck roll,
    // never an "unlucky save") so RNG can't block the teaching gate. The unlimited sim
    // rolls the keeper save chance from total difficulty D — truly random, power-independent.
    if (impKind === 'goal' && !sceneRef.current.showGoal) {
      const scoreChance = 1 - saveProbFor(g.diff)
      g.luckFail = !(Math.random() < scoreChance)
    }

    g.flyT = 0; g.impactT = impactT; g.diveDur = 0.42
    g.diveStart = Math.max(0, impactT - g.diveDur)
    g.dive = impKind === 'miss' ? null
      : { dir: impX >= 0 ? 1 : -1, x: impX, y: Math.max(0.3, impY), z: impZ, t: 0, beaten: impKind === 'goal' && !g.luckFail }

    if (soundRef.current) { sfx.current.ensure(); sfx.current.kick() }
    setPhase('fly')
  }, [])

  // Sandbox shot — fires a ball with the SAME mechanics/prediction as `shoot`, but
  // keeps React `phase` on 'result' (the Remediation try-view stays mounted) and
  // flags `g.sandbox` so the fly resolver never logs an attempt or touches the
  // score. The student can shoot repeatedly to experiment.
  const sandboxShoot = useCallback((value: number) => {
    const g = gameRef.current
    // Only block while a sandbox shot is genuinely mid-flight. (Don't bail on a stale
    // `g.ball` left over from the real shot that opened the lesson — it's hidden behind
    // the arc preview, and this shot overwrites it.)
    if (!g.target || (g.sandbox && g.phase === 'fly')) return
    const angleVal = g.solveFor === 'v' ? g.launchAngle : clamp(value, 1, ANGLE_MAX)
    const f = g.solveFor === 'v' ? clamp(value, 1, 45) : g.lockedV
    const a = (angleVal * Math.PI) / 180
    const vForward = f * Math.cos(a)
    const vUp = f * Math.sin(a)
    const tCross = vForward > 0.1 ? g.shotD / vForward : 999
    const vLat = (g.target.x - g.playerX) / tCross
    g.ball = { x: g.playerX, y: RELEASE.y, z: RELEASE.z, vx: vLat, vy: vUp, vz: vForward, spin: 0, squash: 0.32 }
    g.trail = []; g.particles = []; g.netShake = 0; g.netBulge = 0
    g.force = f; g.launchAngle = angleVal
    g.resolved = false; g.caught = false; g.scored = false; g.pending = null; g.holdUntil = 0
    g.luckFail = false // sandbox practice scores deterministically (no distance luck)
    g.sandbox = true; g.sandboxResetAt = 0; g.phase = 'fly'

    const discG = vUp * vUp + 2 * G * (RELEASE.y - BALL_R)
    const tGround = discG >= 0 ? (vUp + Math.sqrt(discG)) / G : Infinity
    let impactT: number, impKind: 'goal' | 'save' | 'miss', impX: number, impY: number, impZ: number
    if (tGround < tCross) {
      impactT = tGround; impKind = 'save'
      impX = g.playerX + vLat * tGround; impY = BALL_R; impZ = RELEASE.z + vForward * tGround
    } else {
      impactT = tCross; impX = g.target.x; impZ = g.goalZ
      impY = RELEASE.y + vUp * tCross - 0.5 * G * tCross * tCross
      const inFrame = impY > 0.05 && impY < CROSSBAR && Math.abs(impX) < GOAL_W_HALF - 0.05
      impKind = !inFrame ? 'miss' : Math.abs(impY - g.target.h) <= TARGET_R ? 'goal' : 'save'
    }
    g.shotKind = impKind // sandbox scores deterministically (no luck): shotKind drives it
    g.flyT = 0; g.impactT = impactT; g.diveDur = 0.42
    g.diveStart = Math.max(0, impactT - g.diveDur)
    g.dive = impKind === 'miss' ? null
      : { dir: impX >= 0 ? 1 : -1, x: impX, y: Math.max(0.3, impY), z: impZ, t: 0, beaten: impKind === 'goal' }

    previewRef.current = { active: false, value } // hide the aiming arc while it flies
    if (soundRef.current) { sfx.current.ensure(); sfx.current.kick() }
    setSandboxBusy(true); setSandboxResult(null)
  }, [])

  // keep latest action closures for the loop
  const actions = { lockTarget, lockMeter, shoot, finishShot, sandboxShoot }
  const actionsRef = useRef(actions)
  actionsRef.current = actions

  // ===== Input =====
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      const g = gameRef.current
      const typing = (e.target as HTMLElement)?.tagName === 'INPUT'
      if ((e.key === ' ' || e.code === 'Space') && !typing) {
        e.preventDefault()
        if (g.phase === 'meter') actionsRef.current.lockMeter()
        else if (g.phase === 'solve') actionsRef.current.shoot()
        // Note: the sandbox "try for yourself" shot is CLICK-ONLY (no Space) so the
        // ball never auto-fires or repeats — the arc preview is the only default state.
      }
    }
    window.addEventListener('keydown', down)
    return () => { window.removeEventListener('keydown', down) }
  }, [])

  function onPointerMove(e: React.PointerEvent) {
    const g = gameRef.current
    const c = canvasRef.current!; const r = c.getBoundingClientRect()
    const sx = ((e.clientX - r.left) / r.width) * W
    const sy = ((e.clientY - r.top) / r.height) * H
    if (g.phase === 'aim') {
      const scale = FOCAL / Math.max(0.05, g.shotDist)
      const worldRelX = (sx - W / 2) / scale
      const worldY = EYE_Y - (sy - HORIZON) / scale
      const absX = clamp(worldRelX + g.playerX, -GOAL_W_HALF + 0.25, GOAL_W_HALF - 0.25)
      g.cross = { x: absX, y: clamp(worldY, 0.15, CROSSBAR - 0.12) }
    }
  }
  function onPointerDown(e: React.PointerEvent) {
    const g = gameRef.current
    if (g.phase === 'aim') { e.preventDefault(); lockTarget() }
    else if (g.phase === 'meter') { e.preventDefault(); lockMeter() }
  }

  // ===== Draw =====
  const draw = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const g = gameRef.current
    const now = performance.now()
    const preview = previewRef.current.active
    const goalZ = g.phase === 'fly' || g.phase === 'result' ? g.goalZ : g.distToGoal

    // High-DPI crisp rendering: size the backing store to the real displayed pixels,
    // then map the fixed logical W×H scene onto it. (This is the big sharpness win.)
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    const rect = canvas.getBoundingClientRect()
    const bw = Math.max(1, Math.round(rect.width * dpr))
    const bh = Math.max(1, Math.round(rect.height * dpr))
    if (canvas.width !== bw || canvas.height !== bh) { canvas.width = bw; canvas.height = bh }
    ctx.setTransform(canvas.width / W, 0, 0, canvas.height / H, 0, 0)
    ctx.clearRect(0, 0, W, H)

    // Scene gradients + static backdrop are built once and reused every frame.
    if (!gradRef.current) {
      const grass = ctx.createLinearGradient(0, HORIZON, 0, H)
      grass.addColorStop(0, '#1f7a37'); grass.addColorStop(1, '#2fa64e')
      const vignette = ctx.createRadialGradient(W / 2, H / 2, H * 0.32, W / 2, H / 2, H * 0.8)
      vignette.addColorStop(0, 'rgba(0,0,0,0)'); vignette.addColorStop(1, 'rgba(0,0,0,0.42)')
      gradRef.current = { grass, vignette }
    }
    if (!bgRef.current) bgRef.current = buildStaticBackground()

    ctx.save()
    if (g.netShake > 0.4) ctx.translate((Math.random() - 0.5) * g.netShake, (Math.random() - 0.5) * g.netShake)

    // ---- Sky / stadium (cached) ----
    ctx.fillStyle = '#08102a'; ctx.fillRect(-30, -30, W + 60, H + 60) // covers any shake gap
    ctx.drawImage(bgRef.current, 0, 0, W, H)

    // ---- Pitch ----
    ctx.fillStyle = gradRef.current.grass; ctx.fillRect(-30, HORIZON, W + 60, H - HORIZON + 30)
    // mow stripes by depth
    for (let zz = 0; zz < 40; zz += 2) {
      if ((Math.floor(zz / 2)) % 2 === 0) continue
      const a2 = rel(-30, 0, zz + 0.6), b2 = rel(30, 0, zz + 0.6)
      const c2 = rel(30, 0, zz + 2.6), d2 = rel(-30, 0, zz + 2.6)
      ctx.fillStyle = 'rgba(255,255,255,0.04)'
      ctx.beginPath(); ctx.moveTo(a2.sx, a2.sy); ctx.lineTo(b2.sx, b2.sy); ctx.lineTo(c2.sx, c2.sy); ctx.lineTo(d2.sx, d2.sy); ctx.closePath(); ctx.fill()
    }
    // side lines + penalty box near the goal
    ctx.strokeStyle = 'rgba(255,255,255,0.55)'; ctx.lineWidth = 2
    traceLine(ctx, rel(-GOAL_W_HALF - 5, 0, 2), rel(-GOAL_W_HALF - 5, 0, goalZ + 2))
    traceLine(ctx, rel(GOAL_W_HALF + 5, 0, 2), rel(GOAL_W_HALF + 5, 0, goalZ + 2))
    // goal line + 6-yard-ish box
    traceLine(ctx, rel(-GOAL_W_HALF - 5, 0, goalZ), rel(GOAL_W_HALF + 5, 0, goalZ))
    traceLine(ctx, rel(-GOAL_W_HALF - 2.5, 0, goalZ - 5.5), rel(GOAL_W_HALF + 2.5, 0, goalZ - 5.5))
    traceLine(ctx, rel(-GOAL_W_HALF - 2.5, 0, goalZ - 5.5), rel(-GOAL_W_HALF - 2.5, 0, goalZ))
    traceLine(ctx, rel(GOAL_W_HALF + 2.5, 0, goalZ - 5.5), rel(GOAL_W_HALF + 2.5, 0, goalZ))

    // ---- Goal + net ----
    drawGoal(ctx, rel, goalZ, Math.max(g.netShake, g.netBulge * 12))

    // ---- Keeper (idle on the line; dives to meet / just-miss the penalty) ----
    drawKeeper(ctx, rel, goalZ - 0.2, preview ? null : g.dive, now)

    // ---- Aim crosshair / target ----
    if (g.phase === 'aim') {
      const cp = rel(g.cross.x, g.cross.y, g.shotDist)
      ctx.strokeStyle = '#ffe14d'; ctx.lineWidth = 2.5
      ctx.beginPath(); ctx.arc(cp.sx, cp.sy, 16, 0, Math.PI * 2); ctx.stroke()
      ctx.beginPath()
      ctx.moveTo(cp.sx - 22, cp.sy); ctx.lineTo(cp.sx - 7, cp.sy)
      ctx.moveTo(cp.sx + 7, cp.sy); ctx.lineTo(cp.sx + 22, cp.sy)
      ctx.moveTo(cp.sx, cp.sy - 22); ctx.lineTo(cp.sx, cp.sy - 7)
      ctx.moveTo(cp.sx, cp.sy + 7); ctx.lineTo(cp.sx, cp.sy + 22)
      ctx.stroke()
      ctx.fillStyle = 'rgba(255,225,77,0.25)'; ctx.beginPath(); ctx.arc(cp.sx, cp.sy, 5, 0, Math.PI * 2); ctx.fill()
    }
    if (g.target && (g.phase === 'meter' || g.phase === 'solve' || g.phase === 'fly' || g.phase === 'result')) {
      const tp = rel(g.target.x, g.target.h, g.goalZ)
      const gp = rel(g.target.x, 0, g.goalZ)
      const rad = Math.max(6, TARGET_R * tp.scale)
      const pulse = 1 + Math.sin(now / 220) * 0.12
      // dashed height line from the ground up to the circle
      ctx.setLineDash([4, 5]); ctx.strokeStyle = 'rgba(255,225,77,0.6)'; ctx.lineWidth = 1.5
      ctx.beginPath(); ctx.moveTo(gp.sx, gp.sy); ctx.lineTo(tp.sx, tp.sy); ctx.stroke(); ctx.setLineDash([])
      // glowing pulsing scoring ring (radial-gradient glow — far cheaper than shadowBlur)
      const glowR = rad * pulse * 2.4
      const glow = ctx.createRadialGradient(tp.sx, tp.sy, rad * pulse * 0.35, tp.sx, tp.sy, glowR)
      glow.addColorStop(0, 'rgba(255,225,77,0.45)'); glow.addColorStop(0.5, 'rgba(255,225,77,0.16)'); glow.addColorStop(1, 'rgba(255,225,77,0)')
      ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(tp.sx, tp.sy, glowR, 0, Math.PI * 2); ctx.fill()
      ctx.fillStyle = 'rgba(255,225,77,0.14)'; ctx.beginPath(); ctx.arc(tp.sx, tp.sy, rad * pulse, 0, Math.PI * 2); ctx.fill()
      ctx.strokeStyle = 'rgba(255,225,77,0.98)'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(tp.sx, tp.sy, rad * pulse, 0, Math.PI * 2); ctx.stroke()
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(tp.sx, tp.sy, 3, 0, Math.PI * 2); ctx.fill()
      // big clear d / h labels next to the target
      if (g.phase === 'solve') {
        const lx = tp.sx + rad + 10 > W - 130 ? tp.sx - rad - 132 : tp.sx + rad + 10
        ctx.fillStyle = 'rgba(8,12,28,0.92)'; roundRect(ctx, lx, tp.sy - 28, 122, 52, 10); ctx.fill()
        ctx.textAlign = 'left'
        ctx.fillStyle = '#9fb4ff'; ctx.font = '600 10px Inter, sans-serif'; ctx.fillText('SOLVE FOR THIS', lx + 12, tp.sy - 14)
        ctx.fillStyle = '#7ec8ff'; ctx.font = '800 15px Plus Jakarta Sans, sans-serif'; ctx.fillText(`d = ${g.shotD.toFixed(1)} m`, lx + 12, tp.sy + 4)
        ctx.fillStyle = '#ffe14d'; ctx.fillText(`h = ${g.target.h.toFixed(2)} m`, lx + 12, tp.sy + 20)
      }
    }
    // ---- "Try for yourself" sandbox: live trajectory arc reacting to the slider ----
    if (preview && g.target) {
      drawPreviewArc(ctx, rel, g, previewRef.current.value, now)
    }

    // ---- Ball trail ---- (suppressed during the sandbox preview)
    if (!preview) for (let i = 0; i < g.trail.length; i++) {
      const tp = g.trail[i]; const p = rel(tp.x, tp.y, tp.z)
      ctx.fillStyle = `rgba(255,255,255,${(i / g.trail.length) * 0.3})`
      ctx.beginPath(); ctx.arc(p.sx, p.sy, Math.max(1.5, BALL_R * p.scale * 0.6), 0, Math.PI * 2); ctx.fill()
    }

    // ---- Ball ----
    if (preview) {
      // the sandbox draws its own animated ball along the arc; skip the frozen ball
    } else if (g.ball) {
      // World-space ball in flight / held by the keeper.
      const bx = g.ball.x, by = g.ball.y, bz = g.ball.z
      const shadow = rel(bx, 0.01, bz)
      ctx.fillStyle = 'rgba(0,0,0,0.28)'
      ctx.beginPath(); ctx.ellipse(shadow.sx, shadow.sy, BALL_R * shadow.scale * 1.2, BALL_R * shadow.scale * 0.45, 0, 0, Math.PI * 2); ctx.fill()
      const bp = rel(bx, by, bz)
      const br = Math.max(4, BALL_R * bp.scale)
      drawBall(ctx, bp.sx, bp.sy, br, g.ball.spin, g.ball.squash)
    } else {
      // The ball rests on the penalty spot until the strike — drawn low and centred in
      // the first-person view (a viewmodel ball sitting still on the turf).
      const groundY = H - 36
      const vr = 40
      const cxs = W / 2
      const cys = groundY - 6
      ctx.fillStyle = 'rgba(0,0,0,0.32)'
      ctx.beginPath(); ctx.ellipse(cxs, groundY + 8, vr * 1.15, vr * 0.34, 0, 0, Math.PI * 2); ctx.fill()
      drawBall(ctx, cxs, cys, vr, now / 400, 0)
    }

    // ---- Vignette ----
    ctx.fillStyle = gradRef.current.vignette; ctx.fillRect(-30, -30, W + 60, H + 60)

    // ---- Confetti celebration ----
    if (!preview && g.particles.length) {
      for (const p of g.particles) {
        ctx.save(); ctx.globalAlpha = clamp(p.life / p.max, 0, 1)
        ctx.translate(p.x, p.y); ctx.rotate(p.rot)
        ctx.fillStyle = p.color; ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.62)
        ctx.restore()
      }
      ctx.globalAlpha = 1
    }

    // ---- HUD ----
    ctx.textAlign = 'left'
    // Record (top-left) + session goals (top-right) only appear in the unlimited
    // practice runs. The first-run challenge shows just the "Goals 0/1" pill.
    const unlimited = !sceneRef.current.showGoal
    if (unlimited) {
      ctx.fillStyle = 'rgba(8,12,28,0.8)'; roundRect(ctx, 12, 12, 174, 40, 12); ctx.fill()
      ctx.fillStyle = '#ffd166'; ctx.font = '800 14px Plus Jakarta Sans, sans-serif'
      ctx.fillText(`🏆 Record: ${recordRef.current}`, 24, 38)
    }
    if (g.phase === 'aim') {
      const left = Math.max(0, 5 - (now - g.aimStart) / 1000)
      drawTimer(ctx, left, 5, 'Click your spot in the goal', left < 2 ? '#ff6b6b' : '#ffe14d')
    }
    if (g.phase === 'meter' && g.target) {
      // The bar reads EASY (left) → HARD (right) and intentionally hides whether it
      // sets angle or power: the player just picks a difficulty, and the locked value
      // becomes a given in the solve phase.
      drawMeter(ctx, g.meterT, 'Stop the meter to lock it in', '#cfd6ea', true)
    }
    if (g.phase === 'solve') {
      const total = g.solveMs / 1000
      const left = Math.max(0, (g.solveMs - g.solveElapsedMs) / 1000) // effective time (1.25× drain while calc open)
      const warning = left <= SOLVE_WARN_MS / 1000
      const calcLabel = showCalcRef.current ? ' (calc: 1.25× drain)' : ''
      const label = (g.solveFor === 'v' ? 'Solve for force v: SPACE to strike' : 'Solve for angle θ: SPACE to strike') + calcLabel
      drawTimer(ctx, left, total, warning ? `Hurry! ${Math.ceil(left)}s left` : label, warning ? '#ff3b5f' : '#7ec8ff', warning)
    }
    // session goals (top-right) — unlimited practice only
    if (unlimited) {
      ctx.fillStyle = 'rgba(8,12,28,0.8)'; roundRect(ctx, W - 150, 12, 138, 40, 12); ctx.fill()
      ctx.fillStyle = '#fff'; ctx.font = '700 16px Plus Jakarta Sans, sans-serif'; ctx.textAlign = 'left'
      ctx.fillText(`⚽ Goals: ${goalsRef.current}`, W - 138, 38)
    }

    ctx.restore()
  }, [rel])

  // ===== Main loop =====
  useEffect(() => {
    let last = performance.now()

    const update = (now: number, dt: number) => {
      const g = gameRef.current
      const act = actionsRef.current

      // Penalty: the player aims their spot (lazily starting the 5s aim clock), locks the
      // meter, then solves. No run-up, defenders or keeper rush-out.
      if (g.phase === 'aim') {
        if (g.aimStart === 0) g.aimStart = now
        else if (now - g.aimStart >= 5000) act.lockTarget()
      }
      if (g.phase === 'meter') {
        // ONE there-and-back sweep: SLOW (left, t=0) → FAST (right, t=1), then a single
        // rebound back toward SLOW. The speed ramps modestly from 1.0× at the slow end to
        // 1.4× near the fast end (same profile both ways), so the fast end is harder to nail.
        g.meterT += g.meterDir * dt * METER_RATE * (1 + 0.4 * g.meterT)
        if (g.meterDir === 1 && g.meterT >= 1) {
          g.meterT = 1; g.meterDir = -1 // missed the FAST end → rebound back down toward SLOW
        } else if (g.meterDir === -1 && g.meterT <= 0) {
          g.meterT = 0; act.lockMeter() // returned to SLOW unlocked → auto-lock the slowest shot
        }
      }
      if (g.phase === 'solve') {
        // Effective time spent drains 1× normally, 1.25× while the calculator is open.
        g.solveElapsedMs += dt * 1000 * (showCalcRef.current ? 1.25 : 1)
        if (g.solveElapsedMs >= g.solveMs) act.shoot()
      }

      if (g.phase === 'fly' && g.ball && !g.caught) {
        g.flyT += dt
        // ONE pre-planned dive timeline — the keeper is already moving to meet the ball.
        if (g.dive) g.dive.t = clamp((g.flyT - g.diveStart) / g.diveDur, 0, 1)

        const sub = 5, h = dt / sub
        const vx = g.ball.vz
        const t = vx > 0.1 ? g.shotD / vx : 999
        const vy0 = g.force * Math.sin((g.launchAngle * Math.PI) / 180)
        const tx = g.target?.x ?? 0, th = g.target?.h ?? 0
        for (let k = 0; k < sub && !g.resolved && !g.caught; k++) {
          const pz = g.ball.z
          g.ball.vy -= G * h
          g.ball.x += g.ball.vx * h; g.ball.y += g.ball.vy * h; g.ball.z += g.ball.vz * h
          g.ball.spin += g.ball.vz * h * 1.4
          // ground before the goal → the (already-diving) keeper gathers it on the deck
          if (g.ball.y - BALL_R <= 0 && g.ball.z < g.goalZ - 0.2) {
            const x = g.ball.x
            g.caught = true; if (g.dive) g.dive.t = 1
            g.ball.y = BALL_R; g.ball.vx = g.ball.vy = g.ball.vz = 0; g.ball.squash = 0.5
            g.pending = { res: { kind: 'save', text: g.solveFor === 'v' ? 'Dropped short: not enough force. Add more.' : 'Dropped short: flatten the angle to carry it further.' }, review: { angle: g.launchAngle, force: g.force, d: g.shotD, h: th, vx, vy: vy0, t, y: 0, dist: Math.hypot(x - tx, th), kind: 'save' } }
            g.holdUntil = now + 260
            if (soundRef.current) sfx.current.save()
            break
          }
          // Crossing the goal plane. The outcome was decided ONCE at shoot time
          // (g.shotKind + g.luckFail); we apply it here and never re-judge goal/save from
          // live physics, so shot power/speed/landing-jitter can't change the result.
          if (pz < g.goalZ && g.ball.z >= g.goalZ) {
            const y = g.ball.y, x = g.ball.x
            const dist = Math.hypot(x - tx, y - th)
            const review: Review = { angle: g.launchAngle, force: g.force, d: g.shotD, h: th, vx, vy: vy0, t, y, dist, kind: 'goal' }
            if (g.shotKind === 'miss') {
              review.kind = 'miss'
              const missText = y >= CROSSBAR ? (g.solveFor === 'v' ? 'Over the bar: too much force. Ease off.' : 'Over the bar: lower the angle.') : 'Wide of the goal: recheck your working.'
              if (g.sandbox) { setSandboxResult({ kind: 'miss', text: missText }); g.sandboxResetAt = now + 1100 } // let it sail, then back to aiming
              else { setReview(review); act.finishShot({ kind: 'miss', text: missText }) }
              break
            }
            if (g.shotKind === 'goal' && !g.luckFail) {
              // GOAL — the roll succeeded (sandbox always lands here too). The keeper's
              // already-committed dive just misses; let the ball fly into the net.
              review.kind = 'goal'
              g.scored = true
              g.pending = { res: { kind: 'goal', text: 'Buried it, past the keeper!' }, review }
              if (!g.sandbox) setReview(review)
              if (soundRef.current) sfx.current.kick()
              // no break: let the ball keep flying into the goal
            } else {
              // SAVE. Either a wrong answer (shotKind 'save') OR a correct-but-unlucky shot
              // (shotKind 'goal' + luckFail). The keeper ALWAYS catches it cleanly here,
              // regardless of how hard/fast it was struck.
              review.kind = 'save'
              const hy = Math.max(0.25, Math.min(CROSSBAR - 0.1, y))
              g.caught = true; if (g.dive) g.dive.t = 1
              g.ball.x = x; g.ball.y = hy; g.ball.z = g.goalZ - 0.06
              g.ball.vx = g.ball.vy = g.ball.vz = 0; g.ball.squash = 0
              if (g.shotKind === 'goal') {
                // correct but unlucky → dedicated message, NO lesson (`lucky` skips it)
                g.pending = { res: { kind: 'save', text: 'Unlucky, you shot it well, but the goalie saved it anyway. Aiming nearer the corners makes it harder to save.', lucky: true }, review }
              } else {
                const high = y > th
                const fix = g.solveFor === 'v' ? (high ? 'Ease the force a little.' : 'Add a little force.') : (high ? 'Lower the angle a little.' : 'Raise the angle a little.')
                g.pending = { res: { kind: 'save', text: `Saved: ${Math.abs(y - th).toFixed(2)} m too ${high ? 'high' : 'low'}. ${fix}` }, review }
              }
              g.holdUntil = now + 260
              if (soundRef.current) sfx.current.save()
              break
            }
          }
          g.trail.push({ x: g.ball.x, y: g.ball.y, z: g.ball.z })
          if (g.trail.length > 24) g.trail.shift()
        }
        if (g.ball.squash > 0) g.ball.squash *= 0.86
        if (g.ball.y - BALL_R <= 0 && g.ball.vy < 0) { g.ball.y = BALL_R; g.ball.vy *= -0.4; g.ball.vz *= 0.6; g.ball.squash = 0.5 }

        // GOAL finalize: once the ball is into the net, punch the net and celebrate.
        if (g.scored && !g.resolved && (g.ball.z >= g.goalZ + 0.85 || g.ball.y <= BALL_R + 0.02)) {
          g.ball.z = Math.min(g.ball.z, g.goalZ + 1.0)
          g.ball.vx *= 0.16; g.ball.vy *= 0.16; g.ball.vz *= 0.16; g.ball.squash = 0.4
          g.netShake = 18; g.netBulge = 1
          const gp = rel(g.target?.x ?? 0, g.target?.h ?? 1.2, g.goalZ)
          const colors = ['#ffd23f', '#ff6ec7', '#7c5cff', '#4be3c0', '#ff5b6e', '#7ef0a0']
          for (let i = 0; i < 60; i++) {
            const ang = Math.random() * Math.PI * 2
            const sp = 120 + Math.random() * 360
            g.particles.push({
              x: gp.sx + (Math.random() - 0.5) * 40, y: gp.sy + (Math.random() - 0.5) * 30,
              vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp - 160,
              life: 1.1 + Math.random() * 1.1, max: 2.2,
              color: colors[(Math.random() * colors.length) | 0],
              size: 5 + Math.random() * 7, rot: Math.random() * 6.28, vr: (Math.random() - 0.5) * 12,
            })
          }
          const p = g.pending; g.pending = null
          if (g.sandbox) {
            // GOAL in the sandbox: freeze the ball in the net, let the confetti play, and
            // raise a persistent congrats screen (clicking it calls restartRun). No re-arm.
            g.resolved = true
            setSandboxResult({ kind: 'goal', text: p?.res.text ?? 'Goal!' })
            setSandboxBusy(false)
          } else if (p) { setReview(p.review); act.finishShot(p.res) }
        }
      }

      // confetti + net relaxation
      if (g.particles.length) {
        for (const p of g.particles) { p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 760 * dt; p.life -= dt; p.rot += p.vr * dt }
        g.particles = g.particles.filter((p) => p.life > 0)
      }
      if (g.netBulge > 0.01) g.netBulge *= 0.9; else g.netBulge = 0

      // reveal the save popup a beat after the keeper has gathered the ball
      if (g.pending && !g.scored && g.holdUntil > 0 && now >= g.holdUntil) {
        const p = g.pending; g.pending = null; g.holdUntil = 0
        if (g.sandbox) { setSandboxResult({ kind: 'save', text: p.res.text }); g.sandboxResetAt = now + 900 } // show the save, then back to aiming
        else if (p.res.lucky) { setReview(null); act.finishShot(p.res) } // correct-but-unlucky: simple retry card, no lesson
        else { setReview(p.review); act.finishShot(p.res) }
      }

      // Sandbox miss/save: after the shot resolves, clear it and return to the AIMING
      // view (slider + arc) so the student can adjust and shoot again — until the 120s
      // learning timer runs out. (A goal never schedules this; its congrats persists.)
      if (g.sandbox && g.sandboxResetAt > 0 && now >= g.sandboxResetAt) {
        g.ball = null; g.dive = null; g.trail = []; g.particles = []
        g.scored = false; g.caught = false; g.resolved = false; g.pending = null
        g.holdUntil = 0; g.netShake = 0; g.netBulge = 0
        g.phase = 'result'; g.sandboxResetAt = 0
        previewRef.current = { active: true, value: previewRef.current.value }
        setSandboxBusy(false)
      }
      if (g.netShake > 0) g.netShake *= 0.85
    }

    const loop = (now: number) => {
      const dt = Math.min(0.04, (now - last) / 1000); last = now
      update(now, dt)
      draw()
      rafRef.current = requestAnimationFrame(loop)
    }
    rafRef.current = requestAnimationFrame(loop)
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current) }
  }, [draw])

  useEffect(() => () => { if (timeoutRef.current) window.clearTimeout(timeoutRef.current) }, [])

  function toggleSound() { setSound((v) => { if (!v) sfx.current.ensure(); return !v }) }

  return (
    <div className={`sim soccer${phase === 'solve' ? ' soccer--solving' : ''}`}>
      <div className="soccer__stage">
        <canvas
          ref={canvasRef}
          width={W}
          height={H}
          className={`soccer__canvas soccer__canvas--${phase}`}
          onPointerMove={onPointerMove}
          onPointerDown={onPointerDown}
        />
        <button type="button" className="soccer__sound" onClick={toggleSound} aria-label="Toggle sound">{sound ? '🔊' : '🔈'}</button>
        {message && message.kind === 'goal' && (
          <div className="soccer__banner soccer__banner--goal">
            <strong>GOAL!</strong>
            <span>{message.text}</span>
          </div>
        )}
        {phase === 'aim' && (
          <div className="soccer__prompt">Penalty kick! Click the spot in the goal you want to hit. Corners are tougher to save, but harder to solve.</div>
        )}
        {phase === 'meter' && (
          <div className="soccer__prompt">
            Meter sweeps EASY → HARD, then rebounds once back to EASY. <kbd>Space</kbd> or click to lock it (miss it and it returns to EASY and locks there). Your pick becomes a given; then solve for the rest.
          </div>
        )}
        {phase === 'solve' && showCalc && <Calculator onClose={() => setShowCalc(false)} />}

        {phase === 'result' && message && message.kind !== 'goal' && (
          review && shotInfo ? (
            <Remediation review={review} shotInfo={shotInfo} kind={message.kind} onDone={restartRun} setPreview={setPreview} onShoot={(v) => actionsRef.current.sandboxShoot(v)} sandboxBusy={sandboxBusy} sandboxResult={sandboxResult} />
          ) : (
            <div className="soccer__overlay" onClick={restartRun}>
              <div className="soccer__overlay-card" onClick={(e) => e.stopPropagation()}>
                <div className="soccer__overlay-emoji">{message.kind === 'save' ? '🧤' : '❌'}</div>
                <h3>{message.kind === 'save' ? 'Keeper saves it' : 'No goal'}</h3>
                <p className="soccer__overlay-msg">{message.text}</p>
                <button type="button" className="btn btn--primary" onClick={restartRun}>Try again</button>
                <span className="soccer__overlay-hint">click anywhere to retry</span>
              </div>
            </div>
          )
        )}
      </div>

      <div className="soccer__side">
      {phase === 'solve' && shotInfo && (() => {
        // Scaffolding scales with difficulty D: easy shots get the full method + numeric
        // aids; medium shots get the method formulas only; hard shots get nothing (recall
        // it yourself or pay the calculator's 1.25× time cost). The answer/formula are
        // unchanged — only how much help is shown.
        const scaffold = shotInfo.diff < 0.33 ? 'full' : shotInfo.diff <= 0.66 ? 'partial' : 'none'
        const th = (shotInfo.angle * Math.PI) / 180
        return (
        <>
          <div className="soccer__givens">
            <div className="is-key"><span>Distance</span><strong>d = {shotInfo.d.toFixed(1)} m</strong></div>
            <div className="is-key"><span>Target height</span><strong>h = {shotInfo.h.toFixed(2)} m</strong></div>
            {shotInfo.solveFor === 'v' ? (
              <div className="is-key"><span>Your angle (locked)</span><strong>θ = {shotInfo.angle.toFixed(1)}°</strong></div>
            ) : (
              <div className="is-key"><span>Your power (locked)</span><strong>v = {shotInfo.vGiven.toFixed(1)} m/s</strong></div>
            )}
            <div><span>Release height</span><strong>h₀ = {RELEASE.y.toFixed(2)} m</strong></div>
            <div><span>Gravity</span><strong>g = 9.8 m/s²</strong></div>
          </div>
          <div className="soccer__method">
            <div className="soccer__method-head">
              <span>{shotInfo.solveFor === 'v' ? 'Solve for the strike force v' : 'Solve for the launch angle θ'}</span>
              <button type="button" className="soccer__calc-toggle" onClick={() => setShowCalc((v) => !v)}>🧮 {showCalc ? 'Hide' : 'Calc'}</button>
            </div>
            {scaffold !== 'none' && (
              <div className="soccer__steps">
                <code>vₓ = v·cosθ&nbsp;&nbsp;&nbsp;v_y = v·sinθ</code>
                <code>t = d / vₓ</code>
                <code>y = h₀ + v_y·t − ½·g·t²&nbsp;&nbsp;⟶&nbsp;set y = h</code>
              </div>
            )}
            {scaffold === 'full' && (
              shotInfo.solveFor === 'v' ? (
                <div className="soccer__steps">
                  <code>sin θ ≈ {Math.sin(th).toFixed(2)}&nbsp;&nbsp;&nbsp;cos θ ≈ {Math.cos(th).toFixed(2)}</code>
                  <code>plug θ in, set y = h, solve for v</code>
                </div>
              ) : (
                <div className="soccer__steps">
                  <code>t = d / (v·cosθ)</code>
                  <code>set y = h ⟶ quadratic in tanθ, solve for θ</code>
                </div>
              )
            )}
            {scaffold === 'none' && (
              <p className="soccer__tip">Hard shot: no hints. Recall the method, or open the calculator (it drains time 1.25×).</p>
            )}
            <div className="soccer__inputs">
              <label className="soccer__field">
                <span>{shotInfo.solveFor === 'v' ? 'Strike force v (m/s)' : 'Launch angle θ (°)'}</span>
                <input type="text" inputMode="decimal" value={answerStr} placeholder={(shotInfo.solveFor === 'v' ? answerForce(shotInfo.d, shotInfo.h - RELEASE.y, shotInfo.angle) : answerAngle(shotInfo.d, shotInfo.h - RELEASE.y, shotInfo.vGiven)).toFixed(1)} onChange={(e) => setAnswerStr(e.target.value)} />
              </label>
            </div>
          </div>
        </>
        )
      })()}

      <div className="sim__controls">
        <div className="soccer__buttons">
          {phase === 'meter' && <button type="button" className="btn btn--primary" onClick={lockMeter}>Lock it (Space)</button>}
          {phase === 'solve' && <button type="button" className="btn btn--primary" onClick={shoot} disabled={!answerStr}>Strike</button>}
          {(phase === 'aim' || phase === 'fly' || phase === 'result') && <button type="button" className="btn btn--primary" disabled>{phase === 'aim' ? 'Pick a spot…' : phase === 'fly' ? 'Ball in flight…' : '…'}</button>}
          <button type="button" className="btn btn--ghost" onClick={restartRun}>↻ Restart</button>
        </div>
      </div>
      </div>
    </div>
  )
}

// Shown when a shot is NOT a goal. Two views share one mounted component (so the
// "time spent learning" timer keeps running across both):
//   • 'lesson' — a big, animated, screen-filling explanation that teaches how to
//     reach the correct answer for THIS shot (the live scene is hidden behind it).
//   • 'try'   — puts the student back into the shot framing (real goal + glowing
//     ring) with a slider that drives a live ball-trajectory arc on the canvas.
// Everything is read-only: it reuses the same projectile equations and never
// records an attempt or touches the score/grading.
function Remediation({
  review, shotInfo, kind, onDone, setPreview, onShoot, sandboxBusy, sandboxResult,
}: {
  review: Review
  shotInfo: { d: number; h: number; x: number; angle: number; vGiven: number; solveFor: 'v' | 'angle' }
  kind: 'goal' | 'save' | 'miss'
  onDone: () => void
  setPreview: (p: { active: boolean; value: number } | null) => void
  onShoot: (value: number) => void
  sandboxBusy: boolean
  sandboxResult: { kind: 'goal' | 'save' | 'miss'; text: string } | null
}) {
  const solveFor = shotInfo.solveFor
  const d = shotInfo.d
  const h = shotInfo.h
  const h0 = RELEASE.y
  const dh = h - h0
  // The meter LOCKED one variable; the player was solving for the other.
  const fixedAngle = shotInfo.angle   // locked angle (when solving for force)
  const fixedForce = shotInfo.vGiven  // locked force (when solving for angle)
  const correct = solveFor === 'v' ? answerForce(d, dh, fixedAngle) : answerAngle(d, dh, fixedForce)
  const used = solveFor === 'v' ? review.force : review.angle
  const unit = solveFor === 'v' ? 'm/s' : '°'
  const varName = solveFor === 'v' ? 'force v' : 'angle θ'

  // Analytic y at the goal plane for a candidate value of the solved variable.
  const predict = (value: number) => {
    const v = solveFor === 'v' ? value : fixedForce
    const thDeg = solveFor === 'v' ? fixedAngle : value
    const th = (thDeg * Math.PI) / 180
    const vx = v * Math.cos(th)
    const t = vx > 0.1 ? d / vx : 999
    const y = h0 + v * Math.sin(th) * t - 0.5 * G * t * t
    return { v, thDeg, vx, t, y }
  }

  const [view, setView] = useState<'lesson' | 'try'>('lesson')
  const [stepIdx, setStepIdx] = useState(0) // paced reveal of the worked steps
  const [val, setVal] = useState(used)
  // Fill-the-blank checkpoints: the student PICKS a value to drop into the equation's
  // blank, then presses "Check answer". `answered[i]` gates leaving step i; `checked`
  // means Check was pressed for the current step; `revealed` shows the worked solution
  // (auto on a wrong computed step, on-demand for the final knowledge gate).
  const [answered, setAnswered] = useState<boolean[]>(() => Array(6).fill(false))
  const [pick, setPick] = useState<number | null>(null)
  const [checked, setChecked] = useState(false)
  const [revealed, setRevealed] = useState(false)
  const [showLessonCalc, setShowLessonCalc] = useState(false)
  // Random (but stable-per-mount) correct-answer slot for each step's MCQ, so the right
  // option isn't in a predictable left/middle/right cycle. 6 steps, 3 options each.
  const slots = useMemo(() => Array.from({ length: 6 }, () => Math.floor(Math.random() * 3)), [])
  useEffect(() => { setPick(null); setChecked(false); setRevealed(false) }, [stepIdx])
  const live = predict(val)
  const inRing = Math.abs(live.y - h) <= TARGET_R

  // "What went wrong" verdict is about the shot the PLAYER actually took (the miss),
  // NOT the worked walkthrough below (which teaches the correct, scoring shot).
  const missShot = predict(used)
  const offMiss = Math.abs(missShot.y - h)
  const tooLow = missShot.y < h
  const lever = solveFor === 'v'
    ? (tooLow ? 'too little force, so add more power' : 'too much force, so ease off')
    : (tooLow ? 'too shallow an angle, so raise it' : 'too steep an angle, so lower it')
  const verdict = missShot.y < 0.05
    ? `The ball dropped short: it never climbed to the goal at the target height. That's ${lever}.`
    : `Your shot crossed the goal ${offMiss.toFixed(2)} m ${tooLow ? 'below' : 'above'} the ${h.toFixed(2)} m target.`

  // "Time spent learning" — a fixed-duration timer that counts up across BOTH views.
  // The bar fills to full at LEARN_LIMIT; reaching the end while in the "try for
  // yourself" view auto-skips the run.
  const LEARN_LIMIT = 120 // seconds
  const [elapsed, setElapsed] = useState(0)
  useEffect(() => {
    const start = performance.now()
    const id = window.setInterval(() => setElapsed((performance.now() - start) / 1000), 100)
    return () => window.clearInterval(id)
  }, [])
  // Always clear the sandbox preview when the panel unmounts.
  useEffect(() => () => setPreview(null), [setPreview])
  // Auto-skip when the learning time runs out during the try-for-yourself view.
  useEffect(() => {
    if (view === 'try' && elapsed >= LEARN_LIMIT) onDone()
  }, [view, elapsed, onDone])
  const barPct = Math.min(100, (elapsed / LEARN_LIMIT) * 100)
  const timedOutSoon = view === 'try' && elapsed >= LEARN_LIMIT - 10

  const sliderMin = solveFor === 'v' ? 6 : 1
  const sliderMax = solveFor === 'v' ? 45 : ANGLE_MAX

  const enterTry = () => { setView('try'); setPreview({ active: true, value: val }) }
  const backToLesson = () => { setView('lesson'); setPreview({ active: false, value: val }) }
  const onSlide = (nv: number) => { setVal(nv); setPreview({ active: true, value: nv }) }

  const learnBar = (
    <div className={`soccer__learnbar${timedOutSoon ? ' is-ending' : ''}`}>
      <span>⏱ {timedOutSoon ? `Auto-skip in ${Math.max(0, Math.ceil(LEARN_LIMIT - elapsed))}s` : 'Time spent learning'}</span>
      <div className="soccer__learnbar-track"><div className="soccer__learnbar-fill" style={{ width: `${barPct}%` }} /></div>
      <span className="soccer__learnbar-num">{elapsed.toFixed(0)}s</span>
    </div>
  )

  // ---- Try-for-yourself: minimal HUD over the live scene + arc ----
  if (view === 'try') {
    // A sandbox GOAL raises a persistent congrats screen; clicking it restarts the run.
    const scored = sandboxResult?.kind === 'goal'
    const lastShot = sandboxResult && sandboxResult.kind !== 'goal' ? sandboxResult : null
    return (
      <div className="soccer__try">
        <div className="soccer__try-givens">
          <span>d = {d.toFixed(1)} m</span>
          <span>h = {h.toFixed(2)} m</span>
          <span>{solveFor === 'v' ? `θ = ${fixedAngle.toFixed(1)}° (fixed)` : `v = ${fixedForce.toFixed(1)} m/s (fixed)`}</span>
        </div>
        <div className="soccer__try-bar">
          <div className="soccer__try-top">
            <strong>🎯 Try for yourself: drag your {varName}, then shoot</strong>
            <span className={`soccer__try-verdict${inRing ? ' is-good' : ''}`}>
              {sandboxBusy
                ? '⚽ Ball in flight…'
                : inRing
                  ? '✓ Arc lands in the ring, take the shot!'
                  : live.y < 0 ? 'Falls short of the goal' : `y at goal = ${live.y.toFixed(2)} m · need ${h.toFixed(2)} m`}
            </span>
          </div>
          {lastShot && (
            <div className={`soccer__try-last soccer__try-last--${lastShot.kind}`}>
              <strong>{lastShot.kind === 'save' ? '🧤 Saved!' : '❌ No goal'}</strong> {lastShot.text} <em>(adjust and shoot again).</em>
            </div>
          )}
          <label className="slider soccer__try-slider">
            <span className="slider__label">
              <span>Your {varName}</span>
              <span className="slider__value">{val.toFixed(1)} {unit}{inRing ? '  ✓' : ''}</span>
            </span>
            <input type="range" min={sliderMin} max={sliderMax} step={0.1} value={val} disabled={sandboxBusy} onChange={(e) => onSlide(parseFloat(e.target.value))} />
          </label>
          {learnBar}
          <div className="soccer__try-actions">
            <button type="button" className="btn btn--ghost" onClick={backToLesson}>← Back to lesson</button>
            <button type="button" className="btn btn--primary soccer__try-shoot" onClick={() => onShoot(val)} disabled={sandboxBusy}>{sandboxBusy ? 'Shooting…' : '⚽ Shoot it!'}</button>
            <button type="button" className="btn btn--ghost" onClick={onDone}>Skip / restart ↻</button>
          </div>
        </div>

        {scored && (
          <div className="soccer__try-congrats" onClick={onDone}>
            <div className="soccer__try-congrats-card" onClick={(e) => e.stopPropagation()}>
              <div className="soccer__try-congrats-emoji">🎉</div>
              <h2>GOAL!</h2>
              <p>{sandboxResult?.text}</p>
              <button type="button" className="btn btn--primary soccer__try-btn" onClick={onDone}>Play a fresh run →</button>
              <span className="soccer__try-congrats-hint">click anywhere to start a new run</span>
            </div>
          </div>
        )}
      </div>
    )
  }

  // ---- Worked walkthrough built from the CORRECT, scoring shot ----
  // Single source of truth: predict(correct). Every number below is the value AS SHOWN
  // (rounded to its display precision) so each equation's displayed inputs evaluate
  // exactly to its displayed blank-answer, and the combined y lands at the target h.
  const shot = predict(correct)
  const r1 = (x: number) => Math.round(x * 10) / 10
  const r2 = (x: number) => Math.round(x * 100) / 100
  const vShown = r1(shot.v)
  const angShown = r1(shot.thDeg)
  const dShown = r1(d)
  const h0Shown = r2(h0)
  const vxShown = r2(vShown * Math.cos((angShown * Math.PI) / 180))
  const tShownNum = vxShown > 0.1 ? r2(dShown / vxShown) : 999
  const vUpShown = r2(vShown * Math.sin((angShown * Math.PI) / 180)) // v·sinθ (rise without ×t) — distractor
  const riseShown = r2(vShown * Math.sin((angShown * Math.PI) / 180) * tShownNum)
  const dropShown = r2(0.5 * G * tShownNum * tShownNum)
  const yShown = r2(h0Shown + riseShown - dropShown)
  const vStr = vShown.toFixed(1)
  const angStr = angShown.toFixed(1)
  const tStr = tShownNum > 50 ? '-' : tShownNum.toFixed(2)

  // ---- Final-step closed-form, broken into digestible sub-steps ----
  // The locked variable for the final gate (angle θ when solving for v, force v when
  // solving for θ), shown at its displayed precision and used in the intermediate maths
  // so each printed number is rounding-consistent with what the student sees.
  const hShown = r2(h)
  const thLock = r1(fixedAngle)   // locked angle (solving for v)
  const vLock = r1(fixedForce)    // locked force (solving for θ)
  const thLockStr = thLock.toFixed(1)
  const vLockStr = vLock.toFixed(1)
  const thLockRad = (thLock * Math.PI) / 180
  // Solving for v: v = √( numV / denV )
  const numV = r2(G * dShown * dShown)
  const brV = r2(dShown * Math.tan(thLockRad) + h0Shown - hShown)
  const denV = r2(2 * Math.cos(thLockRad) ** 2 * brV)
  const ratioV = denV > 0 ? r2(numV / denV) : 0
  // Solving for θ: quadratic in tanθ → A·tan²θ − d·tanθ + (h − h₀ + A) = 0, A = g·d²/(2v²)
  const aTh = vLock > 0 ? r2(G * dShown * dShown / (2 * vLock * vLock)) : 0
  const discTh = r2(dShown * dShown - 4 * aTh * (hShown - h0Shown + aTh))
  const tanTh = aTh > 0 && discTh >= 0 ? r2((dShown - Math.sqrt(Math.max(0, discTh))) / (2 * aTh)) : 0

  const mps = (x: number) => `${x.toFixed(2)} m/s`
  const sec = (x: number) => `${x.toFixed(2)} s`
  const mtr = (x: number) => `${x.toFixed(2)} m`
  const ans = (x: number) => `${x.toFixed(1)} ${unit}`
  type Opt = { label: string; correct: boolean }
  // Build 3 options from numeric values + a formatter. Any distractor whose formatted
  // label collides with the correct label (after rounding) is nudged to a clearly
  // different plausible value, so the right answer is never duplicated. `offset` rotates
  // which slot holds the correct option.
  const mkOpts = (correctVal: number, distractorVals: number[], fmt: (x: number) => string, offset: number): Opt[] => {
    const correctLabel = fmt(correctVal)
    const seen = new Set<string>([correctLabel])
    const dist: string[] = []
    for (const dv of distractorVals) {
      let v = dv
      let label = fmt(v)
      let guard = 0
      while (seen.has(label) && guard < 12) { v = v * 1.08 + 0.02; label = fmt(v); guard++ }
      seen.add(label); dist.push(label)
    }
    const opts: Opt[] = [{ label: correctLabel, correct: true }, ...dist.map((l) => ({ label: l, correct: false }))]
    const k = offset % opts.length
    return [...opts.slice(k), ...opts.slice(0, k)]
  }
  // A third decoy for the final "what actually scores" gate, kept clearly distinct.
  const thirdVal = solveFor === 'v' ? clamp(correct * 0.7, 6, 45) : clamp(correct * 0.62, 1, ANGLE_MAX)

  // Dev-only consistency assertions (guarded by import.meta.env.DEV, stripped in prod;
  // console.assert never throws). Surface drift early if the displayed terms ever stop
  // summing to the displayed answer, the walkthrough stops landing at h, or the final
  // option drifts from the grader's solution.
  if (import.meta.env.DEV) {
    const near = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol
    console.assert(near(r2(dShown / vxShown), tShownNum, 0.005), 'soccer lesson: t != d/vx (shown)')
    console.assert(near(r2(vShown * Math.sin((angShown * Math.PI) / 180) * tShownNum), riseShown, 0.005), 'soccer lesson: rise term drift')
    console.assert(near(r2(0.5 * G * tShownNum * tShownNum), dropShown, 0.005), 'soccer lesson: drop term drift')
    console.assert(near(r2(h0Shown + riseShown - dropShown), yShown, 0.005), 'soccer lesson: y != h0 + rise - drop (shown)')
    console.assert(near(shot.y, h, 0.05), `soccer lesson: walkthrough y=${shot.y.toFixed(3)} should equal target h=${h.toFixed(3)}`)
    console.assert(near(yShown, h, 0.15), `soccer lesson: shown y=${yShown} far from target h=${h.toFixed(2)}`)
    const grader = solveFor === 'v' ? answerForce(d, dh, fixedAngle) : answerAngle(d, dh, fixedForce)
    console.assert(near(correct, grader, 1e-6), 'soccer lesson: final correct option != grader solution')
    // Final-step sub-steps should reconstruct the gated answer (loose tol: intermediates
    // are rounded for display, so a little drift from the exact grader value is expected).
    if (solveFor === 'v') {
      console.assert(near(Math.sqrt(Math.max(0, ratioV)), correct, 1.0), `soccer lesson: √(numV/denV)=${Math.sqrt(Math.max(0, ratioV)).toFixed(2)} far from v=${correct.toFixed(2)}`)
    } else {
      console.assert(near((Math.atan(tanTh) * 180) / Math.PI, correct, 3), `soccer lesson: arctan(tanθ)=${((Math.atan(tanTh) * 180) / Math.PI).toFixed(2)} far from θ=${correct.toFixed(2)}`)
    }
  }

  // ---- Big animated lesson, revealed ONE worked step at a time ----
  // `card(blank)` positions the blank inside each equation; `solution` is only shown
  // after a WRONG check (computed steps) or on demand (the final gate). `gate: 'check'`
  // lets a computed step proceed once checked (the reveal teaches); `gate: 'correct'`
  // requires the right pick before advancing.
  type Step = {
    n: string; cmp?: boolean; prompt: string; options: Opt[]
    gate: 'check' | 'correct'
    card: (blank: ReactNode) => ReactNode
    solution: ReactNode
  }
  const steps: Step[] = [
    {
      n: '1', prompt: 'Drop the right value into the blank: what is the horizontal speed vₓ?',
      options: mkOpts(vxShown, [vUpShown, vShown], mps, slots[0]), gate: 'check',
      card: (blank) => (<>
        <div className="soccer__step-formula">Split the launch: vₓ = v · cosθ</div>
        <div className="soccer__step-plug">= {vStr} · cos({angStr}°) = {blank}</div>
      </>),
      solution: <>vₓ = {vStr} · cos({angStr}°) = <b>{vxShown.toFixed(2)} m/s</b></>,
    },
    {
      n: '2', prompt: 'Fill the blank: how long until the ball reaches the goal?',
      options: mkOpts(tShownNum, [r2(dShown / vShown), r2(tShownNum * 2)], sec, slots[1]), gate: 'check',
      card: (blank) => (<>
        <div className="soccer__step-formula">Time to the goal: t = d / vₓ</div>
        <div className="soccer__step-plug">= {dShown.toFixed(1)} / {vxShown.toFixed(2)} = {blank}</div>
      </>),
      solution: <>t = {dShown.toFixed(1)} / {vxShown.toFixed(2)} = <b>{tStr} s</b></>,
    },
    {
      n: '3', prompt: 'Fill the blank: how high does the ball climb (the rise term v·sinθ·t)?',
      options: mkOpts(riseShown, [vUpShown, r2(vShown * tShownNum)], mtr, slots[2]), gate: 'check',
      card: (blank) => (<>
        <div className="soccer__step-formula">Rise from the launch: rise = v · sinθ · t</div>
        <div className="soccer__step-plug">= {vStr} · sin({angStr}°) · {tStr} = {blank}</div>
      </>),
      solution: <>rise = {vStr} · sin({angStr}°) · {tStr} = <b>{riseShown.toFixed(2)} m</b></>,
    },
    {
      n: '4', prompt: 'Fill the blank: how far does gravity pull it down (the drop term ½·g·t²)?',
      options: mkOpts(dropShown, [r2(0.5 * G * tShownNum), r2(G * tShownNum * tShownNum)], mtr, slots[3]), gate: 'check',
      card: (blank) => (<>
        <div className="soccer__step-formula">Gravity drop: drop = ½ · g · t²</div>
        <div className="soccer__step-plug">= ½ · 9.8 · {tStr}² = {blank}</div>
      </>),
      solution: <>drop = ½ · 9.8 · {tStr}² = <b>{dropShown.toFixed(2)} m</b></>,
    },
    {
      n: '5', prompt: 'Fill the blank: combine the pieces, what height y is the ball at the goal?',
      options: mkOpts(yShown, [r2(h0Shown + riseShown), r2(h0Shown + riseShown + dropShown)], mtr, slots[4]), gate: 'check',
      card: (blank) => (<>
        <div className="soccer__step-formula">Combine: y = h₀ + rise − drop</div>
        <div className="soccer__step-plug">= {h0Shown.toFixed(2)} + {riseShown.toFixed(2)} − {dropShown.toFixed(2)} = {blank}</div>
      </>),
      solution: <>y = {h0Shown.toFixed(2)} + {riseShown.toFixed(2)} − {dropShown.toFixed(2)} = <b>{yShown.toFixed(2)} m</b> (this lands right at the target h = {h.toFixed(2)} m)</>,
    },
    {
      n: '★', cmp: true,
      prompt: solveFor === 'v'
        ? 'Now produce the answer: which force v actually scores this shot?'
        : 'Now produce the answer: which angle θ actually scores this shot?',
      options: mkOpts(correct, [used, thirdVal], ans, slots[5]), gate: 'correct',
      card: (blank) => (<>
        <div className="soccer__step-formula">The {varName} that lands the ball at h = {h.toFixed(2)} m</div>
        <div className="soccer__step-recap">{solveFor === 'v'
          ? <>
              <span className="soccer__recap-lead">Work it out one step at a time:</span>
              <div className="soccer__recap-eq">1) numerator: g·d² = 9.8 · {dShown.toFixed(1)}² = {numV.toFixed(2)}</div>
              <div className="soccer__recap-eq">2) bracket: d·tanθ + h₀ − h = {dShown.toFixed(1)}·tan{thLockStr}° + {h0Shown.toFixed(2)} − {hShown.toFixed(2)} = {brV.toFixed(2)}</div>
              <div className="soccer__recap-eq">3) denominator: 2·cos²θ · bracket = 2·cos²{thLockStr}° · {brV.toFixed(2)} = {denV.toFixed(2)}</div>
              <div className="soccer__recap-eq soccer__recap-eq--final">4) v = √(numerator / denominator) = √({ratioV.toFixed(2)}) = ?</div>
            </>
          : <>
              <span className="soccer__recap-lead">Quadratic in tanθ, step by step:</span>
              <div className="soccer__recap-eq">1) A = g·d² / (2·v²) = 9.8·{dShown.toFixed(1)}² / (2·{vLockStr}²) = {aTh.toFixed(2)}</div>
              <div className="soccer__recap-eq">2) disc = d² − 4·A·(h − h₀ + A) = {discTh.toFixed(2)}</div>
              <div className="soccer__recap-eq">3) tanθ = (d − √disc) / (2·A) = {tanTh.toFixed(3)}</div>
              <div className="soccer__recap-eq soccer__recap-eq--final">4) θ = arctan({tanTh.toFixed(3)}) = ?</div>
            </>}</div>
        <div className="soccer__step-plug">{solveFor === 'v' ? 'v' : 'θ'} = {blank}</div>
      </>),
      solution: <>Solving the projectile equation for {varName} with d = {d.toFixed(1)} m, h = {h.toFixed(2)} m{solveFor === 'v' ? <> and θ = {fixedAngle.toFixed(1)}°</> : <> and v = {fixedForce.toFixed(1)} m/s</>} gives <b>{correct.toFixed(1)} {unit}</b>.</>,
    },
  ]
  const N = steps.length
  const cur = steps[stepIdx]
  const last = stepIdx === N - 1
  const stepDone = answered[stepIdx]
  const pickedOpt = pick === null ? null : cur.options[pick]
  const pickedCorrect = !!pickedOpt?.correct

  // Pick a value for the blank (re-arms Check). Locked once the step is satisfied.
  const choose = (i: number) => {
    if (stepDone) return
    setPick(i); setChecked(false)
  }
  // Grade the picked value. Computed steps proceed either way (a wrong check reveals the
  // worked solution to learn from); the final gate only proceeds when correct.
  const checkAnswer = () => {
    if (pick === null || stepDone) return
    setChecked(true)
    if (pickedCorrect) {
      setAnswered((a) => { const b = [...a]; b[stepIdx] = true; return b })
    } else if (cur.gate === 'check') {
      setRevealed(true)
      setAnswered((a) => { const b = [...a]; b[stepIdx] = true; return b })
    }
  }
  // The value shown inside the equation blank, styled by check state.
  const blankSlot: ReactNode = pick === null
    ? <span className="soccer__blank">?</span>
    : <span className={`soccer__blank soccer__blank--filled${checked ? (pickedCorrect ? ' soccer__blank--ok' : ' soccer__blank--no') : ''}`}>{pickedOpt!.label}{checked ? (pickedCorrect ? ' ✓' : ' ✗') : ''}</span>
  const showSolution = revealed || (checked && !pickedCorrect && cur.gate === 'check')

  return (
    <div className="soccer__lesson">
      <div className="soccer__lesson-inner">
        <div className="soccer__lesson-head">
          <div className="soccer__lesson-emoji">{kind === 'save' ? '🧤' : '😖'}</div>
          <div>
            <h2 className="soccer__lesson-title">{kind === 'save' ? 'Keeper saved it!' : 'Just missed!'}</h2>
            <p className="soccer__lesson-sub">{verdict}</p>
          </div>
        </div>

        <div className="soccer__lesson-chips">
          <div className="chip"><span>distance</span><strong>d = {d.toFixed(1)} m</strong></div>
          <div className="chip"><span>target height</span><strong>h = {h.toFixed(2)} m</strong></div>
          <div className="chip"><span>release</span><strong>h₀ = {h0.toFixed(2)} m</strong></div>
          <div className="chip"><span>gravity</span><strong>g = 9.8 m/s²</strong></div>
          <div className="chip chip--lock">
            <span>{solveFor === 'v' ? 'locked angle' : 'locked power'}</span>
            <strong>{solveFor === 'v' ? `θ = ${fixedAngle.toFixed(1)}°` : `v = ${fixedForce.toFixed(1)} m/s`}</strong>
          </div>
        </div>

        <div className="soccer__stepper">
          <div className="soccer__stepper-progress">
            <span>Step {stepIdx + 1} of {N}</span>
            <div className="soccer__stepper-dots">
              {steps.map((_, i) => <i key={i} className={i === stepIdx ? 'is-on' : i < stepIdx ? 'is-done' : ''} />)}
            </div>
          </div>
          {/* keyed so each reveal replays the big cartoonish swap animation. The result
              is a BLANK the student fills by picking below, then checking. */}
          <div key={stepIdx} className={`soccer__step soccer__step--big${cur.cmp ? ' soccer__step--cmp' : ''}`}>
            <span className="soccer__step-n">{cur.n}</span>
            <div className="soccer__step-body">{cur.card(blankSlot)}</div>
          </div>

          {/* Worked solution: revealed only after a wrong computed check, or on demand */}
          {showSolution && (
            <div className="soccer__solution">
              <span className="soccer__solution-tag">Here's the working</span>
              <div className="soccer__solution-body">{cur.solution}</div>
            </div>
          )}

          {/* Fill-the-blank checkpoint */}
          <div key={`q${stepIdx}`} className="soccer__quiz">
            <div className="soccer__quiz-q">
              <span className="soccer__quiz-tag">{last ? 'Solve it' : 'Fill the blank'}</span>
              {cur.prompt}
            </div>
            <div className="soccer__quiz-opts">
              {cur.options.map((o, i) => {
                const chosen = pick === i
                const state = chosen
                  ? (checked ? (o.correct ? ' is-correct' : ' is-wrong') : ' is-picked')
                  : (stepDone && o.correct ? ' is-correct' : '')
                return (
                  <button key={i} type="button" className={`soccer__quiz-opt${state}`} onClick={() => choose(i)} disabled={stepDone}>
                    <span className="soccer__quiz-key">{String.fromCharCode(65 + i)}</span>{o.label}
                  </button>
                )
              })}
            </div>
            <div className="soccer__quiz-foot">
              <span className={`soccer__quiz-fb${!checked ? '' : pickedCorrect ? ' is-good' : ' is-bad'}`}>
                {!checked
                  ? (pick === null ? 'Pick the value for the blank, then check it.' : 'Locked in? Hit "Check answer".')
                  : pickedCorrect
                    ? (last ? '✓ Correct! You worked out the answer yourself.' : '✓ Correct! On you go.')
                    : cur.gate === 'check'
                      ? '✗ Not quite. Study the working below, then continue.'
                      : '✗ Not quite. Try again, or reveal the worked solution.'}
              </span>
              <div className="soccer__quiz-actions">
                {cur.gate === 'correct' && checked && !pickedCorrect && !revealed && (
                  <button type="button" className="btn btn--ghost soccer__quiz-calc" onClick={() => setRevealed(true)}>Reveal solution</button>
                )}
                <button type="button" className="btn btn--ghost soccer__quiz-calc" onClick={() => setShowLessonCalc((s) => !s)}>🧮 {showLessonCalc ? 'Hide' : 'Calculator'}</button>
                <button type="button" className="btn btn--primary soccer__quiz-check" onClick={checkAnswer} disabled={pick === null || stepDone}>{stepDone ? 'Checked ✓' : 'Check answer'}</button>
              </div>
            </div>
          </div>
        </div>

        {showLessonCalc && <Calculator onClose={() => setShowLessonCalc(false)} />}

        <div className="soccer__lesson-foot">
          {learnBar}
          <div className="soccer__lesson-actions">
            <button type="button" className="btn btn--ghost" onClick={() => setStepIdx((i) => Math.max(0, i - 1))} disabled={stepIdx === 0}>← Back</button>
            {!last ? (
              <button type="button" className="btn btn--primary soccer__try-btn" onClick={() => setStepIdx((i) => Math.min(N - 1, i + 1))} disabled={!stepDone}>{stepDone ? 'Next →' : 'Answer to continue'}</button>
            ) : (
              <>
                <button type="button" className="btn btn--ghost" onClick={onDone}>Skip explanation</button>
                <button type="button" className="btn btn--primary soccer__try-btn" onClick={enterTry} disabled={!stepDone}>⚽ Try for yourself →</button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ===== Drawing helpers =====
type RelFn = (absX: number, y: number, z: number) => P2

function traceLine(ctx: CanvasRenderingContext2D, a: P2, b: P2) {
  ctx.beginPath(); ctx.moveTo(a.sx, a.sy); ctx.lineTo(b.sx, b.sy); ctx.stroke()
}

function drawGoal(ctx: CanvasRenderingContext2D, rel: RelFn, z: number, shake: number) {
  const back = z + 1.1
  const tl = rel(-GOAL_W_HALF, CROSSBAR, z), tr = rel(GOAL_W_HALF, CROSSBAR, z)
  const bl = rel(-GOAL_W_HALF, 0, z), br = rel(GOAL_W_HALF, 0, z)
  const tlB = rel(-GOAL_W_HALF, CROSSBAR, back), trB = rel(GOAL_W_HALF, CROSSBAR, back)
  const blB = rel(-GOAL_W_HALF, 0, back), brB = rel(GOAL_W_HALF, 0, back)
  // net mesh (back + roof)
  ctx.strokeStyle = 'rgba(255,255,255,0.18)'; ctx.lineWidth = 1
  for (let i = 0; i <= 10; i++) {
    const t = i / 10
    traceLine(ctx, lerpP(tlB, trB, t), lerpP(blB, brB, t))
    traceLine(ctx, lerpP(tlB, blB, t), lerpP(trB, brB, t))
  }
  // connect front frame to back (depth)
  ctx.strokeStyle = 'rgba(255,255,255,0.12)'
  traceLine(ctx, tl, tlB); traceLine(ctx, tr, trB); traceLine(ctx, bl, blB); traceLine(ctx, br, brB)
  // shake ripple hint
  if (shake > 0.4) { ctx.strokeStyle = 'rgba(255,255,255,0.4)'; for (let i = 1; i < 5; i++) traceLine(ctx, lerpP(tlB, trB, i / 5), lerpP(blB, brB, i / 5)) }
  // posts + crossbar (front frame, bright)
  ctx.strokeStyle = '#ffffff'; ctx.lineWidth = Math.max(4, 0.1 * tl.scale); ctx.lineCap = 'round'
  traceLine(ctx, bl, tl); traceLine(ctx, br, tr); traceLine(ctx, tl, tr)
  ctx.lineCap = 'butt'
}

// (drawHair + drawRunner — the outfield-defender figures — were archived to
// dribbleRunup.archive.txt when this sim became a penalty shootout.)

// The goalkeeper: a ready stance that shuffles, then a dramatic dive on a save.
function drawKeeper(ctx: CanvasRenderingContext2D, rel: RelFn, z: number, dive: { dir: number; t: number; x: number; y: number; z: number; beaten?: boolean } | null, now: number, rush: { x: number; z: number; carrying: boolean; intensity?: number } | null = null) {
  const baseFeet = rel(0, 0, z)
  const scale = baseFeet.scale
  const wBody = Math.max(5, 0.4 * scale)
  if (rush) {
    // The keeper sprints off his line toward the loose ball, scoops it, and jogs
    // back — drawn as a running GK figure (kit + padded gloves) at the rush position.
    const feet = rel(rush.x, 0, rush.z), head = rel(rush.x, 1.78, rush.z)
    const s = feet.scale
    // `intensity` (0→1→0 across the trip) eases the run cycle in and out so the
    // legs don't pop straight to full-speed pumping; tie the stride rate to it too.
    const intensity = rush.intensity ?? 1
    const ph = now / 70
    const bob = Math.abs(Math.sin(ph)) * 0.06 * s * intensity
    const cx = feet.sx
    const footY = feet.sy - bob, headY = head.sy - bob
    const hipY = headY + (footY - headY) * 0.5
    const shoulderY = headY + (footY - headY) * 0.28
    const w = Math.max(6, 0.42 * s)
    const swing = Math.sin(ph) * 0.3 * s * intensity
    const liftL = Math.max(0, Math.cos(ph)) * 0.16 * s * intensity
    const lw = Math.max(3, 0.15 * s)
    const headR = Math.max(4, 0.18 * s)
    const torsoH = hipY - shoulderY + 2
    ctx.fillStyle = 'rgba(0,0,0,0.26)'
    ctx.beginPath(); ctx.ellipse(cx, feet.sy + 1, w, w * 0.32, 0, 0, Math.PI * 2); ctx.fill()
    ctx.lineCap = 'round'
    // legs (GK socks) + boots
    ctx.strokeStyle = GK_KIT.sock; ctx.lineWidth = lw
    ctx.beginPath(); ctx.moveTo(cx, hipY); ctx.lineTo(cx - swing, footY - liftL); ctx.stroke()
    ctx.beginPath(); ctx.moveTo(cx, hipY); ctx.lineTo(cx + swing, footY); ctx.stroke()
    ctx.fillStyle = GK_KIT.boot
    ctx.beginPath(); ctx.ellipse(cx + swing, footY, lw * 0.8, lw * 0.45, 0, 0, Math.PI * 2); ctx.fill()
    ctx.beginPath(); ctx.ellipse(cx - swing, footY - liftL, lw * 0.8, lw * 0.45, 0, 0, Math.PI * 2); ctx.fill()
    // shorts band
    const shortsH = Math.max(3, torsoH * 0.32)
    ctx.fillStyle = GK_KIT.shorts; roundRect(ctx, cx - w / 2, hipY - shortsH * 0.55, w, shortsH, Math.max(2, w * 0.18)); ctx.fill()
    // jersey
    ctx.fillStyle = GK_KIT.jersey; roundRect(ctx, cx - w / 2, shoulderY, w, torsoH, Math.max(2, w * 0.3)); ctx.fill()
    ctx.fillStyle = GK_KIT.jerseyDark; ctx.fillRect(cx + w * 0.16, shoulderY + 2, w * 0.34, torsoH - 2)
    // arms reach down to the ball, or cradle it at the chest once carrying
    const handY = rush.carrying ? shoulderY + w * 0.72 : footY - liftL * 0.5
    const armW = Math.max(2.5, 0.11 * s)
    ctx.strokeStyle = GK_KIT.skin; ctx.lineWidth = armW
    ctx.beginPath(); ctx.moveTo(cx - w * 0.42, shoulderY + 3); ctx.lineTo(cx - w * 0.22, handY); ctx.stroke()
    ctx.beginPath(); ctx.moveTo(cx + w * 0.42, shoulderY + 3); ctx.lineTo(cx + w * 0.22, handY); ctx.stroke()
    const gloveR = Math.max(3.5, w * 0.4)
    for (const gx of [cx - w * 0.22, cx + w * 0.22]) {
      ctx.fillStyle = GK_KIT.gloveCuff; ctx.beginPath(); ctx.arc(gx, handY, gloveR * 1.18, 0, Math.PI * 2); ctx.fill()
      ctx.fillStyle = GK_KIT.glove; ctx.strokeStyle = '#c3cad6'; ctx.lineWidth = 1.5
      ctx.beginPath(); ctx.arc(gx, handY, gloveR, 0, Math.PI * 2); ctx.fill(); ctx.stroke()
    }
    if (rush.carrying) drawBall(ctx, cx, handY, Math.max(4, BALL_R * s), now / 200, 0)
    // head + short hair
    ctx.fillStyle = GK_KIT.skin; ctx.beginPath(); ctx.arc(cx, headY, headR, 0, Math.PI * 2); ctx.fill()
    ctx.fillStyle = '#2c2016'; ctx.beginPath(); ctx.arc(cx, headY - headR * 0.18, headR, Math.PI * 1.04, Math.PI * 1.96); ctx.fill()
    ctx.lineCap = 'butt'
    return
  }
  if (dive) {
    // A real dive: the keeper launches off the ground and his whole body (fixed
    // length, not stretched) leaps across and rotates from upright to horizontal,
    // arms reaching out so the gloves land right on the ball.
    const e = 1 - Math.pow(1 - dive.t, 2) // ease-out
    const sp = rel(dive.x, Math.max(0.3, dive.y), dive.z) // the ball / save point (may be off the line)
    const base = rel(0, 0.95, z) // standing chest height
    // stretching ground shadow as he leaves his feet
    const gsh = rel(dive.x * e, 0.01, z)
    ctx.save(); ctx.fillStyle = 'rgba(0,0,0,0.2)'
    ctx.beginPath(); ctx.ellipse(gsh.sx, baseFeet.sy, wBody * (1 + e * 0.8), wBody * 0.36, 0, 0, Math.PI * 2); ctx.fill(); ctx.restore()
    const L = Math.max(16, wBody * 2.6) // constant torso length
    const lift = Math.sin(Math.PI * Math.min(1, e)) * wBody * 1.5 // leap off the turf
    // body centre travels ~80% of the way (arms cover the rest) along a leap arc
    const beaten = !!dive.beaten
    // On a GOAL the keeper guesses, commits fully, and comes up SHORT and LOW — so the
    // ball flies clean over his outstretched gloves. Aim the whole dive at a clear miss.
    const aim = beaten ? rel(dive.x * 0.58, Math.max(0.2, dive.y - 0.95), dive.z) : sp
    const cx = base.sx + (aim.sx - base.sx) * e * 0.8
    const cy = base.sy + (aim.sy - base.sy) * e * 0.8 - lift
    const gx = base.sx + (aim.sx - base.sx) * e
    const gy = base.sy + (aim.sy - base.sy) * e - lift * 0.4
    // rotate from upright (−90°) toward the dive aim
    const targetAng = Math.atan2(aim.sy - base.sy, aim.sx - base.sx)
    const ang = -Math.PI / 2 + (targetAng + Math.PI / 2) * e
    const leadX = cx + Math.cos(ang) * L * 0.5, leadY = cy + Math.sin(ang) * L * 0.5
    const tailX = cx - Math.cos(ang) * L * 0.5, tailY = cy - Math.sin(ang) * L * 0.5
    const perp = ang + Math.PI / 2
    ctx.lineCap = 'round'
    // trailing legs (GK socks) kicking up behind
    ctx.strokeStyle = GK_KIT.sock; ctx.lineWidth = Math.max(3, 0.13 * scale)
    ctx.beginPath(); ctx.moveTo(tailX, tailY); ctx.lineTo(tailX - Math.cos(ang) * wBody * 1.3 + Math.cos(perp) * wBody * 0.5, tailY - Math.sin(ang) * wBody * 1.3 + Math.sin(perp) * wBody * 0.5); ctx.stroke()
    ctx.beginPath(); ctx.moveTo(tailX, tailY); ctx.lineTo(tailX - Math.cos(ang) * wBody * 1.5 - Math.cos(perp) * wBody * 0.5, tailY - Math.sin(ang) * wBody * 1.5 - Math.sin(perp) * wBody * 0.5); ctx.stroke()
    // torso (constant length capsule) in the GK kit, with a shade stripe
    ctx.save(); ctx.translate(cx, cy); ctx.rotate(ang)
    ctx.fillStyle = GK_KIT.jersey; roundRect(ctx, -L / 2, -wBody * 0.55, L, wBody * 1.1, wBody * 0.5); ctx.fill()
    ctx.fillStyle = GK_KIT.jerseyDark; ctx.fillRect(-L / 2 + 2, wBody * 0.1, L - 4, wBody * 0.34)
    ctx.restore()
    // head at the leading end
    ctx.fillStyle = GK_KIT.skin; ctx.beginPath(); ctx.arc(leadX, leadY, Math.max(3, 0.17 * scale), 0, Math.PI * 2); ctx.fill()
    // arms + emphasised padded gloves (white pad, coloured cuff)
    const shx = cx + Math.cos(ang) * L * 0.32, shy = cy + Math.sin(ang) * L * 0.32
    const gloveR = Math.max(4.5, wBody * 0.7)
    const drawGlove = (px: number, py: number) => {
      ctx.fillStyle = GK_KIT.gloveCuff; ctx.beginPath(); ctx.arc(px, py, gloveR * 1.18, 0, Math.PI * 2); ctx.fill()
      ctx.fillStyle = GK_KIT.glove; ctx.strokeStyle = '#c3cad6'; ctx.lineWidth = 2
      ctx.beginPath(); ctx.arc(px, py, gloveR, 0, Math.PI * 2); ctx.fill(); ctx.stroke()
    }
    ctx.strokeStyle = GK_KIT.jersey; ctx.lineWidth = Math.max(3, 0.12 * scale)
    if (beaten) {
      // arms flung wide, gloves grasping at thin air as the ball beats him
      const spread = wBody * 1.05
      const g1x = gx + Math.cos(perp) * spread, g1y = gy + Math.sin(perp) * spread
      const g2x = gx - Math.cos(perp) * spread, g2y = gy - Math.sin(perp) * spread
      ctx.beginPath(); ctx.moveTo(shx + Math.cos(perp) * wBody * 0.3, shy + Math.sin(perp) * wBody * 0.3); ctx.lineTo(g1x, g1y); ctx.stroke()
      ctx.beginPath(); ctx.moveTo(shx - Math.cos(perp) * wBody * 0.3, shy - Math.sin(perp) * wBody * 0.3); ctx.lineTo(g2x, g2y); ctx.stroke()
      drawGlove(g1x, g1y); drawGlove(g2x, g2y)
    } else {
      // both gloves clamp onto the ball
      ctx.beginPath(); ctx.moveTo(shx + Math.cos(perp) * wBody * 0.3, shy + Math.sin(perp) * wBody * 0.3); ctx.lineTo(gx, gy); ctx.stroke()
      ctx.beginPath(); ctx.moveTo(shx - Math.cos(perp) * wBody * 0.3, shy - Math.sin(perp) * wBody * 0.3); ctx.lineTo(gx, gy); ctx.stroke()
      drawGlove(gx, gy)
    }
    ctx.lineCap = 'butt'
    return
  }
  // idle: bounce on the toes, shuffle side to side, gloves up and ready
  const shuffle = Math.sin(now / 480) * 0.35
  const bounce = Math.abs(Math.sin(now / 300)) * 0.05 * scale
  const feet = rel(shuffle, 0, z); const head = rel(shuffle, 1.72, z)
  const cx = feet.sx
  const footY = feet.sy - bounce
  const headY = head.sy - bounce
  const hipY = headY + (footY - headY) * 0.55
  const shoulderY = headY + (footY - headY) * 0.32
  const lw = Math.max(3, 0.14 * scale)
  const headR = Math.max(3.5, 0.16 * scale)

  // ground shadow
  ctx.fillStyle = 'rgba(0,0,0,0.24)'
  ctx.beginPath(); ctx.ellipse(cx, feet.sy + 1, wBody, wBody * 0.32, 0, 0, Math.PI * 2); ctx.fill()

  const torsoH = hipY - shoulderY + 2
  ctx.lineCap = 'round'
  // legs: GK socks down to rounded boots
  ctx.strokeStyle = GK_KIT.sock; ctx.lineWidth = lw
  ctx.beginPath(); ctx.moveTo(cx, hipY); ctx.lineTo(cx - wBody * 0.5, footY); ctx.stroke()
  ctx.beginPath(); ctx.moveTo(cx, hipY); ctx.lineTo(cx + wBody * 0.5, footY); ctx.stroke()
  ctx.strokeStyle = GK_KIT.sockBand; ctx.lineWidth = lw * 0.9
  ctx.beginPath(); ctx.moveTo(cx - wBody * 0.32, hipY + (footY - hipY) * 0.52); ctx.lineTo(cx - wBody * 0.4, hipY + (footY - hipY) * 0.68); ctx.stroke()
  ctx.beginPath(); ctx.moveTo(cx + wBody * 0.32, hipY + (footY - hipY) * 0.52); ctx.lineTo(cx + wBody * 0.4, hipY + (footY - hipY) * 0.68); ctx.stroke()
  ctx.fillStyle = GK_KIT.boot
  ctx.beginPath(); ctx.ellipse(cx - wBody * 0.5, footY, lw * 0.7, lw * 0.4, 0, 0, Math.PI * 2); ctx.fill()
  ctx.beginPath(); ctx.ellipse(cx + wBody * 0.5, footY, lw * 0.7, lw * 0.4, 0, 0, Math.PI * 2); ctx.fill()

  // shorts band across the hips
  const shortsH = Math.max(3, torsoH * 0.34)
  ctx.fillStyle = GK_KIT.shorts
  roundRect(ctx, cx - wBody / 2, hipY - shortsH * 0.5, wBody, shortsH, Math.max(2, wBody * 0.18)); ctx.fill()

  // jersey (keeper amber) — flat fill + shade stripe + light edge
  ctx.fillStyle = GK_KIT.jersey
  roundRect(ctx, cx - wBody / 2, shoulderY, wBody, torsoH, Math.max(2, wBody * 0.3)); ctx.fill()
  ctx.fillStyle = GK_KIT.jerseyDark; ctx.fillRect(cx + wBody * 0.16, shoulderY + 2, wBody * 0.34, torsoH - 2)
  ctx.fillStyle = GK_KIT.jerseyHi; ctx.fillRect(cx - wBody * 0.4, shoulderY + torsoH * 0.12, wBody * 0.12, torsoH * 0.55)
  // collar + GK number 1
  ctx.fillStyle = GK_KIT.collar; ctx.fillRect(cx - wBody * 0.2, shoulderY, wBody * 0.4, Math.max(1.5, torsoH * 0.1))
  if (wBody > 9) {
    ctx.fillStyle = '#1b1f2a'; ctx.font = `800 ${Math.round(wBody * 0.5)}px Plus Jakarta Sans, sans-serif`
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
    ctx.fillText('1', cx, shoulderY + torsoH * 0.52)
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic'
  }

  // ready arms out + emphasised padded gloves (white pad, pink cuff)
  const armY = shoulderY + wBody * 0.5
  ctx.strokeStyle = GK_KIT.skin; ctx.lineWidth = Math.max(2, 0.1 * scale)
  ctx.beginPath(); ctx.moveTo(cx - wBody / 2, shoulderY + 2); ctx.lineTo(cx - wBody * 1.15, armY); ctx.stroke()
  ctx.beginPath(); ctx.moveTo(cx + wBody / 2, shoulderY + 2); ctx.lineTo(cx + wBody * 1.15, armY); ctx.stroke()
  const gloveR = Math.max(3.4, wBody * 0.42)
  for (const gxh of [cx - wBody * 1.15, cx + wBody * 1.15]) {
    ctx.fillStyle = GK_KIT.gloveCuff; ctx.beginPath(); ctx.arc(gxh, armY, gloveR * 1.2, 0, Math.PI * 2); ctx.fill()
    ctx.fillStyle = GK_KIT.glove; ctx.strokeStyle = '#c3cad6'; ctx.lineWidth = 1.5
    ctx.beginPath(); ctx.arc(gxh, armY, gloveR, 0, Math.PI * 2); ctx.fill(); ctx.stroke()
  }
  // head + short hair
  ctx.fillStyle = GK_KIT.skin; ctx.beginPath(); ctx.arc(cx, headY, headR, 0, Math.PI * 2); ctx.fill()
  ctx.fillStyle = '#2c2016'; ctx.beginPath(); ctx.arc(cx, headY - headR * 0.18, headR, Math.PI * 1.04, Math.PI * 1.96); ctx.fill()
  ctx.lineCap = 'butt'
}

// "Try for yourself" sandbox: draw the predicted ball-flight arc for a candidate
// value of the variable the student was solving (force OR angle), in the real
// scene/projection. The arc + endpoint turn green when the shot would land in the
// ring. This reuses the SAME projectile equations as the live game — it is purely a
// read-only preview and never records an attempt or touches the score.
function drawPreviewArc(ctx: CanvasRenderingContext2D, rel: RelFn, g: Game, value: number, now: number) {
  if (!g.target) return
  const angleDeg = g.solveFor === 'v' ? g.launchAngle : value
  const v = g.solveFor === 'v' ? value : g.lockedV
  const a = (angleDeg * Math.PI) / 180
  const vF = v * Math.cos(a)        // forward speed toward the goal
  const vU = v * Math.sin(a)        // upward speed
  const tCross = vF > 0.1 ? g.shotD / vF : 999
  const tx = g.target.x, th = g.target.h
  const vLat = (tx - g.playerX) / tCross
  const discG = vU * vU + 2 * G * (RELEASE.y - BALL_R)
  const tGround = discG >= 0 ? (vU + Math.sqrt(discG)) / G : Infinity
  const reaches = tCross <= tGround
  const tEnd = Math.min(tCross, tGround)
  const yGoal = RELEASE.y + vU * tCross - 0.5 * G * tCross * tCross
  const inFrame = yGoal > 0.05 && yGoal < CROSSBAR && Math.abs(tx) < GOAL_W_HALF - 0.05
  const inRing = reaches && inFrame && Math.abs(yGoal - th) <= TARGET_R
  const color = inRing ? '#3ef08a' : '#ff8fcf'

  const arcPt = (t: number) => rel(g.playerX + vLat * t, RELEASE.y + vU * t - 0.5 * G * t * t, RELEASE.z + vF * t)
  const N = 48
  // soft glow underlay then the bright arc
  ctx.lineCap = 'round'; ctx.lineJoin = 'round'
  const tracePath = () => {
    ctx.beginPath()
    for (let i = 0; i <= N; i++) { const p = arcPt((i / N) * tEnd); if (i === 0) ctx.moveTo(p.sx, p.sy); else ctx.lineTo(p.sx, p.sy) }
  }
  ctx.strokeStyle = inRing ? 'rgba(62,240,138,0.25)' : 'rgba(255,143,207,0.22)'; ctx.lineWidth = 11
  tracePath(); ctx.stroke()
  ctx.strokeStyle = color; ctx.lineWidth = 4
  tracePath(); ctx.stroke()

  // NOTE: the preview is arc-ONLY (no travelling ball) — a ball is only ever launched
  // when the student clicks "Shoot it!". The dashed dots below just mark the path.
  for (let i = 1; i < N; i += 6) {
    const p = arcPt((i / N) * tEnd)
    ctx.fillStyle = color
    ctx.beginPath(); ctx.arc(p.sx, p.sy, 2.4, 0, Math.PI * 2); ctx.fill()
  }

  // endpoint marker on the goal plane (+ a GOAL! flag when it lands in the ring)
  if (reaches) {
    const ep = rel(tx, Math.max(BALL_R, yGoal), g.goalZ)
    const pulse = 1 + Math.sin(now / 180) * 0.18
    ctx.strokeStyle = color; ctx.lineWidth = 3
    ctx.beginPath(); ctx.arc(ep.sx, ep.sy, 8 * pulse, 0, Math.PI * 2); ctx.stroke()
    ctx.fillStyle = color; ctx.beginPath(); ctx.arc(ep.sx, ep.sy, 3.5, 0, Math.PI * 2); ctx.fill()
    if (inRing) {
      ctx.textAlign = 'center'
      ctx.fillStyle = '#0b3a22'; ctx.font = '800 27px "Baloo 2", "Plus Jakarta Sans", sans-serif'
      ctx.fillText('GOAL!', ep.sx + 1, ep.sy - 21)
      ctx.fillStyle = '#5dffa6'; ctx.fillText('GOAL!', ep.sx, ep.sy - 22)
      ctx.textAlign = 'left'
    }
  }
  ctx.lineCap = 'butt'; ctx.lineJoin = 'miter'
}

function drawBall(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, spin: number, squash = 0) {
  ctx.save(); ctx.translate(cx, cy + r * squash * 0.5); ctx.rotate(spin * 0.2)
  ctx.scale(1 + squash * 0.5, 1 - squash * 0.5)
  const g = ctx.createRadialGradient(-r * 0.35, -r * 0.4, r * 0.15, 0, 0, r)
  g.addColorStop(0, '#ffffff'); g.addColorStop(0.7, '#e9edf2'); g.addColorStop(1, '#b9c2cc')
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill()
  // pentagon patches
  ctx.fillStyle = '#1b1f2a'
  const pent = (px: number, py: number, s: number) => {
    ctx.beginPath()
    for (let i = 0; i < 5; i++) {
      const ang = (Math.PI * 2 * i) / 5 - Math.PI / 2 + spin * 0.2
      const vx = px + Math.cos(ang) * s, vy = py + Math.sin(ang) * s
      if (i === 0) ctx.moveTo(vx, vy); else ctx.lineTo(vx, vy)
    }
    ctx.closePath(); ctx.fill()
  }
  pent(0, 0, r * 0.32)
  for (let i = 0; i < 5; i++) {
    const ang = (Math.PI * 2 * i) / 5 - Math.PI / 2 + spin * 0.2
    pent(Math.cos(ang) * r * 0.62, Math.sin(ang) * r * 0.62, r * 0.16)
  }
  ctx.strokeStyle = 'rgba(0,0,0,0.15)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.stroke()
  ctx.restore()
}

// Madden-style oscillating power meter. The marker sweeps; the label shows the live value.
function drawMeter(ctx: CanvasRenderingContext2D, t: number, label: string, color: string, hardRight: boolean) {
  const bw = 380, bx = W / 2 - bw / 2, by = 20, bh = 26
  ctx.fillStyle = 'rgba(8,12,28,0.86)'; roundRect(ctx, bx - 14, by - 14, bw + 28, bh + 64, 14); ctx.fill()
  // track gradient runs SLOW → FAST (green → red), oriented by which end is the hard zone
  const grad = ctx.createLinearGradient(bx, 0, bx + bw, 0)
  if (hardRight) { grad.addColorStop(0, '#3fb67a'); grad.addColorStop(0.5, color); grad.addColorStop(1, '#ff5c7a') }
  else { grad.addColorStop(0, '#ff5c7a'); grad.addColorStop(0.5, color); grad.addColorStop(1, '#3fb67a') }
  ctx.fillStyle = 'rgba(255,255,255,0.08)'; roundRect(ctx, bx, by, bw, bh, 8); ctx.fill()
  ctx.fillStyle = grad; roundRect(ctx, bx, by, bw * t, bh, 8); ctx.fill()
  // marker
  const mx = bx + bw * t
  ctx.fillStyle = '#fff'; roundRect(ctx, mx - 3, by - 6, 6, bh + 12, 3); ctx.fill()
  ctx.beginPath(); ctx.moveTo(mx - 7, by - 6); ctx.lineTo(mx + 7, by - 6); ctx.lineTo(mx, by + 2); ctx.closePath(); ctx.fill()
  // EASY (left, t=0) / HARD (right, t=1) end labels. The further right you stop, the
  // higher the shot difficulty (and the lower the keeper's save chance).
  ctx.font = '800 10px Plus Jakarta Sans, sans-serif'
  ctx.textAlign = 'left'; ctx.fillStyle = '#7ef0a0'; ctx.fillText('EASY', bx + 2, by + bh + 14)
  ctx.textAlign = 'right'; ctx.fillStyle = '#ff8aa0'; ctx.fillText('HARD', bx + bw - 2, by + bh + 14)
  // label + hint
  ctx.textAlign = 'center'
  ctx.fillStyle = color; ctx.font = '800 16px Plus Jakarta Sans, sans-serif'; ctx.fillText(label, W / 2, by + bh + 30)
  ctx.fillStyle = '#cfd6ea'; ctx.font = '600 11px Inter, sans-serif'; ctx.fillText('SPACE / click to lock it in', W / 2, by + bh + 46)
  ctx.textAlign = 'left'
}

function drawTimer(ctx: CanvasRenderingContext2D, left: number, total: number, label: string, color: string, urgent = false) {
  ctx.fillStyle = urgent ? 'rgba(78, 10, 24, 0.9)' : 'rgba(8,12,28,0.82)'
  roundRect(ctx, W / 2 - 170, 12, 340, urgent ? 64 : 50, 14); ctx.fill()
  if (urgent) {
    ctx.strokeStyle = '#ff8aa0'; ctx.lineWidth = 2
    roundRect(ctx, W / 2 - 170, 12, 340, 64, 14); ctx.stroke()
    ctx.textAlign = 'center'
    ctx.fillStyle = '#ffd7df'; ctx.font = '900 10px Plus Jakarta Sans, sans-serif'
    ctx.fillText('TIME RUNNING OUT', W / 2, 24)
  }
  ctx.textAlign = 'center'; ctx.fillStyle = color; ctx.font = '800 22px Plus Jakarta Sans, sans-serif'
  const txt = total >= 90 ? `${Math.floor(left / 60)}:${String(Math.floor(left % 60)).padStart(2, '0')}` : `${left.toFixed(1)}s`
  ctx.fillText(txt, W / 2, urgent ? 45 : 36)
  ctx.fillStyle = urgent ? '#ffe1e7' : '#cfd6ea'; ctx.font = '600 11px Inter, sans-serif'; ctx.fillText(label, W / 2, urgent ? 61 : 52)
  // bar
  const by = urgent ? 66 : 56
  ctx.fillStyle = 'rgba(255,255,255,0.15)'; roundRect(ctx, W / 2 - 150, by, 300, 4, 2); ctx.fill()
  ctx.fillStyle = color; roundRect(ctx, W / 2 - 150, by, 300 * clamp(left / total, 0, 1), 4, 2); ctx.fill()
  ctx.textAlign = 'left'
}

function lerpP(a: P2, b: P2, t: number): P2 {
  return { sx: a.sx + (b.sx - a.sx) * t, sy: a.sy + (b.sy - a.sy) * t, scale: a.scale + (b.scale - a.scale) * t }
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath(); ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath()
}

// The night-stadium backdrop (sky, stands, crowd, floodlights). It never changes,
// so we render it once at 2× supersample and just blit it each frame.
function buildStaticBackground(): HTMLCanvasElement {
  const ss = 2
  const c = document.createElement('canvas'); c.width = W * ss; c.height = H * ss
  const x = c.getContext('2d')!
  x.scale(ss, ss)
  // sky
  const sky = x.createLinearGradient(0, 0, 0, HORIZON)
  sky.addColorStop(0, '#091025'); sky.addColorStop(0.55, '#172a55'); sky.addColorStop(1, '#27406f')
  x.fillStyle = sky; x.fillRect(0, 0, W, HORIZON + 2)
  // upper stand structure
  x.fillStyle = '#101a36'; x.fillRect(0, HORIZON - 60, W, 26)
  // crowd — two tiers of speckle, cool blue-violet tones
  for (let r = 0; r < 5; r++) for (let cc = 0; cc < 92; cc++) {
    const light = 50 + ((cc * 13 + r * 29) % 28)
    x.fillStyle = `hsla(${220 + ((cc * 7) % 50)}, 42%, ${light}%, 0.6)`
    x.fillRect(2 + cc * 9.8, HORIZON - 56 + r * 9, 7, 6)
  }
  // soft pitch-edge glow under the stands
  const edge = x.createLinearGradient(0, HORIZON - 12, 0, HORIZON + 10)
  edge.addColorStop(0, 'rgba(120,150,220,0.18)'); edge.addColorStop(1, 'rgba(120,150,220,0)')
  x.fillStyle = edge; x.fillRect(0, HORIZON - 12, W, 22)
  // floodlights
  for (const lx of [0.16, 0.84]) {
    const gl = x.createRadialGradient(W * lx, 14, 4, W * lx, 14, 90)
    gl.addColorStop(0, 'rgba(255,255,238,0.62)'); gl.addColorStop(1, 'rgba(255,255,238,0)')
    x.fillStyle = gl; x.fillRect(W * lx - 100, -16, 200, 150)
    x.fillStyle = 'rgba(255,255,240,0.95)'
    x.beginPath(); x.arc(W * lx, 14, 4.5, 0, Math.PI * 2); x.fill()
  }
  return c
}
