import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { SimProps } from './types'
import type { JerseyPattern } from '../../types'
import { Calculator } from './Calculator'
import { usePlayerKit } from '../../lib/playerKit'
import { drawPlayerLegs, drawPlayerShorts, bodyMetrics, drawPlayerArms, idleHands } from '../../lib/playerCanvas'
import { fetchHighScore, saveHighScore } from '../../lib/scores'

// ============================================================================
// Momentum unit — soccer skill = DEFENDING (the challenge-menu drill).
//
// An attacker drives at you with the ball. A CHALLENGE MENU offers three
// defensive actions, each bound to a keyboard key (1/2/3). You PICK one with the
// key (or by clicking it); that choice is the decision. Executing it asks ONE
// momentum question about the attacker bearing down on you.
//
// Momentum is p = m · v. Unlike the forces drill, the MASS is NOT constant: each
// challenge faces a different attacker (a light winger, a striker, a target
// man), so momentum depends on BOTH mass and speed. Each round alternates the
// two solve directions:
//
//   • solve MOMENTUM given mass + velocity:   p = m · v
//   • solve VELOCITY given momentum + mass:    v = p / m
//
// Flow per round: menu (attacker closing) → solve (fixed 30 s, formula always
// shown, calculator drains the clock at 1.25×) → fly (the chosen challenge
// animates).
//   • Correct → you time the tackle, WIN the ball, streak/score up, onGoal fires
//     and connections increments. Click anywhere to continue.
//   • Wrong → he beats you; the miss animation plays and a brief result line
//     states the correct answer before you move on.
//   • Run the 30 s down → he simply knocks it past you and goes (no lesson).
// ============================================================================

// ---- Camera / canvas (identical feel to ForcesSim / KinematicsSim) ----
const W = 900
const H = 560
const HORIZON = H * 0.4
// Third-person view: the camera trails CAM_BACK metres behind YOU (the
// defender) and a little above, so you watch your own avatar make the challenge
// while the attacker drives in from up-pitch.
const EYE_Y = 2.4
const FOCAL = 560
const CAM_BACK = 6

// ---- World (metres) ----
const BALL_R = 0.13
// Home of the defender ("you") in third-person: a touch left of and just ahead
// of the camera, so the avatar sits low-centre and never masks the attacker.
const YOU_HOME = { x: -0.4, z: 0.4 }

const BEST_KEY = 'physics-defense-best'

// ---- Solve economy (FIXED — no difficulty scaling) ----
const SOLVE_MS = 30000
const SOLVE_WARN_MS = 10000
const CALC_DRAIN = 1.25

// ---- Attacker (drives at you while you size up the challenge) ----
const ATT_START = 9.5 // metres up-pitch when the menu opens
const ATT_MIN = 4.2 // closest he gets before you have to commit
const ATT_APPROACH = 0.7 // m/s he drives in

// ---- Challenge animation ----
const FLY_DUR = 1.7

// ---- Timeout (the "too slow" knock-past) ----
const ROB_CLOSE_S = 0.8
const ROB_DUR_S = 1.7

type P2 = { sx: number; sy: number; scale: number }
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v))
const lerp = (a: number, b: number, t: number) => a + (b - a) * t
const round1 = (x: number) => Math.round(x * 10) / 10
const easeOut = (u: number) => 1 - (1 - u) * (1 - u)
const easeInOut = (u: number) => (u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2)
const parseNum = (s: string): number => { const v = parseFloat(s); return Number.isFinite(v) ? v : 0 }

// ============================================================================
// The three defensive challenges. Each faces a DIFFERENT attacker, so the mass
// changes between them — momentum p = m·v depends on both mass and speed.
// Velocities are whole m/s and masses are chosen so p = m·v is an exact integer
// AND v = p/m recovers the integer cleanly.
// ============================================================================
// Three rearrangements of momentum p = m·v. Every run draws fresh random
// integer givens and randomly picks ONE of these to solve for.
type Dir = 'findP' | 'findV' | 'findM'
const DIRS: Dir[] = ['findP', 'findV', 'findM']
type MoveId = 'poke' | 'challenge' | 'dive'

type MoveDef = {
  id: MoveId
  key: string
  name: string
  emoji: string
  blurb: string
  who: string // who you're facing (generic — mass is now random)
}

const MOVES: MoveDef[] = [
  { id: 'poke', key: '1', name: 'Poke', emoji: '🦶', blurb: 'Stay up, reach in and nick it', who: 'a quick winger' },
  { id: 'challenge', key: '2', name: 'Challenge', emoji: '💪', blurb: 'Shoulder-to-shoulder, ride him off', who: 'a strong striker' },
  { id: 'dive', key: '3', name: 'Dive', emoji: '🥅', blurb: 'Commit and slide in to win it', who: 'a driving target man' },
]

type Problem = {
  move: MoveDef
  dir: Dir
  m: number // attacker mass (kg) — integer
  v: number // m/s — integer
  p: number // m·v (exact integer)
  answer: number
  unit: string // 'kg·m/s' | 'm/s' | 'kg'
}

const answerOf = (p: Problem) => p.answer
// Flat ±1 tolerance: every exact answer is a whole number, so rounding the
// computed value up OR down is accepted (e.g. 53.x → 53 and 54 both pass).
const tolOf = () => 1.0001

// Attacker mass: random integer 60–90 kg (a realistic player). Never 0, so
// v = p/m and m = p/v never divide by zero.
const randMass = () => 60 + Math.floor(Math.random() * 31)
// Velocity: random integer 1–50 m/s. Never 0, same divide-by-zero guarantee.
const randVel = () => 1 + Math.floor(Math.random() * 50)

function makeProblem(move: MoveDef, dir: Dir): Problem {
  // Draw the two base integers (mass 60–90, velocity 1–50) and derive the
  // product, then present whichever two match the chosen unknown.
  const m = randMass()
  const v = randVel()
  const p = m * v
  const answer = dir === 'findP' ? p : dir === 'findV' ? v : m
  const unit = dir === 'findP' ? 'kg·m/s' : dir === 'findV' ? 'm/s' : 'kg'
  return { move, dir, m, v, p, answer, unit }
}

function makeRound(): { problems: Problem[]; openSide: 1 | -1 } {
  // Each challenge gets a freshly randomized problem (random givens + a randomly
  // chosen unknown), independent every round.
  const problems = MOVES.map((move) => makeProblem(move, DIRS[Math.floor(Math.random() * DIRS.length)]))
  return { problems, openSide: Math.random() < 0.5 ? 1 : -1 }
}

// ---- presentation helpers (shared by the side panel + result text) ----
const unknownName = (dir: Dir) => (dir === 'findP' ? 'momentum p' : dir === 'findV' ? 'speed v' : 'mass m')
const formulaPlug = (p: Problem) =>
  p.dir === 'findP' ? `p = m · v = ${p.m} · ${p.v}`
    : p.dir === 'findV' ? `v = p / m = ${p.p} / ${p.m}`
      : `m = p / v = ${p.p} / ${p.v}`
const solvedText = (p: Problem) =>
  p.dir === 'findP' ? `p = m·v = ${p.m}·${p.v} = ${p.p} kg·m/s`
    : p.dir === 'findV' ? `v = p/m = ${p.p}/${p.m} = ${p.v} m/s`
      : `m = p/v = ${p.p}/${p.v} = ${p.m} kg`
const ctxText = (p: Problem) => {
  const name = p.move.name.toLowerCase()
  return p.dir === 'findP'
    ? `He drives in at v = ${p.v} m/s carrying m = ${p.m} kg. What momentum p = m·v are you timing the ${name} against?`
    : p.dir === 'findV'
      ? `He hits the ${name} with p = ${p.p} kg·m/s on an m = ${p.m} kg frame. How fast is he, v = p/m?`
      : `He carries p = ${p.p} kg·m/s at v = ${p.v} m/s. How heavy is he, m = p/v?`
}

// ---- minimal sound (same toolkit as ForcesSim) ----
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
  whistle() { this.tone(2100, 0.18, 'square', 0.08); this.tone(2400, 0.18, 'square', 0.06, 0.04) }
  cheer() { this.burst(900, 0.4, 0.6, 0.28) }
  beaten() { this.tone(150, 0.22, 'sawtooth', 0.2) }
  miss() { this.burst(240, 1, 0.18, 0.26) }
}

