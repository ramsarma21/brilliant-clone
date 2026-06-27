import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { SimProps } from './types'
import { Calculator } from './Calculator'
import { usePlayerKit } from '../../lib/playerKit'
import { bodyMetrics, drawPlayerLegs, drawPlayerShorts, drawPlayerArms, idleHands } from '../../lib/playerCanvas'
import type { LegPose } from '../../lib/playerCanvas'
import { fetchHighScore, saveHighScore } from '../../lib/scores'

// ============================================================================
// Energy unit — soccer skill = HEADERS (attack the corner).
//
// A CORNER KICK swings in toward a real goal: posts, net, a goalkeeper and
// defenders in the six-yard box. A MENU offers three distinct headers, each
// bound to a keyboard key (1/2/3) and each aimed at a DIFFERENT part of the
// goal. You PICK one with the key (or by clicking it); that choice is the
// decision. Executing it asks ONE energy question about the leap that wins it.
//
// To get up to the ball you convert take-off energy into height. At take-off
// your legs give you kinetic energy ½mv²; at the top of the jump it is all
// gravitational PE mgh. Setting them equal, mgh = ½mv², the mass cancels:
//
//   • solve TAKE-OFF SPEED given the height to reach:   v = √(2·g·h)
//   • solve HEIGHT reached given the take-off speed:     h = v² / (2·g)
//
// Every header fights the SAME gravity, so g = 10 m/s² is the constant across
// all headers and rounds.
//
// The three headers send the ball to visibly different places:
//   • 1 Near-post flick  → glanced low into the NEAR post.
//   • 2 Back-post header → powered across to the FAR post.
//   • 3 Towering header  → climbed over everyone and buried DOWN the middle.
//
// You must SCORE ALL THREE header types before the drill is complete — the goal
// only counts (onGoal) once near post, back post and towering are all done.
//
// Flow per corner: menu (corner hanging in) → solve (fixed 30 s, formula always
// shown, calculator drains the clock at 1.25×) → fly (the leap animates).
//   • Correct → you climb highest and BURY it past the keeper; that header type
//     is ticked off. Click anywhere for the next corner.
//   • Wrong → your marker climbs above you and heads it clear; the brief result
//     text states the correct answer. Click anywhere for the next corner.
//   • Run the 30 s down → you never jump and the cross is cleared.
// ============================================================================

// ---- Camera / canvas (identical feel to KinematicsSim / MotionSim / ForcesSim) ----
const W = 900
const H = 560
const HORIZON = H * 0.4
// Third-person view: the camera sits CAM_BACK metres behind you and a little
// above, so you watch your own avatar attack the corner. Depth is offset by
// CAM_BACK inside project(); there is no screen->world inverse projection here.
const EYE_Y = 2.4
const FOCAL = 560
const CAM_BACK = 6 // metres the camera trails behind the player (world z = 0)

// ---- The goal + box (metres) ----
const GOAL_Z = 12 // the goal line, up-pitch ahead of you
const GOAL_HW = 3.66 // half goal width (regulation 7.32 m)
const GOAL_H = 2.44 // crossbar height (regulation)
const NET_DEPTH = 1.8 // how far the net runs back behind the line
const KEEPER_Z = GOAL_Z - 0.4 // the goalkeeper on his line
const DRILL_CORNER_SIDE: 1 | -1 = -1 // the drill always takes the corner from the LEFT
const CORNER_X = 10.5 // |x| of the corner flag (where the goal line meets the touchline)
const CORNER_BALL_X = 9.7 // where the ball is teed up inside the corner arc
const CORNER_KICKER_X = 10.2 // where the corner taker stands over the ball

// ---- World (metres) ----
const BALL_R = 0.13
// Home of the attacker ("you") in third-person: a touch left of and just ahead
// of the camera, so the avatar sits low-centre and never masks the box.
const YOU_HOME = { x: -0.9, z: 0.25 }
const HEAD_H = 1.7 // metres the ball sits above the feet at the moment of a header

// ---- The constant: every header fights the SAME gravity ----
const GRAV = 10 // m/s² (taken as g ≈ 10 for clean numbers) — never changes

const BEST_KEY = 'physics-headers-best'

// ---- Solve economy (FIXED — no difficulty scaling) ----
const SOLVE_MS = 30000 // every picked header gets a flat 30 s to solve
const SOLVE_WARN_MS = 10000 // last 10 s get an urgent red countdown
const CALC_DRAIN = 1.25 // opening the calculator drains the clock at 1.25×

// ---- Marker (jumps with you to contest the header) ----
const MARK_START = 7.6 // metres up-pitch when the menu opens
const MARK_MIN = 5.0 // closest the contest gets before you have to commit
const MARK_APPROACH = 0.45 // m/s the contest drifts in

// ---- Leap animation ----
const FLY_DUR = 2.1 // seconds the executed header plays out
const U_TAKEOFF = 0.2 // when feet leave the ground
const U_LAND = 0.78 // when you come back down
const U_CONTACT = 0.46 // the header (apex of the jump = meeting the cross)

// ---- Timeout (the "too slow" cleared cross) ----
const ROB_CLOSE_S = 1.0
const ROB_DUR_S = 1.9

type P2 = { sx: number; sy: number; scale: number }
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v))
const lerp = (a: number, b: number, t: number) => a + (b - a) * t
const round1 = (x: number) => Math.round(x * 10) / 10
const easeOut = (u: number) => 1 - (1 - u) * (1 - u)
const easeIn = (u: number) => u * u
const easeInOut = (u: number) => (u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2)
const parseNum = (s: string): number => { const v = parseFloat(s); return Number.isFinite(v) ? v : 0 }

// ============================================================================
// The three headers. Each is a real leap at the cross aimed at a different part
// of the goal, so each maps to an honest v = √(2gh) question about the jump that
// wins it. Take-off speeds are kept to whole numbers so that, with g = 10 m/s²,
// h = v²/(2g) is exact AND v = √(2gh) recovers the integer cleanly.
// ============================================================================
type Dir = 'findV' | 'findH'
type HeaderId = 'flick' | 'back' | 'tower'

type HeaderDef = {
  id: HeaderId
  key: string
  name: string
  emoji: string
  blurb: string
  ctxV: (h: number) => string // describe finding the take-off speed
  ctxH: (v: number) => string // describe finding the height reached
}

const HEADERS: HeaderDef[] = [
  {
    id: 'flick', key: '1', name: 'Near-post flick', emoji: '⚡',
    blurb: 'Glance it low into the near post',
    ctxV: (h) => `The near-post flick needs you up to h = ${h} m. What take-off speed v = √(2gh) gets you there?`,
    ctxH: (v) => `You spring off the turf at v = ${v} m/s for the flick. What height h = v²/2g do you reach?`,
  },
  {
    id: 'back', key: '2', name: 'Back-post header', emoji: '🎯',
    blurb: 'Power it across to the far post',
    ctxV: (h) => `To reach the back-post ball you must rise to h = ${h} m. What take-off speed v = √(2gh) is that?`,
    ctxH: (v) => `You leave the ground at v = ${v} m/s to attack the back post. What height h = v²/2g do you climb to?`,
  },
  {
    id: 'tower', key: '3', name: 'Towering header', emoji: '🦅',
    blurb: 'Climb above everyone and bury it down the middle',
    ctxV: (h) => `Towering over your man means reaching h = ${h} m. What take-off speed v = √(2gh) gets you up there?`,
    ctxH: (v) => `You explode up at v = ${v} m/s for the towering header. What height h = v²/2g do you reach?`,
  },
]

// Where in the goal each header is aimed. `crossSide` is the side the corner is
// taken from, which is the NEAR post. The three destinations are clearly
// different: low near post, across to the far post, and down the middle.
function goalTarget(headerId: HeaderId, crossSide: number): V3 {
  // near post = the post on the side the corner is taken from (crossSide).
  if (headerId === 'flick') return { x: crossSide * (GOAL_HW - 0.45), y: 0.5, z: GOAL_Z + 0.25 } // near post, low
  if (headerId === 'back') return { x: -crossSide * (GOAL_HW - 0.45), y: 1.15, z: GOAL_Z + 0.25 } // far post
  return { x: crossSide * 0.25, y: 0.32, z: GOAL_Z + 0.25 } // towering: down the middle
}

// ============================================================================
// READING THE BOX (unlimited replay only). A header is aimed at one of three
// GOAL ZONES; each header maps to its own zone. A correct leap wins the aerial
// duel, but whether the ball goes IN depends on the box you read:
//   • the goalkeeper guards ONE zone — head it there and he saves it,
//   • a CROWD around the contact point blocks the lower headers (flick / back),
//     but the towering header climbs ABOVE the crowd and is never blocked.
// So the right header changes corner to corner: go where the keeper isn't, and
// go aerial when you are swarmed.
// ============================================================================
type Zone = 'near' | 'far' | 'center'
const headerZone = (id: HeaderId): Zone => (id === 'flick' ? 'near' : id === 'back' ? 'far' : 'center')

// Where the keeper stands on his line to guard a zone (near = the corner side).
function keeperZoneX(zone: Zone, crossSide: number): number {
  if (zone === 'near') return crossSide * (GOAL_HW - 1.0)
  if (zone === 'far') return -crossSide * (GOAL_HW - 1.0)
  return crossSide * 0.1
}

// A contesting body in/around the six-yard box. `team` picks the kit, `peak` is
// how high it leaps at the contest. `team` is a tag (not a Kit object) so this
// table can live above the kit definitions without a temporal-dead-zone crash.
type CrowdActor = { x: number; z: number; team: 'foe' | 'team'; peak: number }

type Scenario = {
  id: string
  keeperZone: Zone // the goal zone the keeper is covering this corner
  crowded: boolean // is the contact point swarmed (blocks the low headers)
  read: string // the right read, for the menu hint / result copy
  crowd: CrowdActor[] // the bodies contesting around the contact point
}

// A small FIXED set (not truly random) so every corner is a fair, learnable
// read. Across the set each header type is the correct answer at least once:
//   • back-post header wins #1, near-post flick wins #2, the towering header is
//     the only way through the crowd in #4 and #5, and #3 rewards either low
//     header while punishing the (saved) towering one.
const SCENARIOS: Scenario[] = [
  {
    id: 'keeper-near', keeperZone: 'near', crowded: false,
    read: 'Keeper cheats to the near post — go back post (or tower).',
    crowd: [
      { x: -1.7, z: 6.6, team: 'foe', peak: 0.9 },
      { x: 1.9, z: 7.0, team: 'team', peak: 0.8 },
      { x: 2.4, z: 8.4, team: 'foe', peak: 0.7 },
    ],
  },
  {
    id: 'keeper-far', keeperZone: 'far', crowded: false,
    read: 'Keeper sits on the back post — flick the near post (or tower).',
    crowd: [
      { x: 1.7, z: 6.6, team: 'foe', peak: 0.9 },
      { x: -2.0, z: 7.1, team: 'team', peak: 0.8 },
      { x: -2.6, z: 8.3, team: 'foe', peak: 0.7 },
    ],
  },
  {
    id: 'keeper-center', keeperZone: 'center', crowded: false,
    read: 'Keeper holds the middle — take a post, near or back (not down the middle).',
    crowd: [
      { x: -2.2, z: 6.9, team: 'foe', peak: 0.85 },
      { x: 2.2, z: 6.7, team: 'team', peak: 0.85 },
    ],
  },
  {
    id: 'swarm-far', keeperZone: 'far', crowded: true,
    read: 'Bodies everywhere and the keeper on the back post — only a towering header gets above it.',
    crowd: [
      { x: -1.0, z: 5.4, team: 'foe', peak: 1.5 },
      { x: 0.7, z: 5.0, team: 'foe', peak: 1.4 },
      { x: -0.3, z: 6.0, team: 'team', peak: 1.2 },
      { x: 1.5, z: 5.8, team: 'foe', peak: 1.35 },
    ],
  },
  {
    id: 'swarm-near', keeperZone: 'near', crowded: true,
    read: 'Packed at the near post — climb above the pile with a towering header.',
    crowd: [
      { x: 0.9, z: 5.2, team: 'foe', peak: 1.5 },
      { x: -0.7, z: 5.6, team: 'foe', peak: 1.35 },
      { x: 0.2, z: 6.2, team: 'team', peak: 1.25 },
      { x: -1.6, z: 5.0, team: 'foe', peak: 1.3 },
    ],
  },
]

// Decide the ball's fate for a CORRECT leap given the corner's scenario and the
// header chosen. Wrong physics never reaches here (it is always 'lost').
//   • SAVED   — the chosen zone is the one the keeper is covering.
//   • DEFLECTED — a low header (flick/back) into a crowded box gets blocked.
//   • GOAL    — open zone, and either uncrowded or a towering header.
function fateFor(scenario: Scenario, headerId: HeaderId): BallResult {
  const zone = headerZone(headerId)
  if (scenario.keeperZone === zone) return 'saved'
  if (scenario.crowded && headerId !== 'tower') return 'deflected'
  return 'goal'
}

type Problem = {
  header: HeaderDef
  dir: Dir
  g: number // 10, always
  h: number // reach height (m): the GIVEN integer for findH, the decimal answer for findV
  v: number // take-off speed (m/s): the GIVEN integer for findV, the decimal answer for findH
  answer: number // the (decimal) value the player solves for
  unit: string // 'm/s' or 'm'
}

const answerOf = (p: Problem) => p.answer
// The exact answer is a decimal; accept anything within 1.0 of it so the player
// can round to the nearest whole number either up OR down (e.g. 27.2 → 27 or 28).
const tolOf = (_p: Problem) => 1.0001

const randInt = (lo: number, hi: number) => lo + Math.floor(Math.random() * (hi - lo + 1))

