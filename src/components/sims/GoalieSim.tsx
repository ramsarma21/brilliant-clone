import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { SimProps } from './types'
import { Calculator } from './Calculator'
// ============================================================================
// Impulse unit — soccer skill = GOALKEEPING (the dive-menu save drill).
//
// A striker runs up and shoots. A SAVE MENU offers three commitments, each bound
// to a keyboard key (1/2/3): dive LEFT, watch the MIDDLE, or stay RIGHT. You PICK
// one with the key (or by clicking it); that choice is your read. Executing it
// asks ONE impulse–momentum question about the shot bearing down on you.
//
// A save is impulse: the shot arrives with momentum p = m·v, and to hold it your
// gloves must remove all of it — an impulse J = Δp = m·v. And J = F·Δt, so over a
// contact time Δt the force is F = J/Δt. Each round alternates the two directions:
//
//   • solve the IMPULSE to stop the shot:  J = m · v
//   • solve the HAND FORCE over Δt:        F = J / Δt   (Δt = 0.1 s)
//
// Flow per round: menu (striker waiting) → solve (fixed 30 s) → fly (he runs up
// and shoots; your committed dive plays out).
//   • GATED first run (lesson): the shot goes WHERE YOU COMMITTED, so a correct
//     impulse → guaranteed SAVE. One save advances. A wrong answer → he beats your
//     hands; the result briefly states the correct answer, then you go again.
//   • UNLIMITED practice: the striker shoots a TRULY RANDOM direction. You only
//     save if you both read the side correctly AND solve the impulse.
// ============================================================================

// ---- Camera / canvas: BEHIND the goal, looking downfield. The goal frame is
// nearest the camera (drawn last, on top), the keeper stands in the mouth, and
// the striker runs up from up-pitch. ----
export const W = 900
export const H = 560
export const HORIZON = H * 0.45
export const EYE_Y = 1.3
export const FOCAL = 560
export const CAM_BACK = 5.5

// ---- World (metres) ----
export const BALL_R = 0.13
export const GOAL_HW = 3.66 // half goal width
export const CROSSBAR = 2.44 // goal height
export const GOAL_Z = 0.35 // the goal-line plane (nearest)
export const KEEP_Z = 1.7 // where the keeper ("you") stands, just off the line
export const RUN_FROM = 12.6 // striker's depth while you read it
export const SHOOT_Z = 10.8 // where he plants and strikes

const BEST_KEY = 'physics-goalie-best'

// ---- Solve economy (FIXED — no difficulty scaling) ----
const SOLVE_MS = 30000
const SOLVE_WARN_MS = 10000
const CALC_DRAIN = 1.25

// ---- Save animation ----
export const FLY_DUR = 2.0
export const CONTACT_FRAC = 0.34 // when the striker's boot meets the ball

// ---- Timeout (the "too slow" — he buries it in an empty net) ----
const ROB_CLOSE_S = 0.95
const ROB_DUR_S = 1.9

// ---- Physics constants ----
const BALL_M = 0.43 // kg (regulation ball)
const DT = 0.1 // s (gloves' contact time)

export type P2 = { sx: number; sy: number; scale: number }
export const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v))
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t
const round1 = (x: number) => Math.round(x * 10) / 10
export const easeOut = (u: number) => 1 - (1 - u) * (1 - u)
const easeInOut = (u: number) => (u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2)
const parseNum = (s: string): number => { const v = parseFloat(s); return Number.isFinite(v) ? v : 0 }

// ============================================================================
// The three save commitments. The PHYSICS is the impulse–momentum theorem
// J = Δp = m·v = F·Δt, with CONSTANTS m = 0.43 kg and Δt = 0.1 s. Each run the
// GIVEN quantity is a fresh random integer (1–50) and the UNKNOWN is randomly one
// of the four sensible rearrangements, so the user solves a different question
// every time while the animation choreography is unchanged.
// ============================================================================
//   • findJ        given v → J = m·v        (impulse, N·s)
//   • findV        given J → v = J/m        (shot speed, m/s)
//   • findF        given J → F = J/Δt       (hand force, N)
//   • findJ_fromF  given F → J = F·Δt       (impulse, N·s)
type Dir = 'findJ' | 'findV' | 'findF' | 'findJ_fromF'
type MoveId = 'left' | 'mid' | 'right'

type MoveDef = {
  id: MoveId
  key: string
  name: string
  emoji: string
  blurb: string
  side: -1 | 0 | 1 // which third of the goal you cover
  shot: string // flavour phrase for how he strikes it
}

const MOVES: MoveDef[] = [
  { id: 'left', key: '1', name: 'Dive left', emoji: '⬅️', side: -1, blurb: 'Spring low to your left post', shot: 'rifles it to your left' },
  { id: 'mid', key: '2', name: 'Watch middle', emoji: '🧤', side: 0, blurb: 'Hold the centre and catch it', shot: 'drills it down the middle' },
  { id: 'right', key: '3', name: 'Stay right', emoji: '➡️', side: 1, blurb: 'Cover the right and dive across', shot: 'curls it to your right' },
]

const DIRS: Dir[] = ['findJ', 'findV', 'findF', 'findJ_fromF']
const randInt = (lo: number, hi: number) => lo + Math.floor(Math.random() * (hi - lo + 1))

// per-direction display strings (the formula, short tags, field/var names, etc.)
const FORMULA: Record<Dir, string> = {
  findJ: 'J = m · v', findV: 'v = J / m', findF: 'F = J / Δt', findJ_fromF: 'J = F · Δt',
}
// just the right-hand side of each formula (the unknown sits on the left)
const FORMULA_RHS: Record<Dir, string> = {
  findJ: 'm · v', findV: 'J / m', findF: 'J / Δt', findJ_fromF: 'F · Δt',
}
const ANSWER_FIELD: Record<Dir, string> = {
  findJ: 'Impulse J (N·s)', findV: 'Shot speed v (m/s)', findF: 'Force F (N)', findJ_fromF: 'Impulse J (N·s)',
}
const ANSWER_NAME: Record<Dir, string> = {
  findJ: 'the impulse J', findV: 'the shot speed v', findF: 'the force F', findJ_fromF: 'the impulse J',
}
const SOLVE_HEAD: Record<Dir, string> = {
  findJ: 'Solve for the impulse J', findV: 'Solve for the shot speed v', findF: 'Solve for the force F', findJ_fromF: 'Solve for the impulse J',
}
const MENU_TAG: Record<Dir, string> = {
  findJ: 'find the impulse J = m·v', findV: 'find the speed v = J/m', findF: 'find the force F = J/Δt', findJ_fromF: 'find the impulse J = F·Δt',
}

type Problem = {
  move: MoveDef
  dir: Dir
  m: number // ball mass (kg) — constant
  dt: number // contact time (s) — constant
  givenVar: 'v' | 'J' | 'F'
  givenVal: number // the given quantity (random integer 1–50)
  answerVar: 'J' | 'v' | 'F'
  answer: number // exact answer (decimal)
  unit: string // unit of the answer
}

const answerOf = (p: Problem) => p.answer
// flat ±1 — the exact answer is a decimal, but rounding to the nearest whole number
// (up OR down) is accepted, e.g. exact 12.9 → both 12 and 13 count.
const tolOf = (_p: Problem) => 1.0001

function makeProblem(move: MoveDef, dir: Dir): Problem {
  const m = BALL_M, dt = DT
  const g = randInt(1, 50)
  if (dir === 'findJ') return { move, dir, m, dt, givenVar: 'v', givenVal: g, answerVar: 'J', answer: m * g, unit: 'N·s' }
  if (dir === 'findV') return { move, dir, m, dt, givenVar: 'J', givenVal: g, answerVar: 'v', answer: g / m, unit: 'm/s' }
  if (dir === 'findF') return { move, dir, m, dt, givenVar: 'J', givenVal: g, answerVar: 'F', answer: g / dt, unit: 'N' }
  return { move, dir, m, dt, givenVar: 'F', givenVal: g, answerVar: 'J', answer: g * dt, unit: 'N·s' } // findJ_fromF
}

// Each round, every save gets an INDEPENDENTLY randomized problem (random given +
// randomly chosen unknown); whichever side the user picks is solved fresh.
function makeRound(): Problem[] {
  return MOVES.map((move) => makeProblem(move, DIRS[Math.floor(Math.random() * DIRS.length)]))
}

// the numeric right-hand side of the chosen formula (without the unknown = …)
function plugText(p: Problem): string {
  if (p.dir === 'findJ') return `${p.m} · ${p.givenVal}`
  if (p.dir === 'findV') return `${p.givenVal} / ${p.m}`
  if (p.dir === 'findF') return `${p.givenVal} / ${p.dt}`
  return `${p.givenVal} · ${p.dt}` // findJ_fromF
}
const workedSolution = (p: Problem) => `${FORMULA[p.dir]} = ${plugText(p)} = ${round1(p.answer)} ${p.unit}`

function contextSentence(p: Problem): string {
  const s = p.move.shot
  if (p.dir === 'findJ') return `He ${s} at v = ${p.givenVal} m/s. What impulse J = m·v must your gloves take out of it?`
  if (p.dir === 'findV') return `He ${s} carrying momentum p = ${p.givenVal} N·s. How fast is it coming — v = J/m?`
  if (p.dir === 'findF') return `He ${s} with momentum p = ${p.givenVal} N·s and you parry it in Δt = 0.1 s. What force F = J/Δt do your hands apply?`
  return `He ${s} and your gloves push back with F = ${p.givenVal} N over Δt = 0.1 s. What impulse J = F·Δt is that?` // findJ_fromF
}

// the given rows for the solve panel: the relevant constant + the random given
function givenList(p: Problem): { label: string; val: string; key?: boolean }[] {
  if (p.dir === 'findJ') return [{ label: 'Ball mass', val: `m = ${p.m} kg` }, { label: 'Shot speed', val: `v = ${p.givenVal} m/s`, key: true }]
  if (p.dir === 'findV') return [{ label: 'Ball mass', val: `m = ${p.m} kg` }, { label: 'Momentum', val: `p = ${p.givenVal} N·s`, key: true }]
  if (p.dir === 'findF') return [{ label: 'Contact time', val: `Δt = ${p.dt} s` }, { label: 'Momentum', val: `p = ${p.givenVal} N·s`, key: true }]
  return [{ label: 'Contact time', val: `Δt = ${p.dt} s` }, { label: 'Hand force', val: `F = ${p.givenVal} N`, key: true }] // findJ_fromF
}

const randSide = (): -1 | 0 | 1 => ([-1, 0, 1] as const)[Math.floor(Math.random() * 3)]

// ---- minimal sound (same toolkit as the other sims) ----
export class Sfx {
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
  save() { this.burst(320, 0.5, 0.16, 0.3); this.tone(140, 0.12, 'sine', 0.2) }
  whistle() { this.tone(2100, 0.18, 'square', 0.08); this.tone(2400, 0.18, 'square', 0.06, 0.04) }
  cheer() { this.burst(900, 0.4, 0.6, 0.28) }
  goal() { this.tone(150, 0.22, 'sawtooth', 0.2) }
  miss() { this.burst(240, 1, 0.18, 0.26) }
}

type Particle = { x: number; y: number; vx: number; vy: number; life: number; max: number; color: string; size: number; rot: number; vr: number }

type Phase = 'menu' | 'solve' | 'fly' | 'robbed' | 'result'
type Outcome = 'beat' | 'lost'
export type Fate = 'save' | 'goal'