type Particle = { x: number; y: number; vx: number; vy: number; life: number; max: number; color: string; size: number; rot: number; vr: number }

type Phase = 'menu' | 'solve' | 'fly' | 'robbed' | 'result'
type Outcome = 'beat' | 'lost'

type Game = {
  phase: Phase
  problems: Problem[]
  picked: Problem | null
  openSide: 1 | -1
  solveElapsedMs: number
  t: number
  outcome: Outcome | null
  played: number
  attZ: number
  resolved: boolean
  scored: boolean
  celebrate: number
  particles: Particle[]
  robbed: boolean
}

const newGame = (problems: Problem[], openSide: 1 | -1): Game => ({
  phase: 'menu', problems, picked: null, openSide,
  solveElapsedMs: 0,
  t: 0, outcome: null, played: 0,
  attZ: ATT_START,
  resolved: false, scored: false, celebrate: 0, particles: [], robbed: false,
})

// ============================================================================
// The executed-challenge scene: where the ball, the attacker and "you" are at
// progress u ∈ [0,1].
// ============================================================================
type V3 = { x: number; y: number; z: number }
// `lean` (-1..1) tilts a standing actor (a stagger / a shoulder-in) without a
// kick pose. `slide` (0..1) drops the defender into a grounded slide-tackle pose.
type SceneActor = { x: number; z: number; running: boolean; hasBall: boolean; reach: V3 | null; lean: number }
type YouPose = { show: boolean; x: number; z: number; running: boolean; footTarget: V3 | null; lean: number; slide: number }
type Scene = { ball: V3; att: SceneActor; you: YouPose; contact: number; contactPt: V3 | null }

const pulse = (u: number, c: number, w: number) => Math.max(0, 1 - Math.abs(u - c) / w)

function flyScene(moveId: MoveId, outcome: Outcome, openSide: number, attZ: number, u: number): Scene {
  return outcome === 'lost'
    ? lostScene(moveId, openSide, attZ, u)
    : beatScene(moveId, openSide, attZ, u)
}

// The tackle point: where the challenge happens, a couple of metres in front of
// you (between you and where the attacker started).
const TACKLE_Z = 2.2

