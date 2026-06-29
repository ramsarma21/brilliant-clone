import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { SimProps } from './types'
import { Calculator } from './Calculator'
import { usePlayerKit } from '../../lib/playerKit'
import { useOpponentClashGuard, DRILL_COLORS } from '../../lib/teams'
import { drawPlayerLegs, drawPlayerShorts, bodyMetrics, drawPlayerArms, idleHands } from '../../lib/playerCanvas'
import { fetchHighScore, saveHighScore } from '../../lib/scores'
import type { JerseyPattern } from '../../types'

// ============================================================================
// Forces unit — soccer skill = DRIBBLING PRACTICE (the move-menu drill).
//
// A defender approaches while you dribble. A MOVE MENU offers three distinct
// dribbling moves, each bound to a keyboard key (1/2/3). You PICK a move with
// the key (or by clicking it); that choice is the decision. Executing the move
// asks ONE Newton's-2nd-law question about the force your foot puts on the ball.
//
// Every move pushes the SAME regulation ball, so the mass is the constant
// m = 0.43 kg across all moves and rounds. Each round alternates the two solve
// directions:
//
//   • solve FORCE given mass + acceleration:   F = m · a
//   • solve ACCELERATION given force + mass:    a = F / m
//
// The spin move comes out of a roulette turn: after shielding and rotating, the
// foot accelerates the ball out of the turn into space, still framed as F = m · a.
//
// Flow per round: menu (defender closing) → solve (fixed 30 s, formula always
// shown, calculator drains the clock at 1.25×) → fly (the chosen move animates).
//   • Correct → the move comes off, you beat your man, streak/score up, onGoal
//     fires and connections increments. Click anywhere to continue.
//   • Wrong → the miss plays out, the defender wins it and the brief result text
//     names the correct answer. Click anywhere for the next run.
//   • Run the 30 s down → the defender steps up and dispossesses you.
//
// Answers are decimals; we accept anything within 1.0 of the exact value, so the
// player may round to the nearest whole number either way.
//
// There is no click-to-place reticle and no safe-zone box. The choice is the
// move; the physics is the force behind it.
// ============================================================================

// ---- Camera / canvas (identical feel to KinematicsSim / MotionSim) ----
const W = 900
const H = 560
const HORIZON = H * 0.4
// Third-person view: the camera sits CAM_BACK metres behind the dribbler and a
// little above him (raised eye height), so you watch your own avatar take the
// man on. Depth is offset by CAM_BACK inside project(); there is no screen->world
// inverse projection in this sim (the move menu replaced click-to-place), so no
// inverse needs to subtract it.
const EYE_Y = 2.4
const FOCAL = 560
const CAM_BACK = 6 // metres the camera trails behind the player (world z = 0)

// ---- World (metres) ----
const RELEASE = { y: 0.12, z: 0.8 } // ground ball resting at your feet
const BALL_R = 0.13
// Home of the dribbler ("you") in third-person: a touch left of and just ahead
// of the camera, so the avatar sits low-centre with the ball at his feet and
// never masks the defender, the loose ball, or the move menu.
const YOU_HOME = { x: -0.9, z: 0.25 }

// ---- The constant: every move is the foot pushing the SAME regulation ball ----
const BALL_MASS = 0.43 // kg (FIFA Law 2 regulation mass) — never changes

const BEST_KEY = 'physics-dribble-best'

// ---- Solve economy (FIXED — no difficulty scaling) ----
const SOLVE_MS = 30000 // every picked move gets a flat 30 s to solve
const SOLVE_WARN_MS = 10000 // last 10 s get an urgent red countdown
const CALC_DRAIN = 1.25 // opening the calculator drains the clock at 1.25×

// ---- Defender (closes you down while you size up the move) ----
const DEF_START = 9.2 // metres in front when the menu opens
const DEF_MIN = 4.4 // closest he gets before you have to commit
const DEF_APPROACH = 0.55 // m/s he drifts in as he marks

// ---- Move animation ----
const FLY_DUR = 1.7 // seconds the executed move plays out

// ---- Timeout dispossession (the "too slow" turnover) ----
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
// The three dribbling moves. Each is a real thing the foot does to the ball, so
// each maps to an honest F = m·a question about that exact motion.
// Accelerations are kept to multiples of 10 m/s² so that, with m = 0.43 kg,
//   F = m·a is exact to one decimal AND a = F/m recovers the integer cleanly.
// ============================================================================
type Dir = 'findF' | 'findA'
type MoveId = 'inout' | 'chip' | 'spin'

type MoveDef = {
  id: MoveId
  key: string
  name: string
  emoji: string
  blurb: string
  // how the force question is framed for this specific move
  ctxF: (a: number) => string // describe finding the force
  ctxA: (f: number) => string // describe finding the acceleration
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

// The GIVEN quantity is a fresh random integer each run. 1..50 (never 0) so the
// answer is never trivially zero and a = F/m never divides into a degenerate
// case. The mass is the lone CONSTANT (m = 0.43 kg); we only ever solve for F or
// a, never for m.
const GIVEN_MIN = 1
const GIVEN_MAX = 50
const randGiven = () => GIVEN_MIN + Math.floor(Math.random() * (GIVEN_MAX - GIVEN_MIN + 1))
const randDir = (): Dir => (Math.random() < 0.5 ? 'findF' : 'findA')

type Problem = {
  move: MoveDef
  dir: Dir
  m: number // 0.43 kg, always (the constant)
  a: number // m/s² — the GIVEN when findF, else the rounded answer for display
  F: number // N — the GIVEN when findA, else the rounded answer for display
  answer: number // EXACT value the player solves for (graded against this)
  unit: string // 'N' or 'm/s²'
}

const answerOf = (p: Problem) => p.answer
// Answers are decimals, but we accept anything within 1.0 of the exact value so
// the player may round to the nearest whole number EITHER way (e.g. exact 53.44
// counts for both 53 and 54). Flat tolerance, not a percentage.
const tolOf = (_p: Problem) => 1.0001

// A freshly randomized problem for the given move + solve direction. The mass is
// the constant 0.43 kg; the given integer drives one exact decimal answer.
function makeProblem(move: MoveDef, dir: Dir): Problem {
  const given = randGiven()
  if (dir === 'findF') {
    const exactF = BALL_MASS * given // 0.43 · a (a = given m/s²)
    return { move, dir, m: BALL_MASS, a: given, F: round1(exactF), answer: exactF, unit: 'N' }
  }
  const exactA = given / BALL_MASS // F / 0.43 (F = given N)
  return { move, dir, m: BALL_MASS, a: round1(exactA), F: given, answer: exactA, unit: 'm/s²' }
}

// Build the round's three move problems. Each move independently draws a fresh
// random GIVEN and a randomly chosen solve direction, so the menu mixes "find F"
// and "find a" and every run is a different question.
function makeRound(): { problems: Problem[]; openSide: 1 | -1 } {
  const problems = MOVES.map((move) => makeProblem(move, randDir()))
  return { problems, openSide: Math.random() < 0.5 ? 1 : -1 }
}

// ---- minimal sound (same toolkit as MotionSim) ----
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
  knock() { this.burst(380, 0.6, 0.12, 0.28); this.tone(140, 0.1, 'sine', 0.18) }
  whistle() { this.tone(2100, 0.18, 'square', 0.08); this.tone(2400, 0.18, 'square', 0.06, 0.04) }
  cheer() { this.burst(900, 0.4, 0.6, 0.28) }
  steal() { this.tone(150, 0.22, 'sawtooth', 0.2) }
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
  // fly
  t: number
  outcome: Outcome | null
  played: number // the answer actually played
  // defender approach (menu/solve)
  defZ: number
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
  defZ: DEF_START,
  resolved: false, scored: false, celebrate: 0, particles: [], robbed: false,
})