type Game = {
  phase: Phase
  problems: Problem[]
  picked: Problem | null
  solveElapsedMs: number
  t: number
  outcome: Outcome | null // 'beat' = correct impulse; 'lost' = wrong impulse
  fate: Fate | null // 'save' or 'goal' (the on-pitch result)
  shotDir: -1 | 0 | 1 // where the striker actually shoots
  played: number
  resolved: boolean
  scored: boolean
  celebrate: number
  particles: Particle[]
  robbed: boolean
}

const newGame = (problems: Problem[]): Game => ({
  phase: 'menu', problems, picked: null,
  solveElapsedMs: 0,
  t: 0, outcome: null, fate: null, shotDir: 0, played: 0,
  resolved: false, scored: false, celebrate: 0, particles: [], robbed: false,
})

// ============================================================================
// The save scene: where the striker, the ball and the keeper's dive are at
// progress u ∈ [0,1].
// ============================================================================
export type V3 = { x: number; y: number; z: number }
type Striker = { x: number; z: number; running: boolean; foot: V3 | null; lean: number }
export type KeeperDive = { t: number; reach: V3; beaten: boolean }
export type Scene = {
  ball: V3
  striker: Striker
  keeper: KeeperDive | null // null → idle ready stance
  contact: number // strike flash 0..1
  netBulge: number // 0..1 when a goal hits the net
  netAt: V3 | null
  caught: boolean
}

const pulse = (u: number, c: number, w: number) => Math.max(0, 1 - Math.abs(u - c) / w)

export function saveScene(side: number, shotDir: number, fate: Fate, yTarget: number, u: number): Scene {
  const cF = CONTACT_FRAC
  const targetX = shotDir * 2.7

  // ---- striker: short run-up, plant, strike, follow through ----
  const strikerAt = (uu: number): Striker => {
    if (uu < 0.30) {
      const a = easeOut(uu / 0.30)
      return { x: 0, z: lerp(RUN_FROM, SHOOT_Z, a), running: true, foot: null, lean: 0 }
    }
    if (uu < cF + 0.06) {
      const inContact = uu > cF - 0.07 && uu < cF + 0.08
      return { x: 0, z: SHOOT_Z, running: false, foot: inContact ? { x: 0, y: BALL_R, z: SHOOT_Z - 0.05 } : null, lean: shotDir * 0.18 }
    }
    const k = easeOut((uu - cF) / (1 - cF))
    return { x: lerp(0, shotDir * 0.5, k * 0.6), z: lerp(SHOOT_Z, SHOOT_Z - 0.5, k), running: false, foot: null, lean: shotDir * 0.25 * (1 - k) }
  }

  // ---- the ball: at his feet, then struck toward the target ----
  const ballAt = (uu: number): V3 => {
    if (uu < cF) { const s = strikerAt(uu); return { x: 0, y: BALL_R, z: s.z - 0.35 } }
    const k = clamp((uu - cF) / (1 - cF), 0, 1)
    const e = easeOut(k)
    const endZ = fate === 'save' ? KEEP_Z : GOAL_Z
    const z = lerp(SHOOT_Z, endZ, e)
    const x = lerp(0, targetX, e)
    const arc = Math.sin(Math.PI * Math.min(1, k)) * 0.45
    const y = lerp(BALL_R, yTarget, e) + arc
    return { x, y: Math.max(BALL_R, y), z }
  }

  const ball = ballAt(u)

  // ---- the keeper commits to his side and dives ----
  // The dive completes just as the ball arrives (≈u 1.0), so the gloves meet it
  // rather than waiting frozen at full stretch.
  const dStart = cF + 0.02
  const d = clamp((u - dStart) / 0.62, 0, 1)
  const reach: V3 = { x: side * 2.7, y: yTarget, z: KEEP_Z }
  const beaten = fate === 'goal'
  const keeper: KeeperDive | null = u >= dStart ? { t: d, reach, beaten } : null

  const caught = fate === 'save' && d >= 0.9
  const netBulge = fate === 'goal' ? clamp((u - 0.9) / 0.1, 0, 1) : 0
  const netAt = fate === 'goal' ? { x: targetX, y: yTarget, z: GOAL_Z } : null
  const contact = pulse(u, cF, 0.05)

  return { ball, striker: strikerAt(u), keeper, contact, netBulge, netAt, caught }
}