// Each picked header gets a FRESH random problem: the GIVEN variable is a random
// integer 1–50 (1–50 avoids trivial zeros) and g = 10 m/s² is the constant. The
// unknown is the matching rearrangement of energy conservation v = √(2gh):
//   • findV: given h → v = √(2·g·h)        (answer is a decimal, e.g. h=37 → 27.2)
//   • findH: given v → h = v² / (2g)        (answer is a decimal, can exceed 50, e.g. v=50 → 125)
function makeProblem(header: HeaderDef, dir: Dir): Problem {
  if (dir === 'findV') {
    const h = randInt(1, 50)
    const v = Math.sqrt(2 * GRAV * h)
    return { header, dir, g: GRAV, h, v, answer: v, unit: 'm/s' }
  }
  const v = randInt(1, 50)
  const h = (v * v) / (2 * GRAV)
  return { header, dir, g: GRAV, h, v, answer: h, unit: 'm' }
}

// Build the round's three header problems. Each header independently rolls a
// random unknown (findV or findH) and fresh random given, so every run differs;
// whichever header the player picks just gets its own freshly randomized problem.
// The corner's scenario still cycles through the fixed set so every read recurs.
function makeRound(roundIdx: number): { problems: Problem[]; crossSide: 1 | -1; scenario: Scenario } {
  const problems = HEADERS.map((hd) => makeProblem(hd, Math.random() < 0.5 ? 'findV' : 'findH'))
  const scenario = SCENARIOS[((roundIdx % SCENARIOS.length) + SCENARIOS.length) % SCENARIOS.length]
  return { problems, crossSide: DRILL_CORNER_SIDE, scenario }
}

// ---- minimal sound (same toolkit as ForcesSim / MotionSim) ----
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
  thud() { this.burst(300, 0.7, 0.14, 0.3); this.tone(120, 0.12, 'sine', 0.2) }
  whistle() { this.tone(2100, 0.18, 'square', 0.08); this.tone(2400, 0.18, 'square', 0.06, 0.04) }
  cheer() { this.burst(900, 0.4, 0.6, 0.28) }
  clear() { this.tone(150, 0.22, 'sawtooth', 0.2) }
  miss() { this.burst(240, 1, 0.18, 0.26) }
}

type Particle = { x: number; y: number; vx: number; vy: number; life: number; max: number; color: string; size: number; rot: number; vr: number }

type Phase = 'menu' | 'solve' | 'fly' | 'robbed' | 'result'
// Did you get up to the ball? 'beat' = you won the aerial duel, 'lost' = you
// mistimed it (wrong physics → teaching lesson).
type Outcome = 'beat' | 'lost'
// What then happened to a won header. Wrong physics ('lost') has no BallResult.
type BallResult = 'goal' | 'saved' | 'deflected'
// The full animated fate of an executed header.
type Fate = BallResult | 'lost'

type Game = {
  phase: Phase
  problems: Problem[]
  picked: Problem | null
  crossSide: 1 | -1
  scenario: Scenario
  solveElapsedMs: number
  // fly
  t: number
  outcome: Outcome | null
  ballResult: BallResult // only meaningful when outcome === 'beat'
  fate: Fate
  played: number // the answer actually played
  // marker approach (menu/solve)
  markZ: number
  resolved: boolean
  scored: boolean
  celebrate: number
  resultT: number // seconds elapsed in the result phase (drives the goal celebration)
  particles: Particle[]
  robbed: boolean
}

const newGame = (problems: Problem[], crossSide: 1 | -1, scenario: Scenario): Game => ({
  phase: 'menu', problems, picked: null, crossSide, scenario,
  solveElapsedMs: 0,
  t: 0, outcome: null, ballResult: 'goal', fate: 'goal', played: 0,
  markZ: MARK_START,
  resolved: false, scored: false, celebrate: 0, resultT: 0, particles: [], robbed: false,
})

// ============================================================================
// The executed-header scene: where the ball, the marker, the keeper and "you"
// are at progress u ∈ [0,1]. The corner drops in from the flag, you take a
// run-up, leap (feet rise to y), head it at the apex toward the goal target, and
// the keeper dives (beaten on a win).
// ============================================================================
type V3 = { x: number; y: number; z: number }
type SceneActor = { x: number; z: number; y: number; running: boolean; hasBall: boolean }
type YouPose = { show: boolean; x: number; z: number; y: number; running: boolean }
// The corner taker: a teammate who runs up and strikes the ball. `footTarget` is
// the world point his kicking foot drives to (the ball) at the strike.
type KickerPose = { x: number; z: number; running: boolean; footTarget: V3 | null; lean: number }
// Drives one foot to an exact screen point (the ball) and leans the body into
// the touch, so a kick reads as real contact rather than a running gait.
type PlayerAction = { footX: number; footY: number; lean: number }
// A full-stretch goalkeeper dive (modelled on KinematicsSim's penalty keeper):
// a two-stage load->leap that rotates the body horizontal. `homeX` is where he
// starts on his line; `beaten` aims him short/low so the ball flies past;
// `catching` clamps the gloves onto a ball that has stopped at (x,y,z).
type KeeperDive = { homeX: number; dir: number; x: number; y: number; z: number; beaten: boolean; catching: boolean; t: number }
type Scene = {
  ball: V3; def: SceneActor; you: YouPose; keeper: SceneActor; kicker: KickerPose
  contact: number; contactPt: V3 | null; kickContact: number; kickPt: V3
  keeperDive?: KeeperDive | null
  // a SECOND beat after your header: the keeper's catch or a defender's block.
  cue2?: number; cue2Pt?: V3 | null
  // the covering defender who throws himself across to block a low header.
  blocker?: SceneActor | null
}

const pulse = (u: number, c: number, w: number) => Math.max(0, 1 - Math.abs(u - c) / w)

// A symmetric jump arc that peaks at the contact frame and is zero outside the
// air time.
const jumpArc = (u: number, peak: number, takeoff = U_TAKEOFF, land = U_LAND): number => {
  if (u <= takeoff || u >= land) return 0
  const k = (u - takeoff) / (land - takeoff)
  return peak * 4 * k * (1 - k)
}

const PEAK: Record<HeaderId, number> = { flick: 0.95, back: 1.45, tower: 1.95 }

function flyScene(headerId: HeaderId, fate: Fate, crossSide: number, markZ: number, scenario: Scenario, u: number): Scene {
  return fate === 'lost'
    ? lostScene(headerId, crossSide, markZ, scenario, u)
    : wonScene(headerId, fate, crossSide, markZ, scenario, u)
}

// ----------------------------------------------------------------------------
// A WON aerial duel. You leap to the header's peak height and meet the cross at
// the forehead at the contact frame; your marker climbs lower/late (beaten to
// the high ball). What happens AFTER the header depends on the read:
//   • 'goal'      — clean strike into the (open) goal target; keeper beaten.
//   • 'saved'     — the keeper was guarding that zone: he gets across, parries.
//   • 'deflected' — the box was packed and you went low: a defender heads it
//                   clear before it travels.
// The run-up, leap and in-swinging cross are identical across the three; only
// the ball's post-contact path and the keeper differ.
// ----------------------------------------------------------------------------
// The corner taker strikes the ball at this point in the timeline; the cross is
// in the air from here until the header at U_CONTACT.
const KICK_U = 0.14

// The corner taker's pose: run-up before the strike, foot on the ball through a
// short contact window, follow-through after.
function makeKicker(crossSide: number, cornerBall: V3, u: number): KickerPose {
  const striking = u > KICK_U - 0.08 && u < KICK_U + 0.1
  return {
    x: crossSide * CORNER_KICKER_X,
    z: GOAL_Z - 0.05,
    running: u < KICK_U - 0.08,
    footTarget: striking ? cornerBall : null,
    lean: -crossSide * pulse(u, KICK_U, 0.14),
  }
}

function wonScene(headerId: HeaderId, fate: BallResult, crossSide: number, markZ: number, scenario: Scenario, u: number): Scene {
  const peak = PEAK[headerId]
  const youY = jumpArc(u, peak)
  const contestZ = markZ - 0.4
  const contactH = peak + HEAD_H
  const target = goalTarget(headerId, crossSide)
  const keeperBaseX = keeperZoneX(scenario.keeperZone, crossSide)

  const groundK = easeOut(clamp(u / U_TAKEOFF, 0, 1))
  // bias the attack toward the post you're aiming at, so a near-post run and a
  // back-post run visibly peel to different zones from the moment of contact
  const youX = lerp(YOU_HOME.x, -0.1 + target.x * 0.18, groundK)
  const youZ = lerp(YOU_HOME.z, contestZ - 0.2, groundK)

  // the marker climbs lower and slightly later, beaten to the high ball
  const markPeak = peak * 0.5
  const markY = jumpArc(u, markPeak, U_TAKEOFF + 0.05, U_LAND + 0.03)

  const cornerBall: V3 = { x: crossSide * CORNER_BALL_X, y: BALL_R, z: GOAL_Z - 0.25 }
  const contactPt: V3 = { x: youX, y: contactH, z: contestZ - 0.2 }

  // ---- SAVED: the keeper claims it. The ball flies at his zone and STOPS in
  // his gloves (a clean catch), held for the rest of the play. ----
  const catchPt: V3 = { x: clamp(target.x * 0.82, -(GOAL_HW - 0.3), GOAL_HW - 0.3), y: clamp(target.y + 0.25, 0.7, 1.95), z: GOAL_Z - 0.55 }
  const CATCH_K = 0.5 // fraction of the post-contact window when the gloves arrive

  // ---- DEFLECTED: you head it, THEN a beat later a covering defender throws
  // himself across and blocks it, and it loops loose. ----
  const BLOCK_U = U_CONTACT + 0.16 // the block lands a clear beat after your header
  const BLOCK_K = (BLOCK_U - U_CONTACT) / (1 - U_CONTACT)
  const blockPt: V3 = { x: lerp(contactPt.x, target.x, 0.4), y: contactH + 0.12, z: contactPt.z + 0.8 }

  const ballAt = (uu: number): V3 => {
    if (uu < KICK_U) return cornerBall // teed up, waiting for the taker
    if (uu < U_CONTACT) {
      // the in-swinging cross: a high looping ball from the corner to your head
      const k = (uu - KICK_U) / (U_CONTACT - KICK_U)
      const ek = easeOut(k)
      return {
        x: lerp(cornerBall.x, contactPt.x, ek),
        y: lerp(0.4, contactH, k) + 3.4 * Math.sin(Math.PI * k),
        z: lerp(cornerBall.z, contactPt.z, ek),
      }
    }
    const k = (uu - U_CONTACT) / (1 - U_CONTACT)
    if (fate === 'goal') {
      const ek = easeOut(k)
      const x = lerp(contactPt.x, target.x, ek)
      const z = lerp(contactPt.z, target.z, ek)
      let y: number
      if (headerId === 'flick') y = lerp(contactH, target.y, ek) // glanced flat and low into the near post
      else if (headerId === 'back') y = lerp(contactH, target.y, ek) + 0.8 * Math.sin(Math.PI * k) // looped across
      else y = lerp(contactH, target.y, easeIn(k)) // powered straight down the middle
      return { x, y, z }
    }
    if (fate === 'saved') {
      // the header drives at the keeper's zone, then the ball STOPS dead in his
      // gloves and stays there (a clean catch).
      if (k < CATCH_K) {
        const kk = k / CATCH_K, e = easeOut(kk)
        return { x: lerp(contactPt.x, catchPt.x, e), y: lerp(contactH, catchPt.y, e) + 0.35 * Math.sin(Math.PI * kk), z: lerp(contactPt.z, catchPt.z, e) }
      }
      return catchPt // held in the keeper's hands
    }
    // deflected: the header rises toward goal until the block, then loops loose.
    if (k < BLOCK_K) {
      const kk = k / BLOCK_K, e = easeOut(kk)
      return { x: lerp(contactPt.x, blockPt.x, e), y: lerp(contactH, blockPt.y, e), z: lerp(contactPt.z, blockPt.z, e) }
    }
    const kk = (k - BLOCK_K) / (1 - BLOCK_K), e = easeOut(kk)
    // ricochets off the block and loops away, clear of goal and back out the box
    return { x: lerp(blockPt.x, -crossSide * 2.8, e), y: lerp(blockPt.y, BALL_R, e) + 2.0 * Math.sin(Math.PI * kk), z: lerp(blockPt.z, contestZ - 3.4, e) }
  }

  const ball = ballAt(u)
  const contactPtNow = ballAt(U_CONTACT)
  const contact = pulse(u, U_CONTACT, 0.06)

  // ---- keeper per fate ----
  let keeperDive: KeeperDive | null = null
  let cue2 = 0
  let cue2Pt: V3 | null = null
  let blocker: SceneActor | null = null

  if (fate === 'saved') {
    // a reaching, two-stage dive that ARRIVES with the ball and claims it.
    const dt = clamp((u - U_CONTACT) / (CATCH_K * (1 - U_CONTACT)), 0, 1)
    keeperDive = {
      homeX: keeperBaseX, dir: Math.sign(catchPt.x - keeperBaseX) || (crossSide as number),
      x: catchPt.x, y: catchPt.y, z: catchPt.z, beaten: false, catching: true, t: dt,
    }
    // the gloves-on-ball cue at the moment of the claim
    cue2 = pulse(u, U_CONTACT + CATCH_K * (1 - U_CONTACT), 0.06)
    cue2Pt = catchPt
  } else if (fate === 'goal') {
    // dives committedly toward the ball's side but is BEATEN — full stretch,
    // late and short, the ball flying past his outstretched gloves into the net.
    const dt = clamp((u - U_CONTACT) / (0.92 * (1 - U_CONTACT)), 0, 1)
    keeperDive = {
      homeX: keeperBaseX, dir: Math.sign(target.x - keeperBaseX) || (-crossSide as number),
      x: target.x, y: Math.max(0.5, target.y + 0.35), z: GOAL_Z - 0.4, beaten: true, catching: false, t: dt,
    }
  } else {
    // deflected: a covering defender launches across and heads it clear a beat
    // after your contact; the keeper stays on his line (the crowd dealt with it).
    const bk = clamp((u - (BLOCK_U - 0.22)) / 0.44, 0, 1)
    const peakB = clamp(blockPt.y - HEAD_H, 0.6, 2.2)
    blocker = { x: blockPt.x, z: blockPt.z, y: Math.sin(Math.PI * bk) * peakB, running: u < U_CONTACT, hasBall: false }
    cue2 = pulse(u, BLOCK_U, 0.05)
    cue2Pt = blockPt
  }

  const keeperX = keeperBaseX + (keeperDive ? 0 : Math.sin(u * 3) * 0.18)

  return {
    ball,
    def: { x: 0.75, z: contestZ + 0.2, y: markY, running: u < U_TAKEOFF, hasBall: false },
    you: { show: true, x: youX, z: youZ, y: youY, running: u < U_TAKEOFF },
    keeper: { x: keeperX, z: KEEPER_Z, y: 0, running: false, hasBall: false },
    kicker: makeKicker(crossSide, cornerBall, u),
    contact, contactPt: contactPtNow,
    kickContact: pulse(u, KICK_U, 0.05), kickPt: cornerBall,
    keeperDive, cue2, cue2Pt, blocker,
  }
}