// ============================================================================
// The executed-move scene: where the ball, the defender and "you" are at
// progress u ∈ [0,1]. Each move traces a visibly different world path so the
// animation reads as the move named in the menu and matches the physics.
// ============================================================================
type V3 = { x: number; y: number; z: number }
type SceneActor = { x: number; z: number; running: boolean; hasBall: boolean; reach: V3 | null }
// The dribbler ("you"). `footTarget` is the world point his near foot should be
// glued to (the ball while he is carrying/striking it, then a short follow-
// through point); when null he is in his running gait. `lean` (-1..1) tilts the
// body into the touch. `contact`/`contactPt` drive the contact cue (puff +
// ball squash) at the decisive frame.
type YouPose = { show: boolean; x: number; z: number; running: boolean; footTarget: V3 | null; lean: number }
type Scene = { ball: V3; def: SceneActor; you: YouPose; contact: number; contactPt: V3 | null }

// A short triangular pulse centred on `c` with half-width `w`, used to fire the
// contact cue/squash exactly around a move's contact frame.
const pulse = (u: number, c: number, w: number) => Math.max(0, 1 - Math.abs(u - c) / w)

function flyScene(moveId: MoveId, outcome: Outcome, openSide: number, defZ: number, u: number): Scene {
  return outcome === 'lost'
    ? lostScene(moveId, openSide, defZ, u)
    : beatScene(moveId, openSide, defZ, u)
}

// ----------------------------------------------------------------------------
// A clean move = a DRIBBLE PAST your man into space. The ball stays at the foot
// through a short plant/load, then at the per-move CONTACT FRAME (cF) the
// decisive touch routes it AROUND the defender onto the open side. The dribbler
// BURSTS onto it and carries it through, finishing clearly UP-PITCH of the
// defender (endZ, beyond defZ) with the ball at his feet in space — so you come
// out the far side and the beaten man is left trailing nearer the camera. The
// two ground moves (in & out, spin) keep the ball rolling on the turf the whole
// way; only the chip leaves the ground, clearing his foot then dropping back to
// the grass to be run onto. The defender commits (often the WRONG way), is
// beaten, then half-turns to chase and falls behind. He never touches the ball.
// ----------------------------------------------------------------------------
function beatScene(moveId: MoveId, openSide: number, defZ: number, u: number): Scene {
  const goSide = openSide // the open side you finish on, out past your man
  // ~120-200 ms of plant/load precede each contact (cF is the contact frame).
  const cF = moveId === 'chip' ? 0.22 : moveId === 'spin' ? 0.55 : 0.30
  const leanDir = moveId === 'chip' ? 0 : goSide
  // The carry finishes CLEARLY up-pitch of the defender (endZ beyond defZ) and a
  // touch onto the open side (LANE), so you come out the far side with the ball
  // at your feet and your man left behind.
  const endZ = defZ + 2.4
  const LANE = 1.3

  const ballAt = (uu: number): V3 => {
    if (moveId === 'inout') {
      // feint to the CLOSED side, plant, then the real contact cuts it the OTHER
      // way onto the open side and past him. Stays rolling on the grass.
      if (uu < 0.16) return { x: -goSide * 0.5 * easeOut(uu / 0.16), y: BALL_R, z: RELEASE.z }
      if (uu < cF) return { x: lerp(-goSide * 0.5, -goSide * 0.15, (uu - 0.16) / (cF - 0.16)), y: BALL_R, z: RELEASE.z }
      const k = easeOut((uu - cF) / (1 - cF))
      return { x: lerp(-goSide * 0.15, goSide * LANE, k), y: BALL_R, z: lerp(RELEASE.z, endZ, k) }
    }
    if (moveId === 'chip') {
      // scoop up over his foot, clear him, then drop back onto the turf in space
      // on the open side so you run onto it past him. The ONLY airborne move.
      if (uu < cF) return { x: 0, y: BALL_R, z: RELEASE.z }
      const k = easeOut((uu - cF) / (1 - cF))
      return { x: lerp(0, goSide * LANE, k), y: BALL_R + 1.7 * Math.sin(Math.PI * Math.min(1, k)), z: lerp(RELEASE.z, endZ, k) }
    }
    // spin: roll a tight roulette loop at the feet (grounded drag/roll touches),
    // then at cF burst out the open side and away up-pitch past him.
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

  // The near foot is glued to the ball through control + plant + strike, follows
  // through just past the contact point, then meets the ball again on a dribble
  // cadence as he carries it into space (small touches). It skips the brief
  // moment the chip is airborne (the foot does not chase the ball up).
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

  // The defender commits (often the WRONG way), gets beaten as you go past, then
  // half-turns to chase and is left trailing nearer the camera. `commit` lunges
  // him in; `recover` swings him round late but he never catches up in depth, so
  // he ends BEHIND you (smaller z). He never touches the ball on a clean move.
  const commit = easeOut(clamp(u / 0.45, 0, 1))
  const recover = easeInOut(clamp((u - 0.45) / 0.55, 0, 1))
  const def: SceneActor = { x: 0, z: defZ, running: u < 0.98, hasBall: false, reach: null }
  if (moveId === 'inout') {
    // bites the feint to the closed side and steps up, then swings back to chase
    def.x = lerp(0, -goSide * 1.8, commit) + lerp(0, goSide * 2.2, recover)
    def.z = defZ + lerp(0, 0.7, commit) - lerp(0, 1.7, recover)
  } else if (moveId === 'chip') {
    // steps up to block, gets chipped over, turns late and drops in behind
    def.x = lerp(0, goSide * 0.35, recover)
    def.z = defZ + lerp(0, 0.9, commit) - lerp(0, 1.5, recover)
  } else {
    // wrong-footed by the roulette, then trails out of the spin
    def.x = lerp(0, -goSide * 1.5, commit) + lerp(0, goSide * 1.9, recover)
    def.z = defZ + lerp(0, 0.5, commit) - lerp(0, 1.8, recover)
  }

  // The avatar plants beside the contact point, then BURSTS into space staying
  // right on the ball: the ball sits a tight touch-distance ahead at his feet, a
  // controlled carry rather than a lonely roll. He finishes just behind it and
  // clearly up-pitch of the beaten man. He tracks the ball's ground (x, z) even
  // while the chip is airborne, so he is there when it drops.
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

// ----------------------------------------------------------------------------
// A wrong answer. The dribbler plays the (mishit) touch he picked, the defender
// steps across and reaches a leg in to make real contact at the STEAL frame,
// the ball deflects off his foot and settles on the GROUND at his feet. Each
// move keeps its failure read: the cut is read, the chip is too flat, the spin
// is closed down. Exactly one ball is drawn (loose until won, then his
// foot-ball via hasBall).
// ----------------------------------------------------------------------------
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
    // his foot reaches the ball around the steal frame to make the nick
    reach: !won && u > STEAL - 0.14 && u < STEAL + 0.16 ? ball : null,
  }

  // dribbler keeps his foot on the ball through his touch, then is beaten
  const you: YouPose = {
    show: true,
    x: lerp(YOU_HOME.x, -openSide * 0.2, ez * 0.5),
    z: lerp(YOU_HOME.z, RELEASE.z - 0.3, ez * 0.5),
    running: u >= STEAL && u < 0.72,
    footTarget: u < STEAL ? ball : null,
    lean: openSide * pulse(u, cF, 0.12),
  }

  // his touch fires a soft cue at cF; the defender's nick fires the stronger
  // cue at STEAL. No cue once the ball is dead at his feet.
  const cSteal = pulse(u, STEAL, 0.06)
  const cTouch = pulse(u, cF, 0.06) * 0.65
  const contact = won ? 0 : Math.max(cSteal, cTouch)
  const contactPt = won ? null : ball

  return { ball, def, you, contact, contactPt }
}