export function GoalieSim({ state, onChange, showGoal, onGoal, matchMode, onResolve }: SimProps) {
  // The goalkeeper keeps his own keeper kit (not driven by the outfield loadout).
  const keeperKit: GkKit = GK_KIT

  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [phase, setPhase] = useState<Phase>('menu')
  const [answerStr, setAnswerStr] = useState('')
  const [streak, setStreak] = useState(0)
  const [best, setBest] = useState(() => { try { return Number(localStorage.getItem(BEST_KEY) ?? 0) || 0 } catch { return 0 } })
  const [sound, setSound] = useState(true)
  const [showCalc, setShowCalc] = useState(false)
  // a WRONG impulse opens the animated worked-solution lesson for this problem
  const [lesson, setLesson] = useState<{ p: Problem; used: number } | null>(null)
  const [robbed, setRobbed] = useState(false)
  const [wrongWay, setWrongWay] = useState(false)
  const [, force] = useState(0)
  const rerender = useCallback(() => force((n) => n + 1), [])

  const sfx = useRef(new Sfx())
  const soundRef = useRef(sound); soundRef.current = sound
  const showCalcRef = useRef(showCalc); showCalcRef.current = showCalc
  const gameRef = useRef<Game>(newGame(makeRound()))
  const rafRef = useRef<number | null>(null)
  const bgRef = useRef<HTMLCanvasElement | null>(null)
  const gradRef = useRef<{ grass: CanvasGradient; vignette: CanvasGradient } | null>(null)
  const sceneRef = useRef({ onChange, state, onGoal, showGoal })
  sceneRef.current = { onChange, state, onGoal, showGoal }
  const goalFiredRef = useRef(false)
  const yTargetRef = useRef(1.05)
  const answerRef = useRef(answerStr); answerRef.current = answerStr
  const streakRef = useRef(streak); streakRef.current = streak
  const bestRef = useRef(best); bestRef.current = best
  // latest keeper kit, read by the canvas draw loop (so loadout changes apply live)
  const keeperKitRef = useRef(keeperKit); keeperKitRef.current = keeperKit
  // ---- MATCH MODE: this drill is ONE save attempt inside a live match. Live refs
  // so the loop/actions read the latest props, and a once-guard so onResolve fires
  // AT MOST once per mount. ----
  const matchModeRef = useRef(matchMode); matchModeRef.current = matchMode
  const onResolveRef = useRef(onResolve); onResolveRef.current = onResolve
  const resolvedOnceRef = useRef(false)
  const resolveMatch = useCallback((success: boolean) => {
    if (resolvedOnceRef.current) return
    resolvedOnceRef.current = true
    onResolveRef.current?.(success)
  }, [])

  const project = useCallback((x: number, y: number, z: number): P2 => {
    const cz = Math.max(0.05, z + CAM_BACK)
    const scale = FOCAL / cz
    return { sx: W / 2 + x * scale, sy: HORIZON - (y - EYE_Y) * scale, scale }
  }, [])

  // ===== Actions =====
  const nextRun = useCallback(() => {
    gameRef.current = newGame(makeRound())
    goalFiredRef.current = false
    setAnswerStr(''); setShowCalc(false); setLesson(null); setRobbed(false); setWrongWay(false)
    setPhase('menu')
  }, [])

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
    const correct = Math.abs(value - answerOf(p)) <= tolOf(p)
    g.outcome = correct ? 'beat' : 'lost'
    // GATED first run guarantees the shot goes to your committed side (so a correct
    // impulse always saves). UNLIMITED practice picks a truly random shot direction.
    const guaranteed = !!sceneRef.current.showGoal || !!matchModeRef.current
    g.shotDir = guaranteed ? p.move.side : randSide()
    const sideMatch = g.shotDir === p.move.side
    g.fate = correct && (guaranteed || sideMatch) ? 'save' : 'goal'
    yTargetRef.current = p.move.side === 0 ? 0.95 : 1.1
    g.t = 0; g.resolved = false; g.scored = false; g.celebrate = 0
    g.phase = 'fly'
    if (soundRef.current) sfx.current.ensure()
    setPhase('fly')
  }, [])

  const playMove = useCallback(() => {
    const g = gameRef.current
    if (g.phase !== 'solve') return
    fire(parseNum(answerRef.current))
  }, [fire])

  const resolve = useCallback(() => {
    const g = gameRef.current
    if (g.resolved) return
    g.resolved = true
    const p = g.picked
    g.phase = 'result'
    const saved = g.fate === 'save'
    if (saved && p) {
      g.scored = true; g.celebrate = 1
      const sc = saveScene(p.move.side, g.shotDir, 'save', yTargetRef.current, 1)
      spawnConfetti(g, project(sc.ball.x, sc.ball.y + 0.3, sc.ball.z))
      if (soundRef.current) { sfx.current.save(); sfx.current.cheer() }
      if (matchModeRef.current) {
        // match moment: report the save once; the orchestrator owns what's next.
        // No streak/best persistence and no onGoal in matchMode.
        resolveMatch(true)
      } else {
        const s = streakRef.current + 1
        setStreak(s)
        if (s > bestRef.current) { setBest(s); try { localStorage.setItem(BEST_KEY, String(s)) } catch { /* ignore */ } }
        const sceneNow = sceneRef.current
        sceneNow.onChange({ ...sceneNow.state, connections: Number(sceneNow.state.connections ?? 0) + 1 })
        if (!goalFiredRef.current) { goalFiredRef.current = true; sceneNow.onGoal?.() }
      }
    } else {
      if (soundRef.current) { sfx.current.goal(); sfx.current.miss() }
      if (matchModeRef.current) {
        // match moment: a conceded goal (wrong impulse OR wrong read) ends the
        // attempt as a failure — no remediation lesson, the orchestrator continues.
        resolveMatch(false)
      } else if (g.outcome === 'beat') {
        // correct impulse but wrong read (only possible in unlimited): a clean
        // miss, just dust yourself off and go again.
        setStreak(0)
        setWrongWay(true)
      } else if (p) {
        // wrong impulse: he beats your hands. Open the animated, multi-step
        // worked-solution lesson for THIS problem, then continue.
        setStreak(0)
        setLesson({ p, used: g.played })
      }
    }
    setPhase('result')
  }, [project, resolveMatch])

  const dispossess = useCallback(() => {
    const g = gameRef.current
    if (g.phase !== 'solve') return
    g.robbed = true
    g.t = 0
    g.phase = 'robbed'
    if (soundRef.current) { sfx.current.ensure(); sfx.current.goal() }
    setStreak(0)
    setRobbed(true)
    setPhase('robbed')
    // match moment: running the solve clock out is a turnover → failure.
    if (matchModeRef.current) resolveMatch(false)
  }, [resolveMatch])

  const endRobbery = useCallback(() => {
    const g = gameRef.current
    if (g.phase !== 'robbed') return
    g.phase = 'result'
    setPhase('result')
  }, [])

  const actionsRef = useRef({ pickMove, playMove, resolve, dispossess, endRobbery })
  actionsRef.current = { pickMove, playMove, resolve, dispossess, endRobbery }

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

    const dpr = Math.min(2, window.devicePixelRatio || 1)
    const rect = canvas.getBoundingClientRect()
    const bw = Math.max(1, Math.round(rect.width * dpr))
    const bh = Math.max(1, Math.round(rect.height * dpr))
    if (canvas.width !== bw || canvas.height !== bh) { canvas.width = bw; canvas.height = bh }
    ctx.setTransform(canvas.width / W, 0, 0, canvas.height / H, 0, 0)
    ctx.clearRect(0, 0, W, H)

    if (!gradRef.current) {
      const grass = ctx.createLinearGradient(0, HORIZON, 0, H)
      grass.addColorStop(0, '#1f7a37'); grass.addColorStop(1, '#2fa64e')
      const vignette = ctx.createRadialGradient(W / 2, H / 2, H * 0.32, W / 2, H / 2, H * 0.8)
      vignette.addColorStop(0, 'rgba(0,0,0,0)'); vignette.addColorStop(1, 'rgba(0,0,0,0.42)')
      gradRef.current = { grass, vignette }
    }
    if (!bgRef.current) bgRef.current = buildStaticBackground()

    ctx.fillStyle = '#08102a'; ctx.fillRect(-30, -30, W + 60, H + 60)
    ctx.drawImage(bgRef.current, 0, 0, W, H)
    ctx.fillStyle = gradRef.current.grass; ctx.fillRect(-30, HORIZON, W + 60, H - HORIZON + 30)
    for (let zz = 0; zz < 44; zz += 2) {
      if ((Math.floor(zz / 2)) % 2 === 0) continue
      const a2 = project(-30, 0, zz + 0.6), b2 = project(30, 0, zz + 0.6)
      const c2 = project(30, 0, zz + 2.6), d2 = project(-30, 0, zz + 2.6)
      ctx.fillStyle = 'rgba(255,255,255,0.04)'
      ctx.beginPath(); ctx.moveTo(a2.sx, a2.sy); ctx.lineTo(b2.sx, b2.sy); ctx.lineTo(c2.sx, c2.sy); ctx.lineTo(d2.sx, d2.sy); ctx.closePath(); ctx.fill()
    }
    // the 6-yard arc of the box, just to sell the keeper's vantage
    ctx.strokeStyle = 'rgba(255,255,255,0.14)'; ctx.lineWidth = 2
    const boxF = project(-GOAL_HW - 1.5, 0, 5.5), boxN = project(-GOAL_HW - 1.5, 0, KEEP_Z)
    const boxFR = project(GOAL_HW + 1.5, 0, 5.5), boxNR = project(GOAL_HW + 1.5, 0, KEEP_Z)
    ctx.beginPath(); ctx.moveTo(boxN.sx, boxN.sy); ctx.lineTo(boxF.sx, boxF.sy); ctx.stroke()
    ctx.beginPath(); ctx.moveTo(boxNR.sx, boxNR.sy); ctx.lineTo(boxFR.sx, boxFR.sy); ctx.stroke()
    ctx.beginPath(); ctx.moveTo(boxF.sx, boxF.sy); ctx.lineTo(boxFR.sx, boxFR.sy); ctx.stroke()

    const drawWorldPlayer = (x: number, z: number, kit: Kit, running: boolean, hasBall: boolean, action?: PlayerAction) =>
      drawPlayer(ctx, project(x, 0, z), project(x, 1.84, z), kit, now, running, hasBall, action)
    const drawWorldBall = (x: number, y: number, z: number, spin: number, squash = 0) => {
      const bp = project(x, y, z); const sh = project(x, 0, z)
      ctx.fillStyle = 'rgba(0,0,0,0.28)'
      ctx.beginPath(); ctx.ellipse(sh.sx, sh.sy, Math.max(4, BALL_R * sh.scale * 1.3), Math.max(2, BALL_R * sh.scale * 0.5), 0, 0, Math.PI * 2); ctx.fill()
      drawBall(ctx, bp.sx, bp.sy, Math.max(4, Math.min(74, BALL_R * bp.scale)), spin, squash)
    }
    const footAction = (target: V3, lean: number): PlayerAction => {
      const fp = project(target.x, target.y, target.z)
      return { footX: fp.sx, footY: fp.sy, lean }
    }
    const leanAction = (lean: number): PlayerAction => ({ footX: null, footY: 0, lean })
    const drawContact = (pt: V3, intensity: number) => {
      if (intensity <= 0.03) return
      const p = project(pt.x, pt.y, pt.z)
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

    const animating = g.phase === 'fly' || (g.phase === 'result' && !g.robbed && g.fate !== null)
    const u = g.phase === 'fly' ? clamp(g.t / FLY_DUR, 0, 1) : 1

    if (g.phase === 'robbed') {
      // TIMEOUT: you dwelt on it; the striker runs up and buries it down the
      // middle of an empty net. You stay rooted to your line.
      const tu = clamp(g.t / ROB_CLOSE_S, 0, 1)
      const e = easeInOut(tu)
      const strikerRunning = tu < 0.34
      const sz = lerp(RUN_FROM, SHOOT_Z, clamp(tu / 0.34, 0, 1))
      drawWorldPlayer(0, strikerRunning ? sz : SHOOT_Z, FOE_KIT, strikerRunning, tu < 0.34)
      const bz = tu < 0.34 ? sz - 0.35 : lerp(SHOOT_Z, GOAL_Z, easeOut(clamp((tu - 0.34) / 0.66, 0, 1)))
      const by = tu < 0.34 ? BALL_R : lerp(BALL_R, 0.9, easeOut(clamp((tu - 0.34) / 0.66, 0, 1)))
      drawKeeper(ctx, project, 0, KEEP_Z, null, now, keeperKitRef.current)
      drawWorldBall(0, by, bz, now / 180)
      drawGoalNet(ctx, project, e * (bz < KEEP_Z ? 1 : 0), W / 2, project(0, 0.9, GOAL_Z).sy)
    } else if (animating && g.picked && g.fate) {
      const sc = saveScene(g.picked.move.side, g.shotDir, g.fate, yTargetRef.current, u)
      // striker (far) first, then ball/keeper by depth, then the goal net on top.
      const strikerAct = sc.striker.foot ? footAction(sc.striker.foot, sc.striker.lean)
        : Math.abs(sc.striker.lean) > 0.02 ? leanAction(sc.striker.lean) : undefined
      drawWorldPlayer(sc.striker.x, sc.striker.z, FOE_KIT, sc.striker.running, false, strikerAct)
      const ballBehindKeeper = sc.ball.z > KEEP_Z + 0.25
      if (ballBehindKeeper) drawWorldBall(sc.ball.x, sc.ball.y, sc.ball.z, g.t * 11, sc.contact * 0.4)
      drawKeeper(ctx, project, 0, KEEP_Z, sc.keeper, now, keeperKitRef.current)
      if (!ballBehindKeeper && !sc.caught) drawWorldBall(sc.ball.x, sc.ball.y, sc.ball.z, g.t * 11, sc.contact * 0.4)
      if (sc.caught) {
        // ball held in the gloves at the save point
        const gp = project(sc.keeper!.reach.x, sc.keeper!.reach.y, sc.keeper!.reach.z)
        drawBall(ctx, gp.sx, gp.sy, Math.max(4, BALL_R * gp.scale), now / 400, 0)
      }
      if (sc.contact > 0.03) drawContact({ x: 0, y: BALL_R + 0.2, z: SHOOT_Z }, sc.contact)
      drawGoalNet(ctx, project, sc.netBulge, sc.netAt ? project(sc.netAt.x, sc.netAt.y, sc.netAt.z).sx : null, sc.netAt ? project(sc.netAt.x, sc.netAt.y, sc.netAt.z).sy : null)
    } else {
      // menu / solve: the striker waits up-pitch with the ball; you hold a ready
      // stance in the goal, shuffling along your line.
      const shuffle = Math.sin(now / 520) * 0.18
      drawWorldPlayer(0, RUN_FROM, FOE_KIT, false, true)
      drawKeeper(ctx, project, shuffle, KEEP_Z, null, now, keeperKitRef.current)
      drawGoalNet(ctx, project, 0, null, null)
    }

    ctx.fillStyle = gradRef.current.vignette; ctx.fillRect(-30, -30, W + 60, H + 60)

    if (g.particles.length) {
      for (const pt of g.particles) {
        ctx.save(); ctx.globalAlpha = clamp(pt.life / pt.max, 0, 1)
        ctx.translate(pt.x, pt.y); ctx.rotate(pt.rot)
        ctx.fillStyle = pt.color; ctx.fillRect(-pt.size / 2, -pt.size / 2, pt.size, pt.size * 0.62)
        ctx.restore()
      }
      ctx.globalAlpha = 1
    }

    // ---- HUD ----
    // In matchMode the orchestrator owns scoring, so the streak/best HUD is hidden.
    const unlimited = !sceneRef.current.showGoal && !matchModeRef.current
    if (unlimited) {
      ctx.fillStyle = 'rgba(8,12,28,0.8)'; roundRect(ctx, 12, 12, 150, 40, 12); ctx.fill()
      ctx.fillStyle = '#ffd166'; ctx.font = '800 14px Plus Jakarta Sans, sans-serif'; ctx.textAlign = 'left'
      ctx.fillText(`🔥 Streak: ${streakRef.current}`, 24, 38)
      ctx.fillStyle = 'rgba(8,12,28,0.8)'; roundRect(ctx, W - 150, 12, 138, 40, 12); ctx.fill()
      ctx.fillStyle = '#fff'; ctx.font = '700 15px Plus Jakarta Sans, sans-serif'
      ctx.fillText(`🏆 Best: ${bestRef.current}`, W - 138, 38)
    }
    if (g.phase === 'solve') {
      const total = SOLVE_MS / 1000
      const left = Math.max(0, (SOLVE_MS - g.solveElapsedMs) / 1000)
      const warn = left <= SOLVE_WARN_MS / 1000
      const calcLabel = showCalcRef.current ? ' (calc: 1.25× drain)' : ''
      const label = (g.picked ? `Solve ${ANSWER_NAME[g.picked.dir]}: ENTER to set` : 'Solve: ENTER to set') + calcLabel
      drawTimer(ctx, left, total, warn ? `Hurry! ${Math.ceil(left)}s left` : label, warn ? '#ff3b5f' : '#7ec8ff', warn)
    }
  }, [project])

  // ===== Loop =====
  useEffect(() => {
    let last = performance.now()
    const update = (dt: number) => {
      const g = gameRef.current
      const act = actionsRef.current
      if (g.phase === 'solve') {
        g.solveElapsedMs += dt * 1000 * (showCalcRef.current ? CALC_DRAIN : 1)
        if (g.solveElapsedMs >= SOLVE_MS) act.dispossess()
      }
      if (g.phase === 'robbed') {
        g.t += dt
        if (g.t >= ROB_DUR_S) act.endRobbery()
      }
      if (g.phase === 'fly') {
        g.t += dt
        if (g.t >= FLY_DUR + 0.35) act.resolve()
      }
      if (g.celebrate > 0) g.celebrate = Math.max(0, g.celebrate - dt)
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
      if (ph === 'fly' || ph === 'menu' || ph === 'solve' || ph === 'robbed') rerender()
      rafRef.current = requestAnimationFrame(loop)
    }
    rafRef.current = requestAnimationFrame(loop)
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current) }
  }, [draw, rerender])

  function toggleSound() { setSound((v) => { if (!v) sfx.current.ensure(); return !v }) }

  // ===== Side-panel data =====
  const g = gameRef.current
  const p = g.picked
  const fate = g.fate
  const unlimited = !showGoal
  // while the worked-solution lesson is up, it owns its own navigation — a stray
  // click must NOT skip straight to the next shot. In matchMode there is no
  // click-to-continue: the attempt freezes on its final frame for the orchestrator.
  const canClickContinue = phase === 'result' && !lesson && !matchMode

  return (
    <div
      className={`sim soccer${phase === 'solve' ? ' soccer--solving' : ''}`}
      onPointerDownCapture={(e) => {
        if (!canClickContinue) return
        e.stopPropagation()
        nextRun()
      }}
    >
      <div className="soccer__stage">
        <canvas
          ref={canvasRef}
          width={W}
          height={H}
          className={`soccer__canvas soccer__canvas--${phase === 'menu' ? 'meter' : phase}`}
        />
        <button type="button" className="soccer__sound" onClick={toggleSound} aria-label="Toggle sound">{sound ? '🔊' : '🔈'}</button>

        {/* SAVE MENU — pick a direction with the key shown, or click it. */}
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
                <span style={{ fontSize: 11, opacity: 0.82, lineHeight: 1.25, display: 'block' }}>{pr.move.blurb}</span>
                <span style={{ fontSize: 10.5, opacity: 0.7, display: 'block', marginTop: 3 }}>{MENU_TAG[pr.dir]}</span>
              </button>
            ))}
          </div>
        )}

        {!matchMode && phase === 'result' && fate === 'save' && (
          <div className="soccer__banner soccer__banner--goal">
            <strong>SAVED IT! 🧤</strong>
            <span>{p?.move.name} timed perfectly — you took the shot’s momentum away. Click anywhere to continue.</span>
          </div>
        )}

        {!matchMode && phase === 'result' && wrongWay && (
          <div className="soccer__banner soccer__banner--save">
            <strong>WRONG WAY! 😖</strong>
            <span>Your impulse was right, but he shot the other side. Read it next time — click to go again.</span>
          </div>
        )}

        {!matchMode && phase === 'result' && lesson && (
          <SolveLesson p={lesson.p} used={lesson.used} onDone={nextRun} />
        )}

        {!matchMode && phase === 'result' && robbed && (
          <div className="soccer__banner soccer__banner--save">
            <strong>TOO SLOW ⛔</strong>
            <span>He buried it in an empty net. Click anywhere to try again.</span>
          </div>
        )}

        {phase === 'solve' && showCalc && <Calculator onClose={() => setShowCalc(false)} />}
      </div>

      <div className="soccer__side">
        {phase === 'menu' && (
          <div className="soccer__givens">
            <div className="is-key"><span>A save is</span><strong>J = Δp</strong></div>
            <div><span>Ball mass</span><strong>m = 0.43 kg</strong></div>
            {unlimited
              ? <div><span>Pick with</span><strong>keys 1 – 3</strong></div>
              : <div className="is-key"><span>Shot goes</span><strong>your way</strong></div>}
          </div>
        )}

        {phase === 'solve' && p && (
          <>
            <div className="soccer__givens">
              <div className="is-key"><span>Save</span><strong>{p.move.emoji} {p.move.name}</strong></div>
              {givenList(p).map((gv) => (
                <div key={gv.label} className={gv.key ? 'is-key' : undefined}><span>{gv.label}</span><strong>{gv.val}</strong></div>
              ))}
            </div>
            <div className="soccer__method">
              <div className="soccer__method-head">
                <span>{SOLVE_HEAD[p.dir]}</span>
                <button type="button" className="soccer__calc-toggle" onClick={() => setShowCalc((v) => !v)}>🧮 {showCalc ? 'Hide' : 'Calc'}</button>
              </div>
              <div className="soccer__steps">
                <code>{FORMULA[p.dir]} = {plugText(p)}</code>
              </div>
              <p className="soccer__tip" style={{ margin: '6px 0 0' }}>{contextSentence(p)}</p>
              <div className="soccer__inputs">
                <label className="soccer__field">
                  <span>{ANSWER_FIELD[p.dir]}</span>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={answerStr}
                    placeholder={p.answer.toFixed(1)}
                    onChange={(e) => setAnswerStr(e.target.value)}
                  />
                </label>
              </div>
              <p className="soccer__tip" style={{ margin: '4px 0 0', fontSize: 11, opacity: 0.75 }}>Round to the nearest whole number — up or down is fine.</p>
            </div>
          </>
        )}

        {!matchMode && phase === 'result' && fate === 'save' && p && (
          <p className="soccer__tip">Maths checks out: {workedSolution(p)} — you read the shot and held it. <b>Streak {streak}</b> · best {best}.</p>
        )}

        <div className="sim__controls">
          <div className="soccer__buttons">
            {phase === 'menu' && <button type="button" className="btn btn--primary" disabled>Pick a side ▸</button>}
            {phase === 'solve' && <button type="button" className="btn btn--primary" onClick={playMove} disabled={!answerStr}>Make the save 🧤</button>}
            {phase === 'fly' && <button type="button" className="btn btn--primary" disabled>Here it comes…</button>}
            {!matchMode && phase === 'result' && <button type="button" className="btn btn--primary" onClick={nextRun}>Next shot →</button>}
            {!matchMode && <button type="button" className="btn btn--ghost" onClick={nextRun}>↻ Restart</button>}
          </div>
        </div>
      </div>
    </div>
  )
}