// ----------------------------------------------------------------------------
// A clean challenge = you WIN the ball. The attacker drives in to the tackle
// point, then at the per-move CONTACT FRAME (cF) each action reads differently:
//   • POKE  — you stay on your feet, jab a foot in and nick it; he overruns the
//             ball and stumbles on past, the ball squirts back to your feet.
//   • CHALLENGE — a shoulder-to-shoulder 50-50: you step across and ride him off,
//             he is knocked wide and off balance, the ball pops loose to you.
//   • DIVE  — you commit to a SLIDE: you go to ground, leg extended, and sweep it
//             away; he hurdles/stumbles over you, the swept ball ends at your foot.
// You finish in control; the attacker is left beaten.
// ----------------------------------------------------------------------------
function beatScene(moveId: MoveId, openSide: number, attZ: number, u: number): Scene {
  const goSide = openSide
  const cF = moveId === 'challenge' ? 0.48 : moveId === 'dive' ? 0.40 : 0.42
  const TZ = TACKLE_Z

  // ---- attacker drives in, then reacts to the challenge ----
  const attAt = (uu: number): { x: number; z: number; lean: number; run: boolean } => {
    if (uu < cF) return { x: 0, z: lerp(attZ, TZ, easeOut(uu / cF)), lean: 0, run: true }
    const k = easeOut((uu - cF) / (1 - cF))
    if (moveId === 'poke') {
      // wrong-footed: he lunges the wrong way and overruns toward the camera as
      // the ball is poked the other way, left trailing it
      return { x: lerp(0, -goSide * 0.5, k), z: lerp(TZ, TZ - 1.4, k), lean: -goSide * 0.6 * (1 - 0.3 * k), run: k < 0.78 }
    }
    if (moveId === 'challenge') {
      // shouldered off: knocked wide to the open side, staggering, slowed
      return { x: lerp(0, goSide * 1.7, k), z: lerp(TZ, TZ + 0.5, k), lean: goSide * 0.9, run: k < 0.4 }
    }
    // dive: hurdles/stumbles over the slide, carries on then loses balance
    return { x: lerp(0, goSide * 0.95, k), z: lerp(TZ, TZ - 0.7, k), lean: goSide * 0.7 * (1 - 0.5 * k), run: k < 0.55 }
  }

  // ---- you make the challenge ----
  const youAt = (uu: number): { x: number; z: number; slide: number } => {
    if (moveId === 'poke') {
      const stepZ = TZ - 0.85 // step in, jab a foot in, stay on your feet
      if (uu < cF) { const a = easeOut(uu / cF); return { x: lerp(YOU_HOME.x, goSide * 0.05, a), z: lerp(YOU_HOME.z, stepZ, a), slide: 0 } }
      const k = easeOut((uu - cF) / (1 - cF))
      return { x: lerp(goSide * 0.05, goSide * 0.12, k), z: lerp(stepZ, stepZ + 0.45, k), slide: 0 }
    }
    if (moveId === 'challenge') {
      const sideZ = TZ - 0.55 // get your body across, alongside him
      if (uu < cF) { const a = easeOut(uu / cF); return { x: lerp(YOU_HOME.x, goSide * 0.28, a), z: lerp(YOU_HOME.z, sideZ, a), slide: 0 } }
      const k = easeOut((uu - cF) / (1 - cF))
      return { x: lerp(goSide * 0.28, YOU_HOME.x + 0.1, k * 0.8), z: lerp(sideZ, YOU_HOME.z + 0.35, k * 0.8), slide: 0 }
    }
    // dive / slide: commit forward and low, hold the slide, then start to get up
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

  // the ball: at his feet on the way in, then nicked/swept per move
  const ballAt = (uu: number): V3 => {
    if (uu < cF) { const aa = attAt(uu); return { x: aa.x, y: BALL_R, z: aa.z - 0.45 } }
    const k = easeOut((uu - cF) / (1 - cF))
    if (moveId === 'poke') {
      // poked cleanly past him: it squirts out to the open side and rolls
      // up-pitch into the space BEHIND the beaten attacker
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

  // your foot stays on the ball: through the slide for the dive, on the decisive
  // touch for the poke, and on the settle for the challenge. The poke knocks the
  // ball away up-pitch, so the foot only meets it at the contact frame.
  let footTarget: V3 | null = null
  if (moveId === 'dive') { if (y.slide > 0.1 || youWon) footTarget = ball }
  else if (u > cF - 0.12 && u < cF + 0.16) footTarget = ball
  else if (youWon && moveId === 'challenge') footTarget = ball

  const leanDir = moveId === 'challenge' ? goSide : moveId === 'poke' ? goSide * 0.5 : 0
  const att: SceneActor = { x: a.x, z: a.z, running: a.run, hasBall: false, reach: null, lean: a.lean }
  const you: YouPose = {
    show: true, x: y.x, z: y.z,
    running: y.slide < 0.1 && footTarget == null && u > 0.04 && u < 0.95,
    footTarget,
    lean: leanDir * pulse(u, cF, 0.25),
    slide: y.slide,
  }
  return { ball, att, you, contact, contactPt }
}

// ----------------------------------------------------------------------------
// A wrong answer. You misjudge his momentum and arrive wrong; the attacker
// bursts past on the open side and drives goal-side with the ball. Each action
// fails in its own way: the POKE jabs at thin air, the CHALLENGE gets brushed
// off, and the DIVE slides past harmlessly while he skips clear.
// ----------------------------------------------------------------------------
function lostScene(moveId: MoveId, openSide: number, attZ: number, u: number): Scene {
  const goSide = openSide
  const cF = moveId === 'challenge' ? 0.44 : 0.40
  const k = easeOut(u)
  const ax = lerp(0, goSide * 1.5, k)
  const az = lerp(attZ, -0.4, k) // bursts past you toward the camera
  const ball: V3 = { x: ax + goSide * 0.32, y: BALL_R, z: az - 0.3 }

  let yx: number, yz: number, slide = 0
  if (moveId === 'dive') {
    // you slide in and miss entirely, ending grounded and beaten
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

  const att: SceneActor = { x: ax, z: az, running: u < 0.95, hasBall: false, reach: null, lean: moveId === 'challenge' ? -goSide * 0.3 : 0 }
  const you: YouPose = {
    show: true, x: yx, z: yz,
    running: slide < 0.1 && u > 0.08 && u < 0.7,
    footTarget: reaching ? { x: goSide * 0.7, y: BALL_R, z: yz + 0.55 } : null,
    lean: moveId === 'dive' ? 0 : goSide * pulse(u, cF, 0.16),
    slide,
  }
  return { ball, att, you, contact: 0, contactPt: null }
}

export function DefenseSim({ state, onChange, showGoal, onGoal }: SimProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [phase, setPhase] = useState<Phase>('menu')
  const [answerStr, setAnswerStr] = useState('')
  const [streak, setStreak] = useState(0)
  const [best, setBest] = useState(() => { try { return Number(localStorage.getItem(BEST_KEY) ?? 0) || 0 } catch { return 0 } })
  // Reconcile the all-time record with Supabase for the signed-in user on mount.
  useEffect(() => { void fetchHighScore('momentum').then(setBest) }, [])
  // Gated first run (showGoal): the drill only finishes once you have won the ball
  // with ALL THREE challenges. Tracks which move ids are done.
  const [wonTypes, setWonTypes] = useState<MoveId[]>([])
  const [sound, setSound] = useState(true)
  const [showCalc, setShowCalc] = useState(false)
  const [robbed, setRobbed] = useState(false)
  const [, force] = useState(0)
  const rerender = useCallback(() => force((n) => n + 1), [])

  // The controlled defender wears YOUR equipped loadout. usePlayerKit merges the
  // equipped jersey + cleats COLOURS onto TEAM_KIT (shirt/shorts/socks/boots),
  // while preserving the structural identity fields (number, hair, skin, facing).
  // Held in a ref so the rAF draw loop reads the latest without re-subscribing;
  // the opponent attacker keeps his own distinct FOE_KIT.
  const teamKit = usePlayerKit(TEAM_KIT)
  const kitRef = useRef<Kit>(teamKit)
  kitRef.current = teamKit

  const sfx = useRef(new Sfx())
  const soundRef = useRef(sound); soundRef.current = sound
  const showCalcRef = useRef(showCalc); showCalcRef.current = showCalc
  const gameRef = useRef<Game>((() => { const r = makeRound(); return newGame(r.problems, r.openSide) })())
  const rafRef = useRef<number | null>(null)
  const bgRef = useRef<HTMLCanvasElement | null>(null)
  const gradRef = useRef<{ grass: CanvasGradient; vignette: CanvasGradient } | null>(null)
  const sceneRef = useRef({ onChange, state, onGoal, showGoal })
  sceneRef.current = { onChange, state, onGoal, showGoal }
  const goalFiredRef = useRef(false)
  const answerRef = useRef(answerStr); answerRef.current = answerStr
  const streakRef = useRef(streak); streakRef.current = streak
  const bestRef = useRef(best); bestRef.current = best
  const wonTypesRef = useRef(wonTypes); wonTypesRef.current = wonTypes

  const project = useCallback((x: number, y: number, z: number): P2 => {
    const cz = Math.max(0.05, z + CAM_BACK)
    const scale = FOCAL / cz
    return { sx: W / 2 + x * scale, sy: HORIZON - (y - EYE_Y) * scale, scale }
  }, [])

  // ===== Actions =====
  const nextRun = useCallback(() => {
    const r = makeRound()
    gameRef.current = newGame(r.problems, r.openSide)
    goalFiredRef.current = false
    // keep the won-tackles tally across the gated drill; only clear it once all
    // three are done (a fresh drill)
    if (wonTypesRef.current.length >= MOVES.length) setWonTypes([])
    setAnswerStr(''); setShowCalc(false); setRobbed(false)
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
    g.outcome = Math.abs(value - answerOf(p)) <= tolOf() ? 'beat' : 'lost'
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
    const clean = g.outcome === 'beat'
    if (clean && p) {
      g.scored = true; g.celebrate = 1
      const sc = flyScene(p.move.id, 'beat', g.openSide, g.attZ, 1)
      spawnConfetti(g, project(sc.ball.x, 1.0, sc.ball.z))
      if (soundRef.current) { sfx.current.tackle(); sfx.current.cheer() }
      const s = streakRef.current + 1
      setStreak(s)
      if (s > bestRef.current) { setBest(s); void saveHighScore('momentum', s) }
      const sceneNow = sceneRef.current
      sceneNow.onChange({ ...sceneNow.state, connections: Number(sceneNow.state.connections ?? 0) + 1 })
      if (sceneNow.showGoal) {
        // gated first run: tick this challenge off; only finish once all three
        // tackles have been won
        const already = wonTypesRef.current
        const next = already.includes(p.move.id) ? already : [...already, p.move.id]
        if (!already.includes(p.move.id)) setWonTypes(next)
        if (next.length >= MOVES.length && !goalFiredRef.current) {
          goalFiredRef.current = true
          sceneNow.onGoal?.()
        }
      } else if (!goalFiredRef.current) {
        goalFiredRef.current = true
        sceneNow.onGoal?.()
      }
    } else {
      // wrong answer: the miss animation has played; just reset the streak. The
      // result banner states the correct answer before the next round.
      if (soundRef.current) { sfx.current.beaten(); sfx.current.miss() }
      setStreak(0)
    }
    setPhase('result')
  }, [project])

  const dispossess = useCallback(() => {
    const g = gameRef.current
    if (g.phase !== 'solve') return
    g.robbed = true
    g.t = 0
    g.phase = 'robbed'
    if (soundRef.current) { sfx.current.ensure(); sfx.current.beaten() }
    setStreak(0)
    setRobbed(true)
    setPhase('robbed')
  }, [])

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

    const drawWorldPlayer = (x: number, z: number, kit: Kit, running: boolean, hasBall: boolean, action?: PlayerAction) =>
      drawPlayer(ctx, project(x, 0, z), project(x, 1.84, z), kit, now, running, hasBall, action)
    const drawWorldBall = (x: number, y: number, z: number, spin: number, squash = 0) => {
      const bp = project(x, y, z); const sh = project(x, 0, z)
      ctx.fillStyle = 'rgba(0,0,0,0.28)'
      ctx.beginPath(); ctx.ellipse(sh.sx, sh.sy, Math.max(4, BALL_R * sh.scale * 1.3), Math.max(2, BALL_R * sh.scale * 0.5), 0, 0, Math.PI * 2); ctx.fill()
      drawBall(ctx, bp.sx, bp.sy, Math.max(4, Math.min(74, BALL_R * bp.scale)), spin, squash)
    }
    const footAction = (target: V3, lean: number, slide = 0): PlayerAction => {
      const fp = project(target.x, target.y, target.z)
      return { footX: fp.sx, footY: fp.sy, lean, slide }
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

    // The defender you control wears the LIVE loadout kit; the attacker keeps his
    // distinct FOE_KIT. Read fresh each frame from the kit ref.
    const youKit = kitRef.current

    const animating = g.phase === 'fly' || (g.phase === 'result' && !g.robbed && g.outcome !== null)
    const u = g.phase === 'fly' ? clamp(g.t / FLY_DUR, 0, 1) : 1

    if (g.phase === 'robbed') {
      // TIMEOUT: you dithered, the attacker simply knocks it past you and drives
      // goal-side. You stay flat-footed. ONE ball, at his feet.
      const tu = clamp(g.t / ROB_CLOSE_S, 0, 1)
      const e = easeInOut(tu)
      const az = lerp(g.attZ, -0.3, e)
      const ax = lerp(0, g.openSide * 1.2, e)
      const ball: V3 = { x: ax + g.openSide * 0.3, y: BALL_R, z: az - 0.3 }
      // attacker nearer than you at the end → draw you first, him on top
      const drawAtt = () => drawWorldPlayer(ax, az, FOE_KIT, tu < 0.96, false)
      const drawYou = () => drawWorldPlayer(YOU_HOME.x, YOU_HOME.z, youKit, tu < 0.3, false)
      if (az >= YOU_HOME.z) { drawAtt(); drawYou() } else { drawYou(); drawAtt() }
      drawWorldBall(ball.x, ball.y, ball.z, now / 300)
    } else if (animating && g.picked && g.outcome) {
      const sc = flyScene(g.picked.move.id, g.outcome, g.openSide, g.attZ, u)
      // depth order: farther/up-pitch drawn first so the nearer one overlaps. On a
      // beat you finish nearer the camera (on top) with the ball; on a loss the
      // attacker bursts past and ends nearer (on top). ONE ball only.
      const drawAtt = () => {
        const act = sc.att.reach ? footAction(sc.att.reach, 0)
          : Math.abs(sc.att.lean) > 0.02 ? leanAction(sc.att.lean)
          : undefined
        drawWorldPlayer(sc.att.x, sc.att.z, FOE_KIT, sc.att.running, sc.att.hasBall, act)
      }
      const drawYou = () => {
        if (!sc.you.show) return
        const act = sc.you.footTarget ? footAction(sc.you.footTarget, sc.you.lean, sc.you.slide)
          : sc.you.slide > 0.05 ? { footX: null, footY: 0, lean: sc.you.lean, slide: sc.you.slide }
          : Math.abs(sc.you.lean) > 0.02 ? leanAction(sc.you.lean)
          : undefined
        drawWorldPlayer(sc.you.x, sc.you.z, youKit, sc.you.running, false, act)
      }
      if (sc.att.z >= sc.you.z) { drawAtt(); drawYou() } else { drawYou(); drawAtt() }
      drawWorldBall(sc.ball.x, sc.ball.y, sc.ball.z, g.t * 9, sc.contact * 0.4)
      if (sc.contactPt) drawContact(sc.contactPt, sc.contact)
    } else {
      // menu / solve: the attacker drives in at you with the ball at his feet
      // while you hold a defensive stance, shuffling to stay in front of him.
      const ph = (now / 1000) / 0.5 * Math.PI * 2
      const shuffle = Math.sin(ph) * 0.12
      drawWorldPlayer(0, g.attZ, FOE_KIT, g.phase === 'menu' || g.phase === 'solve', false)
      drawWorldBall(0, BALL_R, g.attZ - 0.45, now / 320)
      drawWorldPlayer(YOU_HOME.x + shuffle, YOU_HOME.z, youKit, false, false)
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
    const unlimited = !sceneRef.current.showGoal
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
      const solveName = g.picked ? unknownName(g.picked.dir) : 'momentum p'
      const label = `Solve the ${solveName}: ENTER to challenge` + calcLabel
      drawTimer(ctx, left, total, warn ? `Hurry! ${Math.ceil(left)}s left` : label, warn ? '#ff3b5f' : '#7ec8ff', warn)
    }
  }, [project])

  // ===== Loop =====
  useEffect(() => {
    let last = performance.now()
    const update = (dt: number) => {
      const g = gameRef.current
      const act = actionsRef.current
      if (g.phase === 'menu' || g.phase === 'solve') {
        g.attZ = Math.max(ATT_MIN, g.attZ - ATT_APPROACH * dt)
      }
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
  const outcome = g.outcome
  const unlimited = !showGoal
  const wonCount = wonTypes.length
  const allWon = !unlimited && wonCount >= MOVES.length
  // A wrong answer now opens the worked-solution lesson (its own navigation /
  // "Next attacker" continues the run), so it is intentionally excluded from the
  // click-anywhere-to-continue shortcut — otherwise the first click would skip it.
  const canClickContinue = phase === 'result' && (robbed || outcome === 'beat')

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

        {/* CHALLENGE MENU — pick a challenge with the key shown, or click it. */}
        {phase === 'menu' && (
          <div style={{ position: 'absolute', left: 0, right: 0, bottom: 16, display: 'flex', gap: 10, justifyContent: 'center', padding: '0 16px', pointerEvents: 'auto' }}>
            {g.problems.map((pr) => {
              const done = !unlimited && wonTypes.includes(pr.move.id)
              return (
                <button
                  key={pr.move.id}
                  type="button"
                  onClick={() => pickMove(pr)}
                  style={{
                    flex: '1 1 0', maxWidth: 196, background: done ? 'rgba(12,40,26,0.9)' : 'rgba(8,12,28,0.88)',
                    border: `2px solid ${done ? 'rgba(52,210,123,0.85)' : 'rgba(126,200,255,0.55)'}`, borderRadius: 14,
                    padding: '10px 12px', color: '#fff', cursor: 'pointer', textAlign: 'left',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                    <span style={{ background: done ? '#34d27b' : '#7ec8ff', color: '#06223f', fontWeight: 800, borderRadius: 7, padding: '1px 8px', fontSize: 14 }}>{pr.move.key}</span>
                    <strong style={{ fontSize: 14.5 }}>{pr.move.emoji} {pr.move.name}{done ? ' ✓' : ''}</strong>
                  </div>
                  <span style={{ fontSize: 11, opacity: 0.82, lineHeight: 1.25, display: 'block' }}>{pr.move.blurb} ({pr.move.who})</span>
                  <span style={{ fontSize: 10.5, opacity: 0.7, display: 'block', marginTop: 3 }}>{pr.dir === 'findP' ? 'find the momentum p = m·v' : pr.dir === 'findV' ? 'find the speed v = p/m' : 'find the mass m = p/v'}</span>
                </button>
              )
            })}
          </div>
        )}

        {phase === 'result' && outcome === 'beat' && (
          <div className="soccer__banner soccer__banner--goal">
            <strong>WON THE BALL! 🛡️</strong>
            <span>
              {p?.move.name} timed perfectly.{' '}
              {unlimited
                ? 'Click anywhere to continue.'
                : allWon
                  ? 'All three tackles won — moving on!'
                  : `${wonCount} / ${MOVES.length} done. Click to face the next.`}
            </span>
          </div>
        )}

        {phase === 'result' && outcome === 'lost' && !robbed && (
          <div className="soccer__banner soccer__banner--save">
            <strong>BEATEN 😖</strong>
            <span>{missText(p, g.played)} Click anywhere to continue.</span>
          </div>
        )}

        {/* Wrong answer → animated, multi-step worked-solution lesson (replaces the
            brief miss banner above, which it covers). No try-yourself sandbox. */}
        {phase === 'result' && outcome === 'lost' && !robbed && p && (
          <DefenseLesson p={p} used={g.played} onDone={nextRun} />
        )}

        {phase === 'result' && robbed && (
          <div className="soccer__banner soccer__banner--save">
            <strong>TOO SLOW ⛔</strong>
            <span>He knocked it past you and went. Click anywhere to try again.</span>
          </div>
        )}

        {phase === 'solve' && showCalc && <Calculator onClose={() => setShowCalc(false)} />}
      </div>

      <div className="soccer__side">
        {phase === 'menu' && (
          <div className="soccer__givens">
            <div className="is-key"><span>Read his</span><strong>p = m · v</strong></div>
            <div><span>Numbers change</span><strong>every run</strong></div>
            {unlimited
              ? <div><span>Pick with</span><strong>keys 1 – 3</strong></div>
              : <div className="is-key"><span>Tackles won</span><strong>{wonCount} / {MOVES.length}</strong></div>}
          </div>
        )}

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

        {phase === 'result' && outcome === 'beat' && p && (
          <p className="soccer__tip">Momentum checks out: {solvedText(p)} — you read it and timed the {p.move.name.toLowerCase()}. <b>Streak {streak}</b> · best {best}.</p>
        )}

        {phase === 'result' && outcome === 'lost' && !robbed && p && (
          <p className="soccer__tip">He beat you — {solvedText(p)}. <b>Streak reset.</b> Click the pitch or “Next attacker” to go again.</p>
        )}

        <div className="sim__controls">
          <div className="soccer__buttons">
            {phase === 'menu' && <button type="button" className="btn btn--primary" disabled>Pick a challenge ▸</button>}
            {phase === 'solve' && <button type="button" className="btn btn--primary" onClick={playMove} disabled={!answerStr}>Make the challenge 🛡️</button>}
            {phase === 'fly' && <button type="button" className="btn btn--primary" disabled>Going in…</button>}
            {phase === 'result' && <button type="button" className="btn btn--primary" onClick={nextRun}>Next attacker →</button>}
            <button type="button" className="btn btn--ghost" onClick={nextRun}>↻ Restart</button>
          </div>
        </div>
      </div>
    </div>
  )
}

function missText(p: Problem | null, used: number): string {
  if (!p) return 'Not quite — work the momentum again.'
  if (p.dir === 'findP') {
    return used > p.p
      ? `Too much — ${round1(used)} kg·m/s overcommits. p = m·v = ${p.p} kg·m/s.`
      : `Too little — ${round1(used)} kg·m/s and he rides through. p = m·v = ${p.p} kg·m/s.`
  }
  if (p.dir === 'findV') {
    return used > p.v
      ? `Too fast — ${round1(used)} m/s. v = p/m = ${p.v} m/s.`
      : `Too slow — ${round1(used)} m/s. v = p/m = ${p.v} m/s.`
  }
  return used > p.m
    ? `Too heavy — ${round1(used)} kg. m = p/v = ${p.m} kg.`
    : `Too light — ${round1(used)} kg. m = p/v = ${p.m} kg.`
}

// ============================================================================
// Wrong-answer lesson — an animated, multi-step worked solution for THIS
// attacker's momentum problem, modelled on KinematicsSim's SolveLesson. It walks
// p = m·v in whichever direction the challenge asked, one fill-the-blank step at a
// time, ending on the correct answer. Explanation slides ONLY: there is no
// try-yourself sandbox (only the shooting sims keep that). When it is done — via
// its own "Next attacker", "Skip explanation", or the side-panel button — the
// existing nextRun flow starts the next attacker.
// ============================================================================
function DefenseLesson({ p, used, onDone }: { p: Problem; used: number; onDone: () => void }) {
  const dir = p.dir
  const answer = answerOf(p)
  const unit = p.unit
  const uName = unknownName(dir) // 'momentum p' | 'speed v' | 'mass m'
  const uSym = dir === 'findP' ? 'p' : dir === 'findV' ? 'v' : 'm'
  // the right-hand side that isolates the unknown, then the numbers plugged in
  const rhsSym = dir === 'findP' ? 'm · v' : dir === 'findV' ? 'p / m' : 'p / v'
  const numExpr = dir === 'findP' ? `${p.m} · ${p.v}` : dir === 'findV' ? `${p.p} / ${p.m}` : `${p.p} / ${p.v}`
  // a "wrong operation / wrong variable" numeric distractor for the final compute
  const wrongOp = dir === 'findP' ? p.m + p.v : dir === 'findV' ? p.p / p.v : p.p / p.m

  // "What went wrong" — about the player's actual miss, not the worked solution.
  const tooHigh = used > answer
  const verdict = `You went with ${round1(used)} ${unit} — that reads his momentum ${tooHigh ? 'too high' : 'too low'}. The ${uName} works out to ${answer} ${unit}; here's how to get there.`

  // ---- paced, fill-the-blank worked steps ----
  const [stepIdx, setStepIdx] = useState(0)
  const [answered, setAnswered] = useState<boolean[]>(() => [false, false, false])
  const [pick, setPick] = useState<number | null>(null)
  const [checked, setChecked] = useState(false)
  const [revealed, setRevealed] = useState(false)
  const [showLessonCalc, setShowLessonCalc] = useState(false)
  // Stable-per-mount correct slot for each step's MCQ (3 steps, 3 options each).
  const slots = useMemo(() => Array.from({ length: 3 }, () => Math.floor(Math.random() * 3)), [])
  useEffect(() => { setPick(null); setChecked(false); setRevealed(false) }, [stepIdx])

  // Count-up "time spent learning" bar (informational — no auto-skip without a
  // sandbox to fall back to).
  const LEARN_LIMIT = 90
  const [elapsed, setElapsed] = useState(0)
  useEffect(() => {
    const start = performance.now()
    const id = window.setInterval(() => setElapsed((performance.now() - start) / 1000), 100)
    return () => window.clearInterval(id)
  }, [])
  const barPct = Math.min(100, (elapsed / LEARN_LIMIT) * 100)
  const learnBar = (
    <div className="soccer__learnbar">
      <span>⏱ Time spent learning</span>
      <div className="soccer__learnbar-track"><div className="soccer__learnbar-fill" style={{ width: `${barPct}%` }} /></div>
      <span className="soccer__learnbar-num">{elapsed.toFixed(0)}s</span>
    </div>
  )

  type Opt = { label: string; correct: boolean }
  const rotate = (opts: Opt[], offset: number): Opt[] => { const k = offset % opts.length; return [...opts.slice(k), ...opts.slice(0, k)] }
  const strOpts = (correctLabel: string, distractors: string[], offset: number): Opt[] =>
    rotate([{ label: correctLabel, correct: true }, ...distractors.map((l) => ({ label: l, correct: false }))], offset)
  const numFmt = (x: number) => `${round1(x)} ${unit}`
  // Build numeric options, nudging any distractor whose formatted label collides
  // with the correct one so the right answer is never duplicated.
  const numOpts = (correctVal: number, distractors: number[], offset: number): Opt[] => {
    const correctLabel = numFmt(correctVal)
    const seen = new Set<string>([correctLabel])
    const dist: string[] = []
    for (const dv of distractors) {
      let v = dv, label = numFmt(v), guard = 0
      while (seen.has(label) && guard < 12) { v = v * 1.08 + 1; label = numFmt(v); guard++ }
      seen.add(label); dist.push(label)
    }
    return rotate([{ label: correctLabel, correct: true }, ...dist.map((l) => ({ label: l, correct: false }))], offset)
  }

  const nameP = 'momentum p', nameV = 'speed v', nameM = 'mass m'
  const otherNames = [nameP, nameV, nameM].filter((n) => n !== uName)

  type Step = {
    n: string; cmp?: boolean; tag: string; prompt: string; options: Opt[]
    gate: 'check' | 'correct'
    card: (blank: ReactNode) => ReactNode
    solution: ReactNode
  }
  const steps: Step[] = [
    {
      n: '1', tag: 'Fill the blank', gate: 'check',
      prompt: 'A clean tackle starts with reading the right thing. Which quantity does this challenge ask for?',
      options: strOpts(uName, otherNames, slots[0]),
      card: (blank) => (<>
        <div className="soccer__step-formula">Momentum links mass and speed: p = m · v</div>
        <div className="soccer__step-plug">here you must find {blank}</div>
      </>),
      solution: <>The challenge asks for the <b>{uName}</b>.</>,
    },
    {
      n: '2', tag: 'Fill the blank', gate: 'check',
      prompt: `Rearrange p = m · v to get ${uSym} on its own. Which expression equals ${uSym}?`,
      options: strOpts(
        rhsSym,
        dir === 'findP' ? ['m + v', 'm / v'] : dir === 'findV' ? ['p · m', 'm / p'] : ['p · v', 'v / p'],
        slots[1],
      ),
      card: (blank) => (<>
        <div className="soccer__step-formula">Isolate {uSym} in p = m · v</div>
        <div className="soccer__step-plug">{uSym} = {blank}</div>
      </>),
      solution: <>{uSym} = <b>{rhsSym}</b>.</>,
    },
    {
      n: '★', cmp: true, tag: 'Solve it', gate: 'correct',
      prompt: `Now drop his numbers in: what is the ${uName}?`,
      options: numOpts(answer, [used, wrongOp], slots[2]),
      card: (blank) => (<>
        <div className="soccer__step-formula">Plug the numbers into {uSym} = {rhsSym}</div>
        <div className="soccer__step-plug">{uSym} = {numExpr} = {blank}</div>
      </>),
      solution: <>{uSym} = {numExpr} = <b>{answer} {unit}</b> — that's the momentum to time your {p.move.name.toLowerCase()} against.</>,
    },
  ]
  const N = steps.length
  const cur = steps[stepIdx]
  const last = stepIdx === N - 1
  const stepDone = answered[stepIdx]
  const pickedOpt = pick === null ? null : cur.options[pick]
  const pickedCorrect = !!pickedOpt?.correct

  // Pick a value for the blank (re-arms Check). Locked once the step is satisfied.
  const choose = (i: number) => { if (stepDone) return; setPick(i); setChecked(false) }
  // Computed steps proceed either way (a wrong check reveals the working to learn
  // from); the final gate only proceeds when the answer is correct.
  const checkAnswer = () => {
    if (pick === null || stepDone) return
    setChecked(true)
    if (pickedCorrect) setAnswered((a) => { const b = [...a]; b[stepIdx] = true; return b })
    else if (cur.gate === 'check') { setRevealed(true); setAnswered((a) => { const b = [...a]; b[stepIdx] = true; return b }) }
  }
  const blankSlot: ReactNode = pick === null
    ? <span className="soccer__blank">?</span>
    : <span className={`soccer__blank soccer__blank--filled${checked ? (pickedCorrect ? ' soccer__blank--ok' : ' soccer__blank--no') : ''}`}>{pickedOpt!.label}{checked ? (pickedCorrect ? ' ✓' : ' ✗') : ''}</span>
  const showSolution = revealed || (checked && !pickedCorrect && cur.gate === 'check')

  return (
    // stop the click-anywhere-to-continue capture so the student can work the steps
    <div className="soccer__lesson" onPointerDownCapture={(e) => e.stopPropagation()}>
      <div className="soccer__lesson-inner">
        <div className="soccer__lesson-head">
          <div className="soccer__lesson-emoji">😖</div>
          <div>
            <h2 className="soccer__lesson-title">Beaten — read his momentum</h2>
            <p className="soccer__lesson-sub">{verdict}</p>
          </div>
        </div>

        <div className="soccer__lesson-chips">
          <div className="chip"><span>challenge</span><strong>{p.move.emoji} {p.move.name}</strong></div>
          {dir === 'findP' ? (<>
            <div className="chip"><span>attacker mass</span><strong>m = {p.m} kg</strong></div>
            <div className="chip"><span>his speed</span><strong>v = {p.v} m/s</strong></div>
          </>) : dir === 'findV' ? (<>
            <div className="chip"><span>his momentum</span><strong>p = {p.p} kg·m/s</strong></div>
            <div className="chip"><span>attacker mass</span><strong>m = {p.m} kg</strong></div>
          </>) : (<>
            <div className="chip"><span>his momentum</span><strong>p = {p.p} kg·m/s</strong></div>
            <div className="chip"><span>his speed</span><strong>v = {p.v} m/s</strong></div>
          </>)}
          <div className="chip chip--lock"><span>find</span><strong>{uName} ({unit})</strong></div>
        </div>

        <div className="soccer__stepper">
          <div className="soccer__stepper-progress">
            <span>Step {stepIdx + 1} of {N}</span>
            <div className="soccer__stepper-dots">
              {steps.map((_, i) => <i key={i} className={i === stepIdx ? 'is-on' : i < stepIdx ? 'is-done' : ''} />)}
            </div>
          </div>
          {/* keyed so each reveal replays the big swap animation; the blank is filled
              by picking below, then checking. */}
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
              <span className="soccer__quiz-tag">{cur.tag}</span>
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
                    ? (last ? '✓ Correct! You read his momentum spot on.' : '✓ Correct! On you go.')
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
            ) : (<>
              <button type="button" className="btn btn--ghost" onClick={onDone}>Skip explanation</button>
              <button type="button" className="btn btn--primary soccer__try-btn" onClick={onDone} disabled={!stepDone}>Next attacker →</button>
            </>)}
          </div>
        </div>
      </div>
    </div>
  )
}

// ============================================================================
// Canvas drawing helpers (shared render kit with ForcesSim / KinematicsSim)
// ============================================================================
// `skinDark` is a one-shade-darker skin tone used for cheek/jaw + limb shading.
// `faceCamera` picks whether a figure shows a FACE (true) or the BACK of the head
// (false). The defender ("you") is trailed by the camera so you see his back;
// the attacker drives toward the camera so you see his face.
// YOUR PLAYER's BASE kit. The loadout (usePlayerKit) overrides ONLY the jersey
// design + cleat colour fields (jersey/jerseyDark/jerseyHi/number/accent/pattern/
// boot/bootDark). Everything below — white shorts, blue socks, collar, skin and
// hair — stays fixed so the body draws + animates correctly from behind.
const TEAM_KIT = {
  jersey: '#2f6df0', jerseyDark: '#1f4ec2', jerseyHi: '#6c9bff', collar: '#0d2f7a',
  shorts: '#f4f6fb', shortsDark: '#c4ccdb', sock: '#2f6df0', sockBand: '#ffffff',
  boot: '#15171f', bootDark: '#05060a', number: '#ffffff', num: 5, skin: '#e8b48a', skinDark: '#c2895f',
  hair: '#2c2016', hairStyle: 0, faceCamera: false,
}
const FOE_KIT = {
  jersey: '#ef4444', jerseyDark: '#b91c1c', jerseyHi: '#fca5a5', collar: '#7f1010',
  shorts: '#3a0d0d', shortsDark: '#250707', sock: '#ef4444', sockBand: '#ffe8e8',
  boot: '#15171f', bootDark: '#05060a', number: '#ffffff', num: 7, skin: '#b87a45', skinDark: '#945e31',
  hair: '#1a130c', hairStyle: 3, faceCamera: true,
}
// The render Kit for a figure. TEAM_KIT is YOUR PLAYER's BASE default; the
// component skins it with the equipped loadout via usePlayerKit (which overrides
// jersey/jerseyDark/jerseyHi/collar/shorts/shortsDark/sock/sockBand/boot/number
// and preserves num/skin/skinDark/hair/hairStyle/faceCamera). FOE_KIT is the
// opponent and is never loadout-skinned.
type Kit = typeof TEAM_KIT

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

// A two-segment limb (upper + lower) joined at a mid-point that is nudged by
// (bx,by) to read as a bent elbow/knee. The proximal segment is thicker than the
// distal one (thigh > shin, upper-arm > forearm). The START and END points are
// preserved EXACTLY, so kick/poke foot targets and hand anchors never move.
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
  return { jx, jy }
}

// Lightweight stylised FACE (front-facing figures, only when the head is big
// enough): small skin ears, a soft cheek/jaw shade, two eyes and a brow hint.
function drawFace(ctx: CanvasRenderingContext2D, cx: number, headY: number, headR: number, kit: Kit) {
  ctx.fillStyle = kit.skin
  ctx.beginPath(); ctx.arc(cx - headR * 0.88, headY + headR * 0.04, headR * 0.26, 0, Math.PI * 2); ctx.fill()
  ctx.beginPath(); ctx.arc(cx + headR * 0.88, headY + headR * 0.04, headR * 0.26, 0, Math.PI * 2); ctx.fill()
  ctx.save()
  ctx.beginPath(); ctx.arc(cx, headY, headR, 0, Math.PI * 2); ctx.clip()
  ctx.globalAlpha = 0.4; ctx.fillStyle = kit.skinDark
  ctx.beginPath(); ctx.arc(cx + headR * 0.55, headY + headR * 0.28, headR * 0.92, 0, Math.PI * 2); ctx.fill()
  ctx.restore()
  const eyeY = headY - headR * 0.02
  const eyeDx = headR * 0.38
  const eyeR = Math.max(1, headR * 0.13)
  ctx.fillStyle = '#23262f'
  ctx.beginPath(); ctx.arc(cx - eyeDx, eyeY, eyeR, 0, Math.PI * 2); ctx.fill()
  ctx.beginPath(); ctx.arc(cx + eyeDx, eyeY, eyeR, 0, Math.PI * 2); ctx.fill()
  ctx.strokeStyle = 'rgba(40,30,20,0.5)'; ctx.lineWidth = Math.max(1, headR * 0.11); ctx.lineCap = 'round'
  ctx.beginPath()
  ctx.moveTo(cx - eyeDx - eyeR, eyeY - headR * 0.3); ctx.lineTo(cx - eyeDx + eyeR, eyeY - headR * 0.36)
  ctx.moveTo(cx + eyeDx - eyeR, eyeY - headR * 0.36); ctx.lineTo(cx + eyeDx + eyeR, eyeY - headR * 0.3)
  ctx.stroke()
  ctx.lineCap = 'butt'
}

// BACK of the head (figures facing away from the camera): hair covers most of
// the skull, small ears at the sides, a faint nape shade — no eyes/face.
function drawBackHead(ctx: CanvasRenderingContext2D, cx: number, headY: number, headR: number, kit: Kit) {
  ctx.fillStyle = kit.skin
  ctx.beginPath(); ctx.arc(cx - headR * 0.9, headY + headR * 0.05, headR * 0.24, 0, Math.PI * 2); ctx.fill()
  ctx.beginPath(); ctx.arc(cx + headR * 0.9, headY + headR * 0.05, headR * 0.24, 0, Math.PI * 2); ctx.fill()
  ctx.fillStyle = kit.hair
  ctx.beginPath(); ctx.arc(cx, headY - headR * 0.04, headR * 0.98, Math.PI * 0.82, Math.PI * 2.18); ctx.fill()
  ctx.fillStyle = 'rgba(0,0,0,0.12)'
  ctx.beginPath(); ctx.arc(cx, headY + headR * 0.16, headR * 0.5, 0, Math.PI * 2); ctx.fill()
}

// Draw a head consistent with which way the figure faces: face vs back-of-head,
// with finer detail gated behind size. `detail` is the size gate.
function drawHead(ctx: CanvasRenderingContext2D, cx: number, headY: number, headR: number, kit: Kit, detail: boolean) {
  ctx.fillStyle = kit.skin; ctx.beginPath(); ctx.arc(cx, headY, headR, 0, Math.PI * 2); ctx.fill()
  if (!kit.faceCamera) { drawBackHead(ctx, cx, headY, headR, kit); return }
  if (detail) drawFace(ctx, cx, headY, headR, kit)
  drawHair(ctx, cx, headY, headR, kit.hairStyle, kit.hair)
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

type PlayerAction = { footX: number | null; footY: number; lean: number; slide?: number }

// Render YOUR PLAYER's equipped jersey DESIGN in the accent colour. The caller has
// already filled the torso with the base jersey colour + form shading and clipped to
// the torso path, so these shapes are automatically clipped to the shirt silhouette.
// (x0,y0,w,h) is the torso bounding box (top-left + size).
function drawJerseyPattern(ctx: CanvasRenderingContext2D, pattern: JerseyPattern, accent: string, x0: number, y0: number, w: number, h: number) {
  ctx.fillStyle = accent
  switch (pattern) {
    case 'stripes': {                                  // vertical accent stripes
      const n = 5
      const sw = w / (n * 2 - 1)
      for (let i = 0; i < n; i++) ctx.fillRect(x0 + i * sw * 2, y0, sw, h)
      break
    }
    case 'hoops': {                                    // horizontal accent bands
      const n = 4
      const bh = h / (n * 2 - 1)
      for (let i = 0; i < n; i++) ctx.fillRect(x0, y0 + i * bh * 2, w, bh)
      break
    }
    case 'sash': {                                     // one diagonal band shoulder→hip
      const bw = w * 0.34
      ctx.beginPath()
      ctx.moveTo(x0, y0 + h * 0.12)
      ctx.lineTo(x0 + bw, y0)
      ctx.lineTo(x0 + w, y0 + h * 0.6)
      ctx.lineTo(x0 + w - bw, y0 + h * 0.72)
      ctx.closePath(); ctx.fill()
      break
    }
    case 'halves': {                                   // left/right split
      ctx.fillRect(x0 + w / 2, y0, w / 2, h)
      break
    }
    case 'galaxy': {                                   // scattered accent flecks
      const pts: Array<[number, number]> = [
        [0.2, 0.16], [0.6, 0.1], [0.42, 0.38], [0.78, 0.46],
        [0.24, 0.6], [0.56, 0.74], [0.14, 0.84], [0.82, 0.8],
      ]
      const r = Math.max(1.2, w * 0.055)
      for (const [u, v] of pts) { ctx.beginPath(); ctx.arc(x0 + u * w, y0 + v * h, r, 0, Math.PI * 2); ctx.fill() }
      break
    }
    case 'plain':
    default:
      break
  }
}

function drawPlayer(ctx: CanvasRenderingContext2D, feet: P2, head: P2, kit: Kit, now: number, running: boolean, hasBall: boolean, action?: PlayerAction) {
  const scale = feet.scale
  if (scale < 4 || scale > 360) return
  // grounded slide-tackle pose is drawn by a dedicated renderer
  if (action && (action.slide ?? 0) > 0.05) { drawSlidePlayer(ctx, feet, head, kit, action, action.slide ?? 0); return }
  const ph = now / 80
  const bob = running ? Math.abs(Math.sin(ph)) * 0.055 * scale : 0
  const cx = feet.sx
  const footY = feet.sy - bob
  const headY = head.sy - bob // top-of-head anchor (projected crown) for YOUR PLAYER
  // YOUR PLAYER is the back-facing defender; the attacker faces the camera and is
  // left on the original render path untouched.
  const isSelf = !kit.faceCamera
  // BOTH the back-facing defender AND the front-facing attacker now draw from the
  // canonical athletic build (shared with the card + every other drill), so they
  // are the same footballer — only the kit colours + facing differ.
  const m = bodyMetrics(headY, footY)
  const hipY = m.hipY
  // shoulders sit just below the head so the neck is a short stub, not a pole
  const wBody = m.shoulderW
  const lw = m.legW
  const headR = m.headR
  const headCenterY = m.headCY
  const shoulderY = m.shoulderY
  const torsoH = hipY - shoulderY + 2
  const leanX = action ? clamp(action.lean, -1, 1) * wBody * 0.55 : 0
  const cxU = cx + leanX
  const hipX = cx + leanX
  const detail = headR > 6.5

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
  // Both figures share the standardised lower-body renderer. The pose (hip CENTRE +
  // the animated foot anchors + leg width) is reused for the legs and the white
  // shorts. For the attacker the sock takes its RED jersey colour + dark cleat.
  const bodyPose = {
    hipX, hipY,
    lFootX: footLx, lFootY: footLy, rFootX: footRx, rFootY: footRy,
    legW: lw,
    sock: kit.sock,
    boot: kit.boot,
    bootDark: (kit as { bootDark?: string }).bootDark ?? kit.boot,
    detail,
  }
  // skin thigh → jersey-coloured sock shin + sock cuffs + boots, BEFORE the torso
  drawPlayerLegs(ctx, bodyPose)
  ctx.lineCap = 'butt'

  // NECK — short skin stub so the head sits just above the shoulders
  ctx.strokeStyle = kit.skin; ctx.lineWidth = headR; ctx.lineCap = 'round'
  ctx.beginPath(); ctx.moveTo(cxU, shoulderY + 1); ctx.lineTo(cxU, headCenterY + headR * 0.95); ctx.stroke()
  ctx.lineCap = 'butt'

  // TORSO — trapezoid: wide shoulders tapering to a narrower waist
  const topW = wBody
  const botW = m.waistW
  const torsoBot = shoulderY + torsoH
  const torsoPath = () => {
    ctx.beginPath()
    ctx.moveTo(cxU - topW / 2, shoulderY)
    ctx.lineTo(cxU + topW / 2, shoulderY)
    ctx.lineTo(cxU + botW / 2, torsoBot)
    ctx.lineTo(cxU - botW / 2, torsoBot)
    ctx.closePath()
  }
  ctx.fillStyle = kit.jersey; torsoPath(); ctx.fill()
  // centre shade stripe (right of midline) + lighter left edge highlight
  ctx.fillStyle = kit.jerseyDark; ctx.fillRect(cxU + wBody * 0.16, shoulderY + 2, wBody * 0.3, torsoH - 3)
  ctx.fillStyle = kit.jerseyHi; ctx.fillRect(cxU - wBody * 0.42, shoulderY + torsoH * 0.12, wBody * 0.1, torsoH * 0.6)
  // YOUR PLAYER's loadout jersey DESIGN in the accent colour, clipped to the torso
  // silhouette (the squad number is added on top below). The attacker has no pattern.
  if (isSelf) {
    const pattern = ((kit as any).pattern ?? 'plain') as JerseyPattern
    const accent = (kit as any).accent ?? kit.jerseyDark
    ctx.save(); torsoPath(); ctx.clip()
    drawJerseyPattern(ctx, pattern, accent, cxU - topW / 2, shoulderY, topW, torsoH)
    ctx.restore()
  }

  // SHORTS — the standardised white football shorts, AFTER the torso (both figures).
  ctx.lineCap = 'round'
  drawPlayerShorts(ctx, bodyPose)
  ctx.lineCap = 'butt'

  const armSwing = running ? Math.sin(ph + Math.PI) * 0.18 * scale : 0
  const armBal = action ? -leanX * 0.5 : 0
  // Both figures' arms are the shared, standardised renderer (jersey sleeve over the
  // upper arm + skin forearm + hand) so they match the card model. Start from the
  // canonical idle hands at the sides and ADD the running swing + lean balance on top.
  // The attacker uses its RED jersey for the sleeves.
  const hands = idleHands(cxU, m)
  drawPlayerArms(ctx, {
    cx: cxU,
    shoulderY: m.shoulderY,
    shoulderW: m.shoulderW,
    armW: m.armW,
    lHandX: hands.lHandX - armSwing + armBal,
    lHandY: hands.lHandY,
    rHandX: hands.rHandX + armSwing + armBal,
    rHandY: hands.rHandY,
    sleeve: kit.jersey,
    sleeveDark: kit.jerseyDark,
  })

  ctx.fillStyle = kit.collar; ctx.fillRect(cxU - wBody * 0.2, shoulderY, wBody * 0.4, Math.max(1.5, torsoH * 0.1))
  if (wBody > 9) {
    ctx.fillStyle = kit.number
    ctx.font = `800 ${Math.round(wBody * 0.5)}px Plus Jakarta Sans, sans-serif`
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
    ctx.fillText(String(kit.num), cxU, shoulderY + torsoH * 0.52)
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic'
  }

  if (hasBall) {
    const br = Math.max(4, BALL_R * scale)
    const bx = cx + wBody * 0.5
    const by = feet.sy
    ctx.fillStyle = 'rgba(0,0,0,0.3)'
    ctx.beginPath(); ctx.ellipse(bx, by + 2, br * 1.2, br * 0.45, 0, 0, Math.PI * 2); ctx.fill()
    drawBall(ctx, bx, by - br * 0.7, br, now / 320, 0)
  }

  drawHead(ctx, cxU, headCenterY, headR, kit, detail)
  ctx.lineCap = 'butt'
}

// A grounded slide-tackle pose: the hips drop near the turf, the body reclines
// back away from the slide direction, the leading leg extends to the ball and
// the trailing leg tucks under. `s` (0..1) blends from a low lunge into a full
// slide so the commit eases in and the defender pops back up at the end.
function drawSlidePlayer(ctx: CanvasRenderingContext2D, feet: P2, head: P2, kit: Kit, action: PlayerAction, s: number) {
  const scale = feet.scale
  // Body-part SIZES come from the canonical athletic build (head, limbs, torso
  // taper) derived from the representative standing span (crown anchor → feet),
  // so the grounded defender is the SAME build as the standing player and every
  // other drill. `wBody` stays the geometry unit so the slide pose/orientation
  // is unchanged — only the drawn body sizes are standardised.
  const mb = bodyMetrics(head.sy, feet.sy)
  const wBody = Math.max(5, 0.4 * scale)
  const lw = mb.legW
  const headR = mb.headR
  // torso thickness honours the shoulder→waist taper (single capsule → mid value)
  const torsoW = (mb.shoulderW + mb.waistW) / 2
  const groundY = feet.sy
  const dir = action.footX != null ? (Math.sign(action.footX - feet.sx) || 1) : 1
  const detail = headR > 6.5

  // elongated ground shadow
  ctx.fillStyle = 'rgba(0,0,0,0.28)'
  ctx.beginPath(); ctx.ellipse(feet.sx, groundY + 1, wBody * (1.1 + 0.5 * s), wBody * 0.32, 0, 0, Math.PI * 2); ctx.fill()

  const hipX = feet.sx - dir * wBody * 0.18 * s
  const hipY = groundY - wBody * (0.06 + 0.18 * s)
  // leading leg reaches the ball (or extends forward if no target)
  const leadX = action.footX != null ? action.footX : feet.sx + dir * wBody * (0.8 + 0.7 * s)
  const leadY = action.footX != null ? action.footY : groundY - wBody * 0.04
  // trailing leg tucks under and behind the hip
  const trailX = hipX - dir * wBody * (0.3 + 0.35 * s)
  const trailY = groundY
  // torso reclines up-and-back; shoulders come down as the slide deepens
  const shoX = hipX - dir * wBody * 0.7 * s
  const shoY = hipY - wBody * (0.96 - 0.5 * s)
  const headX = shoX - dir * wBody * 0.42 * s
  const headY = shoY - wBody * (0.4 - 0.04 * s) - headR * 0.2

  // LEGS + boots — the standardised shared lower-body renderer, posed with the
  // slide's hip centre and the two splayed foot anchors (leading + trailing leg).
  const slidePose = {
    hipX, hipY,
    lFootX: leadX, lFootY: leadY, rFootX: trailX, rFootY: trailY,
    legW: lw,
    sock: kit.sock,
    boot: kit.boot,
    bootDark: (kit as { bootDark?: string }).bootDark ?? kit.boot,
    detail,
  }
  drawPlayerLegs(ctx, slidePose)

  // NECK — short skin stub from the shoulders to just under the head
  ctx.lineCap = 'round'
  ctx.strokeStyle = kit.skin; ctx.lineWidth = headR * 0.9
  ctx.beginPath(); ctx.moveTo(shoX, shoY); ctx.lineTo(headX, headY + headR * 0.85); ctx.stroke()

  // torso as a thick capsule from hip to shoulder, with shade + highlight
  ctx.strokeStyle = kit.jersey; ctx.lineWidth = torsoW
  ctx.beginPath(); ctx.moveTo(hipX, hipY); ctx.lineTo(shoX, shoY); ctx.stroke()
  ctx.strokeStyle = kit.jerseyDark; ctx.lineWidth = torsoW * 0.33
  ctx.beginPath(); ctx.moveTo(hipX + dir * wBody * 0.18, hipY); ctx.lineTo(shoX + dir * wBody * 0.18, shoY); ctx.stroke()
  ctx.strokeStyle = kit.jerseyHi; ctx.lineWidth = torsoW * 0.13
  ctx.beginPath(); ctx.moveTo(hipX - dir * wBody * 0.22, hipY); ctx.lineTo(shoX - dir * wBody * 0.22, shoY); ctx.stroke()
  ctx.lineCap = 'butt'

  // SHORTS — the standardised white football shorts (same pose), AFTER the torso.
  drawPlayerShorts(ctx, slidePose)

  // arms: leading arm forward for balance, trailing arm back — jointed, hands
  const armProx = Math.max(2, mb.armW * 1.05), armDist = Math.max(1.6, mb.armW * 0.9)
  const leadHandX = shoX + dir * wBody * 0.85, leadHandY = shoY + wBody * 0.16
  const trailHandX = shoX - dir * wBody * 0.45, trailHandY = shoY - wBody * 0.55
  drawLimb(ctx, shoX, shoY, leadHandX, leadHandY, 0, wBody * 0.08, armProx, armDist, kit.skin)
  drawLimb(ctx, shoX, shoY, trailHandX, trailHandY, -dir * wBody * 0.05, -wBody * 0.04, armProx, armDist, kit.skin)
  ctx.fillStyle = kit.skin
  ctx.beginPath(); ctx.arc(leadHandX, leadHandY, armDist * 0.85, 0, Math.PI * 2); ctx.fill()
  ctx.beginPath(); ctx.arc(trailHandX, trailHandY, armDist * 0.85, 0, Math.PI * 2); ctx.fill()
  ctx.lineCap = 'butt'

  drawHead(ctx, headX, headY, headR, kit, detail)
  ctx.lineCap = 'butt'
}

function drawBall(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, spin: number, squash = 0) {
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

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath(); ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath()
}

function buildStaticBackground(): HTMLCanvasElement {
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