export function ForcesSim({ state, onChange, showGoal, onGoal, matchMode, onResolve }: SimProps) {
  // ---- Match-mode wiring (see SimProps) -----------------------------------
  // When matchMode is true this drill is ONE moment inside a live match: the
  // player still sees the scene and answers the SAME question, but the attempt
  // resolves exactly once (via onResolve) and then freezes on its final frame.
  // It does NOT loop, restart, persist scores, fire onGoal, or show the
  // remediation lesson / streak HUD. A correct answer is treated as a guaranteed
  // beat-your-man (gated semantics) so the question maps 1:1 to success/failure.
  // Live refs keep the loop + callbacks reading the latest props; resolvedOnceRef
  // makes onResolve fire AT MOST once per mount.
  const onResolveRef = useRef(onResolve); onResolveRef.current = onResolve
  const matchModeRef = useRef(matchMode); matchModeRef.current = matchMode
  const resolvedOnceRef = useRef(false)

  // Universal appearance: the dribbler the user controls is drawn from the LIVE
  // equipped loadout, so changing the player card updates this drill globally.
  // We keep the kit in a ref so the canvas draw loop reads the latest value.
  // Start from TEAM_KIT (structure + identity bits) and merge the equipped
  // jersey + cleats COLOURS over it; skin/hair/number/facing are preserved.
  const teamKit = usePlayerKit(TEAM_KIT)
  const youKitRef = useRef<Kit>(teamKit)
  youKitRef.current = teamKit
  // Opponent defender: distinct club colour in the lessons, red in the Training Ground —
  // and never the same kit as YOUR equipped jersey.
  useOpponentClashGuard(FOE_KIT, DRILL_COLORS.forces, teamKit.jersey)

  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [phase, setPhase] = useState<Phase>('menu')
  const [answerStr, setAnswerStr] = useState('')
  const [streak, setStreak] = useState(0)
  const [best, setBest] = useState(() => { try { return Number(localStorage.getItem(BEST_KEY) ?? 0) || 0 } catch { return 0 } })
  useEffect(() => { void fetchHighScore('forces').then(setBest) }, [])
  // Gated first run (showGoal): the drill only finishes once you have beaten your
  // man with ALL THREE moves. Tracks which move ids are done.
  const [wonTypes, setWonTypes] = useState<MoveId[]>([])
  const [sound, setSound] = useState(true)
  const [showCalc, setShowCalc] = useState(false)
  // Ran the solve clock down without committing: the defender robbed you. A
  // non-lesson turnover — reset the streak, click anywhere to play on.
  const [robbed, setRobbed] = useState(false)
  const [, force] = useState(0)
  const rerender = useCallback(() => force((n) => n + 1), [])

  const sfx = useRef(new Sfx())
  const soundRef = useRef(sound); soundRef.current = sound
  const showCalcRef = useRef(showCalc); showCalcRef.current = showCalc
  const gameRef = useRef<Game>((() => { const r = makeRound(); return newGame(r.problems, r.openSide) })())
  const rafRef = useRef<number | null>(null)
  const bgRef = useRef<HTMLCanvasElement | null>(null)
  const gradRef = useRef<{ grass: CanvasGradient; vignette: CanvasGradient } | null>(null)
  const sceneRef = useRef({ onChange, state, onGoal, showGoal, matchMode })
  sceneRef.current = { onChange, state, onGoal, showGoal, matchMode }
  const goalFiredRef = useRef(false)
  const answerRef = useRef(answerStr); answerRef.current = answerStr
  const streakRef = useRef(streak); streakRef.current = streak
  const bestRef = useRef(best); bestRef.current = best
  const wonTypesRef = useRef(wonTypes); wonTypesRef.current = wonTypes

  // ---- projection ----
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
    // keep the beaten-move tally across the gated drill; only clear once all three
    // are done (a fresh drill)
    if (wonTypesRef.current.length >= MOVES.length) setWonTypes([])
    setAnswerStr(''); setShowCalc(false); setRobbed(false)
    setPhase('menu')
  }, [])

  // Pick a move from the menu — that choice becomes the physics question.
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

  // Execute the chosen move with the player's answer. The outcome is decided
  // once (deterministic): a correct force/acceleration beats the man.
  const fire = useCallback((value: number) => {
    const g = gameRef.current
    const p = g.picked
    if (!p) return
    g.played = value
    g.outcome = Math.abs(value - answerOf(p)) <= tolOf(p) ? 'beat' : 'lost'
    g.t = 0; g.resolved = false; g.scored = false; g.celebrate = 0
    g.phase = 'fly'
    if (soundRef.current) { sfx.current.ensure(); sfx.current.knock() }
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
      const sc = flyScene(p.move.id, 'beat', g.openSide, g.defZ, 1)
      spawnConfetti(g, project(sc.ball.x, 1.0, sc.ball.z))
      if (soundRef.current) { sfx.current.knock(); sfx.current.cheer() }
      if (matchModeRef.current) {
        // MATCH MOMENT: a single successful move IS the win (no all-three gate, no
        // onGoal, no high-score persistence). Report success once; the celebration
        // keeps playing and the frame freezes for the orchestrator to take over.
        if (!resolvedOnceRef.current) { resolvedOnceRef.current = true; onResolveRef.current?.(true) }
      } else {
        const s = streakRef.current + 1
        setStreak(s)
        if (s > bestRef.current) { setBest(s); void saveHighScore('forces', s) }
        const sceneNow = sceneRef.current
        sceneNow.onChange({ ...sceneNow.state, connections: Number(sceneNow.state.connections ?? 0) + 1 })
        if (sceneNow.showGoal) {
          // gated first run: tick this move off; only finish once all three moves
          // have beaten your man
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
      }
    } else {
      // wrong answer: play the miss, reset the streak, show the brief result text
      if (soundRef.current) { sfx.current.steal(); sfx.current.miss() }
      setStreak(0)
      // MATCH MOMENT: a mis-hit is a failed moment — report it once.
      if (matchModeRef.current && !resolvedOnceRef.current) { resolvedOnceRef.current = true; onResolveRef.current?.(false) }
    }
    setPhase('result')
  }, [project])

  // Timeout: solve clock expired with no move played. The defender steps up and
  // robs the ball off your feet — a non-lesson turnover.
  const dispossess = useCallback(() => {
    const g = gameRef.current
    if (g.phase !== 'solve') return
    g.robbed = true
    g.t = 0
    g.phase = 'robbed'
    if (soundRef.current) { sfx.current.ensure(); sfx.current.steal() }
    setStreak(0)
    setRobbed(true)
    setPhase('robbed')
    // MATCH MOMENT: running the solve clock out is a turnover — report failure once.
    if (matchModeRef.current && !resolvedOnceRef.current) { resolvedOnceRef.current = true; onResolveRef.current?.(false) }
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
    // The controlled dribbler's kit, derived live from the equipped loadout.
    const TEAM_KIT = youKitRef.current

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
    // Build a kick/reach pose so a player's near foot lands exactly on a world
    // point (the ball), selling foot-on-ball contact and tight control.
    const footAction = (target: V3, lean: number): PlayerAction => {
      const fp = project(target.x, target.y, target.z)
      return { footX: fp.sx, footY: fp.sy, lean }
    }
    // A brief contact cue (white flash + expanding ring) at a world point, used
    // on the decisive touch / the defender's nick.
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

    const animating = g.phase === 'fly' || (g.phase === 'result' && !g.robbed && g.outcome !== null)
    const u = g.phase === 'fly' ? clamp(g.t / FLY_DUR, 0, 1) : 1

    if (g.phase === 'robbed') {
      // TIMEOUT ROBBERY (third-person): your man steps all the way up and nicks
      // the ball off your feet. You stay in shot, beaten on the spot. Exactly
      // ONE ball is drawn: the loose world ball sliding toward him until he wins
      // it, then his foot-ball after. As he arrives he reaches a leg in and the
      // contact cue fires on the nick.
      const tu = clamp(g.t / ROB_CLOSE_S, 0, 1)
      const e = easeInOut(tu)
      const robZ = lerp(g.defZ, 2.0, e)
      const robHasBall = g.t >= ROB_CLOSE_S
      const jit = Math.sin(now / 70) * Math.min(0.06, g.t * 0.12)
      const bz = lerp(YOU_HOME.z + 0.5, robZ - 0.5, e)
      const ballPt: V3 = { x: jit, y: BALL_R, z: bz }
      const reaching = !robHasBall && tu > 0.6
      drawWorldPlayer(0, robZ, FOE_KIT, tu < 0.92, robHasBall, reaching ? footAction(ballPt, 0) : undefined)
      drawWorldPlayer(YOU_HOME.x, YOU_HOME.z, TEAM_KIT, tu < 0.4, false)
      if (!robHasBall) {
        const nick = pulse(tu, 0.92, 0.12)
        drawWorldBall(jit, BALL_R, bz, now / 320, nick * 0.4)
        drawContact(ballPt, nick)
      }
    } else if (animating && g.picked && g.outcome) {
      const sc = flyScene(g.picked.move.id, g.outcome, g.openSide, g.defZ, u)
      // Players in DEPTH ORDER (farther/up-pitch drawn first so the nearer one
      // overlaps on top), then the ball, then the contact cue. On a beat you end
      // up-pitch of the defender, so the beaten man (now nearer the camera) is
      // painted ON TOP of you, selling that you have gone PAST him; on a loss the
      // defender is up-pitch and stays behind you. Only ONE ball is ever drawn:
      // the loose flight ball below, OR the defender's foot-ball when he has won
      // it. The "you" player never carries his own ball (that would double up
      // with the loose ball), so hasBall is always false here; his near foot is
      // glued to the world ball instead.
      const drawDef = () => drawWorldPlayer(sc.def.x, sc.def.z, FOE_KIT, sc.def.running, sc.def.hasBall, sc.def.reach ? footAction(sc.def.reach, 0) : undefined)
      const drawYou = () => { if (sc.you.show) drawWorldPlayer(sc.you.x, sc.you.z, TEAM_KIT, sc.you.running, false, sc.you.footTarget ? footAction(sc.you.footTarget, sc.you.lean) : undefined) }
      if (sc.def.z >= sc.you.z) { drawDef(); drawYou() } else { drawYou(); drawDef() }
      if (!sc.def.hasBall) drawWorldBall(sc.ball.x, sc.ball.y, sc.ball.z, g.t * 9, sc.contact * 0.4)
      if (sc.contactPt) drawContact(sc.contactPt, sc.contact)
    } else {
      // menu / solve (third-person): your man closes while you idle-dribble the
      // ball at your feet with small, frequent touches. The ball stays GLUED
      // near the feet, nudged left/right with little forward pushes in time with
      // a dribble cycle, and the near foot reaches the ball on every touch — so
      // he is actively carrying it, not letting it drift. ONE ball only: the
      // world ball at your feet; the "you" avatar never draws its own foot-ball.
      drawWorldPlayer(0, g.defZ, FOE_KIT, g.phase === 'menu' || g.phase === 'solve', false)
      const ph = (now / 1000) / 0.5 * Math.PI * 2 // ~0.5 s dribble cycle
      const side = Math.sin(ph)
      const touchX = YOU_HOME.x + 0.5 + side * 0.22
      const touchZ = YOU_HOME.z + 0.55 + Math.abs(Math.sin(ph)) * 0.1
      const ballPt: V3 = { x: touchX, y: BALL_R, z: touchZ }
      drawWorldBall(touchX, BALL_R, touchZ, now / 360)
      drawWorldPlayer(YOU_HOME.x, YOU_HOME.z, TEAM_KIT, false, false, footAction(ballPt, side * 0.35))
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
    // In a match moment the streak/best HUD is hidden (the orchestrator owns the score).
    if (unlimited && !sceneRef.current.matchMode) {
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
      const label = (g.picked?.dir === 'findF' ? 'Solve the force F: ENTER to do the move' : 'Solve the acceleration a: ENTER to do the move') + calcLabel
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
        g.defZ = Math.max(DEF_MIN, g.defZ - DEF_APPROACH * dt)
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
  // A wrong answer to a picked move raises the animated worked-solution lesson
  // (modeled on KinematicsSim). It owns its own "next run" flow, so the
  // click-anywhere-to-continue handler must stand down while it is showing.
  const showLesson = phase === 'result' && outcome === 'lost' && !robbed && p != null && !matchMode
  // any settled result (beat or robbed) continues on click; the lost lesson does not.
  // In a match moment the sim FREEZES on its final frame (no click-to-continue) and
  // the orchestrator decides what happens next.
  const canClickContinue = phase === 'result' && !showLesson && !matchMode

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

        {/* MOVE MENU — pick a move with the key shown, or click it. */}
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
                    flex: '1 1 0', maxWidth: 188, background: done ? 'rgba(12,40,26,0.9)' : 'rgba(8,12,28,0.88)',
                    border: `2px solid ${done ? 'rgba(52,210,123,0.85)' : 'rgba(126,200,255,0.55)'}`, borderRadius: 14,
                    padding: '10px 12px', color: '#fff', cursor: 'pointer', textAlign: 'left',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                    <span style={{ background: done ? '#34d27b' : '#7ec8ff', color: '#06223f', fontWeight: 800, borderRadius: 7, padding: '1px 8px', fontSize: 14 }}>{pr.move.key}</span>
                    <strong style={{ fontSize: 14.5 }}>{pr.move.emoji} {pr.move.name}{done ? ' ✓' : ''}</strong>
                  </div>
                  <span style={{ fontSize: 11, opacity: 0.82, lineHeight: 1.25, display: 'block' }}>{pr.move.blurb}</span>
                  <span style={{ fontSize: 10.5, opacity: 0.7, display: 'block', marginTop: 3 }}>{pr.dir === 'findF' ? 'find the force F = m·a' : 'find the acceleration a = F/m'}</span>
                </button>
              )
            })}
          </div>
        )}

        {phase === 'result' && outcome === 'beat' && !matchMode && (
          <div className="soccer__banner soccer__banner--goal">
            <strong>BEAT YOUR MAN!</strong>
            <span>
              {p?.move.name} came off perfectly.{' '}
              {unlimited
                ? 'Click anywhere to continue.'
                : allWon
                  ? 'All three moves done — moving on!'
                  : `${wonCount} / ${MOVES.length} done. Click for the next.`}
            </span>
          </div>
        )}

        {showLesson && p && (
          <DribbleLesson problem={p} played={g.played} onDone={nextRun} />
        )}

        {phase === 'result' && robbed && !matchMode && (
          <div className="soccer__banner soccer__banner--save">
            <strong>TOO SLOW ⛔</strong>
            <span>He closed you down. Dispossessed. Click anywhere to try again.</span>
          </div>
        )}

        {/* In-game calculator overlay during solve. */}
        {phase === 'solve' && showCalc && <Calculator onClose={() => setShowCalc(false)} />}
      </div>

      <div className="soccer__side">
        {phase === 'menu' && (
          <div className="soccer__givens">
            <div className="is-key"><span>The ball</span><strong>m = {BALL_MASS} kg</strong></div>
            <div><span>Every move uses</span><strong>F = m · a</strong></div>
            {unlimited
              ? <div><span>Pick with</span><strong>keys 1 – 3</strong></div>
              : <div className="is-key"><span>Moves done</span><strong>{wonCount} / {MOVES.length}</strong></div>}
          </div>
        )}

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
                    onChange={(e) => setAnswerStr(e.target.value)}
                  />
                </label>
              </div>
              <p className="soccer__tip" style={{ margin: '6px 0 0', fontSize: 11, opacity: 0.78 }}>Round to the nearest whole number (up or down is fine).</p>
            </div>
          </>
        )}

        {phase === 'result' && outcome === 'beat' && p && !matchMode && (
          <p className="soccer__tip">Newton checks out: {p.dir === 'findF' ? `F = m·a = ${p.m}·${p.a} = ${p.F} N` : `a = F/m = ${p.F}/${p.m} = ${p.a} m/s²`} put the perfect weight on the {p.move.name.toLowerCase()}. <b>Streak {streak}</b> · best {best}.</p>
        )}

        {phase === 'result' && outcome === 'lost' && !robbed && p && !matchMode && (
          <p className="soccer__tip">Not quite. {p.dir === 'findF' ? `F = m·a = ${p.m}·${p.a} = ${p.F} N` : `a = F/m = ${p.F}/${p.m} = ${p.a} m/s²`} was the answer. <b>Streak reset.</b></p>
        )}

        <div className="sim__controls">
          <div className="soccer__buttons">
            {phase === 'menu' && <button type="button" className="btn btn--primary" disabled>Pick a move ▸</button>}
            {phase === 'solve' && <button type="button" className="btn btn--primary" onClick={playMove} disabled={!answerStr}>Do the move ⚽</button>}
            {phase === 'fly' && <button type="button" className="btn btn--primary" disabled>On the move…</button>}
            {phase === 'result' && !matchMode && <button type="button" className="btn btn--primary" onClick={nextRun}>Next run →</button>}
            {!matchMode && <button type="button" className="btn btn--ghost" onClick={nextRun}>↻ Restart</button>}
          </div>
        </div>
      </div>
    </div>
  )
}