// ----------------------------------------------------------------------------
// A wrong answer. You mistime the leap and get UNDER the ball (a smaller jump),
// while your marker climbs ABOVE you and heads the corner clear back out of the
// box — a cleared header, a turnover. The keeper barely has to move. No one
// ends with the ball at their feet (it is a clearance).
// ----------------------------------------------------------------------------
function lostScene(headerId: HeaderId, crossSide: number, markZ: number, scenario: Scenario, u: number): Scene {
  const peak = PEAK[headerId]
  const keeperBaseX = keeperZoneX(scenario.keeperZone, crossSide)
  const youY = jumpArc(u, peak * 0.6)
  const markPeak = peak * 1.05
  const markY = jumpArc(u, markPeak, U_TAKEOFF - 0.02, U_LAND)
  const contactH = markPeak + HEAD_H
  const contestZ = markZ - 0.4

  const groundK = easeOut(clamp(u / U_TAKEOFF, 0, 1))
  const youX = lerp(YOU_HOME.x, -0.1, groundK)
  const youZ = lerp(YOU_HOME.z, contestZ - 0.5, groundK)

  const markerX = 0.35
  const markerZ = contestZ - 0.1

  const cornerBall: V3 = { x: crossSide * CORNER_BALL_X, y: BALL_R, z: GOAL_Z - 0.25 }
  const contactPt: V3 = { x: markerX, y: contactH, z: markerZ }

  const ballAt = (uu: number): V3 => {
    if (uu < KICK_U) return cornerBall
    if (uu < U_CONTACT) {
      const k = (uu - KICK_U) / (U_CONTACT - KICK_U)
      const ek = easeOut(k)
      return {
        x: lerp(cornerBall.x, contactPt.x, ek),
        y: lerp(0.4, contactH, k) + 3.4 * Math.sin(Math.PI * k),
        z: lerp(cornerBall.z, contactPt.z, ek),
      }
    }
    // headed clear: back across the box and out, down to the turf away from goal
    const k = easeOut((uu - U_CONTACT) / (1 - U_CONTACT))
    return {
      x: lerp(markerX, crossSide * 3.4, k),
      y: lerp(contactH, BALL_R, k) + 0.7 * Math.sin(Math.PI * ((uu - U_CONTACT) / (1 - U_CONTACT))),
      z: lerp(markerZ, contestZ - 3.4, k),
    }
  }

  const ball = ballAt(u)
  const contactPtNow = ballAt(U_CONTACT)
  const contact = pulse(u, U_CONTACT, 0.06)

  return {
    ball,
    def: { x: markerX, z: markerZ, y: markY, running: u < U_TAKEOFF, hasBall: false },
    you: { show: true, x: youX, z: youZ, y: youY, running: u < U_TAKEOFF },
    keeper: { x: keeperBaseX + Math.sin(u * 3) * 0.2, z: KEEPER_Z, y: 0, running: false, hasBall: false },
    kicker: makeKicker(crossSide, cornerBall, u),
    contact, contactPt: contactPtNow,
    kickContact: pulse(u, KICK_U, 0.05), kickPt: cornerBall,
  }
}