// ============================================================================
// Wrong-answer lesson: an animated, multi-step worked solution for THIS save's
// impulse problem (J = Δp = m·v = F·Δt). Modeled on the KinematicsSim remediation
// stepper — givens → write the law → plug in → compute — but explanation-slides
// ONLY (no try-yourself sandbox). Each step is a fill-the-blank MCQ: a wrong pick
// reveals the working and lets you move on; the final step gates on the right
// answer. Read-only: it never grades or touches the score.
// ============================================================================
type Opt = { label: string; correct: boolean }

// Build 3 options (correct + distractors), dropping any distractor that collides
// with the correct label, then rotate so the right answer sits in slot `slot`.
function mkOpts(correct: string, distractors: string[], slot: number): Opt[] {
  const seen = new Set<string>([correct])
  const dist: string[] = []
  for (const d of distractors) { if (!seen.has(d)) { seen.add(d); dist.push(d) } }
  const opts: Opt[] = [{ label: correct, correct: true }, ...dist.map((l) => ({ label: l, correct: false }))]
  const k = slot % opts.length
  return [...opts.slice(k), ...opts.slice(0, k)]
}

function SolveLesson({ p, used, onDone }: { p: Problem; used: number; onDone: () => void }) {
  const { m, dt, givenVal: g, unit } = p
  const ans = p.answer
  const ansShown = round1(ans)
  const fmtNum = (x: number) => `${round1(x)} ${unit}`
  const correctNum = fmtNum(ans)

  // wrong-operation distractors for the final computed step (the classic slips:
  // mixing up multiply/divide or forgetting the constant entirely).
  const numDistractors: Record<Dir, number[]> = {
    findJ: [g, g / m],
    findV: [g * m, g],
    findF: [g * dt, g],
    findJ_fromF: [g / dt, g],
  }
  // wrong substitutions for the "plug in" step.
  const plugDistractors: Record<Dir, string[]> = {
    findJ: [`${g} / ${m}`, `${m} + ${g}`],
    findV: [`${g} · ${m}`, `${m} / ${g}`],
    findF: [`${g} · ${dt}`, `${g} + ${dt}`],
    findJ_fromF: [`${g} / ${dt}`, `${g} + ${dt}`],
  }
  // two other formula shapes as distractors (whichever aren't this problem's law).
  const formulaDistractors = DIRS.filter((d) => FORMULA[d] !== FORMULA[p.dir])
    .map((d) => FORMULA[d]).filter((f, i, a) => a.indexOf(f) === i).slice(0, 2)
  // two other unknowns to choose from when identifying what we're solving for.
  const fieldDistractors = DIRS.filter((d) => ANSWER_FIELD[d] !== ANSWER_FIELD[p.dir])
    .map((d) => ANSWER_FIELD[d]).filter((f, i, a) => a.indexOf(f) === i).slice(0, 2)

  // "What went wrong" — about the player's ACTUAL wrong answer (too much / too
  // little impulse), not the worked walkthrough below.
  const tooHigh = round1(used) > ansShown
  const verdict = `You played ${round1(used)} ${unit}, ${tooHigh ? 'more than' : 'less than'} the ${ansShown} ${unit} this save needs — ${tooHigh ? 'you overdid the impulse.' : 'too little impulse, so the shot beat your hands.'}`

  // stable-per-mount correct-slot for each step's MCQ (4 steps, 3 options)
  const slots = useMemo(() => Array.from({ length: 4 }, () => Math.floor(Math.random() * 3)), [])

  type Step = {
    n: string; cmp?: boolean; prompt: string; options: Opt[]
    gate: 'check' | 'correct'
    card: (blank: ReactNode) => ReactNode
    solution: ReactNode
  }
  const steps: Step[] = [
    {
      n: '1', prompt: 'First, what are you actually solving for on this shot?',
      options: mkOpts(ANSWER_FIELD[p.dir], fieldDistractors, slots[0]), gate: 'check',
      card: (blank) => (<>
        <div className="soccer__step-formula">A save kills the shot's momentum: J = Δp</div>
        <div className="soccer__step-plug">The save asks for ⟶ {blank}</div>
      </>),
      solution: <>This save asks you to find <b>{ANSWER_FIELD[p.dir]}</b>.</>,
    },
    {
      n: '2', prompt: `Which relation gives ${ANSWER_NAME[p.dir]}?`,
      options: mkOpts(FORMULA[p.dir], formulaDistractors, slots[1]), gate: 'check',
      card: (blank) => (<>
        <div className="soccer__step-formula">Impulse–momentum theorem: J = Δp = m·v = F·Δt</div>
        <div className="soccer__step-plug">Pick the form you need ⟶ {blank}</div>
      </>),
      solution: <>For {ANSWER_NAME[p.dir]} use <b>{FORMULA[p.dir]}</b>.</>,
    },
    {
      n: '3', prompt: `Drop the numbers into ${FORMULA[p.dir]}. What's the right-hand side?`,
      options: mkOpts(plugText(p), plugDistractors[p.dir], slots[2]), gate: 'check',
      card: (blank) => (<>
        <div className="soccer__step-formula">Substitute the givens: {FORMULA_RHS[p.dir]}</div>
        <div className="soccer__step-plug">{p.answerVar} = {blank}</div>
      </>),
      solution: <>{p.answerVar} = <b>{plugText(p)}</b>.</>,
    },
    {
      n: '★', cmp: true, prompt: `Now compute it: what is ${ANSWER_NAME[p.dir]}?`,
      options: mkOpts(correctNum, numDistractors[p.dir].map(fmtNum), slots[3]), gate: 'correct',
      card: (blank) => (<>
        <div className="soccer__step-formula">{FORMULA[p.dir]} = {plugText(p)}</div>
        <div className="soccer__step-plug">{p.answerVar} = {blank}</div>
      </>),
      solution: <>{FORMULA[p.dir]} = {plugText(p)} = <b>{ansShown} {unit}</b> (rounding to the nearest whole number is accepted).</>,
    },
  ]
  const N = steps.length

  const [stepIdx, setStepIdx] = useState(0)
  const [answered, setAnswered] = useState<boolean[]>(() => Array(N).fill(false))
  const [pick, setPick] = useState<number | null>(null)
  const [checked, setChecked] = useState(false)
  const [revealed, setRevealed] = useState(false)
  const [showLessonCalc, setShowLessonCalc] = useState(false)
  useEffect(() => { setPick(null); setChecked(false); setRevealed(false) }, [stepIdx])

  // count-up "time spent learning" bar (no auto-skip — explanation slides only)
  const LEARN_LIMIT = 90
  const [elapsed, setElapsed] = useState(0)
  useEffect(() => {
    const start = performance.now()
    const id = window.setInterval(() => setElapsed((performance.now() - start) / 1000), 100)
    return () => window.clearInterval(id)
  }, [])
  const barPct = Math.min(100, (elapsed / LEARN_LIMIT) * 100)

  const cur = steps[stepIdx]
  const last = stepIdx === N - 1
  const stepDone = answered[stepIdx]
  const pickedOpt = pick === null ? null : cur.options[pick]
  const pickedCorrect = !!pickedOpt?.correct

  const choose = (i: number) => { if (stepDone) return; setPick(i); setChecked(false) }
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
  const blankSlot: ReactNode = pick === null
    ? <span className="soccer__blank">?</span>
    : <span className={`soccer__blank soccer__blank--filled${checked ? (pickedCorrect ? ' soccer__blank--ok' : ' soccer__blank--no') : ''}`}>{pickedOpt!.label}{checked ? (pickedCorrect ? ' ✓' : ' ✗') : ''}</span>
  const showSolution = revealed || (checked && !pickedCorrect && cur.gate === 'check')

  const learnBar = (
    <div className="soccer__learnbar">
      <span>⏱ Time spent learning</span>
      <div className="soccer__learnbar-track"><div className="soccer__learnbar-fill" style={{ width: `${barPct}%` }} /></div>
      <span className="soccer__learnbar-num">{elapsed.toFixed(0)}s</span>
    </div>
  )

  return (
    <div className="soccer__lesson">
      <div className="soccer__lesson-inner">
        <div className="soccer__lesson-head">
          <div className="soccer__lesson-emoji">😖</div>
          <div>
            <h2 className="soccer__lesson-title">He beat your hands!</h2>
            <p className="soccer__lesson-sub">{verdict}</p>
          </div>
        </div>

        <div className="soccer__lesson-chips">
          <div className="chip"><span>save</span><strong>{p.move.emoji} {p.move.name}</strong></div>
          {givenList(p).map((gv) => (
            <div key={gv.label} className={gv.key ? 'chip chip--lock' : 'chip'}><span>{gv.label.toLowerCase()}</span><strong>{gv.val}</strong></div>
          ))}
        </div>

        <div className="soccer__stepper">
          <div className="soccer__stepper-progress">
            <span>Step {stepIdx + 1} of {N}</span>
            <div className="soccer__stepper-dots">
              {steps.map((_, i) => <i key={i} className={i === stepIdx ? 'is-on' : i < stepIdx ? 'is-done' : ''} />)}
            </div>
          </div>
          <div key={stepIdx} className={`soccer__step soccer__step--big${cur.cmp ? ' soccer__step--cmp' : ''}`}>
            <span className="soccer__step-n">{cur.n}</span>
            <div className="soccer__step-body">{cur.card(blankSlot)}</div>
          </div>

          {showSolution && (
            <div className="soccer__solution">
              <span className="soccer__solution-tag">Here's the working</span>
              <div className="soccer__solution-body">{cur.solution}</div>
            </div>
          )}

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
                    ? (last ? '✓ Correct! You worked the save out yourself.' : '✓ Correct! On you go.')
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
                <button type="button" className="btn btn--primary soccer__try-btn" onClick={onDone} disabled={!stepDone}>Next shot →</button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ============================================================================
// Canvas drawing helpers (shared render kit with ForcesSim / DefenseSim)
// ============================================================================
// `skinDark` is a one-shade-darker skin tone used for cheek/jaw + limb shading.
// `faceCamera` decides whether a figure shows a FACE (true) or the BACK of the
// head (false). The striker drives the ball toward the goal (= toward this
// behind-the-net camera) so we see his face; the keeper faces downfield, so the
// camera sees the back of his head.
export const FOE_KIT = {
  jersey: '#ef4444', jerseyDark: '#b91c1c', jerseyHi: '#fca5a5', collar: '#7f1010',
  shorts: '#3a0d0d', shortsDark: '#250707', sock: '#ef4444', sockBand: '#ffe8e8',
  boot: '#15171f', number: '#ffffff', num: 9, skin: '#b87a45', skinDark: '#915d31',
  hair: '#1a130c', hairStyle: 3, faceCamera: true,
}
export type Kit = typeof FOE_KIT

// Keeper kit (amber GK jersey + padded gloves). Lighter skin + browner hair so he
// reads as a DIFFERENT person from the striker; he faces away from the camera.
export const GK_KIT = {
  jersey: '#f4b942', jerseyDark: '#c4880f', jerseyHi: '#ffd479', collar: '#7a4d06',
  shorts: '#15171f', sock: '#f4b942', sockBand: '#1b1f2a', boot: '#0e0f15',
  skin: '#e8b48a', skinDark: '#c2895f', glove: '#f4f6fa', gloveCuff: '#ef4444', hair: '#3a2a1a',
}
export type GkKit = typeof GK_KIT

function drawHair(ctx: CanvasRenderingContext2D, cx: number, headY: number, headR: number, style: number, color: string) {
  ctx.fillStyle = color
  if (style === 1) {
    ctx.beginPath(); ctx.arc(cx, headY - headR * 0.06, headR * 0.92, Math.PI * 1.02, Math.PI * 1.98); ctx.fill()
  } else if (style === 2) {
    ctx.beginPath(); ctx.arc(cx, headY - headR * 0.18, headR, Math.PI * 1.05, Math.PI * 1.95); ctx.fill()
    ctx.beginPath(); ctx.arc(cx, headY - headR * 1.05, headR * 0.42, 0, Math.PI * 2); ctx.fill()
  } else if (style === 3) {
    ctx.beginPath(); ctx.arc(cx, headY - headR * 0.12, headR * 1.06, Math.PI * 0.92, Math.PI * 2.08); ctx.fill()
    ctx.fillRect(cx - headR * 1.02, headY - headR * 0.2, headR * 0.34, headR * 1.1)
    ctx.fillRect(cx + headR * 0.68, headY - headR * 0.2, headR * 0.34, headR * 1.1)
  } else {
    ctx.beginPath(); ctx.arc(cx, headY - headR * 0.18, headR, Math.PI * 1.04, Math.PI * 1.96); ctx.fill()
  }
}

// A two-segment limb (root → joint → end): the joint is the segment midpoint
// pushed out by a SLIGHT perpendicular bend (`bowFrac` is a fraction of the limb
// length, so the bend stays natural at any size), tapering modestly from wRoot to
// wEnd. The END point is preserved EXACTLY so kick-foot / glove targets line up.
function drawLimb(
  ctx: CanvasRenderingContext2D,
  x0: number, y0: number, x1: number, y1: number,
  bowFrac: number, color: string, wRoot: number, wEnd: number, shade?: string,
): { jx: number; jy: number } {
  const dx = x1 - x0, dy = y1 - y0
  const len = Math.hypot(dx, dy) || 1
  const nx = -dy / len, ny = dx / len
  const bow = len * bowFrac
  const jx = x0 + dx * 0.5 + nx * bow
  const jy = y0 + dy * 0.5 + ny * bow
  ctx.lineCap = 'round'; ctx.lineJoin = 'round'
  ctx.strokeStyle = color
  ctx.lineWidth = wRoot
  ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(jx, jy); ctx.stroke()
  ctx.lineWidth = wEnd
  ctx.beginPath(); ctx.moveTo(jx, jy); ctx.lineTo(x1, y1); ctx.stroke()
  if (shade) {
    ctx.strokeStyle = shade; ctx.lineWidth = Math.max(1, wEnd * 0.42)
    ctx.beginPath()
    ctx.moveTo(x0 + nx * wRoot * 0.24, y0 + ny * wRoot * 0.24)
    ctx.lineTo(jx + nx * wEnd * 0.24, jy + ny * wEnd * 0.24)
    ctx.lineTo(x1 + nx * wEnd * 0.2, y1 + ny * wEnd * 0.2)
    ctx.stroke()
  }
  return { jx, jy }
}

// A human torso: shoulders wider than the waist (slight taper), with a centre
// shade stripe, a soft form-shadow down one side and a lighter edge highlight.
function drawTorso(
  ctx: CanvasRenderingContext2D,
  cxU: number, topY: number, botY: number, wBody: number,
  jersey: string, jerseyDark: string, jerseyHi: string,
) {
  const wSh = wBody * 1.06, wW = wBody * 0.82
  const torsoH = botY - topY
  const rTop = Math.max(2, wBody * 0.18), rBot = Math.max(2, wBody * 0.16)
  const path = () => {
    ctx.beginPath()
    ctx.moveTo(cxU - wSh / 2, topY + rTop)
    ctx.quadraticCurveTo(cxU - wSh / 2, topY, cxU - wSh / 2 + rTop, topY)
    ctx.lineTo(cxU + wSh / 2 - rTop, topY)
    ctx.quadraticCurveTo(cxU + wSh / 2, topY, cxU + wSh / 2, topY + rTop)
    ctx.lineTo(cxU + wW / 2, botY - rBot)
    ctx.quadraticCurveTo(cxU + wW / 2, botY, cxU + wW / 2 - rBot, botY)
    ctx.lineTo(cxU - wW / 2 + rBot, botY)
    ctx.quadraticCurveTo(cxU - wW / 2, botY, cxU - wW / 2, botY - rBot)
    ctx.closePath()
  }
  path(); ctx.fillStyle = jersey; ctx.fill()
  ctx.save(); path(); ctx.clip()
  ctx.fillStyle = jerseyDark; ctx.fillRect(cxU + wBody * 0.14, topY, wBody * 0.34, torsoH + 4)
  ctx.fillStyle = 'rgba(0,0,0,0.12)'; ctx.fillRect(cxU + wBody * 0.22, topY, wBody, torsoH + 4)
  ctx.fillStyle = jerseyHi; ctx.fillRect(cxU - wBody * 0.46, topY + torsoH * 0.1, wBody * 0.12, torsoH * 0.62)
  ctx.restore()
}

// A realistic-ish GK glove: a rounded palm/back-of-hand with finger ridges, a
// thumb bump and a wrist cuff. `ang` points along the fingers (the reach
// direction) and `hw` is the palm half-length, so the glove stays proportional to
// the hand and tracks its anchor smoothly through every pose.
function drawGkGlove(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, ang: number, hw: number,
  glove: string, cuff: string, line: string,
) {
  const ww = hw * 0.82
  const detail = hw > 5
  ctx.save(); ctx.translate(x, y); ctx.rotate(ang); ctx.lineJoin = 'round'
  // wrist cuff peeking out behind the palm
  ctx.fillStyle = cuff
  roundRect(ctx, -hw * 1.05, -ww * 0.92, hw * 0.7, ww * 1.84, ww * 0.45); ctx.fill()
  // palm / back of hand
  ctx.fillStyle = glove; ctx.strokeStyle = line; ctx.lineWidth = Math.max(1, hw * 0.16)
  roundRect(ctx, -hw * 0.55, -ww, hw * 1.5, ww * 2, ww * 0.62); ctx.fill(); ctx.stroke()
  if (detail) {
    // thumb bump on the lower side
    ctx.fillStyle = glove
    ctx.beginPath(); ctx.ellipse(hw * 0.05, ww * 0.92, hw * 0.34, ww * 0.46, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke()
    // finger ridges near the tips
    ctx.strokeStyle = line; ctx.lineWidth = Math.max(1, hw * 0.12); ctx.lineCap = 'round'
    for (let i = 0; i < 3; i++) {
      const fy = -ww * 0.5 + i * ww * 0.5
      ctx.beginPath(); ctx.moveTo(hw * 0.5, fy); ctx.lineTo(hw * 0.92, fy); ctx.stroke()
    }
  }
  ctx.restore()
}

// Short skin neck + round head with either a stylized face (eyes / brow / cheek
// shade / ears) when facing the camera or the back of the head (hair cap, no
// eyes) when facing away. Fine features gate behind head size so distant figures
// stay clean.
function drawHeadFace(
  ctx: CanvasRenderingContext2D,
  cx: number, headY: number, headR: number, neckTopY: number,
  skin: string, skinDark: string, hair: string, hairStyle: number, faceCamera: boolean,
) {
  const fine = headR > 5.2
  const ears = headR > 7
  // a SHORT, head-wide neck stub: `neckTopY` is the torso top (just below the
  // head), and the stroke tucks up under the head so only ~0.25·headR shows.
  ctx.strokeStyle = skin; ctx.lineCap = 'round'; ctx.lineWidth = headR * 0.92
  ctx.beginPath(); ctx.moveTo(cx, neckTopY); ctx.lineTo(cx, headY + headR * 0.5); ctx.stroke()
  if (faceCamera && ears) {
    ctx.fillStyle = skin
    ctx.beginPath(); ctx.arc(cx - headR * 0.92, headY, headR * 0.3, 0, Math.PI * 2); ctx.fill()
    ctx.beginPath(); ctx.arc(cx + headR * 0.92, headY, headR * 0.3, 0, Math.PI * 2); ctx.fill()
    ctx.fillStyle = skinDark
    ctx.beginPath(); ctx.arc(cx - headR * 0.92, headY, headR * 0.13, 0, Math.PI * 2); ctx.fill()
    ctx.beginPath(); ctx.arc(cx + headR * 0.92, headY, headR * 0.13, 0, Math.PI * 2); ctx.fill()
  }
  ctx.fillStyle = skin; ctx.beginPath(); ctx.arc(cx, headY, headR, 0, Math.PI * 2); ctx.fill()
  if (faceCamera) {
    if (fine) {
      ctx.save(); ctx.beginPath(); ctx.arc(cx, headY, headR, 0, Math.PI * 2); ctx.clip()
      ctx.fillStyle = skinDark
      ctx.beginPath(); ctx.ellipse(cx + headR * 0.52, headY + headR * 0.32, headR * 0.68, headR * 0.92, 0, 0, Math.PI * 2); ctx.fill()
      ctx.restore()
    }
    drawHair(ctx, cx, headY, headR, hairStyle, hair)
    if (fine) {
      const ex = headR * 0.4, ey = headY + headR * 0.04, er = Math.max(1, headR * 0.14)
      ctx.fillStyle = '#23180f'
      ctx.beginPath(); ctx.ellipse(cx - ex, ey, er, er * 1.2, 0, 0, Math.PI * 2); ctx.fill()
      ctx.beginPath(); ctx.ellipse(cx + ex, ey, er, er * 1.2, 0, 0, Math.PI * 2); ctx.fill()
      ctx.strokeStyle = hair; ctx.lineCap = 'round'; ctx.lineWidth = Math.max(1, headR * 0.12)
      ctx.beginPath(); ctx.moveTo(cx - ex - er, ey - headR * 0.36); ctx.lineTo(cx - ex + er, ey - headR * 0.28); ctx.stroke()
      ctx.beginPath(); ctx.moveTo(cx + ex - er, ey - headR * 0.28); ctx.lineTo(cx + ex + er, ey - headR * 0.36); ctx.stroke()
    }
  } else {
    // back of the head: hair covers the skull, a thin skin rim left at the nape
    ctx.fillStyle = hair
    ctx.beginPath(); ctx.arc(cx, headY - headR * 0.12, headR * 0.96, 0, Math.PI * 2); ctx.fill()
    if (fine) {
      ctx.fillStyle = skinDark
      ctx.beginPath(); ctx.ellipse(cx, headY + headR * 0.72, headR * 0.46, headR * 0.26, 0, 0, Math.PI * 2); ctx.fill()
    }
  }
  ctx.lineCap = 'butt'
}

function spawnConfetti(g: Game, at: P2) {
  const colors = ['#ffd23f', '#ff6ec7', '#7c5cff', '#4be3c0', '#ff5b6e', '#7ef0a0', '#3b82f6']
  for (let i = 0; i < 56; i++) {
    const ang = Math.random() * Math.PI * 2
    const sp = 110 + Math.random() * 340
    g.particles.push({
      x: at.sx + (Math.random() - 0.5) * 40, y: at.sy + (Math.random() - 0.5) * 30,
      vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp - 160,
      life: 1.1 + Math.random() * 1.1, max: 2.2,
      color: colors[(Math.random() * colors.length) | 0],
      size: 5 + Math.random() * 7, rot: Math.random() * 6.28, vr: (Math.random() - 0.5) * 12,
    })
  }
}

export type PlayerAction = { footX: number | null; footY: number; lean: number }

export function drawPlayer(ctx: CanvasRenderingContext2D, feet: P2, head: P2, kit: Kit, now: number, running: boolean, hasBall: boolean, action?: PlayerAction) {
  const scale = feet.scale
  if (scale < 4 || scale > 360) return
  const ph = now / 80
  const bob = running ? Math.abs(Math.sin(ph)) * 0.055 * scale : 0
  const cx = feet.sx
  const footY = feet.sy - bob
  const headY = head.sy - bob
  const hipY = headY + (footY - headY) * 0.52
  const wBody = Math.max(5, 0.4 * scale)
  const lw = Math.max(3, 0.15 * scale)
  const headR = Math.max(3.5, 0.17 * scale)
  const leanX = action ? clamp(action.lean, -1, 1) * wBody * 0.55 : 0
  const cxU = cx + leanX
  const hipX = cx + leanX

  ctx.fillStyle = 'rgba(0,0,0,0.26)'
  ctx.beginPath(); ctx.ellipse(cx, feet.sy + 1, wBody * 0.95, wBody * 0.32, 0, 0, Math.PI * 2); ctx.fill()

  ctx.lineCap = 'round'
  let footLx: number, footLy: number, footRx: number, footRy: number
  if (action && action.footX != null) {
    const dir = Math.sign(action.footX - cx) || 1
    footRx = action.footX; footRy = action.footY
    footLx = cx - dir * wBody * 0.34; footLy = footY
  } else {
    const swing = running ? Math.sin(ph) * 0.28 * scale : wBody * 0.4
    const lift = running ? Math.max(0, Math.cos(ph)) * 0.15 * scale : 0
    footLx = cx - swing; footLy = footY - lift
    footRx = cx + swing; footRy = footY
  }
  // legs: thigh → knee → shin, near-equal segments with a slight knee bend and a
  // modest taper. The FOOT end is kept exact (kick foot stays on the ball point).
  const thighW = lw * 1.08, shinW = lw * 0.92
  drawLimb(ctx, hipX, hipY, footLx, footLy, (footLx <= hipX ? -1 : 1) * 0.06, kit.sock, thighW, shinW, 'rgba(0,0,0,0.12)')
  drawLimb(ctx, hipX, hipY, footRx, footRy, (footRx < hipX ? -1 : 1) * 0.06, kit.sock, thighW, shinW, 'rgba(0,0,0,0.12)')
  ctx.strokeStyle = kit.sockBand; ctx.lineWidth = shinW * 0.95
  ctx.beginPath(); ctx.moveTo(hipX + (footLx - hipX) * 0.6, hipY + (footLy - hipY) * 0.62); ctx.lineTo(hipX + (footLx - hipX) * 0.72, hipY + (footLy - hipY) * 0.74); ctx.stroke()
  ctx.beginPath(); ctx.moveTo(hipX + (footRx - hipX) * 0.6, hipY + (footRy - hipY) * 0.62); ctx.lineTo(hipX + (footRx - hipX) * 0.72, hipY + (footRy - hipY) * 0.74); ctx.stroke()
  ctx.fillStyle = kit.boot
  ctx.beginPath(); ctx.ellipse(footRx, footRy, lw * 0.96, lw * 0.5, 0, 0, Math.PI * 2); ctx.fill()
  ctx.beginPath(); ctx.ellipse(footLx, footLy, lw * 0.96, lw * 0.5, 0, 0, Math.PI * 2); ctx.fill()

  // torso top is raised to sit just under the head (short neck), keeping the hip
  // anchor. Shoulders/arms hang from the upper torso.
  const torsoTopY = headY + headR * 1.25
  const torsoBotY = hipY + 2
  const newTorsoH = torsoBotY - torsoTopY
  drawTorso(ctx, cxU, torsoTopY, torsoBotY, wBody, kit.jersey, kit.jerseyDark, kit.jerseyHi)

  ctx.fillStyle = kit.collar; ctx.fillRect(cxU - wBody * 0.2, torsoTopY, wBody * 0.4, Math.max(1.5, newTorsoH * 0.08))
  if (wBody > 9) {
    ctx.fillStyle = kit.number
    ctx.font = `800 ${Math.round(wBody * 0.5)}px Plus Jakarta Sans, sans-serif`
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
    ctx.fillText(String(kit.num), cxU, torsoTopY + newTorsoH * 0.42)
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic'
  }

  // shorts: a clear team-coloured block at the hips, drawn OVER the torso bottom
  // and the thigh tops so it always reads as distinct shorts.
  const shortsTop = hipY - newTorsoH * 0.05
  const shortsH = Math.max(4, newTorsoH * 0.32)
  ctx.fillStyle = kit.shorts; roundRect(ctx, cxU - wBody * 0.52, shortsTop, wBody * 1.04, shortsH, Math.max(2, wBody * 0.2)); ctx.fill()
  ctx.fillStyle = kit.shortsDark; ctx.fillRect(cxU + wBody * 0.06, shortsTop, wBody * 0.3, shortsH)

  // arms: upper arm + forearm with a slight elbow bend, small skin hand at the
  // end, a short jersey sleeve capping the shoulder.
  const armW = Math.max(2, 0.1 * scale)
  const armSwing = running ? Math.sin(ph + Math.PI) * 0.18 * scale : 0
  const armBal = action ? -leanX * 0.5 : 0
  const armTopY = torsoTopY + newTorsoH * 0.14
  const handY = armTopY + wBody * 0.95
  const handReach = wBody * 0.6
  const shLx = cxU - wBody * 0.5, shRx = cxU + wBody * 0.5, shY = armTopY
  const hLx = cxU - handReach - armSwing + armBal, hRx = cxU + handReach + armSwing + armBal
  drawLimb(ctx, shLx, shY, hLx, handY, -0.08, kit.skin, armW * 1.05, armW * 0.9, 'rgba(0,0,0,0.1)')
  drawLimb(ctx, shRx, shY, hRx, handY, 0.08, kit.skin, armW * 1.05, armW * 0.9, 'rgba(0,0,0,0.1)')
  ctx.strokeStyle = kit.jerseyDark; ctx.lineCap = 'round'; ctx.lineWidth = armW * 1.7
  ctx.beginPath(); ctx.moveTo(shLx, shY); ctx.lineTo(cxU - wBody * 0.62, armTopY + wBody * 0.32); ctx.stroke()
  ctx.beginPath(); ctx.moveTo(shRx, shY); ctx.lineTo(cxU + wBody * 0.62, armTopY + wBody * 0.32); ctx.stroke()
  ctx.fillStyle = kit.skin
  ctx.beginPath(); ctx.arc(hLx, handY, armW * 0.85, 0, Math.PI * 2); ctx.fill()
  ctx.beginPath(); ctx.arc(hRx, handY, armW * 0.85, 0, Math.PI * 2); ctx.fill()

  if (hasBall) {
    const br = Math.max(4, BALL_R * scale)
    const bx = cx + wBody * 0.5
    const by = feet.sy
    ctx.fillStyle = 'rgba(0,0,0,0.3)'
    ctx.beginPath(); ctx.ellipse(bx, by + 2, br * 1.2, br * 0.45, 0, 0, Math.PI * 2); ctx.fill()
    drawBall(ctx, bx, by - br * 0.7, br, now / 320, 0)
  }

  drawHeadFace(ctx, cxU, headY, headR, torsoTopY, kit.skin, kit.skinDark, kit.hair, kit.hairStyle, kit.faceCamera)
  ctx.lineCap = 'butt'
}

// The goalkeeper: a ready stance that bounces and shuffles, then a two-stage dive
// (anticipation load → eased leap) that rotates the body toward horizontal so the
// gloves land on the save point. On a goal he commits but comes up short/low so
// the ball beats his outstretched gloves. Adapted from the KinematicsSim keeper.
export function drawKeeper(ctx: CanvasRenderingContext2D, project: (x: number, y: number, z: number) => P2, homeX: number, homeZ: number, dive: KeeperDive | null, now: number, kit: GkKit) {
  const baseFeet = project(homeX, 0, homeZ)
  const scale = baseFeet.scale
  if (scale < 4) return
  const wBody = Math.max(5, 0.4 * scale)

  if (dive) {
    // A clean, streamlined dive. The body arcs on a soft parabola from a standing
    // gather toward the ball; it tilts from upright to a graceful diagonal (only
    // approaching horizontal on a full-stretch corner save), legs trail together,
    // and both arms converge on the ball. `commit` (0 centre → 1 corner) scales
    // how dramatic the dive is, so a middle catch stays nearly upright.
    const dir = Math.sign(dive.reach.x - homeX) || 1
    const commit = clamp(Math.abs(dive.reach.x - homeX) / 2.6, 0, 1)
    const load = clamp(dive.t / 0.16, 0, 1)
    const leap = clamp((dive.t - 0.16) / 0.84, 0, 1)
    const e = 1 - Math.pow(1 - leap, 3) // smooth ease-out off the line
    const beaten = dive.beaten

    const stand = project(homeX, 1.0, homeZ) // chest height, set position
    const aim = beaten
      ? project(dive.reach.x * 0.6, Math.max(0.25, dive.reach.y - 1.0), dive.reach.z)
      : project(dive.reach.x, Math.max(0.4, dive.reach.y), dive.reach.z)

    // gather: a small crouch + weight-shift toward the dive side, eased out by the leap
    const dip = Math.sin(load * Math.PI) * (1 - leap) * wBody * 0.45
    const stepX = dir * wBody * 0.35 * load * (1 - leap)
    // the body centre covers ~72% of the way (arms reach the rest) on an arc
    const arc = Math.sin(Math.PI * leap) * wBody * (0.8 + 1.5 * commit)
    const cx = stand.sx + stepX + (aim.sx - stand.sx) * e * 0.72
    const cy = stand.sy + dip + (aim.sy - stand.sy) * e * 0.72 - arc

    // body axis (hip → head): upright (straight up) easing to a diagonal toward the ball
    const maxTilt = (Math.PI / 2) * (0.32 + 0.6 * commit)
    const tilt = dir * maxTilt * e
    const ux = Math.sin(tilt), uy = -Math.cos(tilt) // up vector
    const px = -uy, py = ux // across-body vector
    const L = wBody * 1.25 // half body length
    const headX = cx + ux * L, headY = cy + uy * L
    const hipX = cx - ux * L, hipY = cy - uy * L
    const shoX = cx + ux * L * 0.5, shoY = cy + uy * L * 0.5
    const lw = Math.max(3, 0.13 * scale)
    const headRk = Math.max(3, 0.17 * scale)
    // torso top: extended up the body axis to just below the head so only a short
    // neck shows (no giraffe gap between the capsule and the head)
    const neckBaseX = cx + ux * (L - headRk * 1.25)
    const neckBaseY = cy + uy * (L - headRk * 1.25)

    // stretched ground shadow under the flight
    const gsh = project(homeX + (dive.reach.x - homeX) * e * 0.72, 0.01, homeZ)
    ctx.save(); ctx.fillStyle = 'rgba(0,0,0,0.2)'
    ctx.beginPath(); ctx.ellipse(gsh.sx, baseFeet.sy, wBody * (1 + e * 0.9), wBody * 0.34, 0, 0, Math.PI * 2); ctx.fill(); ctx.restore()

    ctx.lineCap = 'round'

    // legs trail from the hip, together and slightly split, knees softly bent.
    // The knee/foot positions are UNCHANGED — only the thigh/shin taper + shading
    // are new, so the dive still lands on exactly the same points.
    const legLen = wBody * 1.15
    const bend = wBody * 0.24 * (1 - e)
    for (const s of [0.5, -0.5]) {
      const kneeX = hipX - ux * legLen * 0.55 + px * s * wBody * 0.34 - ux * bend
      const kneeY = hipY - uy * legLen * 0.55 + py * s * wBody * 0.34 - uy * bend
      const footX = hipX - ux * legLen + px * s * wBody * 0.42
      const footY = hipY - uy * legLen + py * s * wBody * 0.42
      ctx.strokeStyle = kit.sock
      ctx.lineWidth = lw * 1.1
      ctx.beginPath(); ctx.moveTo(hipX, hipY); ctx.lineTo(kneeX, kneeY); ctx.stroke()
      ctx.lineWidth = lw * 0.92
      ctx.beginPath(); ctx.moveTo(kneeX, kneeY); ctx.lineTo(footX, footY); ctx.stroke()
      ctx.strokeStyle = 'rgba(0,0,0,0.13)'; ctx.lineWidth = lw * 0.34
      ctx.beginPath(); ctx.moveTo(hipX, hipY); ctx.lineTo(kneeX, kneeY); ctx.lineTo(footX, footY); ctx.stroke()
      ctx.fillStyle = kit.boot
      ctx.beginPath(); ctx.ellipse(footX, footY, lw * 0.95, lw * 0.52, tilt, 0, Math.PI * 2); ctx.fill()
    }

    // torso: a clean rounded capsule from hip up to just below the head, in the
    // GK jersey, with a centre shade stripe and a lighter edge highlight.
    ctx.strokeStyle = kit.jersey; ctx.lineWidth = wBody
    ctx.beginPath(); ctx.moveTo(hipX, hipY); ctx.lineTo(neckBaseX, neckBaseY); ctx.stroke()
    ctx.strokeStyle = kit.jerseyDark; ctx.lineWidth = wBody * 0.34
    ctx.beginPath(); ctx.moveTo(hipX + px * wBody * 0.18, hipY + py * wBody * 0.18); ctx.lineTo(neckBaseX + px * wBody * 0.18, neckBaseY + py * wBody * 0.18); ctx.stroke()
    ctx.strokeStyle = kit.jerseyHi; ctx.lineWidth = wBody * 0.16
    ctx.beginPath(); ctx.moveTo(hipX - px * wBody * 0.34, hipY - py * wBody * 0.34); ctx.lineTo(neckBaseX - px * wBody * 0.34, neckBaseY - py * wBody * 0.34); ctx.stroke()

    // shorts: a distinct team-coloured block at the hip, drawn OVER the torso/leg
    // junction so it always reads as shorts covering the thigh tops.
    ctx.fillStyle = kit.shorts
    ctx.beginPath(); ctx.ellipse(hipX, hipY, wBody * 0.58, wBody * 0.5, tilt, 0, Math.PI * 2); ctx.fill()
    ctx.fillStyle = 'rgba(0,0,0,0.14)'
    ctx.beginPath(); ctx.ellipse(hipX + px * wBody * 0.16, hipY + py * wBody * 0.16, wBody * 0.34, wBody * 0.42, tilt, 0, Math.PI * 2); ctx.fill()

    // arms + padded gloves. CRUCIAL: the hands travel WITH the dive — they start
    // up by the shoulders and extend toward the ball as the leap progresses, so
    // they never snap out ahead of the body.
    // hands begin in a ready position just in front of the chest and reach to the
    // ball over the dive (slightly ahead of the body so the arms lead)
    const reachE = clamp(e * 1.12, 0, 1)
    const readyX = shoX + ux * wBody * 0.3 + px * dir * wBody * 0.3
    const readyY = shoY + uy * wBody * 0.3 + py * dir * wBody * 0.3
    const handX = readyX + (aim.sx - readyX) * reachE
    const handY = readyY + (aim.sy - readyY) * reachE
    // arms get a slight elbow bend but keep their EXACT shoulder roots and glove
    // endpoints, so the hand-travel still lands where the dive math puts it.
    const gkArmW = Math.max(3, 0.11 * scale)
    const gloveHw = Math.max(3.5, gkArmW * 1.15)
    const sh1x = shoX + px * wBody * 0.28, sh1y = shoY + py * wBody * 0.28
    const sh2x = shoX - px * wBody * 0.28, sh2y = shoY - py * wBody * 0.28
    if (beaten) {
      // gloves grasp at thin air, spread a touch around the (missed) ball
      const spread = wBody * (0.55 + 0.4 * reachE)
      const g1x = handX + px * spread, g1y = handY + py * spread
      const g2x = handX - px * spread, g2y = handY - py * spread
      drawLimb(ctx, sh1x, sh1y, g1x, g1y, 0.08, kit.jersey, gkArmW * 1.05, gkArmW * 0.9, 'rgba(0,0,0,0.12)')
      drawLimb(ctx, sh2x, sh2y, g2x, g2y, -0.08, kit.jersey, gkArmW * 1.05, gkArmW * 0.9, 'rgba(0,0,0,0.12)')
      drawGkGlove(ctx, g1x, g1y, Math.atan2(g1y - sh1y, g1x - sh1x), gloveHw, kit.glove, kit.gloveCuff, '#c3cad6')
      drawGkGlove(ctx, g2x, g2y, Math.atan2(g2y - sh2y, g2x - sh2x), gloveHw, kit.glove, kit.gloveCuff, '#c3cad6')
    } else {
      // both arms converge — strong hands right on the ball
      drawLimb(ctx, sh1x, sh1y, handX, handY, 0.08, kit.jersey, gkArmW * 1.05, gkArmW * 0.9, 'rgba(0,0,0,0.12)')
      drawLimb(ctx, sh2x, sh2y, handX, handY, -0.08, kit.jersey, gkArmW * 1.05, gkArmW * 0.9, 'rgba(0,0,0,0.12)')
      drawGkGlove(ctx, handX, handY, Math.atan2(handY - shoY, handX - shoX), gloveHw, kit.glove, kit.gloveCuff, '#c3cad6')
    }

    // short neck stub linking the torso top to the head along the body axis
    ctx.strokeStyle = kit.skin; ctx.lineCap = 'round'; ctx.lineWidth = headRk * 0.92
    ctx.beginPath(); ctx.moveTo(neckBaseX, neckBaseY); ctx.lineTo(headX - ux * headRk * 0.5, headY - uy * headRk * 0.5); ctx.stroke()
    // head: he faces downfield, so the camera sees the BACK of his head — a hair
    // cap (no face) that rotates with the diving body, plus a small nape shade.
    ctx.fillStyle = kit.skin; ctx.beginPath(); ctx.arc(headX, headY, headRk, 0, Math.PI * 2); ctx.fill()
    ctx.save(); ctx.translate(headX, headY); ctx.rotate(tilt)
    ctx.fillStyle = kit.hair; ctx.beginPath(); ctx.arc(0, -headRk * 0.12, headRk * 0.96, 0, Math.PI * 2); ctx.fill()
    if (headRk > 5.2) {
      ctx.fillStyle = kit.skinDark
      ctx.beginPath(); ctx.ellipse(0, headRk * 0.72, headRk * 0.46, headRk * 0.24, 0, 0, Math.PI * 2); ctx.fill()
    }
    ctx.restore()

    ctx.lineCap = 'butt'
    return
  }

  // idle ready stance: bounce on the toes, gloves up
  const bounce = Math.abs(Math.sin(now / 300)) * 0.05 * scale
  const feet = project(homeX, 0, homeZ); const head = project(homeX, 1.72, homeZ)
  const cx = feet.sx
  const footY = feet.sy - bounce
  const headY = head.sy - bounce
  const hipY = headY + (footY - headY) * 0.55
  const lw = Math.max(3, 0.14 * scale)
  const headR = Math.max(3.5, 0.16 * scale)
  // torso top raised to just under the head (short neck), hip anchor kept
  const torsoTopY = headY + headR * 1.25
  const torsoBotY = hipY + 2
  const newTorsoH = torsoBotY - torsoTopY

  ctx.fillStyle = 'rgba(0,0,0,0.24)'
  ctx.beginPath(); ctx.ellipse(cx, feet.sy + 1, wBody, wBody * 0.32, 0, 0, Math.PI * 2); ctx.fill()

  ctx.lineCap = 'round'
  // legs: thigh → knee → shin, near-equal segments with a slight knee bend
  const kThighW = lw * 1.08, kShinW = lw * 0.92
  drawLimb(ctx, cx, hipY, cx - wBody * 0.5, footY, -0.06, kit.sock, kThighW, kShinW, 'rgba(0,0,0,0.12)')
  drawLimb(ctx, cx, hipY, cx + wBody * 0.5, footY, 0.06, kit.sock, kThighW, kShinW, 'rgba(0,0,0,0.12)')
  ctx.fillStyle = kit.boot
  ctx.beginPath(); ctx.ellipse(cx - wBody * 0.5, footY, lw * 0.82, lw * 0.46, 0, 0, Math.PI * 2); ctx.fill()
  ctx.beginPath(); ctx.ellipse(cx + wBody * 0.5, footY, lw * 0.82, lw * 0.46, 0, 0, Math.PI * 2); ctx.fill()

  drawTorso(ctx, cx, torsoTopY, torsoBotY, wBody, kit.jersey, kit.jerseyDark, kit.jerseyHi)
  ctx.fillStyle = kit.collar; ctx.fillRect(cx - wBody * 0.2, torsoTopY, wBody * 0.4, Math.max(1.5, newTorsoH * 0.08))
  if (wBody > 9) {
    ctx.fillStyle = '#1b1f2a'; ctx.font = `800 ${Math.round(wBody * 0.5)}px Plus Jakarta Sans, sans-serif`
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
    ctx.fillText('1', cx, torsoTopY + newTorsoH * 0.42)
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic'
  }

  // shorts: a clear team-coloured block at the hips, over the torso bottom + thighs
  const shortsTop = hipY - newTorsoH * 0.05
  const shortsH = Math.max(4, newTorsoH * 0.32)
  ctx.fillStyle = kit.shorts; roundRect(ctx, cx - wBody * 0.52, shortsTop, wBody * 1.04, shortsH, Math.max(2, wBody * 0.2)); ctx.fill()
  ctx.fillStyle = 'rgba(0,0,0,0.14)'; ctx.fillRect(cx + wBody * 0.06, shortsTop, wBody * 0.3, shortsH)

  // arms (gloves up, ready): upper arm + forearm with a slight elbow bend
  const armTopY = torsoTopY + newTorsoH * 0.14
  const idleArmW = Math.max(2, 0.1 * scale)
  const gloveLx = cx - wBody * 1.05, gloveRx = cx + wBody * 1.05
  const gloveY = armTopY + wBody * 0.4
  drawLimb(ctx, cx - wBody * 0.5, armTopY, gloveLx, gloveY, -0.08, kit.skin, idleArmW * 1.05, idleArmW * 0.9, 'rgba(0,0,0,0.1)')
  drawLimb(ctx, cx + wBody * 0.5, armTopY, gloveRx, gloveY, 0.08, kit.skin, idleArmW * 1.05, idleArmW * 0.9, 'rgba(0,0,0,0.1)')
  const gloveHw = Math.max(3.5, idleArmW * 1.15)
  drawGkGlove(ctx, gloveLx, gloveY, Math.atan2(gloveY - armTopY, gloveLx - (cx - wBody * 0.5)), gloveHw, kit.glove, kit.gloveCuff, '#c3cad6')
  drawGkGlove(ctx, gloveRx, gloveY, Math.atan2(gloveY - armTopY, gloveRx - (cx + wBody * 0.5)), gloveHw, kit.glove, kit.gloveCuff, '#c3cad6')

  // he faces downfield → the camera sees the back of his head (no face)
  drawHeadFace(ctx, cx, headY, headR, torsoTopY, kit.skin, kit.skinDark, kit.hair, 0, false)
  ctx.lineCap = 'butt'
}

// The goal: a net mesh + bright white frame at the goal-line plane. Drawn LAST so
// (from the behind-goal camera) we look through the netting at the keeper.
export function drawGoalNet(ctx: CanvasRenderingContext2D, project: (x: number, y: number, z: number) => P2, bulge: number, bx: number | null, by: number | null) {
  const tl = project(-GOAL_HW, CROSSBAR, GOAL_Z), tr = project(GOAL_HW, CROSSBAR, GOAL_Z)
  const bl = project(-GOAL_HW, 0, GOAL_Z), br = project(GOAL_HW, 0, GOAL_Z)
  const lp = (a: P2, b: P2, t: number) => ({ sx: a.sx + (b.sx - a.sx) * t, sy: a.sy + (b.sy - a.sy) * t })
  ctx.strokeStyle = 'rgba(255,255,255,0.16)'; ctx.lineWidth = 1
  for (let i = 0; i <= 12; i++) { const t = i / 12; const a = lp(tl, tr, t), b = lp(bl, br, t); ctx.beginPath(); ctx.moveTo(a.sx, a.sy); ctx.lineTo(b.sx, b.sy); ctx.stroke() }
  for (let i = 0; i <= 8; i++) { const t = i / 8; const a = lp(tl, bl, t), b = lp(tr, br, t); ctx.beginPath(); ctx.moveTo(a.sx, a.sy); ctx.lineTo(b.sx, b.sy); ctx.stroke() }
  if (bulge > 0 && bx != null && by != null) {
    ctx.fillStyle = `rgba(255,255,255,${0.2 * bulge})`
    ctx.beginPath(); ctx.arc(bx, by, 30 * bulge, 0, Math.PI * 2); ctx.fill()
    ctx.strokeStyle = `rgba(255,255,255,${0.5 * bulge})`; ctx.lineWidth = 1.5
    ctx.beginPath(); ctx.arc(bx, by, 34 * bulge, 0, Math.PI * 2); ctx.stroke()
  }
  ctx.strokeStyle = '#ffffff'; ctx.lineWidth = Math.max(5, 0.12 * tl.scale); ctx.lineCap = 'round'
  ctx.beginPath(); ctx.moveTo(bl.sx, bl.sy); ctx.lineTo(tl.sx, tl.sy); ctx.stroke()
  ctx.beginPath(); ctx.moveTo(br.sx, br.sy); ctx.lineTo(tr.sx, tr.sy); ctx.stroke()
  ctx.beginPath(); ctx.moveTo(tl.sx, tl.sy); ctx.lineTo(tr.sx, tr.sy); ctx.stroke()
  ctx.lineCap = 'butt'
}

export function drawBall(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, spin: number, squash = 0) {
  ctx.save(); ctx.translate(cx, cy + r * squash * 0.5); ctx.rotate(spin * 0.2)
  ctx.scale(1 + squash * 0.5, 1 - squash * 0.5)
  const g = ctx.createRadialGradient(-r * 0.35, -r * 0.4, r * 0.15, 0, 0, r)
  g.addColorStop(0, '#ffffff'); g.addColorStop(0.7, '#e9edf2'); g.addColorStop(1, '#b9c2cc')
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill()
  ctx.fillStyle = '#1b1f2a'
  const pent = (px: number, py: number, sz: number) => {
    ctx.beginPath()
    for (let i = 0; i < 5; i++) {
      const ang = (Math.PI * 2 * i) / 5 - Math.PI / 2 + spin * 0.2
      const vx = px + Math.cos(ang) * sz, vy = py + Math.sin(ang) * sz
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

export function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath(); ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath()
}

export function buildStaticBackground(): HTMLCanvasElement {
  const ss = 2
  const c = document.createElement('canvas'); c.width = W * ss; c.height = H * ss
  const x = c.getContext('2d')!
  x.scale(ss, ss)
  const sky = x.createLinearGradient(0, 0, 0, HORIZON)
  sky.addColorStop(0, '#091025'); sky.addColorStop(0.55, '#172a55'); sky.addColorStop(1, '#27406f')
  x.fillStyle = sky; x.fillRect(0, 0, W, HORIZON + 2)
  x.fillStyle = '#101a36'; x.fillRect(0, HORIZON - 60, W, 26)
  for (let r = 0; r < 5; r++) for (let cc = 0; cc < 92; cc++) {
    const light = 50 + ((cc * 13 + r * 29) % 28)
    x.fillStyle = `hsla(${220 + ((cc * 7) % 50)}, 42%, ${light}%, 0.6)`
    x.fillRect(2 + cc * 9.8, HORIZON - 56 + r * 9, 7, 6)
  }
  const edge = x.createLinearGradient(0, HORIZON - 12, 0, HORIZON + 10)
  edge.addColorStop(0, 'rgba(120,150,220,0.18)'); edge.addColorStop(1, 'rgba(120,150,220,0)')
  x.fillStyle = edge; x.fillRect(0, HORIZON - 12, W, 22)
  for (const lx of [0.16, 0.84]) {
    const gl = x.createRadialGradient(W * lx, 14, 4, W * lx, 14, 90)
    gl.addColorStop(0, 'rgba(255,255,238,0.62)'); gl.addColorStop(1, 'rgba(255,255,238,0)')
    x.fillStyle = gl; x.fillRect(W * lx - 100, -16, 200, 150)
    x.fillStyle = 'rgba(255,255,240,0.95)'
    x.beginPath(); x.arc(W * lx, 14, 4.5, 0, Math.PI * 2); x.fill()
  }
  return c
}