// ============================================================================
// Wrong-answer worked-solution lesson (modeled on KinematicsSim's Remediation).
// Shown ONLY when the player commits a wrong numeric answer to a picked move.
// It walks Newton's 2nd law on the constant 0.43 kg ball ONE step at a time:
//   givens (the constant mass) → write F = m·a (or rearrange a = F/m) → plug in
//   → compute → produce the answer the grader wanted.
// Each step is a fill-the-blank MCQ; a wrong pick reveals the working, a correct
// pick advances. There is NO "try for yourself" sandbox (shooting keeps that);
// the final step states the correct answer and continues to the next run.
// ============================================================================
type LessonOpt = { label: string; correct: boolean }
type LessonStep = {
  n: string
  cmp?: boolean
  prompt: string
  options: LessonOpt[]
  gate: 'check' | 'correct'
  card: (blank: ReactNode) => ReactNode
  solution: ReactNode
}

const STEP_COUNT = 4

function DribbleLesson({ problem, played, onDone }: { problem: Problem; played: number; onDone: () => void }) {
  const dir = problem.dir
  const m = problem.m // 0.43 kg, the constant
  const a = problem.a // m/s² (given when findF, shown answer when findA)
  const F = problem.F // N    (given when findA, shown answer when findF)
  const correct = answerOf(problem) // exact value the grader compares against
  const used = played
  const unit = problem.unit

  const fmtN = (x: number) => `${x.toFixed(1)} N`
  const fmtA = (x: number) => `${x.toFixed(1)} m/s²`
  const fmtKg = (x: number) => `${x.toFixed(2)} kg`

  // Stable-per-mount correct-answer slot for each step's MCQ, so the right option
  // isn't in a predictable position. Reset the per-step pick state on step change.
  const slots = useMemo(() => Array.from({ length: STEP_COUNT }, () => Math.floor(Math.random() * 3)), [])
  const [stepIdx, setStepIdx] = useState(0)
  const [answered, setAnswered] = useState<boolean[]>(() => Array(STEP_COUNT).fill(false))
  const [pick, setPick] = useState<number | null>(null)
  const [checked, setChecked] = useState(false)
  const [revealed, setRevealed] = useState(false)
  const [showLessonCalc, setShowLessonCalc] = useState(false)
  useEffect(() => { setPick(null); setChecked(false); setRevealed(false) }, [stepIdx])

  // "Time spent learning" — a fixed-duration count-up bar shared with the other
  // sims' lessons (cosmetic here; there is no auto-skip without a try view).
  const LEARN_LIMIT = 120
  const [elapsed, setElapsed] = useState(0)
  useEffect(() => {
    const start = performance.now()
    const id = window.setInterval(() => setElapsed((performance.now() - start) / 1000), 100)
    return () => window.clearInterval(id)
  }, [])
  const barPct = Math.min(100, (elapsed / LEARN_LIMIT) * 100)

  // "What went wrong" verdict — about the answer the PLAYER actually submitted.
  const off = Math.abs(used - correct)
  const tooHigh = used > correct
  const verdict = dir === 'findF'
    ? `You put F = ${used.toFixed(1)} N through it, about ${off.toFixed(1)} N ${tooHigh ? 'too hard, so the ball ran away from your feet' : 'too soft, so it never burst past him'}. It needed F = ${correct.toFixed(1)} N.`
    : `You read a = ${used.toFixed(1)} m/s², about ${off.toFixed(1)} ${tooHigh ? 'too high' : 'too low'}. Coming off the move the ball actually accelerates at a = ${correct.toFixed(1)} m/s².`

  // Build 3 MCQ options, dedup any distractor whose formatted label collides with
  // the correct one (or another distractor), and rotate the correct slot.
  const mkOpts = (correctVal: number, distractorVals: number[], fmt: (x: number) => string, offset: number): LessonOpt[] => {
    const correctLabel = fmt(correctVal)
    const seen = new Set<string>([correctLabel])
    const dist: string[] = []
    for (const dv of distractorVals) {
      let v = dv
      let label = fmt(v)
      let guard = 0
      while (seen.has(label) && guard < 12) { v = v * 1.08 + 0.05; label = fmt(v); guard++ }
      seen.add(label); dist.push(label)
    }
    const opts: LessonOpt[] = [{ label: correctLabel, correct: true }, ...dist.map((l) => ({ label: l, correct: false }))]
    const k = offset % opts.length
    return [...opts.slice(k), ...opts.slice(0, k)]
  }
  const rotate = (opts: LessonOpt[], offset: number): LessonOpt[] => {
    const k = offset % opts.length
    return [...opts.slice(k), ...opts.slice(0, k)]
  }

  // A final-step decoy on the OPPOSITE side of the player's miss, kept clearly
  // outside the grader tolerance (≥ 2 from the answer) so it is never "right".
  const third = Math.max(0.5, correct + (used > correct ? -1 : 1) * Math.max(2, off * 0.7))

  const steps: LessonStep[] = dir === 'findF'
    ? [
        {
          n: '1', prompt: 'Every move pushes the same regulation ball. What mass m goes into the law?',
          options: mkOpts(m, [m * 2, 1], fmtKg, slots[0]), gate: 'check',
          card: (blank) => (<>
            <div className="soccer__step-formula">The mass is the constant: every move hits the same ball</div>
            <div className="soccer__step-plug">m = {blank}</div>
          </>),
          solution: <>m = <b>{m.toFixed(2)} kg</b> — the same regulation ball on every touch.</>,
        },
        {
          n: '2', prompt: 'How does Newton’s 2nd law give the force from mass and acceleration?',
          options: rotate([{ label: 'm · a', correct: true }, { label: 'm / a', correct: false }, { label: 'a / m', correct: false }], slots[1]), gate: 'check',
          card: (blank) => (<>
            <div className="soccer__step-formula">Newton’s 2nd law</div>
            <div className="soccer__step-plug">F = {blank}</div>
          </>),
          solution: <>F = <b>m · a</b> (force = mass × acceleration).</>,
        },
        {
          n: '3', prompt: 'Put the numbers in: what force does that work out to?',
          options: mkOpts(correct, [a, a / m], fmtN, slots[2]), gate: 'check',
          card: (blank) => (<>
            <div className="soccer__step-formula">Plug in the mass and acceleration</div>
            <div className="soccer__step-plug">F = m · a = {m} · {a} = {blank}</div>
          </>),
          solution: <>F = {m} · {a} = <b>{fmtN(correct)}</b></>,
        },
        {
          n: '★', cmp: true, prompt: 'So which force F actually beats your man on this move?',
          options: mkOpts(correct, [used, third], fmtN, slots[3]), gate: 'correct',
          card: (blank) => (<>
            <div className="soccer__step-formula">The force that puts the perfect weight on the touch</div>
            <div className="soccer__step-plug">F = {blank}</div>
          </>),
          solution: <>With m = {m} kg and a = {a} m/s², F = m · a = <b>{fmtN(correct)}</b>.</>,
        },
      ]
    : [
        {
          n: '1', prompt: 'Every move pushes the same regulation ball. What mass m goes into the law?',
          options: mkOpts(m, [m * 2, 1], fmtKg, slots[0]), gate: 'check',
          card: (blank) => (<>
            <div className="soccer__step-formula">The mass is the constant: every move hits the same ball</div>
            <div className="soccer__step-plug">m = {blank}</div>
          </>),
          solution: <>m = <b>{m.toFixed(2)} kg</b> — the same regulation ball on every touch.</>,
        },
        {
          n: '2', prompt: 'Rearrange Newton’s 2nd law to get the acceleration from force and mass.',
          options: rotate([{ label: 'F / m', correct: true }, { label: 'm / F', correct: false }, { label: 'F · m', correct: false }], slots[1]), gate: 'check',
          card: (blank) => (<>
            <div className="soccer__step-formula">Newton’s 2nd law, solved for acceleration</div>
            <div className="soccer__step-plug">a = {blank}</div>
          </>),
          solution: <>a = <b>F / m</b> (acceleration = force ÷ mass).</>,
        },
        {
          n: '3', prompt: 'Put the numbers in: what acceleration does that work out to?',
          options: mkOpts(correct, [F, F * m], fmtA, slots[2]), gate: 'check',
          card: (blank) => (<>
            <div className="soccer__step-formula">Plug in the force and mass</div>
            <div className="soccer__step-plug">a = F / m = {F} / {m} = {blank}</div>
          </>),
          solution: <>a = {F} / {m} = <b>{fmtA(correct)}</b></>,
        },
        {
          n: '★', cmp: true, prompt: 'So what acceleration a does the ball burst away at on this move?',
          options: mkOpts(correct, [used, third], fmtA, slots[3]), gate: 'correct',
          card: (blank) => (<>
            <div className="soccer__step-formula">The acceleration the ball leaves your foot with</div>
            <div className="soccer__step-plug">a = {blank}</div>
          </>),
          solution: <>With F = {F} N and m = {m} kg, a = F / m = <b>{fmtA(correct)}</b>.</>,
        },
      ]

  const N = steps.length
  const cur = steps[stepIdx]
  const last = stepIdx === N - 1
  const stepDone = answered[stepIdx]
  const pickedOpt = pick === null ? null : cur.options[pick]
  const pickedCorrect = !!pickedOpt?.correct

  const choose = (i: number) => {
    if (stepDone) return
    setPick(i); setChecked(false)
  }
  const checkAnswer = () => {
    if (pick === null || stepDone) return
    setChecked(true)
    if (pickedCorrect) {
      setAnswered((arr) => { const b = [...arr]; b[stepIdx] = true; return b })
    } else if (cur.gate === 'check') {
      setRevealed(true)
      setAnswered((arr) => { const b = [...arr]; b[stepIdx] = true; return b })
    }
  }
  const blankSlot: ReactNode = pick === null
    ? <span className="soccer__blank">?</span>
    : <span className={`soccer__blank soccer__blank--filled${checked ? (pickedCorrect ? ' soccer__blank--ok' : ' soccer__blank--no') : ''}`}>{pickedOpt!.label}{checked ? (pickedCorrect ? ' ✓' : ' ✗') : ''}</span>
  const showSolution = revealed || (checked && !pickedCorrect && cur.gate === 'check')

  return (
    <div className="soccer__lesson">
      <div className="soccer__lesson-inner">
        <div className="soccer__lesson-head">
          <div className="soccer__lesson-emoji">🧤</div>
          <div>
            <h2 className="soccer__lesson-title">Tackled! Let’s break it down</h2>
            <p className="soccer__lesson-sub">{verdict}</p>
          </div>
        </div>

        <div className="soccer__lesson-chips">
          <div className="chip"><span>the ball</span><strong>m = {m} kg</strong></div>
          <div className="chip"><span>move</span><strong>{problem.move.emoji} {problem.move.name}</strong></div>
          {dir === 'findF'
            ? <div className="chip"><span>acceleration</span><strong>a = {a} m/s²</strong></div>
            : <div className="chip"><span>foot force</span><strong>F = {F} N</strong></div>}
          <div className="chip chip--lock">
            <span>you played</span>
            <strong>{used.toFixed(1)} {unit}</strong>
          </div>
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
              <span className="soccer__solution-tag">Here’s the working</span>
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
          <div className={`soccer__learnbar`}>
            <span>{'⏱'} Time spent learning</span>
            <div className="soccer__learnbar-track"><div className="soccer__learnbar-fill" style={{ width: `${barPct}%` }} /></div>
            <span className="soccer__learnbar-num">{elapsed.toFixed(0)}s</span>
          </div>
          <div className="soccer__lesson-actions">
            <button type="button" className="btn btn--ghost" onClick={() => setStepIdx((i) => Math.max(0, i - 1))} disabled={stepIdx === 0}>{'←'} Back</button>
            {!last ? (
              <button type="button" className="btn btn--primary soccer__try-btn" onClick={() => setStepIdx((i) => Math.min(N - 1, i + 1))} disabled={!stepDone}>{stepDone ? 'Next →' : 'Answer to continue'}</button>
            ) : (
              <>
                <button type="button" className="btn btn--ghost" onClick={onDone}>Skip explanation</button>
                <button type="button" className="btn btn--primary soccer__try-btn" onClick={onDone}>Next run {'→'}</button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ============================================================================
// Canvas drawing helpers (shared render kit with MotionSim / KinematicsSim)
// ============================================================================
// `face` chooses which side of the head reads to the camera: "you" the dribbler
// runs up-pitch (back to camera), the defender marks you (faces the camera).
// `skinDark` is a deeper tone of the same skin used for cheek/jaw + limb shading.
const TEAM_KIT = {
  jersey: '#2f6df0', jerseyDark: '#1f4ec2', jerseyHi: '#6c9bff', collar: '#0d2f7a',
  // White shorts + blue socks, consistent with the other first-person drills.
  shorts: '#eef2fb', shortsDark: '#c7d2e6', sock: '#2f6df0', sockBand: '#ffffff',
  boot: '#15171f', bootDark: '#05060a', number: '#ffffff', num: 9,
  skin: '#e8b48a', skinDark: '#c8895f', hair: '#2c2016', hairStyle: 0, face: 'back' as 'back' | 'front',
}
// NOTE: `pattern` + `accent` are NOT declared on the base kit on purpose — they are
// injected at runtime by usePlayerKit(TEAM_KIT) from the equipped loadout and read
// defensively as (kit as any).pattern/.accent, so the shared Kit type (also used by
// the untouched FOE_KIT defender) does not need them.
const FOE_KIT = {
  jersey: '#ef4444', jerseyDark: '#b91c1c', jerseyHi: '#fca5a5', collar: '#7f1010',
  // Shorts are now drawn by the SHARED white renderer (these fields are unused for
  // the defender, kept only so FOE_KIT structurally matches the Kit type). The sock
  // is the red jersey colour and the boot is a dark cleat, fed into drawPlayerLegs.
  shorts: '#eef2fb', shortsDark: '#c7d2e6', sock: '#ef4444', sockBand: '#ffe8e8',
  boot: '#15171f', bootDark: '#05060a', number: '#ffffff', num: 4,
  // Same skin look as YOUR PLAYER so the shared limb/arm/head skin reads identically.
  skin: '#e8b48a', skinDark: '#c8895f', hair: '#1a130c', hairStyle: 3, face: 'front' as 'back' | 'front',
}
type Kit = typeof TEAM_KIT

function drawHair(ctx: CanvasRenderingContext2D, cx: number, headY: number, headR: number, style: number, color: string, back = false) {
  ctx.fillStyle = color
  if (back) {
    // back of the head: hair sheets down over most of the skull, no fringe gap
    ctx.beginPath(); ctx.arc(cx, headY + headR * 0.06, headR * 1.04, Math.PI * 0.86, Math.PI * 2.14); ctx.fill()
    ctx.beginPath(); ctx.ellipse(cx, headY + headR * 0.1, headR * 0.95, headR * 1.0, 0, 0, Math.PI * 2); ctx.fill()
    if (style === 2) { ctx.beginPath(); ctx.arc(cx, headY - headR * 0.95, headR * 0.4, 0, Math.PI * 2); ctx.fill() }
    if (style === 3) {
      ctx.fillRect(cx - headR * 1.04, headY - headR * 0.1, headR * 0.32, headR * 1.0)
      ctx.fillRect(cx + headR * 0.72, headY - headR * 0.1, headR * 0.32, headR * 1.0)
    }
    return
  }
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

// YOUR PLAYER only: paint the equipped jersey DESIGN over the back of the shirt.
// The torso is filled flat by drawPlayer; this overlays the accent artwork for the
// equipped pattern, clipped to the torso trapezoid so it never bleeds onto the
// arms or shorts. 'plain' draws nothing (the solid jersey is enough).
function drawJerseyPattern(
  ctx: CanvasRenderingContext2D, pattern: JerseyPattern, accent: string,
  cx: number, top: number, bot: number, shoulderW: number, waistW: number,
) {
  ctx.save()
  ctx.beginPath()
  ctx.moveTo(cx - shoulderW / 2, top)
  ctx.lineTo(cx + shoulderW / 2, top)
  ctx.lineTo(cx + waistW / 2, bot)
  ctx.lineTo(cx - waistW / 2, bot)
  ctx.closePath(); ctx.clip()
  ctx.fillStyle = accent
  const w = shoulderW, h = bot - top, left = cx - w / 2
  switch (pattern) {
    case 'stripes': {
      const cols = 6
      const sw = w / (cols * 2 - 1)
      for (let i = 0; i < cols; i++) ctx.fillRect(left + i * sw * 2, top, sw, h)
      break
    }
    case 'hoops': {
      const rows = 5
      const hh = h / (rows * 2 - 1)
      for (let i = 0; i < rows; i++) ctx.fillRect(cx - w, top + i * hh * 2, w * 2, hh)
      break
    }
    case 'sash': {
      ctx.lineCap = 'butt'
      ctx.strokeStyle = accent
      ctx.lineWidth = Math.max(2, w * 0.3)
      ctx.beginPath()
      ctx.moveTo(cx - w * 0.7, bot + h * 0.12)
      ctx.lineTo(cx + w * 0.7, top - h * 0.12)
      ctx.stroke()
      break
    }
    case 'halves': {
      ctx.fillRect(cx, top - 1, w, h + 2)
      break
    }
    case 'galaxy': {
      const flecks: [number, number][] = [
        [0.28, 0.18], [0.62, 0.3], [0.42, 0.52], [0.72, 0.64], [0.24, 0.72],
        [0.78, 0.2], [0.5, 0.82], [0.36, 0.4], [0.66, 0.86],
      ]
      const r = Math.max(1, w * 0.055)
      for (const [fxp, fyp] of flecks) {
        ctx.beginPath(); ctx.arc(left + fxp * w, top + fyp * h, r, 0, Math.PI * 2); ctx.fill()
      }
      break
    }
    default: break // 'plain' — solid jersey, no overlay
  }
  ctx.restore()
}

// An optional pose that drives one foot to an exact screen point (the ball) and
// leans the body into the touch, so a kick/reach reads as real contact rather
// than a generic running gait.
type PlayerAction = { footX: number; footY: number; lean: number }

// Draws a kitted player given his already-projected feet + head points. A won
// ball rests on the GROUND at his feet (a player wins it to his feet, not hands).
// When `action` is supplied, the near foot is planted on action.foot* (the ball)
// and the upper body leans by action.lean — this is what sells foot-on-ball
// contact and tight control.
function drawPlayer(ctx: CanvasRenderingContext2D, feet: P2, head: P2, kit: Kit, now: number, running: boolean, hasBall: boolean, action?: PlayerAction) {
  const scale = feet.scale
  if (scale < 4 || scale > 360) return
  const ph = now / 80
  const bob = running ? Math.abs(Math.sin(ph)) * 0.055 * scale : 0
  const cx = feet.sx
  const footY = feet.sy - bob
  // `headY` is the projected TOP-OF-HEAD (crown) anchor at world y = 1.84.
  const headY = head.sy - bob
  const back = kit.face === 'back'
  // BOTH FIGURES draw from the SHARED canonical athletic build, so the head/torso/
  // leg ratios match the player card and each other: small head, broad shoulders
  // tapering to a lean waist, long legs (hips at mid-height). The crown anchor is
  // `headY`; feet are `footY`. YOUR PLAYER faces away; the defender faces the camera
  // (front), but the proportions + limb/arm renderers are now identical.
  const m = bodyMetrics(headY, footY)
  const wBody = Math.max(5, 0.4 * scale)
  const hipY = m.hipY
  const lw = m.legW
  const headR = m.headR
  // head CENTRE drops below the crown anchor onto a short neck stub (m.headCY).
  const headCY = m.headCY
  // shoulder line sits just below the head so the neck reads as a short stub
  const shoulderY = m.shoulderY
  const torsoH = hipY - shoulderY + 2
  // body lean into the touch: hips + upper body shift, the support foot stays put
  const leanX = action ? clamp(action.lean, -1, 1) * wBody * 0.55 : 0
  const cxU = cx + leanX
  const hipX = cx + leanX
  // finer detail (face, seams, taper) only when the figure is big enough to read
  const detail = scale > 24

  ctx.fillStyle = 'rgba(0,0,0,0.26)'
  ctx.beginPath(); ctx.ellipse(cx, feet.sy + 1, wBody * 0.95, wBody * 0.32, 0, 0, Math.PI * 2); ctx.fill()

  ctx.lineCap = 'round'; ctx.lineJoin = 'round'
  let footLx: number, footLy: number, footRx: number, footRy: number
  if (action) {
    // the striking/control foot drives to the contact point; the other plants
    // under the body for balance, so the touch lands with clear weight
    const dir = Math.sign(action.footX - cx) || 1
    footRx = action.footX; footRy = action.footY
    footLx = cx - dir * wBody * 0.34; footLy = footY
  } else {
    const swing = running ? Math.sin(ph) * 0.28 * scale : wBody * 0.4
    const lift = running ? Math.max(0, Math.cos(ph)) * 0.15 * scale : 0
    footLx = cx - swing; footLy = footY - lift
    footRx = cx + swing; footRy = footY
  }

  // ---- legs: BOTH FIGURES draw their lower body from the SHARED standardized
  // renderer so the legs + shorts are identical across every drill and match the
  // card. The only per-loadout inputs are the sock (jersey) colour and the boot
  // colours; the defender feeds in its RED sock + dark cleat. The pose is reused
  // for the shorts after the torso, and the foot anchors come from the stance/
  // animation above so any defensive movement is preserved.
  const pose = {
    hipX, hipY,
    lFootX: footLx, lFootY: footLy,
    rFootX: footRx, rFootY: footRy,
    legW: lw,
    sock: kit.sock,
    boot: kit.boot,
    bootDark: (kit as { bootDark?: string }).bootDark ?? kit.boot,
    skin: kit.skin,
    // YOUR PLAYER's shorts follow the equipped (locker) kit; the front defender that shares
    // this renderer stays white (undefined → standard white shorts).
    shorts: back ? kit.shorts : undefined,
    shortsDark: back ? (kit as { shortsDark?: string }).shortsDark : undefined,
    detail,
  }
  drawPlayerLegs(ctx, pose)

  // ---- neck: a SHORT skin stub linking head to shoulders ----
  const neckTop = headCY + headR * 0.9
  const neckW = headR * 0.8
  ctx.fillStyle = kit.skin
  ctx.beginPath()
  ctx.moveTo(cxU - neckW * 0.78, neckTop); ctx.lineTo(cxU + neckW * 0.78, neckTop)
  ctx.lineTo(cxU + neckW, shoulderY + 1); ctx.lineTo(cxU - neckW, shoulderY + 1)
  ctx.closePath(); ctx.fill()
  ctx.fillStyle = kit.skinDark
  ctx.fillRect(cxU + neckW * 0.12, neckTop, neckW * 0.62, shoulderY + 1 - neckTop)

  // ---- torso: trapezoid (shoulders wider than waist) + shade stripe + edge hi
  const shoulderW = m.shoulderW
  const waistW = m.waistW
  ctx.fillStyle = kit.jersey
  ctx.beginPath()
  ctx.moveTo(cxU - shoulderW / 2, shoulderY)
  ctx.lineTo(cxU + shoulderW / 2, shoulderY)
  ctx.lineTo(cxU + waistW / 2, hipY + 1)
  ctx.lineTo(cxU - waistW / 2, hipY + 1)
  ctx.closePath(); ctx.fill()
  ctx.save(); ctx.clip()
  ctx.fillStyle = kit.jerseyDark; ctx.fillRect(cxU + wBody * 0.12, shoulderY, wBody * 0.4, torsoH + 2)
  ctx.fillStyle = kit.jerseyHi; ctx.fillRect(cxU - shoulderW * 0.46, shoulderY + torsoH * 0.1, wBody * 0.12, torsoH * 0.62)
  ctx.restore()
  // YOUR PLAYER only: paint the equipped jersey DESIGN (pattern + accent) over
  // the back of the shirt, clipped to the torso. The defender (front) has no
  // pattern field so it falls through to 'plain' and is left untouched.
  if (back && scale > 14) {
    drawJerseyPattern(
      ctx, (kit as any).pattern ?? 'plain', (kit as any).accent ?? kit.jerseyHi,
      cxU, shoulderY, hipY + 1, shoulderW, waistW,
    )
  }

  // ---- shorts: BOTH FIGURES wear the SHARED standardized white football shorts,
  // drawn from the same pose as the legs so they match the card. Always white (not
  // loadout-driven), so the defender gets white shorts under its red shirt.
  drawPlayerShorts(ctx, pose)

  // ---- arms: BOTH FIGURES use the SHARED standardized arms so the limbs match the
  // card model — a jersey sleeve over the upper arm, a skin forearm, and a hand.
  // Start from the canonical idle hands and ADD the dribble/run swing + balance
  // offsets so each figure's motion (including the defender's gait) is preserved.
  // The defender's sleeve is its RED jersey colour.
  const armSwing = running ? Math.sin(ph + Math.PI) * 0.16 * scale : 0
  const armBal = action ? -leanX * 0.5 : 0
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
    skin: kit.skin,
  })

  ctx.fillStyle = kit.collar; ctx.fillRect(cxU - wBody * 0.2, shoulderY, wBody * 0.4, Math.max(1.5, torsoH * 0.1))
  if (wBody > 9) {
    ctx.fillStyle = kit.number
    ctx.font = `800 ${Math.round(wBody * 0.5)}px Plus Jakarta Sans, sans-serif`
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
    ctx.fillText(String(kit.num), cxU, shoulderY + torsoH * 0.52)
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic'
  }

  // Won ball rests on the GROUND at his feet.
  if (hasBall) {
    const br = Math.max(4, BALL_R * scale)
    const bx = cx + wBody * 0.5
    const by = feet.sy
    ctx.fillStyle = 'rgba(0,0,0,0.3)'
    ctx.beginPath(); ctx.ellipse(bx, by + 2, br * 1.2, br * 0.45, 0, 0, Math.PI * 2); ctx.fill()
    drawBall(ctx, bx, by - br * 0.7, br, now / 320, 0)
  }

  // ---- head + ears + hair, then face (only big and only when facing camera) ----
  if (detail) {
    ctx.fillStyle = kit.skin
    ctx.beginPath(); ctx.arc(cxU - headR * 0.95, headCY + headR * 0.05, headR * 0.28, 0, Math.PI * 2); ctx.fill()
    ctx.beginPath(); ctx.arc(cxU + headR * 0.95, headCY + headR * 0.05, headR * 0.28, 0, Math.PI * 2); ctx.fill()
  }
  ctx.fillStyle = kit.skin; ctx.beginPath(); ctx.arc(cxU, headCY, headR, 0, Math.PI * 2); ctx.fill()
  if (!back) {
    // cheek/jaw shading down the shaded side of the face
    ctx.save()
    ctx.beginPath(); ctx.arc(cxU, headCY, headR, 0, Math.PI * 2); ctx.clip()
    ctx.fillStyle = kit.skinDark
    ctx.beginPath(); ctx.ellipse(cxU + headR * 0.55, headCY + headR * 0.2, headR * 0.7, headR, 0, 0, Math.PI * 2); ctx.fill()
    ctx.restore()
  }
  drawHair(ctx, cxU, headCY, headR, kit.hairStyle, kit.hair, back)
  if (detail && !back) {
    // brow line + two eyes, looking slightly down at the ball
    const eyeDX = headR * 0.4, eyeY = headCY + headR * 0.04, eyeR = Math.max(0.9, headR * 0.13)
    ctx.strokeStyle = 'rgba(40,28,18,0.6)'; ctx.lineWidth = Math.max(1, headR * 0.1)
    ctx.beginPath(); ctx.moveTo(cxU - eyeDX * 1.3, eyeY - headR * 0.28); ctx.lineTo(cxU - eyeDX * 0.4, eyeY - headR * 0.34); ctx.stroke()
    ctx.beginPath(); ctx.moveTo(cxU + eyeDX * 0.4, eyeY - headR * 0.34); ctx.lineTo(cxU + eyeDX * 1.3, eyeY - headR * 0.28); ctx.stroke()
    ctx.fillStyle = '#24180e'
    ctx.beginPath(); ctx.arc(cxU - eyeDX, eyeY, eyeR, 0, Math.PI * 2); ctx.fill()
    ctx.beginPath(); ctx.arc(cxU + eyeDX, eyeY, eyeR, 0, Math.PI * 2); ctx.fill()
  }
  ctx.lineCap = 'butt'; ctx.lineJoin = 'miter'
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