export function EnergySim({ state, onChange, showGoal, onGoal }: SimProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [phase, setPhase] = useState<Phase>('menu')
  const [answerStr, setAnswerStr] = useState('')
  const [streak, setStreak] = useState(0)
  const [best, setBest] = useState(() => { try { return Number(localStorage.getItem(BEST_KEY) ?? 0) || 0 } catch { return 0 } })
  useEffect(() => { void fetchHighScore('energy').then(setBest) }, [])
  const [sound, setSound] = useState(true)
  const [showCalc, setShowCalc] = useState(false)
  // The header types scored so far this drill. The goal only counts once all
  // three (near post, back post, towering) have been buried.
  const [wonTypes, setWonTypes] = useState<HeaderId[]>([])
  // Ran the solve clock down without committing: the cross was cleared. A
  // non-lesson turnover — reset the streak, click anywhere to play on.
  const [robbed, setRobbed] = useState(false)
  // A WRONG numeric answer opens the animated worked-solution lesson (the
  // explanation slides). While it is up, background clicks must NOT advance the
  // run; the lesson's own buttons drive continue.
  const [showLesson, setShowLesson] = useState(false)
  const [, force] = useState(0)
  const rerender = useCallback(() => force((n) => n + 1), [])

  const sfx = useRef(new Sfx())
  const soundRef = useRef(sound); soundRef.current = sound
  const showCalcRef = useRef(showCalc); showCalcRef.current = showCalc
  const roundIdxRef = useRef(0)
  // The drill always takes the corner from the LEFT for simplicity. The near/
  // back-post targeting stays relative to this side (goalTarget(crossSide)), so
  // later the real game can swap the side from game state and everything follows.
  const gameRef = useRef<Game>((() => { const r = makeRound(0); return newGame(r.problems, DRILL_CORNER_SIDE, r.scenario) })())
  const rafRef = useRef<number | null>(null)
  const bgRef = useRef<HTMLCanvasElement | null>(null)
  const gradRef = useRef<{ grass: CanvasGradient; vignette: CanvasGradient } | null>(null)
  const sceneRef = useRef({ onChange, state, onGoal, showGoal })
  sceneRef.current = { onChange, state, onGoal, showGoal }
  const goalFiredRef = useRef(false)
  // UNIVERSAL KIT: the player the user controls (the header-winner) and his
  // teammates wear the LIVE kit derived from the equipped jersey + cleats, so a
  // loadout change on the player card updates this drill instantly. usePlayerKit
  // merges the equipped jersey/short/sock/boot COLOURS onto TEAM_KIT while keeping
  // its structural fields (num, skin, hair, hairStyle). Opponents (FOE_KIT) and
  // the keeper (GK_KIT) keep their own distinct colours. The draw loop reads
  // youKitRef each frame.
  const teamKit = usePlayerKit(TEAM_KIT)
  const youKitRef = useRef<Kit>(teamKit)
  youKitRef.current = teamKit
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
    roundIdxRef.current += 1
    const r = makeRound(roundIdxRef.current)
    // Always from the left for the drill; once all three types are buried, start
    // a fresh drill (still from the left).
    if (wonTypesRef.current.length >= HEADERS.length) setWonTypes([])
    gameRef.current = newGame(r.problems, DRILL_CORNER_SIDE, r.scenario)
    setAnswerStr(''); setShowCalc(false); setRobbed(false); setShowLesson(false)
    setPhase('menu')
  }, [])

  // Pick a header from the menu — that choice becomes the physics question.
  const pickHeader = useCallback((p: Problem) => {
    const g = gameRef.current
    if (g.phase !== 'menu') return
    g.picked = p
    g.solveElapsedMs = 0
    g.phase = 'solve'
    if (soundRef.current) sfx.current.ensure()
    setAnswerStr('')
    setPhase('solve')
  }, [])

  // Execute the chosen header with the player's answer. The outcome is decided
  // once (deterministic): a correct take-off speed/height wins the header.
  const fire = useCallback((value: number) => {
    const g = gameRef.current
    const p = g.picked
    if (!p) return
    g.played = value
    const correct = Math.abs(value - answerOf(p)) <= tolOf(p)
    g.outcome = correct ? 'beat' : 'lost'
    // The ball's fate. The GATED first run (showGoal) always buries a correct
    // leap so the challenge can never be blocked by RNG/scenario. Only the
    // unlimited replay reads the box.
    if (!correct) g.fate = 'lost'
    else if (sceneRef.current.showGoal) g.fate = 'goal'
    else g.fate = fateFor(g.scenario, p.header.id)
    g.ballResult = g.fate === 'lost' ? 'goal' : g.fate
    g.t = 0; g.resolved = false; g.scored = false; g.celebrate = 0
    g.phase = 'fly'
    if (soundRef.current) { sfx.current.ensure() }
    setPhase('fly')
  }, [])

  const playHeader = useCallback(() => {
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
    g.resultT = 0
    const clean = g.outcome === 'beat'
    const scored = clean && g.fate === 'goal'
    if (scored && p) {
      // Correct physics AND the right read: it's in the net.
      g.scored = true; g.celebrate = 1
      const sc = flyScene(p.header.id, g.fate, g.crossSide, g.markZ, g.scenario, 1)
      spawnConfetti(g, project(sc.ball.x, 1.0, sc.ball.z))
      if (soundRef.current) { sfx.current.thud(); sfx.current.cheer() }
      const s = streakRef.current + 1
      setStreak(s)
      if (s > bestRef.current) { setBest(s); void saveHighScore('energy', s) }
      const sceneNow = sceneRef.current
      sceneNow.onChange({ ...sceneNow.state, connections: Number(sceneNow.state.connections ?? 0) + 1 })
      // Tick this header type off; only finish the drill once all three are in.
      const already = wonTypesRef.current
      const next = already.includes(p.header.id) ? already : [...already, p.header.id]
      if (!already.includes(p.header.id)) setWonTypes(next)
      if (next.length >= HEADERS.length && !goalFiredRef.current) {
        goalFiredRef.current = true
        sceneNow.onGoal?.()
      }
    } else if (clean && p) {
      // RIGHT physics, WRONG read (unlimited only): you won the duel, but the
      // keeper saved it or the crowd blocked it. A non-lesson no-goal.
      g.scored = false
      if (soundRef.current) { sfx.current.thud(); sfx.current.clear() }
      setStreak(0)
    } else {
      // Wrong physics: you mistimed the leap. Open the animated worked-solution
      // lesson (explanation slides) for this energy problem; continue from there.
      if (soundRef.current) { sfx.current.clear(); sfx.current.miss() }
      setStreak(0)
      setShowLesson(true)
    }
    setPhase('result')
  }, [project])

  // Timeout: solve clock expired with no header played. You never jumped and the
  // cross is cleared — a non-lesson turnover.
  const dispossess = useCallback(() => {
    const g = gameRef.current
    if (g.phase !== 'solve') return
    g.robbed = true
    g.t = 0
    g.phase = 'robbed'
    if (soundRef.current) { sfx.current.ensure(); sfx.current.clear() }
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

  const actionsRef = useRef({ pickHeader, playHeader, resolve, dispossess, endRobbery })
  actionsRef.current = { pickHeader, playHeader, resolve, dispossess, endRobbery }

  // ===== Input =====
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      const g = gameRef.current
      const typing = (e.target as HTMLElement)?.tagName === 'INPUT'
      if (g.phase === 'menu' && !typing) {
        const m = g.problems.find((pr) => pr.header.key === e.key)
        if (m) { e.preventDefault(); actionsRef.current.pickHeader(m) }
        return
      }
      if ((e.key === 'Enter' || e.key === ' ' || e.code === 'Space') && !typing) {
        if (g.phase === 'solve' && answerRef.current) { e.preventDefault(); actionsRef.current.playHeader() }
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

    // A player who may be airborne: lift his feet+head by `jumpY` metres while
    // keeping his shadow planted on the turf so a leap reads. `action` (optional)
    // drives a foot to a world point (the ball) for a kick.
    const drawWorldPlayer = (x: number, z: number, kit: Kit, running: boolean, hasBall: boolean, jumpY = 0, action?: PlayerAction, celebrate = false) => {
      const shadow = jumpY > 0.01 ? project(x, 0, z).sy : undefined
      // attackers (you + teammates) drive downfield toward the goal, so the
      // camera sees the BACK of their heads; the keeper and defenders face back
      // out toward the play (and the camera), so they show their faces. (The
      // controlled player wears the live kit, so test the OPPONENT kits here.)
      const faceCamera = kit === FOE_KIT || kit === GK_KIT
      drawPlayer(ctx, project(x, jumpY, z), project(x, jumpY + 1.84, z), kit, now, running, hasBall, action, shadow, celebrate, faceCamera)
    }
    // Build a kick pose so a player's near foot lands exactly on a world point.
    const footAction = (target: V3, lean: number): PlayerAction => {
      const fp = project(target.x, target.y, target.z)
      return { footX: fp.sx, footY: fp.sy, lean }
    }
    const drawWorldBall = (x: number, y: number, z: number, spin: number, squash = 0) => {
      const bp = project(x, y, z); const sh = project(x, 0, z)
      ctx.fillStyle = 'rgba(0,0,0,0.28)'
      ctx.beginPath(); ctx.ellipse(sh.sx, sh.sy, Math.max(4, BALL_R * sh.scale * 1.3), Math.max(2, BALL_R * sh.scale * 0.5), 0, 0, Math.PI * 2); ctx.fill()
      drawBall(ctx, bp.sx, bp.sy, Math.max(4, Math.min(74, BALL_R * bp.scale)), spin, squash)
    }
    const drawContact = (pt: V3, intensity: number) => {
      if (intensity <= 0.03) return
      const p = project(pt.x, pt.y, pt.z)
      const r = Math.max(7, BALL_R * p.scale)
      const k = clamp(intensity, 0, 1)
      const cy = p.sy
      ctx.save()
      ctx.globalAlpha = k * 0.85
      ctx.fillStyle = 'rgba(255,255,255,0.95)'
      ctx.beginPath(); ctx.arc(p.sx, cy, r * (0.5 + 0.45 * k), 0, Math.PI * 2); ctx.fill()
      ctx.globalAlpha = k * 0.7
      ctx.strokeStyle = 'rgba(255,236,180,0.95)'; ctx.lineWidth = Math.max(1.5, r * 0.14)
      ctx.beginPath(); ctx.arc(p.sx, cy, r * (1.05 + (1 - k) * 1.5), 0, Math.PI * 2); ctx.stroke()
      ctx.restore()
    }

    // The corner-kick arena: pitch lines, the goal + net, both corner flags, the
    // corner taker (pose passed in), the keeper and the contesting crowd of
    // defenders/teammates. Drawn far -> near so nearer figures overlap on top.
    // `contestU` (0 = standing) drives the crowd's leap as the cross drops in.
    const drawArena = (keeper: SceneActor, kicker: KickerPose, crowd: CrowdActor[], contestU: number, keeperDive: KeeperDive | null = null) => {
      drawPitchLines(ctx, project)
      drawGoalFrame(ctx, project)
      drawCornerFlag(ctx, project, 1)
      drawCornerFlag(ctx, project, -1)
      // corner taker (deepest, out at the flag), then keeper, then the crowd
      drawWorldPlayer(kicker.x, kicker.z, youKitRef.current, kicker.running, false, 0, kicker.footTarget ? footAction(kicker.footTarget, kicker.lean) : undefined)
      if (keeperDive) drawDivingKeeper(ctx, project, KEEPER_Z, keeperDive)
      else drawWorldPlayer(keeper.x, keeper.z, GK_KIT, keeper.running, false, keeper.y)
      // contesting bodies, far -> near, each leaping for the dropping ball
      const sorted = [...crowd].sort((a, b) => b.z - a.z)
      for (const a of sorted) {
        const kit = a.team === 'foe' ? FOE_KIT : youKitRef.current
        const jY = contestU > 0 ? jumpArc(contestU, a.peak) : 0
        drawWorldPlayer(a.x, a.z, kit, contestU > 0 && contestU < U_TAKEOFF, false, jY)
      }
    }

    const scenario = g.scenario
    // the keeper telegraphs the zone he is guarding (a small shuffle on his spot)
    const keeperBaseX = keeperZoneX(scenario.keeperZone, g.crossSide)
    const baseKeeper: SceneActor = { x: keeperBaseX + Math.sin(now / 650) * 0.22, z: KEEPER_Z, y: 0, running: false, hasBall: false }
    const idleKicker: KickerPose = { x: g.crossSide * CORNER_KICKER_X, z: GOAL_Z - 0.05, running: false, footTarget: null, lean: 0 }

    const animating = g.phase === 'fly' || (g.phase === 'result' && !g.robbed && g.outcome !== null)
    const u = g.phase === 'fly' ? clamp(g.t / FLY_DUR, 0, 1) : 1

    if (g.phase === 'robbed') {
      // TIMEOUT: you never jumped, so a defender steps up, climbs and heads the
      // dropping corner clear. You stay flat-footed in shot.
      const tu = clamp(g.t / ROB_CLOSE_S, 0, 1)
      const e = easeInOut(tu)
      const robZ = lerp(g.markZ, g.markZ - 1.2, e)
      const mJ = clamp((tu - 0.45) / 0.45, 0, 1)
      const markY = 1.2 * 4 * mJ * (1 - mJ)
      const contactH = markY + HEAD_H
      const headPt: V3 = { x: 0, y: contactH, z: robZ }
      let bx: number, by: number, bz: number
      const cbx = g.crossSide * CORNER_BALL_X
      if (tu < 0.18) { bx = cbx; by = BALL_R; bz = GOAL_Z - 0.25 } // teed up, then the taker strikes
      else if (tu < 0.85) {
        const k = (tu - 0.18) / 0.67
        bx = lerp(cbx, 0, easeOut(k)); by = lerp(0.4, contactH, k) + 3.2 * Math.sin(Math.PI * k); bz = lerp(GOAL_Z - 0.25, robZ, easeOut(k))
      } else {
        const k = (tu - 0.85) / 0.15
        bx = lerp(0, g.crossSide * 3.4, k); by = lerp(contactH, BALL_R, easeOut(k)) + 0.6 * Math.sin(Math.PI * k); bz = lerp(robZ, robZ - 3, k)
      }
      const robKicker: KickerPose = { ...idleKicker, running: tu < 0.1, footTarget: tu > 0.06 && tu < 0.2 ? { x: cbx, y: BALL_R, z: GOAL_Z - 0.25 } : null, lean: -g.crossSide * pulse(tu, 0.13, 0.1) }
      drawArena(baseKeeper, robKicker, scenario.crowd, 0)
      drawWorldPlayer(0, robZ, FOE_KIT, tu < 0.45, false, markY)
      drawWorldPlayer(YOU_HOME.x, YOU_HOME.z, youKitRef.current, false, false)
      drawWorldBall(bx, by, bz, now / 300)
      const nick = pulse(tu, 0.85, 0.1)
      if (nick > 0.02) drawContact(headPt, nick)
    } else if (animating && g.picked && g.outcome) {
      const sc = flyScene(g.picked.header.id, g.fate, g.crossSide, g.markZ, scenario, u)
      drawArena(sc.keeper, sc.kicker, scenario.crowd, u, sc.keeperDive ?? null)
      // marker, you and any blocking defender in depth order (farther first),
      // then the ball on top.
      type DrawItem = { z: number; draw: () => void }
      const items: DrawItem[] = [
        { z: sc.def.z, draw: () => drawWorldPlayer(sc.def.x, sc.def.z, FOE_KIT, sc.def.running, false, sc.def.y) },
      ]
      // GOAL result: the scorer peels away in a wheel-away celebration — running
      // off toward the corner with arms aloft and a repeated little jump.
      const celebrating = g.phase === 'result' && g.fate === 'goal' && g.scored
      if (sc.you.show && celebrating) {
        const cp = clamp(g.resultT / 1.4, 0, 1)
        const e = easeOut(cp)
        const cxw = sc.you.x + g.crossSide * 2.4 * e // peel toward the corner the cross came from
        const czw = Math.max(0.2, sc.you.z - 0.45 * e)
        items.push({ z: czw, draw: () => drawWorldPlayer(cxw, czw, youKitRef.current, true, false, 0, undefined, true) })
      } else if (sc.you.show) {
        items.push({ z: sc.you.z, draw: () => drawWorldPlayer(sc.you.x, sc.you.z, youKitRef.current, sc.you.running, false, sc.you.y) })
      }
      if (sc.blocker) items.push({ z: sc.blocker.z, draw: () => drawWorldPlayer(sc.blocker!.x, sc.blocker!.z, FOE_KIT, sc.blocker!.running, false, sc.blocker!.y) })
      items.sort((a, b) => b.z - a.z).forEach((it) => it.draw())
      drawWorldBall(sc.ball.x, sc.ball.y, sc.ball.z, g.t * 9, sc.contact * 0.4)
      if (sc.kickPt) drawContact(sc.kickPt, sc.kickContact * 0.6)
      if (sc.contactPt) drawContact(sc.contactPt, sc.contact)
      // the second beat: the keeper's catch or the defender's block
      if (sc.cue2Pt && sc.cue2) drawContact(sc.cue2Pt, sc.cue2)
    } else {
      // menu / solve: the corner is about to be taken. The arena is set, your
      // teammate stands over the ball in the corner, your marker closes, and you
      // wait to attack.
      drawArena(baseKeeper, idleKicker, scenario.crowd, 0)
      drawWorldPlayer(0.4, g.markZ, FOE_KIT, g.phase === 'menu' || g.phase === 'solve', false)
      drawWorldPlayer(YOU_HOME.x, YOU_HOME.z, youKitRef.current, false, false)
      drawWorldBall(g.crossSide * CORNER_BALL_X, BALL_R, GOAL_Z - 0.25, now / 600)
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
      const label = (g.picked?.dir === 'findV' ? 'Solve the take-off speed v: ENTER to jump' : 'Solve the height h: ENTER to jump') + calcLabel
      drawTimer(ctx, left, total, warn ? `Hurry! ${Math.ceil(left)}s left` : label, warn ? '#ff3b5f' : '#7ec8ff', warn)
    }
    // header-type progress pips: which of the three are scored (not during solve,
    // where the timer owns the top bar). Only the GATED drill tracks "score all 3";
    // the unlimited sim lets you take any header any number of times, so no pips.
    if (sceneRef.current.showGoal && (g.phase === 'menu' || (g.phase === 'result' && !g.robbed && g.outcome === 'beat'))) {
      drawProgress(ctx, wonTypesRef.current)
    }
  }, [project])

  // ===== Loop =====
  useEffect(() => {
    let last = performance.now()
    const update = (dt: number) => {
      const g = gameRef.current
      const act = actionsRef.current
      if (g.phase === 'menu' || g.phase === 'solve') {
        g.markZ = Math.max(MARK_MIN, g.markZ - MARK_APPROACH * dt)
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
        if (g.t >= FLY_DUR + 0.45) act.resolve()
      }
      if (g.phase === 'result') g.resultT += dt
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
  // While the wrong-answer lesson is up, the lesson's own buttons continue;
  // a stray background click must not skip it.
  const canClickContinue = phase === 'result' && !showLesson
  // Only the gated first run tracks "score all 3"; the unlimited sim is free play
  // (any header, any number of times) so it shows no completed/green state.
  const unlimited = !showGoal
  const wonCount = wonTypes.length
  const allWon = !unlimited && wonCount >= HEADERS.length
  const headerName = (id: HeaderId) => HEADERS.find((hd) => hd.id === id)?.name ?? ''

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

        {/* HEADER MENU — pick a header with the key shown, or click it. */}
        {phase === 'menu' && (
          <div style={{ position: 'absolute', left: 0, right: 0, bottom: 16, display: 'flex', gap: 10, justifyContent: 'center', padding: '0 16px', pointerEvents: 'auto' }}>
            {g.problems.map((pr) => {
              const done = !unlimited && wonTypes.includes(pr.header.id)
              return (
                <button
                  key={pr.header.id}
                  type="button"
                  onClick={() => pickHeader(pr)}
                  style={{
                    flex: '1 1 0', maxWidth: 188, background: done ? 'rgba(16,46,30,0.9)' : 'rgba(8,12,28,0.88)',
                    border: `2px solid ${done ? 'rgba(80,220,140,0.7)' : 'rgba(126,200,255,0.55)'}`, borderRadius: 14,
                    padding: '10px 12px', color: '#fff', cursor: 'pointer', textAlign: 'left',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                    <span style={{ background: done ? '#46d98a' : '#7ec8ff', color: '#06223f', fontWeight: 800, borderRadius: 7, padding: '1px 8px', fontSize: 14 }}>{pr.header.key}</span>
                    <strong style={{ fontSize: 14.5 }}>{pr.header.emoji} {pr.header.name}</strong>
                    {done && <span style={{ marginLeft: 'auto', color: '#7ef0a0', fontWeight: 800, fontSize: 13 }}>✓</span>}
                  </div>
                  <span style={{ fontSize: 11, opacity: 0.82, lineHeight: 1.25, display: 'block' }}>{pr.header.blurb}</span>
                  <span style={{ fontSize: 10.5, opacity: 0.7, display: 'block', marginTop: 3 }}>{pr.dir === 'findV' ? 'find the take-off speed v = √(2gh)' : 'find the height h = v²/2g'}</span>
                </button>
              )
            })}
          </div>
        )}

        {phase === 'result' && outcome === 'beat' && g.fate === 'goal' && (
          <div className="soccer__banner soccer__banner--goal">
            <strong>{allWon ? 'ALL THREE BURIED! 🎉' : 'GOAL! 🥅'}</strong>
            <span>{allWon ? 'Near post, back post and towering — drill complete.' : unlimited ? `${p?.header.name} — buried! Click anywhere for the next corner.` : `${p?.header.name} scored. ${wonCount}/3 header types. Click anywhere for the next corner.`}</span>
          </div>
        )}

        {phase === 'result' && outcome === 'beat' && g.fate === 'saved' && (
          <div className="soccer__banner soccer__banner--save">
            <strong>SAVED! 🧤</strong>
            <span>Your physics was perfect, but the keeper was on that post. Read where he is. Click anywhere for the next corner.</span>
          </div>
        )}

        {phase === 'result' && outcome === 'beat' && g.fate === 'deflected' && (
          <div className="soccer__banner soccer__banner--save">
            <strong>HEADED CLEAR! 🧱</strong>
            <span>Right leap, but the box was packed and a defender blocked it. Go aerial with the towering header. Click anywhere for the next corner.</span>
          </div>
        )}

        {phase === 'result' && outcome === 'lost' && !showLesson && (
          <div className="soccer__banner soccer__banner--save">
            <strong>BEATEN IN THE AIR! 🤿</strong>
            <span>He climbed above you and headed it clear. Click anywhere for the next corner.</span>
          </div>
        )}

        {/* WRONG-ANSWER LESSON — animated worked-solution explanation slides. */}
        {phase === 'result' && outcome === 'lost' && showLesson && p && (
          <HeaderLesson problem={p} played={g.played} onDone={nextRun} />
        )}

        {phase === 'result' && robbed && (
          <div className="soccer__banner soccer__banner--save">
            <strong>TOO SLOW ⛔</strong>
            <span>The cross was cleared. Click anywhere to try again.</span>
          </div>
        )}

        {/* In-game calculator overlay during solve. */}
        {phase === 'solve' && showCalc && <Calculator onClose={() => setShowCalc(false)} />}
      </div>

      <div className="soccer__side">
        {phase === 'menu' && (
          <div className="soccer__givens">
            {unlimited
              ? <div className="is-key"><span>Free play</span><strong>Any header, any time</strong></div>
              : <div className="is-key"><span>Score all 3</span><strong>{wonCount} / 3 headers</strong></div>}
            <div><span>Gravity</span><strong>g = {GRAV} m/s²</strong></div>
            <div><span>Every header uses</span><strong>v = √(2gh)</strong></div>
          </div>
        )}

        {phase === 'solve' && p && (
          <>
            <div className="soccer__givens">
              <div className="is-key"><span>Header</span><strong>{p.header.emoji} {p.header.name}</strong></div>
              <div><span>Gravity</span><strong>g = {p.g} m/s²</strong></div>
              {p.dir === 'findV'
                ? <div className="is-key"><span>Reach height</span><strong>h = {p.h} m</strong></div>
                : <div className="is-key"><span>Take-off speed</span><strong>v = {p.v} m/s</strong></div>}
            </div>
            <div className="soccer__method">
              <div className="soccer__method-head">
                <span>{p.dir === 'findV' ? 'Solve for the take-off speed v' : 'Solve for the height h'}</span>
                <button type="button" className="soccer__calc-toggle" onClick={() => setShowCalc((v) => !v)}>🧮 {showCalc ? 'Hide' : 'Calc'}</button>
              </div>
              <div className="soccer__steps">
                <code>{p.dir === 'findV' ? `v = √(2 · g · h) = √(2 · ${p.g} · ${p.h})` : `h = v² / (2g) = ${p.v}² / ${2 * p.g}`}</code>
              </div>
              <p className="soccer__tip" style={{ margin: '6px 0 0' }}>{p.dir === 'findV' ? p.header.ctxV(p.h) : p.header.ctxH(p.v)}</p>
              <div className="soccer__inputs">
                <label className="soccer__field">
                  <span>{p.dir === 'findV' ? 'Take-off speed v (m/s)' : 'Height h (m)'}</span>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={answerStr}
                    placeholder={round1(answerOf(p)).toFixed(1)}
                    onChange={(e) => setAnswerStr(e.target.value)}
                  />
                </label>
              </div>
              <p className="soccer__tip" style={{ margin: '6px 0 0', fontSize: 12 }}>Round to the nearest whole number — up or down is fine.</p>
            </div>
          </>
        )}

        {phase === 'result' && outcome === 'beat' && g.fate === 'goal' && p && (
          <p className="soccer__tip">
            Energy checks out: {p.dir === 'findV' ? `v = √(2gh) = √(2·${p.g}·${p.h}) = ${round1(p.v)} m/s` : `h = v²/2g = ${p.v}²/${2 * p.g} = ${round1(p.h)} m`} got you up to bury the {p.header.name.toLowerCase()}.
            {unlimited ? '' : allWon ? ' Hat-trick of header types!' : ` Still to score: ${HEADERS.filter((hd) => !wonTypes.includes(hd.id)).map((hd) => headerName(hd.id)).join(', ')}.`}
          </p>
        )}

        {phase === 'result' && outcome === 'beat' && g.fate !== 'goal' && p && (
          <p className="soccer__tip">
            Energy was spot on ({p.dir === 'findV' ? `v = √(2gh) = ${round1(p.v)} m/s` : `h = v²/2g = ${round1(p.h)} m`}), so you won the header. {g.scenario.read} Pick the header the box leaves open.
          </p>
        )}

        {phase === 'result' && outcome === 'lost' && p && (
          <p className="soccer__tip">{missText(p, g.played)}</p>
        )}

        <div className="sim__controls">
          <div className="soccer__buttons">
            {phase === 'menu' && <button type="button" className="btn btn--primary" disabled>Pick a header ▸</button>}
            {phase === 'solve' && <button type="button" className="btn btn--primary" onClick={playHeader} disabled={!answerStr}>Go up for it ⚽</button>}
            {phase === 'fly' && <button type="button" className="btn btn--primary" disabled>In the air…</button>}
            {phase === 'result' && <button type="button" className="btn btn--primary" onClick={nextRun}>Next corner →</button>}
            <button type="button" className="btn btn--ghost" onClick={nextRun}>↻ Restart</button>
          </div>
        </div>
      </div>
    </div>
  )
}

// On a wrong answer: a brief result line that states the correct answer.
function missText(p: Problem | null, used: number): string {
  if (!p) return 'Not quite — work the take-off speed again.'
  if (p.dir === 'findV') {
    return used > p.v
      ? `Too much spring — ${round1(used)} m/s overshoots it. v = √(2gh) = ${round1(p.v)} m/s.`
      : `Not enough spring — ${round1(used)} m/s stays too low. v = √(2gh) = ${round1(p.v)} m/s.`
  }
  return used > p.h
    ? `Too high — ${round1(used)} m. h = v²/2g = ${round1(p.h)} m.`
    : `Too low — ${round1(used)} m. h = v²/2g = ${round1(p.h)} m.`
}

// ============================================================================
// WRONG-ANSWER LESSON — an animated, multi-step worked-solution stepper, modeled
// on KinematicsSim's SolveLesson. Shown ONLY when the player's numeric answer is
// wrong (the leap is lost). It walks energy conservation — v = √(2·g·h), or its
// inverse h = v²/(2g) — one computed sub-step at a time, each a fill-the-blank
// MCQ checkpoint, ending on the grader's exact correct value. There is NO "try
// for yourself" sandbox here: the player continues via the click-to-continue
// flow (the lesson's Next / Skip buttons call onDone → next corner).
// ============================================================================
type Opt = { label: string; correct: boolean }

function HeaderLesson({ problem, played, onDone }: { problem: Problem; played: number; onDone: () => void }) {
  const { dir, g, h, v } = problem
  const unit = problem.unit
  const correct = round1(answerOf(problem)) // the grader's exact target, at display precision
  const used = round1(played)

  // Intermediates (integers, since g, h and v are whole numbers).
  const twoG = 2 * g
  const twoGH = 2 * g * h
  const vSq = v * v

  const r2 = (x: number) => Math.round(x * 100) / 100
  const num = (x: number) => String(r2(x))
  const ans = (x: number) => `${round1(x).toFixed(1)} ${unit}`

  // Build 3 MCQ options: the correct value plus distractors, with the correct
  // option rotated into a stable-per-mount slot. Any distractor whose formatted
  // label collides with the correct label is nudged to a clearly different value
  // so the right answer is never duplicated.
  const mkOpts = (correctVal: number, distractorVals: number[], fmt: (x: number) => string, offset: number): Opt[] => {
    const correctLabel = fmt(correctVal)
    const seen = new Set<string>([correctLabel])
    const dist: string[] = []
    for (const dv of distractorVals) {
      let val = dv
      let label = fmt(val)
      let guard = 0
      while (seen.has(label) && guard < 12) { val = val * 1.08 + 0.05; label = fmt(val); guard++ }
      seen.add(label); dist.push(label)
    }
    const opts: Opt[] = [{ label: correctLabel, correct: true }, ...dist.map((l) => ({ label: l, correct: false }))]
    const k = offset % opts.length
    return [...opts.slice(k), ...opts.slice(0, k)]
  }

  // Stable-per-mount correct slot for each step's MCQ (3 steps, 3 options each).
  const slots = useMemo(() => Array.from({ length: 3 }, () => Math.floor(Math.random() * 3)), [])

  type Step = {
    n: string; cmp?: boolean; prompt: string; options: Opt[]
    gate: 'check' | 'correct'
    card: (blank: ReactNode) => ReactNode
    solution: ReactNode
  }

  const steps: Step[] = dir === 'findV'
    ? [
        {
          n: '1', prompt: 'Fill the blank: what is 2 · g?',
          options: mkOpts(twoG, [g, 4 * g], num, slots[0]), gate: 'check',
          card: (blank) => (<>
            <div className="soccer__step-formula">The mass cancels in ½mv² = mgh, leaving v² = 2·g·h. First double gravity:</div>
            <div className="soccer__step-plug">2 · g = 2 · {num(g)} = {blank}</div>
          </>),
          solution: <>2 · g = 2 · {num(g)} = <b>{num(twoG)}</b></>,
        },
        {
          n: '2', prompt: 'Fill the blank: what is 2 · g · h?',
          options: mkOpts(twoGH, [g * h, twoGH * 2], num, slots[1]), gate: 'check',
          card: (blank) => (<>
            <div className="soccer__step-formula">Now multiply by the reach height h = {num(h)} m:</div>
            <div className="soccer__step-plug">2 · g · h = {num(twoG)} · {num(h)} = {blank}</div>
          </>),
          solution: <>2 · g · h = {num(twoG)} · {num(h)} = <b>{num(twoGH)}</b></>,
        },
        {
          n: '★', cmp: true, prompt: 'Now produce the answer: what take-off speed v wins this header?',
          options: mkOpts(correct, [used, round1(Math.sqrt(g * h))], ans, slots[2]), gate: 'correct',
          card: (blank) => (<>
            <div className="soccer__step-formula">Take the square root: v = √(2·g·h)</div>
            <div className="soccer__step-plug">v = √({num(twoGH)}) = {blank}</div>
          </>),
          solution: <>v = √(2·g·h) = √({num(twoGH)}) = <b>{correct.toFixed(1)} {unit}</b></>,
        },
      ]
    : [
        {
          n: '1', prompt: 'Fill the blank: what is v²?',
          options: mkOpts(vSq, [2 * v, 4 * v], num, slots[0]), gate: 'check',
          card: (blank) => (<>
            <div className="soccer__step-formula">The mass cancels in ½mv² = mgh, leaving h = v² / (2·g). First square the take-off speed:</div>
            <div className="soccer__step-plug">v² = {num(v)}² = {blank}</div>
          </>),
          solution: <>v² = {num(v)}² = <b>{num(vSq)}</b></>,
        },
        {
          n: '2', prompt: 'Fill the blank: what is 2 · g?',
          options: mkOpts(twoG, [g, 4 * g], num, slots[1]), gate: 'check',
          card: (blank) => (<>
            <div className="soccer__step-formula">Then double gravity:</div>
            <div className="soccer__step-plug">2 · g = 2 · {num(g)} = {blank}</div>
          </>),
          solution: <>2 · g = 2 · {num(g)} = <b>{num(twoG)}</b></>,
        },
        {
          n: '★', cmp: true, prompt: 'Now produce the answer: what height h does this leap reach?',
          options: mkOpts(correct, [used, round1(vSq / g)], ans, slots[2]), gate: 'correct',
          card: (blank) => (<>
            <div className="soccer__step-formula">Divide to get the height: h = v² / (2·g)</div>
            <div className="soccer__step-plug">h = {num(vSq)} / {num(twoG)} = {blank}</div>
          </>),
          solution: <>h = v² / (2·g) = {num(vSq)} / {num(twoG)} = <b>{correct.toFixed(1)} {unit}</b></>,
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

  // Count-up "time spent learning" bar (cosmetic; continue is click-driven).
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
    if (pickedCorrect) setAnswered((a) => { const b = [...a]; b[stepIdx] = true; return b })
    else if (cur.gate === 'check') { setRevealed(true); setAnswered((a) => { const b = [...a]; b[stepIdx] = true; return b }) }
  }
  const blankSlot: ReactNode = pick === null
    ? <span className="soccer__blank">?</span>
    : <span className={`soccer__blank soccer__blank--filled${checked ? (pickedCorrect ? ' soccer__blank--ok' : ' soccer__blank--no') : ''}`}>{pickedOpt!.label}{checked ? (pickedCorrect ? ' ✓' : ' ✗') : ''}</span>
  const showSolution = revealed || (checked && !pickedCorrect && cur.gate === 'check')

  // "What went wrong" verdict about the player's actual wrong answer.
  const tooHigh = used > correct
  const off = Math.abs(used - correct)
  const verdict = dir === 'findV'
    ? `Your leap used v = ${used} m/s — ${tooHigh ? 'too much spring' : 'not enough spring'}, about ${off.toFixed(1)} m/s ${tooHigh ? 'over' : 'under'} the v = √(2gh) = ${correct.toFixed(1)} m/s you needed.`
    : `You read the height as ${used} m — ${tooHigh ? 'overshooting' : 'falling short of'} the h = v²/2g = ${correct.toFixed(1)} m the leap actually gives, about ${off.toFixed(1)} m ${tooHigh ? 'too high' : 'too low'}.`

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
          <div className="soccer__lesson-emoji">🤿</div>
          <div>
            <h2 className="soccer__lesson-title">Beaten in the air!</h2>
            <p className="soccer__lesson-sub">{verdict}</p>
          </div>
        </div>

        <div className="soccer__lesson-chips">
          <div className="chip"><span>header</span><strong>{problem.header.emoji} {problem.header.name}</strong></div>
          <div className="chip"><span>gravity</span><strong>g = {num(g)} m/s²</strong></div>
          <div className="chip chip--lock">
            <span>{dir === 'findV' ? 'reach height' : 'take-off speed'}</span>
            <strong>{dir === 'findV' ? `h = ${num(h)} m` : `v = ${num(v)} m/s`}</strong>
          </div>
        </div>

        <div className="soccer__stepper">
          <div className="soccer__stepper-progress">
            <span>Step {stepIdx + 1} of {N}</span>
            <div className="soccer__stepper-dots">
              {steps.map((_, i) => <i key={i} className={i === stepIdx ? 'is-on' : i < stepIdx ? 'is-done' : ''} />)}
            </div>
          </div>
          {/* keyed so each reveal replays the swap animation; the result is a
              BLANK the student fills by picking below, then checking. */}
          <div key={stepIdx} className={`soccer__step soccer__step--big${cur.cmp ? ' soccer__step--cmp' : ''}`}>
            <span className="soccer__step-n">{cur.n}</span>
            <div className="soccer__step-body">{cur.card(blankSlot)}</div>
          </div>

          {/* Worked solution: revealed after a wrong computed check, or on demand. */}
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
                <button type="button" className="btn btn--primary soccer__try-btn" onClick={onDone} disabled={!stepDone}>Next corner →</button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ============================================================================
// Canvas drawing helpers (shared render kit with ForcesSim / MotionSim / KinematicsSim)
// ============================================================================
const TEAM_KIT = {
  jersey: '#2f6df0', jerseyDark: '#1f4ec2', jerseyHi: '#6c9bff', collar: '#0d2f7a',
  shorts: '#13234d', shortsDark: '#0c1834', sock: '#2f6df0', sockBand: '#ffffff',
  boot: '#15171f', number: '#ffffff', num: 9, skin: '#e8b48a', hair: '#2c2016', hairStyle: 0,
}
const FOE_KIT = {
  jersey: '#ef4444', jerseyDark: '#b91c1c', jerseyHi: '#fca5a5', collar: '#7f1010',
  shorts: '#3a0d0d', shortsDark: '#250707', sock: '#ef4444', sockBand: '#ffe8e8',
  boot: '#15171f', number: '#ffffff', num: 4, skin: '#e8b58c', hair: '#1a130c', hairStyle: 3,
}
const GK_KIT = {
  jersey: '#f7e017', jerseyDark: '#caa90a', jerseyHi: '#fff27a', collar: '#6b5a00',
  shorts: '#1a1a1a', shortsDark: '#000000', sock: '#f7e017', sockBand: '#1a1a1a',
  boot: '#15171f', number: '#1a1a1a', num: 1, skin: '#7d4a2c', hair: '#0f0a06', hairStyle: 2,
}
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

// Paints the equipped jersey DESIGN in the loadout accent, assuming the caller has
// already clipped to the torso shape. `x,y,w,h` is the torso bounding box and `cx`
// its centre. Only YOUR PLAYER's kit carries a non-'plain' pattern, so this is a
// no-op for everyone else.
function drawJerseyPattern(
  ctx: CanvasRenderingContext2D, pattern: string, accent: string,
  x: number, y: number, w: number, h: number, cx: number,
) {
  ctx.fillStyle = accent
  switch (pattern) {
    case 'stripes': {
      const cols = 5
      const sw = w / (cols * 2 - 1)
      for (let i = 0; i < cols; i++) ctx.fillRect(x + i * sw * 2, y, sw, h)
      break
    }
    case 'hoops': {
      const rows = 4
      const hh = h / (rows * 2 - 1)
      for (let i = 0; i < rows; i++) ctx.fillRect(x, y + i * hh * 2, w, hh)
      break
    }
    case 'sash': {
      ctx.save()
      ctx.lineCap = 'butt'
      ctx.strokeStyle = accent
      ctx.lineWidth = Math.max(3, w * 0.3)
      ctx.beginPath()
      ctx.moveTo(x - w * 0.12, y + h + w * 0.12)
      ctx.lineTo(x + w + w * 0.12, y - w * 0.12)
      ctx.stroke()
      ctx.restore()
      break
    }
    case 'halves': {
      ctx.fillRect(cx, y, x + w - cx, h)
      break
    }
    case 'galaxy': {
      let seed = 1337
      const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff }
      for (let i = 0; i < 14; i++) {
        const fx = x + rnd() * w, fy = y + rnd() * h
        const r = Math.max(1, w * (0.035 + rnd() * 0.05))
        ctx.beginPath(); ctx.arc(fx, fy, r, 0, Math.PI * 2); ctx.fill()
      }
      break
    }
    default:
      break // 'plain' — solid jersey, nothing extra
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

// Draws a kitted player given his already-projected feet + head points. When
// `shadowSy` is supplied (a leap), the ground shadow is drawn there instead of
// under the lifted feet, so a jump reads as a jump. A won ball rests on the
// GROUND at his feet.
function drawPlayer(ctx: CanvasRenderingContext2D, feet: P2, head: P2, kit: Kit, now: number, running: boolean, hasBall: boolean, action?: PlayerAction, shadowSy?: number, celebrate = false, faceCamera = false) {
  const scale = feet.scale
  if (scale < 4 || scale > 360) return
  // a leaping figure (world jumpY) reads as airborne; the run cycle drives gait.
  const airborne = shadowSy != null
  const ph = now / 80
  // a fluid run gait bob, plus a repeated little hop when celebrating a goal
  const runBob = running ? Math.abs(Math.sin(ph)) * 0.055 * scale : 0
  const celebHop = celebrate ? Math.abs(Math.sin(now / 200)) * 0.12 * scale : 0
  const bob = runBob + celebHop
  const cx = feet.sx
  const footY = feet.sy - bob
  const headY = head.sy - bob
  // YOUR PLAYER is viewed from BEHIND and uses the canonical shared athletic build
  // (bodyMetrics), so his head/torso/leg ratios match every other drill + the card.
  // The whole figure rises as one because both anchors carry the jump offset, so we
  // just recompute the metrics each frame. Front-facing figures (keeper / opponents)
  // keep their existing local proportions untouched.
  const backView = !faceCamera
  // The OPPONENT DEFENDERS (red FOE_KIT) share YOUR PLAYER's athletic build +
  // clean shared limb/arm renderers, just front-facing in a red kit. The keeper
  // (GK_KIT) keeps its own local front-facing drawing untouched.
  const isFoe = kit === FOE_KIT
  const useSharedBody = backView || isFoe
  const m = bodyMetrics(headY, footY)
  const hipY = useSharedBody ? m.hipY : headY + (footY - headY) * 0.52
  const shoulderY = useSharedBody ? m.shoulderY : headY + (footY - headY) * 0.3
  const wBody = Math.max(5, 0.4 * scale)
  const lw = useSharedBody ? m.legW : Math.max(3, 0.15 * scale)
  const headR = useSharedBody ? m.headR : Math.max(3.5, 0.17 * scale)
  const torsoH = hipY - shoulderY + 2
  const detail = headR > 5 // gate finer features (face, ears, seams) by size
  // a kick leans the upper body into the strike
  const leanX = action ? clamp(action.lean, -1, 1) * wBody * 0.55 : 0
  const cxU = cx + leanX
  const hipX = cx + leanX

  ctx.fillStyle = 'rgba(0,0,0,0.26)'
  ctx.beginPath(); ctx.ellipse(cx, (shadowSy ?? feet.sy) + 1, wBody * 0.95, wBody * 0.32, 0, 0, Math.PI * 2); ctx.fill()

  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  let footLx: number, footLy: number, footRx: number, footRy: number
  if (action) {
    // the kicking foot drives to the ball; the other foot plants beside it
    const dir = Math.sign(action.footX - cx) || 1
    footRx = action.footX; footRy = action.footY
    footLx = cx - dir * wBody * 0.34; footLy = footY
  } else if (airborne && !running) {
    // a leap: knees tuck up under the body and the feet draw together so the
    // jump reads as a real spring rather than a stiff standing slide upward.
    footLx = cx - wBody * 0.24; footLy = footY - wBody * 0.55
    footRx = cx + wBody * 0.3; footRy = footY - wBody * 0.28
  } else {
    const swing = running ? Math.sin(ph) * 0.28 * scale : wBody * 0.4
    const liftL = running ? Math.max(0, Math.cos(ph)) * 0.15 * scale : 0
    footLx = cx - swing; footLy = footY - liftL
    footRx = cx + swing; footRy = footY
  }

  // Two-segment limb (thigh+shin / upper-arm+forearm): keep the EXACT start and
  // end anchors, insert a knee/elbow joint nudged perpendicular for a bend, and
  // taper from a thicker proximal segment to a thinner distal one.
  const drawLimb = (
    ax: number, ay: number, bx: number, by: number,
    bow: number, wTop: number, wBot: number, topColor: string, botColor: string,
  ) => {
    const mx = (ax + bx) / 2, my = (ay + by) / 2
    const dx = bx - ax, dy = by - ay
    const len = Math.hypot(dx, dy) || 1
    const jx = mx + (-dy / len) * bow, jy = my + (dx / len) * bow
    ctx.strokeStyle = topColor; ctx.lineWidth = wTop
    ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(jx, jy); ctx.stroke()
    ctx.strokeStyle = botColor; ctx.lineWidth = wBot
    ctx.beginPath(); ctx.moveTo(jx, jy); ctx.lineTo(bx, by); ctx.stroke()
    return { jx, jy }
  }

  // YOUR PLAYER is viewed from BEHIND and uses the SHARED lower-body renderer so
  // his legs + shorts look identical in every drill. The ONLY per-loadout inputs
  // are sock (jersey colour) and boot/bootDark (cleat colour); everything else
  // (white shorts, skin, hip spread, proportions) is fixed in playerCanvas.
  // Front-facing figures (keeper/opponents) keep their existing drawing untouched.
  const pose: LegPose = {
    hipX, hipY,
    lFootX: footLx, lFootY: footLy,
    rFootX: footRx, rFootY: footRy,
    legW: lw,
    sock: kit.sock,
    boot: kit.boot,
    bootDark: (kit as { bootDark?: string }).bootDark ?? kit.boot,
    detail,
  }

  // ---- legs: thigh + shin, near-equal lengths with only a SLIGHT knee bend and
  // a modest taper; the feet stay EXACTLY on their anchors.
  const legBow = (airborne ? 0.6 : 1) * 0.05 * scale
  let kneeL = { jx: footLx, jy: footLy }
  let kneeR = { jx: footRx, jy: footRy }
  if (useSharedBody) {
    drawPlayerLegs(ctx, pose)
  } else {
    kneeL = drawLimb(hipX, hipY, footLx, footLy, -legBow, lw * 1.05, lw * 0.86, kit.sock, kit.sock)
    kneeR = drawLimb(hipX, hipY, footRx, footRy, legBow, lw * 1.05, lw * 0.86, kit.sock, kit.sock)
    ctx.strokeStyle = kit.sockBand; ctx.lineWidth = lw * 0.78
    ctx.beginPath(); ctx.moveTo(lerp(kneeL.jx, footLx, 0.3), lerp(kneeL.jy, footLy, 0.3)); ctx.lineTo(lerp(kneeL.jx, footLx, 0.5), lerp(kneeL.jy, footLy, 0.5)); ctx.stroke()
    ctx.beginPath(); ctx.moveTo(lerp(kneeR.jx, footRx, 0.3), lerp(kneeR.jy, footRy, 0.3)); ctx.lineTo(lerp(kneeR.jx, footRx, 0.5), lerp(kneeR.jy, footRy, 0.5)); ctx.stroke()
    const drawBoot = (fx: number, fy: number, kx: number, ky: number) => {
      const ang = Math.atan2(fy - ky, fx - kx)
      ctx.save(); ctx.translate(fx, fy); ctx.rotate(ang)
      ctx.fillStyle = kit.boot
      ctx.beginPath(); ctx.ellipse(lw * 0.3, 0, lw * 1.05, lw * 0.5, 0, 0, Math.PI * 2); ctx.fill()
      ctx.restore()
    }
    drawBoot(footLx, footLy, kneeL.jx, kneeL.jy)
    drawBoot(footRx, footRy, kneeR.jx, kneeR.jy)
  }

  // ---- head sits JUST above the shoulders on a short neck (so it never floats on a
  // long stalk). The visual head centre is derived from the shoulders — NOT from the
  // tall head projection — which keeps the proportions identical to the other drills.
  const neckStub = useSharedBody ? m.neckH : headR * 0.34
  const headCY = shoulderY - neckStub - headR
  const neckHalfW = headR * 0.56
  const neckTopY = headCY + headR * 0.72
  const neckBottomY = shoulderY + 1
  ctx.fillStyle = kit.skin
  roundRect(ctx, cxU - neckHalfW, neckTopY, neckHalfW * 2, neckBottomY - neckTopY, neckHalfW * 0.4); ctx.fill()
  ctx.fillStyle = 'rgba(0,0,0,0.14)'; ctx.fillRect(cxU + neckHalfW * 0.1, neckTopY, neckHalfW * 0.8, neckBottomY - neckTopY)

  // ---- torso: flat-ish shoulders at shoulderY (widest, where the arms attach)
  // tapering to the waist at the hip. Short neckline opening at the top.
  const shoulderW = useSharedBody ? m.shoulderW : wBody * 1.06
  const waistW = useSharedBody ? m.waistW : wBody * 0.84
  ctx.fillStyle = kit.jersey
  ctx.beginPath()
  ctx.moveTo(cxU - neckHalfW, neckBottomY)
  ctx.lineTo(cxU + neckHalfW, neckBottomY)
  ctx.lineTo(cxU + shoulderW / 2, shoulderY + 1)
  ctx.lineTo(cxU + waistW / 2, hipY + 2)
  ctx.lineTo(cxU - waistW / 2, hipY + 2)
  ctx.lineTo(cxU - shoulderW / 2, shoulderY + 1)
  ctx.closePath(); ctx.fill()
  ctx.save(); ctx.clip()
  ctx.fillStyle = kit.jerseyDark; ctx.fillRect(cxU + wBody * 0.1, neckBottomY, wBody * 0.3, hipY - neckBottomY + 2)
  ctx.fillStyle = kit.jerseyHi; ctx.fillRect(cxU - shoulderW * 0.46, shoulderY + torsoH * 0.04, wBody * 0.1, torsoH * 0.6)
  // the equipped jersey DESIGN, painted in the loadout accent and clipped to the
  // torso. Only YOUR PLAYER's kit carries a pattern/accent, so front-facing
  // figures fall through to 'plain' and stay untouched.
  const jPattern = (kit as { pattern?: string }).pattern ?? 'plain'
  const jAccent = (kit as { accent?: string }).accent ?? kit.jerseyHi
  if (jPattern !== 'plain') {
    drawJerseyPattern(ctx, jPattern, jAccent, cxU - shoulderW / 2, neckBottomY, shoulderW, hipY + 2 - neckBottomY, cxU)
  }
  ctx.restore()

  ctx.fillStyle = kit.collar; ctx.fillRect(cxU - neckHalfW, neckBottomY - 1, neckHalfW * 2, Math.max(1.5, headR * 0.2))
  if (wBody > 9) {
    ctx.fillStyle = kit.number
    ctx.font = `800 ${Math.round(wBody * 0.5)}px Plus Jakarta Sans, sans-serif`
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
    ctx.fillText(String(kit.num), cxU, shoulderY + torsoH * 0.42)
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic'
  }

  // ---- shorts: loadout-coloured, worn over the hips and the TOP THIRD of each
  // thigh. Drawn AFTER the torso + legs.
  ctx.lineCap = 'round'
  if (useSharedBody) {
    // YOUR PLAYER (from behind) AND the red defenders (front-facing) share the
    // renderer that draws the white football shorts (short waistband + two narrow
    // thigh covers with a real inseam gap) over the SAME pose, so the shorts track
    // the run-up splay and tucked leap.
    drawPlayerShorts(ctx, pose)
  } else {
    // the keeper: unchanged two-short-leg shorts.
    const shortsW = wBody * 1.08
    const waistTop = hipY - torsoH * 0.10
    const hipBot = hipY + torsoH * 0.06
    const hemFrac = 0.6
    const drawShortLeg = (jx: number, jy: number, color: string, wMul: number) => {
      const hx = lerp(hipX, jx, hemFrac), hy = lerp(hipY, jy, hemFrac)
      ctx.strokeStyle = color; ctx.lineWidth = lw * wMul
      ctx.beginPath(); ctx.moveTo(hipX, hipY); ctx.lineTo(hx, hy); ctx.stroke()
    }
    drawShortLeg(kneeL.jx, kneeL.jy, kit.shorts, 1.95)
    drawShortLeg(kneeR.jx, kneeR.jy, kit.shorts, 1.95)
    drawShortLeg(kneeR.jx, kneeR.jy, kit.shortsDark, 0.85)
    ctx.fillStyle = kit.shorts
    roundRect(ctx, cxU - shortsW / 2, waistTop, shortsW, hipBot - waistTop, Math.max(2, wBody * 0.22)); ctx.fill()
    ctx.fillStyle = kit.shortsDark; ctx.fillRect(cxU + wBody * 0.12, waistTop, wBody * 0.34, hipBot - waistTop)
    ctx.fillStyle = kit.jerseyHi; ctx.fillRect(cxU - shortsW / 2, waistTop, shortsW, Math.max(1.5, torsoH * 0.05))
  }

  // ---- arms.
  const armSwing = running ? Math.sin(ph + Math.PI) * 0.18 * scale : 0
  const armBal = action ? -leanX * 0.6 : 0
  if (useSharedBody) {
    // YOUR PLAYER (from behind) AND the red defenders (front-facing): arms via the
    // SHARED renderer so the jersey sleeves + skin forearms match every other drill.
    // Idle hands hang at the sides; when a figure LEAPS to contest they raise up and
    // spread (the arm pump), and a celebration throws them overhead. Drawn AFTER the
    // torso + shorts.
    const base = idleHands(cxU, m)
    let lHandX: number, lHandY: number, rHandX: number, rHandY: number
    if (celebrate) {
      const pump = Math.abs(Math.sin(now / 200)) * m.shoulderW * 0.18
      lHandX = cxU - m.shoulderW * 0.72; lHandY = m.shoulderY - m.shoulderW * 1.05 + pump
      rHandX = cxU + m.shoulderW * 0.72; rHandY = m.shoulderY - m.shoulderW * 1.05 + pump
    } else if (airborne) {
      // the header arm pump: hands raise above the shoulders and spread out.
      lHandX = cxU - m.shoulderW * 0.62; lHandY = m.shoulderY - m.shoulderW * 0.8
      rHandX = cxU + m.shoulderW * 0.62; rHandY = m.shoulderY - m.shoulderW * 0.8
    } else {
      lHandX = base.lHandX - armSwing + armBal; lHandY = base.lHandY
      rHandX = base.rHandX + armSwing + armBal; rHandY = base.rHandY
    }
    drawPlayerArms(ctx, {
      cx: cxU, shoulderY: m.shoulderY, shoulderW: m.shoulderW, armW: m.armW,
      lHandX, lHandY, rHandX, rHandY,
      sleeve: kit.jersey, sleeveDark: kit.jerseyDark,
    })
  } else {
    // the keeper: unchanged upper-arm (sleeve) +
    // forearm (skin) with a slight elbow bend and a small hand at the END point.
    const armW = Math.max(2, 0.1 * scale)
    const shLx = cxU - wBody * 0.5, shRx = cxU + wBody * 0.5, shY = shoulderY + 2
    let handLx: number, handLy: number, handRx: number, handRy: number
    if (celebrate) {
      const pump = Math.abs(Math.sin(now / 200)) * wBody * 0.18
      handLx = cxU - wBody * 0.72; handLy = shoulderY - wBody * 1.05 + pump
      handRx = cxU + wBody * 0.72; handRy = shoulderY - wBody * 1.05 + pump
    } else {
      const handY = shoulderY + wBody * (airborne ? 0.1 : 0.85)
      const handReach = wBody * (airborne ? 0.5 : 0.62)
      handLx = cxU - handReach - armSwing + armBal; handLy = handY
      handRx = cxU + handReach + armSwing + armBal; handRy = handY
    }
    const isKeeper = kit === GK_KIT
    const drawArm = (sx: number, sy: number, hx: number, hy: number, side: number) => {
      drawLimb(sx, sy, hx, hy, side * armW * 0.8, armW * 1.4, armW * 1.05, kit.jersey, kit.skin)
      const fingerAng = Math.atan2(hy - sy, hx - sx)
      if (isKeeper) drawKeeperGlove(ctx, hx, hy, fingerAng, Math.max(2.4, armW * 1.35))
      else { ctx.fillStyle = kit.skin; ctx.beginPath(); ctx.arc(hx, hy, Math.max(1.8, armW * 0.7), 0, Math.PI * 2); ctx.fill() }
    }
    drawArm(shLx, shY, handLx, handLy, -1)
    drawArm(shRx, shY, handRx, handRy, 1)
  }

  if (hasBall) {
    const br = Math.max(4, BALL_R * scale)
    const bx = cx + wBody * 0.5
    const by = feet.sy
    ctx.fillStyle = 'rgba(0,0,0,0.3)'
    ctx.beginPath(); ctx.ellipse(bx, by + 2, br * 1.2, br * 0.45, 0, 0, Math.PI * 2); ctx.fill()
    drawBall(ctx, bx, by - br * 0.7, br, now / 320, 0)
  }

  // ---- head, ears, hair and (front-facing only) a simple face. Drawn at headCY so the
  // head sits just above the shoulders (short neck) rather than at the tall projection.
  if (detail) {
    ctx.fillStyle = kit.skin
    ctx.beginPath(); ctx.ellipse(cxU - headR * 0.94, headCY + headR * 0.06, headR * 0.26, headR * 0.38, 0, 0, Math.PI * 2); ctx.fill()
    ctx.beginPath(); ctx.ellipse(cxU + headR * 0.94, headCY + headR * 0.06, headR * 0.26, headR * 0.38, 0, 0, Math.PI * 2); ctx.fill()
  }
  ctx.fillStyle = kit.skin; ctx.beginPath(); ctx.arc(cxU, headCY, headR, 0, Math.PI * 2); ctx.fill()
  // a soft shade down one side of the face for roundness
  ctx.save(); ctx.beginPath(); ctx.arc(cxU, headCY, headR, 0, Math.PI * 2); ctx.clip()
  ctx.fillStyle = 'rgba(0,0,0,0.1)'; ctx.fillRect(cxU + headR * 0.2, headCY - headR, headR, headR * 2); ctx.restore()
  if (faceCamera) {
    drawHair(ctx, cxU, headCY, headR, kit.hairStyle, kit.hair)
    if (detail) {
      ctx.fillStyle = '#241509'
      const eyeY = headCY - headR * 0.02, eyeDx = headR * 0.38, eyeR = Math.max(1, headR * 0.14)
      ctx.beginPath(); ctx.arc(cxU - eyeDx, eyeY, eyeR, 0, Math.PI * 2); ctx.fill()
      ctx.beginPath(); ctx.arc(cxU + eyeDx, eyeY, eyeR, 0, Math.PI * 2); ctx.fill()
      ctx.strokeStyle = 'rgba(28,16,8,0.45)'; ctx.lineWidth = Math.max(1, headR * 0.1)
      ctx.beginPath(); ctx.moveTo(cxU - eyeDx - eyeR, eyeY - headR * 0.26); ctx.lineTo(cxU - eyeDx + eyeR, eyeY - headR * 0.22); ctx.stroke()
      ctx.beginPath(); ctx.moveTo(cxU + eyeDx - eyeR, eyeY - headR * 0.22); ctx.lineTo(cxU + eyeDx + eyeR, eyeY - headR * 0.26); ctx.stroke()
      // a faint jaw/cheek line on the shaded side
      ctx.strokeStyle = 'rgba(0,0,0,0.12)'; ctx.lineWidth = 1
      ctx.beginPath(); ctx.arc(cxU, headCY + headR * 0.1, headR * 0.7, Math.PI * 0.1, Math.PI * 0.45); ctx.stroke()
    }
  } else {
    // back of the head: hair covers most of the skull, leaving only the nape
    ctx.fillStyle = kit.hair
    ctx.beginPath(); ctx.arc(cxU, headCY - headR * 0.1, headR * 0.97, 0, Math.PI * 2); ctx.fill()
    if (detail) {
      ctx.strokeStyle = 'rgba(0,0,0,0.18)'; ctx.lineWidth = Math.max(1, headR * 0.1)
      ctx.beginPath(); ctx.moveTo(cxU, headCY - headR * 0.9); ctx.lineTo(cxU, headCY + headR * 0.4); ctx.stroke()
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

// A realistic GK glove: a dark wrist cuff/band, a white rounded palm/back-of-hand
// with a grey outline, a few finger ridges and a thumb. `ang` points the fingers
// away from the wrist; `r` is the glove half-size (sized to the hand, not giant).
function drawKeeperGlove(ctx: CanvasRenderingContext2D, px: number, py: number, ang: number, r: number) {
  ctx.save(); ctx.translate(px, py); ctx.rotate(ang)
  ctx.lineJoin = 'round'
  // wrist cuff/band behind the hand
  ctx.fillStyle = '#2b3450'
  roundRect(ctx, -r * 1.5, -r * 0.62, r * 0.72, r * 1.24, r * 0.22); ctx.fill()
  // palm / back of the hand
  ctx.fillStyle = '#f4f7ff'; ctx.strokeStyle = '#c3cad6'; ctx.lineWidth = Math.max(1, r * 0.14)
  roundRect(ctx, -r * 0.9, -r * 0.78, r * 1.7, r * 1.56, r * 0.48); ctx.fill(); ctx.stroke()
  // finger ridges at the far end
  ctx.lineWidth = Math.max(1, r * 0.1)
  for (let i = -1; i <= 1; i++) {
    ctx.beginPath(); ctx.moveTo(r * 0.22, i * r * 0.42); ctx.lineTo(r * 0.74, i * r * 0.42); ctx.stroke()
  }
  // thumb tucked to one side
  ctx.fillStyle = '#f4f7ff'
  ctx.beginPath(); ctx.ellipse(-r * 0.12, r * 0.82, r * 0.36, r * 0.24, -0.3, 0, Math.PI * 2); ctx.fill(); ctx.stroke()
  ctx.restore()
}

// The diving goalkeeper — same two-stage load->leap, full-stretch feel as the
// penalty keeper in KinematicsSim. `dive.beaten` aims him short/low so the ball
// flies past into the net; otherwise both gloves clamp onto the (stopped) ball
// for a clean catch. `dive.homeX` is where he starts on his line.
function drawDivingKeeper(ctx: CanvasRenderingContext2D, project: Proj, z: number, dive: KeeperDive) {
  const baseFeet = project(0, 0, z)
  const scale = baseFeet.scale
  if (scale < 4 || scale > 360) return
  const wBody = Math.max(5, 0.4 * scale)
  const load = clamp(dive.t / 0.18, 0, 1) // gather/crouch before launch
  const leap = clamp((dive.t - 0.18) / 0.82, 0, 1) // the dive across
  const e = 1 - Math.pow(1 - leap, 2.2) // ease-out leap
  const sp = project(dive.x, Math.max(0.3, dive.y), dive.z) // the ball / save point
  const base0 = project(dive.homeX, 0.95, z) // standing chest height on his line
  const dip = Math.sin(load * Math.PI) * (1 - leap)
  const base = { sx: base0.sx + dive.dir * wBody * 0.4 * load * (1 - leap), sy: base0.sy + dip * wBody * 0.5 }
  // stretching ground shadow as he leaves his feet
  const gsh = project(lerp(dive.homeX, dive.x, e), 0.01, z)
  ctx.save(); ctx.fillStyle = 'rgba(0,0,0,0.2)'
  ctx.beginPath(); ctx.ellipse(gsh.sx, baseFeet.sy, wBody * (1 + e * 0.8), wBody * 0.36, 0, 0, Math.PI * 2); ctx.fill(); ctx.restore()
  const L = Math.max(16, wBody * 2.6) // constant torso length
  const lift = Math.sin(Math.PI * Math.min(1, e)) * wBody * 1.5 // leap off the turf
  const beaten = dive.beaten
  // beaten: comes up SHORT (between his start and the ball) and LOW, so the ball
  // beats his outstretched gloves; otherwise he reaches the ball itself.
  const aim = beaten ? project(lerp(dive.homeX, dive.x, 0.62), Math.max(0.2, dive.y - 0.95), dive.z) : sp
  const cx = base.sx + (aim.sx - base.sx) * e * 0.8
  const cy = base.sy + (aim.sy - base.sy) * e * 0.8 - lift
  const gx = base.sx + (aim.sx - base.sx) * e
  const gy = base.sy + (aim.sy - base.sy) * e - lift * 0.4
  // rotate from upright (−90°) to roughly HORIZONTAL on the dive side — a real
  // sideways dive that never rotates past horizontal, so he can't flip upside down.
  const horizAng = aim.sx >= base.sx ? 0 : -Math.PI
  const ang = -Math.PI / 2 + (horizAng + Math.PI / 2) * e
  const leadX = cx + Math.cos(ang) * L * 0.5, leadY = cy + Math.sin(ang) * L * 0.5
  const tailX = cx - Math.cos(ang) * L * 0.5, tailY = cy - Math.sin(ang) * L * 0.5
  const perp = ang + Math.PI / 2
  ctx.lineCap = 'round'; ctx.lineJoin = 'round'
  // trailing legs kicking up behind, each with a slight knee bend + a dark boot
  const legL = Math.max(3, 0.13 * scale)
  const footA = { x: tailX - Math.cos(ang) * wBody * 1.3 + Math.cos(perp) * wBody * 0.5, y: tailY - Math.sin(ang) * wBody * 1.3 + Math.sin(perp) * wBody * 0.5 }
  const footB = { x: tailX - Math.cos(ang) * wBody * 1.5 - Math.cos(perp) * wBody * 0.5, y: tailY - Math.sin(ang) * wBody * 1.5 - Math.sin(perp) * wBody * 0.5 }
  const divLimb = (ax: number, ay: number, bx: number, by: number, bow: number, wA: number, wB: number, cA: string, cB: string) => {
    const mx = (ax + bx) / 2, my = (ay + by) / 2, dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy) || 1
    const jx = mx + (-dy / len) * bow, jy = my + (dx / len) * bow
    ctx.strokeStyle = cA; ctx.lineWidth = wA; ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(jx, jy); ctx.stroke()
    ctx.strokeStyle = cB; ctx.lineWidth = wB; ctx.beginPath(); ctx.moveTo(jx, jy); ctx.lineTo(bx, by); ctx.stroke()
  }
  divLimb(tailX, tailY, footA.x, footA.y, wBody * 0.2, legL, legL * 0.8, GK_KIT.sock, GK_KIT.sock)
  divLimb(tailX, tailY, footB.x, footB.y, -wBody * 0.2, legL, legL * 0.8, GK_KIT.sock, GK_KIT.sock)
  ctx.fillStyle = GK_KIT.boot
  ctx.beginPath(); ctx.ellipse(footA.x, footA.y, legL * 0.9, legL * 0.45, ang, 0, Math.PI * 2); ctx.fill()
  ctx.beginPath(); ctx.ellipse(footB.x, footB.y, legL * 0.9, legL * 0.45, ang, 0, Math.PI * 2); ctx.fill()
  // torso (constant-length capsule) in the GK kit, with team shorts over the hip
  // (the tail end, where the trailing legs emerge)
  ctx.save(); ctx.translate(cx, cy); ctx.rotate(ang)
  ctx.fillStyle = GK_KIT.jersey; roundRect(ctx, -L / 2, -wBody * 0.55, L, wBody * 1.1, wBody * 0.5); ctx.fill()
  ctx.fillStyle = GK_KIT.jerseyDark; ctx.fillRect(-L / 2 + 2, wBody * 0.1, L - 4, wBody * 0.34)
  ctx.fillStyle = GK_KIT.shorts; roundRect(ctx, -L / 2, -wBody * 0.6, L * 0.34, wBody * 1.2, wBody * 0.4); ctx.fill()
  ctx.fillStyle = GK_KIT.shortsDark; ctx.fillRect(-L / 2 + 2, wBody * 0.12, L * 0.3, wBody * 0.34)
  ctx.restore()
  // neck linking the leading torso end to the head
  const headRk = Math.max(3, 0.17 * scale)
  const neckX = cx + Math.cos(ang) * L * 0.46, neckY = cy + Math.sin(ang) * L * 0.46
  ctx.strokeStyle = GK_KIT.skin; ctx.lineWidth = headRk * 0.8
  ctx.beginPath(); ctx.moveTo(neckX, neckY); ctx.lineTo(leadX, leadY); ctx.stroke()
  // head at the leading end — hair cap on the crown (rotated with the body so it
  // sits on the back of the head) plus a hint of a face turned toward the play
  ctx.save(); ctx.translate(leadX, leadY); ctx.rotate(ang + Math.PI / 2)
  ctx.fillStyle = GK_KIT.skin; ctx.beginPath(); ctx.arc(0, 0, headRk, 0, Math.PI * 2); ctx.fill()
  ctx.fillStyle = GK_KIT.hair; ctx.beginPath(); ctx.arc(0, -headRk * 0.18, headRk, Math.PI * 1.04, Math.PI * 1.96); ctx.fill()
  if (headRk > 5) {
    ctx.fillStyle = '#241509'
    ctx.beginPath(); ctx.arc(-headRk * 0.36, headRk * 0.04, Math.max(1, headRk * 0.14), 0, Math.PI * 2); ctx.fill()
    ctx.beginPath(); ctx.arc(headRk * 0.36, headRk * 0.04, Math.max(1, headRk * 0.14), 0, Math.PI * 2); ctx.fill()
  }
  ctx.restore()
  // arms + realistic GK gloves (rounded palm, finger ridges, wrist cuff)
  const shx = cx + Math.cos(ang) * L * 0.32, shy = cy + Math.sin(ang) * L * 0.32
  const gloveR = Math.max(3, wBody * 0.5)
  const armWk = Math.max(3, 0.12 * scale)
  // upper-arm (sleeve) + forearm (skin) with a slight elbow bend; the GLOVE end
  // point is preserved exactly so the catch / save line-up never shifts.
  const divArm = (sx: number, sy: number, hx: number, hy: number, bow: number) => {
    const mx = (sx + hx) / 2, my = (sy + hy) / 2, dx = hx - sx, dy = hy - sy, len = Math.hypot(dx, dy) || 1
    const jx = mx + (-dy / len) * bow, jy = my + (dx / len) * bow
    ctx.strokeStyle = GK_KIT.jersey; ctx.lineWidth = armWk; ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(jx, jy); ctx.stroke()
    ctx.strokeStyle = GK_KIT.skin; ctx.lineWidth = armWk * 0.7; ctx.beginPath(); ctx.moveTo(jx, jy); ctx.lineTo(hx, hy); ctx.stroke()
  }
  if (beaten) {
    // arms flung wide, gloves grasping at thin air as the ball beats him
    const spread = wBody * 1.05
    const g1x = gx + Math.cos(perp) * spread, g1y = gy + Math.sin(perp) * spread
    const g2x = gx - Math.cos(perp) * spread, g2y = gy - Math.sin(perp) * spread
    const s1x = shx + Math.cos(perp) * wBody * 0.3, s1y = shy + Math.sin(perp) * wBody * 0.3
    const s2x = shx - Math.cos(perp) * wBody * 0.3, s2y = shy - Math.sin(perp) * wBody * 0.3
    divArm(s1x, s1y, g1x, g1y, wBody * 0.25)
    divArm(s2x, s2y, g2x, g2y, -wBody * 0.25)
    drawKeeperGlove(ctx, g1x, g1y, Math.atan2(g1y - s1y, g1x - s1x), gloveR)
    drawKeeperGlove(ctx, g2x, g2y, Math.atan2(g2y - s2y, g2x - s2x), gloveR)
  } else {
    // both gloves clamp together onto the ball (the catch). The held ball is the
    // main scene ball, drawn separately and parked at this point.
    const s1x = shx + Math.cos(perp) * wBody * 0.3, s1y = shy + Math.sin(perp) * wBody * 0.3
    const s2x = shx - Math.cos(perp) * wBody * 0.3, s2y = shy - Math.sin(perp) * wBody * 0.3
    divArm(s1x, s1y, gx, gy, wBody * 0.25)
    divArm(s2x, s2y, gx, gy, -wBody * 0.25)
    drawKeeperGlove(ctx, gx, gy, Math.atan2(gy - shy, gx - shx), gloveR)
  }
  ctx.lineCap = 'butt'; ctx.lineJoin = 'miter'
}

// ---- corner-kick arena: goal frame + net, pitch lines, corner flags ----
const projLerp = (a: P2, b: P2, t: number): P2 => ({ sx: lerp(a.sx, b.sx, t), sy: lerp(a.sy, b.sy, t), scale: lerp(a.scale, b.scale, t) })
const seg = (ctx: CanvasRenderingContext2D, a: P2, b: P2) => { ctx.beginPath(); ctx.moveTo(a.sx, a.sy); ctx.lineTo(b.sx, b.sy); ctx.stroke() }

type Proj = (x: number, y: number, z: number) => P2

function drawPitchLines(ctx: CanvasRenderingContext2D, project: Proj) {
  ctx.save()
  ctx.strokeStyle = 'rgba(255,255,255,0.4)'; ctx.lineWidth = 2
  // goal line runs corner to corner; the touchlines run back from each corner
  seg(ctx, project(-CORNER_X, 0, GOAL_Z), project(CORNER_X, 0, GOAL_Z))
  seg(ctx, project(-CORNER_X, 0, GOAL_Z), project(-CORNER_X, 0, GOAL_Z - 16))
  seg(ctx, project(CORNER_X, 0, GOAL_Z), project(CORNER_X, 0, GOAL_Z - 16))
  const zf = GOAL_Z - 5.5, hw6 = 5.0 // six-yard box
  seg(ctx, project(-hw6, 0, GOAL_Z), project(-hw6, 0, zf))
  seg(ctx, project(hw6, 0, GOAL_Z), project(hw6, 0, zf))
  seg(ctx, project(-hw6, 0, zf), project(hw6, 0, zf))
  const zp = GOAL_Z - 11, hw18 = 10.0 // penalty box (front edge only, for depth)
  if (zp > 0.5) {
    ctx.strokeStyle = 'rgba(255,255,255,0.26)'
    seg(ctx, project(-hw18, 0, zp), project(hw18, 0, zp))
    seg(ctx, project(-hw18, 0, GOAL_Z), project(-hw18, 0, zp))
    seg(ctx, project(hw18, 0, GOAL_Z), project(hw18, 0, zp))
  }
  // quarter-circle corner arcs where the goal line meets each touchline
  ctx.strokeStyle = 'rgba(255,255,255,0.4)'; ctx.lineWidth = 2
  for (const side of [-1, 1]) {
    ctx.beginPath()
    for (let i = 0; i <= 10; i++) {
      const th = (Math.PI / 2) * (i / 10)
      const p = project(side * (CORNER_X - 1 + Math.cos(th)), 0, GOAL_Z - Math.sin(th))
      if (i === 0) ctx.moveTo(p.sx, p.sy); else ctx.lineTo(p.sx, p.sy)
    }
    ctx.stroke()
  }
  ctx.restore()
}

function drawGoalFrame(ctx: CanvasRenderingContext2D, project: Proj) {
  const hw = GOAL_HW, ht = GOAL_H, z0 = GOAL_Z, zb = GOAL_Z + NET_DEPTH
  const TL = project(-hw, ht, z0), TR = project(hw, ht, z0), BL = project(-hw, 0, z0), BR = project(hw, 0, z0)
  const TLb = project(-hw, ht, zb), TRb = project(hw, ht, zb), BLb = project(-hw, 0, zb), BRb = project(hw, 0, zb)
  ctx.save()
  // translucent net planes (roof + back) so the goal reads as having depth
  ctx.fillStyle = 'rgba(225,232,245,0.06)'
  ctx.beginPath(); ctx.moveTo(TL.sx, TL.sy); ctx.lineTo(TR.sx, TR.sy); ctx.lineTo(TRb.sx, TRb.sy); ctx.lineTo(TLb.sx, TLb.sy); ctx.closePath(); ctx.fill()
  ctx.beginPath(); ctx.moveTo(TLb.sx, TLb.sy); ctx.lineTo(TRb.sx, TRb.sy); ctx.lineTo(BRb.sx, BRb.sy); ctx.lineTo(BLb.sx, BLb.sy); ctx.closePath(); ctx.fill()
  // net mesh
  ctx.strokeStyle = 'rgba(255,255,255,0.16)'; ctx.lineWidth = 1
  const NX = 9, NY = 4
  for (let i = 0; i <= NX; i++) { const t = i / NX; seg(ctx, projLerp(TLb, TRb, t), projLerp(BLb, BRb, t)) }
  for (let j = 0; j <= NY; j++) { const t = j / NY; seg(ctx, projLerp(TLb, BLb, t), projLerp(TRb, BRb, t)) }
  // depth strands front->back
  seg(ctx, TL, TLb); seg(ctx, TR, TRb); seg(ctx, BL, BLb); seg(ctx, BR, BRb)
  for (let i = 1; i < NX; i++) { const t = i / NX; seg(ctx, projLerp(TL, TR, t), projLerp(TLb, TRb, t)) }
  // back frame (thin)
  ctx.strokeStyle = 'rgba(205,212,225,0.7)'; ctx.lineWidth = Math.max(1.4, TLb.scale * 0.045)
  seg(ctx, TLb, TRb); seg(ctx, TLb, BLb); seg(ctx, TRb, BRb)
  // front frame (thick white posts + crossbar)
  ctx.strokeStyle = '#f4f7ff'; ctx.lineWidth = Math.max(2.5, TL.scale * 0.1); ctx.lineCap = 'round'
  seg(ctx, BL, TL); seg(ctx, BR, TR); seg(ctx, TL, TR)
  ctx.lineCap = 'butt'
  ctx.restore()
}

function drawCornerFlag(ctx: CanvasRenderingContext2D, project: Proj, side: number) {
  const base = project(side * CORNER_X, 0, GOAL_Z), top = project(side * CORNER_X, 1.5, GOAL_Z)
  ctx.save()
  ctx.strokeStyle = '#e8e8e8'; ctx.lineWidth = Math.max(1.5, base.scale * 0.025); ctx.lineCap = 'round'
  seg(ctx, base, top)
  ctx.fillStyle = '#ff5b6e'
  const fw = Math.max(6, base.scale * 0.22)
  ctx.beginPath(); ctx.moveTo(top.sx, top.sy); ctx.lineTo(top.sx - side * fw, top.sy + fw * 0.4); ctx.lineTo(top.sx, top.sy + fw * 0.75); ctx.closePath(); ctx.fill()
  ctx.lineCap = 'butt'
  ctx.restore()
}

// Three pips tracking which header types are scored this drill.
function drawProgress(ctx: CanvasRenderingContext2D, won: HeaderId[]) {
  const labels: [HeaderId, string][] = [['flick', 'Near'], ['back', 'Back'], ['tower', 'Tower']]
  const bw = 92, gap = 8, total = bw * 3 + gap * 2
  const x0 = W / 2 - total / 2, y = 70
  ctx.save()
  ctx.textAlign = 'center'; ctx.font = '800 12px Plus Jakarta Sans, sans-serif'
  labels.forEach(([id, label], i) => {
    const x = x0 + i * (bw + gap)
    const done = won.includes(id)
    ctx.fillStyle = done ? 'rgba(22,74,46,0.92)' : 'rgba(8,12,28,0.82)'
    roundRect(ctx, x, y, bw, 24, 9); ctx.fill()
    ctx.strokeStyle = done ? 'rgba(80,220,140,0.8)' : 'rgba(255,255,255,0.18)'; ctx.lineWidth = 1.5
    roundRect(ctx, x, y, bw, 24, 9); ctx.stroke()
    ctx.fillStyle = done ? '#7ef0a0' : '#cfd6ea'
    ctx.fillText(`${done ? '✓ ' : ''}${label}`, x + bw / 2, y + 16)
  })
  ctx.textAlign = 'left'
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
