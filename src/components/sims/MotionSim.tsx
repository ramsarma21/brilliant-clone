import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { SimProps } from './types'
import { Calculator } from './Calculator'
import { usePlayerKit } from '../../lib/playerKit'
import { drawPlayerLegs, drawPlayerShorts, bodyMetrics, drawPlayerArms, idleHands } from '../../lib/playerCanvas'
import { fetchHighScore, saveHighScore } from '../../lib/scores'
import type { JerseyPattern } from '../../types'

// ============================================================================
// Motion-Graphs unit — soccer skill = PASSING (the through-ball).
//
// CLICK-TO-PLACE through ball. The teammate roams the pitch continuously; the
// player aims a pulsing reticle (mirroring the penalty game's aim selector) and
// CLICKS the ground spot the ball should go. The game then judges the placement
// in objective soccer terms BEFORE asking any physics:
//
//   • GOOD through ball = led INTO SPACE ahead of the runner (along his heading,
//     a sensible lead distance, roughly on his running line) → ask the timing
//     question (solve the pass speed v_b = D / t_meet, fixed 30 s).
//   • BAD pass = behind / to his feet / off his line / wildly over-or-underhit →
//     the defender reads it and intercepts. A concise turnover (no lesson, reset
//     streak, click to retry).
//
// On a CORRECT answer the ball threads to the spot and the runner meets it 100%
// of the time. On a WRONG answer the defender cuts it out and a brief result line
// states the correct answer (no remediation lesson) — click to play the next run.
//
// Everything is deterministic — there is no Madden meter, no difficulty scaling
// and no luck-based interception of correct passes anymore.
// ============================================================================

// ---- Camera / canvas (identical feel to KinematicsSim) ----
const W = 900
const H = 560
const HORIZON = H * 0.4
// THIRD-PERSON camera. The lens is pulled CAM_BACK metres behind your passer and
// the eye is raised to EYE_Y for a slightly elevated look, so you can see your own
// avatar (world depth ~0, projecting into the lower-centre foreground at cz = CAM_BACK)
// the whole time. Every inverse projection must subtract CAM_BACK to stay exact.
const EYE_Y = 2.4
const FOCAL = 560
const CAM_BACK = 6 // metres the camera sits behind you (foreground depth of your avatar)

// ---- World (metres) ----
const RELEASE = { y: 0.12, z: 0.8 } // ground ball resting just ahead of you
// Your own passer avatar's world spot: foreground, just left of the ball so he
// never blocks the ball, the teammate, the defender, or the green safe zone.
const SELF = { x: -1.7, z: 0 }
const BALL_R = 0.13
const ZONE_HALF = 1.7 // catch tolerance ALONG his run for a "connected" thread
const T_MAX = 7 // seconds fallback for the fly clock

const BEST_KEY = 'physics-passing-best'

// ---- Solve economy (FIXED — no difficulty scaling) ----
const SOLVE_MS = 30000        // every good pass gets a flat 30 s to solve
const SOLVE_WARN_MS = 10000   // last 10 s get an urgent red countdown
const CALC_DRAIN = 1.25       // opening the calculator drains the clock at 1.25×

// ---- Free-roam aim (the teammate wanders; nothing is committed until you click) ----
const ROAM = { x: 5, zMin: 6.5, zMax: 13.5, cx: 0, cz: 10 }
const ROAM_TURN = 1.6    // rad/s max heading change → gradual, never-snapping turns
const ROAM_ACCEL = 3.2   // m/s² speed easing so pace changes look natural
const HEADING_MAX = 0.85 // max roam target heading off straight-ahead (±~49°)

// ---- Defender marking (aim phase): a marker shadows the roaming teammate the
// whole time so the player can SEE he is marked and must lead him into space.
// The defender tracks a point a step goal-side (ahead along the run) and a touch
// to the inside, eased toward each frame so he never teleports/pops.
const MARK_GAP = 1.7    // m goal-side of the runner (ahead along his heading)
const MARK_SIDE = 1.0   // m to the inside shoulder
const MARK_EASE = 5.5   // 1/s smoothing toward the mark point (lower = looser mark)

// ---- Through-ball judging (objective good vs bad placement) ----
// Relative to the runner's CURRENT position + heading + speed at click time:
//   along  = projection of (spot − runner) onto his heading.
//   across = perpendicular distance of the spot from his run line.
// GOOD = led into space ahead of him: a sensible forward lead and roughly on his
// running line. Anything else (feet/behind, off the line, over/underhit) is BAD.
const LEAD_MIN = 4      // m — at least this far ahead (not to his feet)
const LEAD_MAX = 18     // m — not a wild over-hit
const CHANNEL_HALF = 3.5 // m — within this channel of his run line

// Friendly integer sets the placement-derived givens snap to, so the shown
// numbers stay tidy and there is exactly one correct v_b.
const VR_SET = [3, 4, 5]   // runner speed (m/s)
const T_SET = [2, 3, 4]    // meet time (s)

// ---- Timeout dispossession (the "too slow" turnover) ----
const ROB_CLOSE_S = 0.75   // seconds for the defender to sprint up and take it
const ROB_DUR_S = 1.7      // total robbery beat before the result banner

// ---- Struck-pass timeline (visual only — the ball NEVER moves until CONTACT) ----
// The fly clock g.t starts at 0 the instant the pass is committed, but the ball's
// own travel clock is tf = g.t − WINDUP_S, so the through-ball flight begins EXACTLY
// at the contact frame. Up to WINDUP_S the passer plants, winds back and swings
// through; the ball launches at WINDUP_S; then he follows through. Every downstream
// timing (ball flight, runner run, defender lunge, resolution) is measured from
// contact, so the trajectories/outcomes are byte-for-byte what they were before —
// only a fixed pre-contact beat is inserted so the hit reads.
const WINDUP_S = 0.40      // plant + backswing + downswing → CONTACT at this instant
const PLANT_S = 0.16       // support-foot plant + backswing/anticipation (~160 ms)
const FOLLOW_S = 0.30      // follow-through after contact (leg decelerates)
const DEFLECT_S = 0.18     // ball deflects off the defender's boot to settle at his feet
const RECEIVE_S = 0.16     // teammate cushions the through ball down to his feet

type P2 = { sx: number; sy: number; scale: number }
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v))
const lerp = (a: number, b: number, t: number) => a + (b - a) * t
// Smooth accel→decel — used for the defender's interception lunge so it never snaps.
const easeInOut = (u: number) => (u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2)
// Decelerating ease — follow-through and reach-in settle smoothly to a stop.
const easeOut = (u: number) => 1 - Math.pow(1 - clamp(u, 0, 1), 3)
const parseNum = (s: string): number => { const v = parseFloat(s); return Number.isFinite(v) ? v : 0 }
const angWrap = (d: number) => { while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return d }

type Phase = 'aim' | 'solve' | 'fly' | 'robbed' | 'result'
type Outcome = 'connected' | 'early' | 'late' | 'soft'

type Play = {
  vr: number        // runner's constant speed (m/s) = slope of his run
  tMeet: number     // the instant he arrives at the spot (s)
  L: number         // lead distance he covers to the spot = v_r · t_meet (m)
  D: number         // straight-line pass distance from you to the spot (m, GIVEN)
  vb: number        // the one correct pass speed = D / t_meet
  // ---- world geometry (metres) ----
  rx0: number       // his position at click (lateral)
  rz0: number       // his position at click (depth)
  hx: number        // run direction you→spot, unit (lateral)
  hz: number        // run direction you→spot, unit (depth)
  bdx: number       // ball pass direction you→spot, unit (lateral)
  bdz: number       // ball pass direction you→spot, unit (depth)
  sx: number        // the spot, world (lateral) = you + bdir·D
  sz: number        // the spot, world (depth)
  along: number     // forward lead the player chose (judged)
  across: number    // off-line distance the player chose (judged)
  side: 1 | -1      // which way the run leans (drives the defender's offset)
  defD: number      // defender loiters this far along the ball line (m)
  defOff: number    // ...offset to the side of the ball line (m)
}

// Judge a placed spot in objective soccer terms relative to the runner's live
// position + heading. Returns the lead components and whether it is a good ball.
function judgePlacement(heading: number, rx: number, rz: number, gx: number, gz: number) {
  const hx = Math.sin(heading), hz = Math.cos(heading)
  const dx = gx - rx, dz = gz - rz
  const along = dx * hx + dz * hz                 // forward projection onto his run
  const across = dx * hz - dz * hx                // perpendicular off-line distance
  const good = along >= LEAD_MIN && along <= LEAD_MAX && Math.abs(across) <= CHANNEL_HALF
  return { along, across, good }
}

// Build a complete play from the runner's position R0 and the clicked spot. The
// runner runs straight from R0 onto the spot; the ball cuts its own diagonal line
// from you to the spot. v_r / t_meet snap to friendly integers (chosen so v_r·t
// best matches the clicked lead), D is tidied to 0.5 m and v_b = D / t_meet is the
// single correct answer — consistent with the grader and the drawn flight.
function buildPlacedPlay(rx0: number, rz0: number, gx: number, gz: number, along: number, across: number): Play {
  const dx = gx - rx0, dz = gz - rz0
  const runDist = Math.max(0.001, Math.hypot(dx, dz))
  const dirx = dx / runDist, dirz = dz / runDist
  // Friendly (v_r, t_meet) whose product best matches the chosen lead distance.
  let vr = VR_SET[0], tMeet = T_SET[0], bestErr = Infinity
  for (const v of VR_SET) for (const tm of T_SET) {
    const e = Math.abs(v * tm - runDist)
    if (e < bestErr) { bestErr = e; vr = v; tMeet = tm }
  }
  const L = vr * tMeet
  const sxt = rx0 + dirx * L, szt = rz0 + dirz * L   // where the runner arrives
  const px = 0, pz = RELEASE.z
  const trueD = Math.max(0.001, Math.hypot(sxt - px, szt - pz))
  const D = Math.max(4, Math.round(trueD * 2) / 2)   // tidy shown pass distance
  const bdx = (sxt - px) / trueD, bdz = (szt - pz) / trueD
  const side: 1 | -1 = dirx >= 0 ? 1 : -1
  return {
    vr, tMeet, L, D, vb: D / tMeet,
    rx0, rz0, hx: dirx, hz: dirz, bdx, bdz,
    sx: px + bdx * D, sz: pz + bdz * D,
    along, across, side,
    defD: clamp(D * 0.58, 3, D - 1.5), defOff: -side * 2.2,
  }
}

// A default play for the uncommitted aim phase / a fresh run. The REAL play is
// rebuilt at click from the runner's live roam state + the clicked spot.
function makeSeedPlay(): Play {
  return buildPlacedPlay(0, 9, 0, 13, 4, 0)
}

// Advance the free-roam teammate one frame during `aim`. He wanders toward random
// heading/speed targets that refresh every ~1–2.5 s, turning at a capped rate (no
// snapping) and easing his pace. A soft containment points him back toward centre
// near a box edge so he turns around and keeps running. Pure visual.
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
  updateMarker(g, dt)
}

// Ease the marker toward a point a step goal-side + inside the runner. Frame-rate
// independent exponential smoothing → he shadows the run smoothly, lagging a hair
// like a real marker (never snapping to the runner's exact position).
function updateMarker(g: Game, dt: number) {
  const hx = Math.sin(g.roamHeading), hz = Math.cos(g.roamHeading)
  const sideSign = g.roamX >= 0 ? -1 : 1
  const off = sideSign * MARK_SIDE
  const tx = g.roamX + MARK_GAP * hx + off * hz
  const tz = g.roamZ + MARK_GAP * hz - off * hx
  const k = 1 - Math.exp(-dt * MARK_EASE)
  g.defX += (tx - g.defX) * k
  g.defZ += (tz - g.defZ) * k
}

// The single correct answer for the placed play.
const answerSpeed = (p: Play) => p.D / p.tMeet // v_b = D / t_meet

// Timing of a chosen pass at the spot. The ball is released at t=0 and flies at
// v_b over distance D, reaching the spot at t_b = D / v_b. The runner arrives at
// t_meet, so the signed `runOffset` tells the whole story (connected within
// ±ZONE_HALF, else early/late/soft).
function passResult(vb: number, p: Play): { tb: number; runOffset: number } | null {
  if (vb <= 0.001) return null
  const tb = p.D / vb
  return { tb, runOffset: p.vr * (tb - p.tMeet) }
}

function classify(r: { runOffset: number } | null): Outcome {
  if (!r) return 'soft'
  if (r.runOffset > ZONE_HALF * 3) return 'soft'   // far underhit — arrives way behind
  if (r.runOffset > ZONE_HALF) return 'late'       // he ran through before it arrived
  if (r.runOffset < -ZONE_HALF) return 'early'     // ball got there ahead of him
  return 'connected'
}

// ============================================================================
// Randomized motion-graph PROBLEM (the typed-solve question, uniform with the
// other drills). Every run draws fresh INTEGER givens in [1,50] and a random
// unknown among the straight-line motion-graph relations (slope = velocity):
//   • velocity   v   = Δx / Δt          (read the slope off the graph)
//   • position   x   = x₀ + v · t        (where he is after time t)
//   • time       t   = (x − x₀) / v      (when he reaches a point)
//   • passspeed  v_b = D / t             (lead-the-runner: pass dist over meet time)
// The exact answer can be a decimal; it is graded within ±1 whole number so the
// user may round up OR down. The live input placeholder is generic (the unit) and
// never reveals the answer. Givens are built so each answer is finite and
// non-trivial (1..50, never 0); the time/position pair is constructed from a whole
// t so "find t" lands on a clean integer.
// ============================================================================
type ProblemKind = 'velocity' | 'position' | 'time' | 'passspeed'
type Given = { label: string; expr: string }
type Problem = {
  kind: ProblemKind
  givens: Given[]
  formula: string     // e.g. 'v = Δx / Δt'
  plug: string        // e.g. '24 / 6'
  symbol: string      // e.g. 'v'
  varName: string     // e.g. 'velocity v'
  unit: string        // 'm/s' | 'm' | 's'
  answer: number      // EXACT value graded against
  nums: { a: number; b: number; c: number } // raw givens for the remediation
}

const GIVEN_MIN = 1
const GIVEN_MAX = 50
const randInt = () => GIVEN_MIN + Math.floor(Math.random() * (GIVEN_MAX - GIVEN_MIN + 1))
const round1 = (x: number) => Math.round(x * 10) / 10
const answerOf = (p: Problem) => p.answer
// The exact answer can be a decimal; accept anything within 1.0 of it so the user
// may round the exact value UP or DOWN to the nearest whole number (e.g. exact
// 24.4 → both 24 and 25 count). Flat tolerance, nudged just past 1 to keep the
// rounding boundary inclusive against float error.
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
      formula: 'v = Δx / Δt', plug: `${dx} / ${dt}`, nums: { a: dx, b: dt, c: 0 },
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
      formula: 'x = x₀ + v · t', plug: `${x0} + ${v} · ${t}`, nums: { a: x0, b: v, c: t },
    }
  }
  if (kind === 'time') {
    const x0 = randInt(), v = randInt(), t = randInt()
    const x = x0 + v * t   // construct from a whole t so the answer is a clean integer
    return {
      kind, symbol: 't', varName: 'time t', unit: 's', answer: (x - x0) / v,
      givens: [
        { label: 'Start position', expr: `x₀ = ${x0} m` },
        { label: 'Target position', expr: `x = ${x} m` },
        { label: 'Velocity (slope)', expr: `v = ${v} m/s` },
      ],
      formula: 't = (x − x₀) / v', plug: `(${x} − ${x0}) / ${v}`, nums: { a: x, b: x0, c: v },
    }
  }
  // passspeed — the lead-the-runner relation: pass distance over the meet time
  const D = randInt(), t = randInt()
  return {
    kind, symbol: 'v_b', varName: 'pass speed v_b', unit: 'm/s', answer: D / t,
    givens: [
      { label: 'Pass distance to the spot', expr: `D = ${D} m` },
      { label: 'Runner reaches it at', expr: `t = ${t} s` },
    ],
    formula: 'v_b = D / t', plug: `${D} / ${t}`, nums: { a: D, b: t, c: 0 },
  }
}

function missText(p: Problem, used: number): string {
  const correct = round1(p.answer)
  return `${used > p.answer ? 'Too high' : 'Too low'} — you played ${round1(used)} ${p.unit}, but ${p.formula} = ${correct} ${p.unit}.`
}

// ---- minimal sound (same toolkit as the penalty) ----
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
  pass() { this.burst(380, 0.6, 0.12, 0.28); this.tone(140, 0.1, 'sine', 0.18) }
  whistle() { this.tone(2100, 0.18, 'square', 0.08); this.tone(2400, 0.18, 'square', 0.06, 0.04) }
  cheer() { this.burst(900, 0.4, 0.6, 0.28) }
  steal() { this.tone(150, 0.22, 'sawtooth', 0.2) }
  miss() { this.burst(240, 1, 0.18, 0.26) }
}

type Particle = { x: number; y: number; vx: number; vy: number; life: number; max: number; color: string; size: number; rot: number; vr: number }

type Game = {
  phase: Phase
  play: Play
  problem: Problem        // the randomized motion-graph question shown in `solve`
  played: number          // the numeric answer the player actually submitted
  badPass: boolean       // a placed pass judged objectively bad (turnover, no question)
  solveElapsedMs: number  // accrues 1× normally, 1.25× while the calculator is open
  vb: number              // the pass speed actually played (drives the animation)
  t: number               // fly clock (0 at commit; ball travel clock is t − WINDUP_S)
  released: boolean
  contacted: boolean      // true once the swing reaches the ball (the launch frame)
  // Outcome decided ONCE at strike, applied by the fly loop.
  outcome: Outcome | null
  crossT: number          // time the ball reaches the spot (Infinity if never)
  crossS: number          // ball travel distance to the spot
  // Defender interception (cuts out a bad placement OR a mis-weighted answer).
  interceptS: number
  interceptT: number
  defRunDur: number
  resolved: boolean
  scored: boolean
  celebrate: number
  particles: Particle[]
  // Timeout dispossession: set when the solve clock expires with no pass played.
  robbed: boolean
  // ---- Free-roam (aim phase): live wandering before any spot is committed ----
  roamX: number
  roamZ: number
  roamHeading: number
  roamSpeed: number
  roamTargetHeading: number
  roamTargetSpeed: number
  roamRetargetAt: number
  // Live marker world position (eased toward a goal-side point on the runner during
  // aim). Captured at commit to seed the defender's loiter so there's no pop.
  defX: number
  defZ: number
  // Aim reticle ground point (follows the pointer over the canvas during aim).
  aimGX: number
  aimGZ: number
  // performance.now() at click — drives the space/defender fade-in (no pop).
  commitAt: number
}

const newGame = (play: Play, problem: Problem): Game => ({
  phase: 'aim', play, problem, played: 0,
  badPass: false, solveElapsedMs: 0,
  vb: 0, t: 0, released: false, contacted: false,
  outcome: null, crossT: Infinity, crossS: 0,
  interceptS: NaN, interceptT: Infinity, defRunDur: 0.9,
  resolved: false, scored: false, celebrate: 0, particles: [],
  robbed: false,
  roamX: 0, roamZ: 10, roamHeading: 0, roamSpeed: 4,
  roamTargetHeading: 0, roamTargetSpeed: 4, roamRetargetAt: 0,
  defX: 0, defZ: 10 + MARK_GAP,
  aimGX: 0, aimGZ: 11, commitAt: 0,
})

export function MotionSim({ state, onChange, showGoal, onGoal }: SimProps) {
  // UNIVERSAL APPEARANCE: the passer in the foreground (the player the user
  // controls) is drawn from the live equipped loadout, so changing the kit on the
  // player card updates this drill globally. We keep the latest kit in a ref the
  // draw loop reads, merging the loadout colours over SELF_KIT's fixed identity
  // bits (collar / shirt number / hair style). The teammate + defender keep their
  // own distinct TEAM_KIT / FOE_KIT colours.
  // SELF_KIT is the BASE identity (num 10, hair, skin). usePlayerKit merges the
  // equipped jersey + cleats COLOURS over it (jersey/shorts/socks/boots), leaving the
  // structural bits intact, so equipping a different loadout visibly re-skins your
  // passer's shirt, shorts, socks and boots while skin/hair stay put.
  const selfKit = usePlayerKit(SELF_KIT)
  const selfKitRef = useRef<Kit>(selfKit)
  selfKitRef.current = selfKit

  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [phase, setPhase] = useState<Phase>('aim')
  const [answerStr, setAnswerStr] = useState('')
  const [streak, setStreak] = useState(0)
  const [best, setBest] = useState(() => { try { return Number(localStorage.getItem(BEST_KEY) ?? 0) || 0 } catch { return 0 } })
  useEffect(() => { void fetchHighScore('motion-graphs').then(setBest) }, [])
  const [sound, setSound] = useState(true)
  const [showCalc, setShowCalc] = useState(false)
  // A wrong answer: a turnover with a brief result line stating the correct answer
  // (no remediation lesson). Holds that line for the result banner.
  const [missMsg, setMissMsg] = useState<string | null>(null)
  // An objectively bad placement that the defender read & cut out: no score, no
  // teaching lesson — a soccer-feedback turnover, click anywhere to retry.
  const [badPass, setBadPass] = useState(false)
  // Ran the solve clock down without playing: the defender stepped up and robbed
  // you. A non-lesson turnover — reset the streak, click anywhere to play on.
  const [robbed, setRobbed] = useState(false)
  // Re-render tick so the React side-panel follows the live game state.
  const [, force] = useState(0)
  const rerender = useCallback(() => force((n) => n + 1), [])

  const sfx = useRef(new Sfx())
  const soundRef = useRef(sound); soundRef.current = sound
  const showCalcRef = useRef(showCalc); showCalcRef.current = showCalc
  const gameRef = useRef<Game>(newGame(makeSeedPlay(), makeProblem()))
  const rafRef = useRef<number | null>(null)
  const bgRef = useRef<HTMLCanvasElement | null>(null)
  const gradRef = useRef<{ grass: CanvasGradient; vignette: CanvasGradient } | null>(null)
  const sceneRef = useRef({ onChange, state, onGoal, showGoal })
  sceneRef.current = { onChange, state, onGoal, showGoal }
  const goalFiredRef = useRef(false)
  const answerRef = useRef(answerStr); answerRef.current = answerStr
  const streakRef = useRef(streak); streakRef.current = streak
  const bestRef = useRef(best); bestRef.current = best

  // ---- projection ----
  const project = useCallback((x: number, y: number, z: number): P2 => {
    // Camera-space depth = world depth + the third-person pull-back, so your own
    // avatar at world z~0 lands a comfortable cz = CAM_BACK in the foreground.
    const cz = Math.max(0.05, z + CAM_BACK)
    const scale = FOCAL / cz
    return { sx: W / 2 + x * scale, sy: HORIZON - (y - EYE_Y) * scale, scale }
  }, [])
  // Point on the RUNNER's line: run-distance `s` from R0 along his heading.
  const runAt = useCallback((p: Play, s: number, y: number, lat = 0): P2 => {
    const gx = p.rx0 + p.hx * s + p.hz * lat
    const gz = p.rz0 + p.hz * s - p.hx * lat
    return project(gx, y, gz)
  }, [project])
  // Point on the BALL's line: distance `s` from you (origin) along the pass dir.
  const ballAt = useCallback((p: Play, s: number, y: number, lat = 0): P2 => {
    const gx = p.bdx * s + p.bdz * lat
    const gz = RELEASE.z + p.bdz * s - p.bdx * lat
    return project(gx, y, gz)
  }, [project])

  // ===== Actions =====
  const nextRun = useCallback(() => {
    gameRef.current = newGame(makeSeedPlay(), makeProblem())
    goalFiredRef.current = false
    setAnswerStr(''); setShowCalc(false); setMissMsg(null); setBadPass(false); setRobbed(false)
    setPhase('aim')
  }, [])

  // Shared strike core for the QUESTION pass. The typed numeric answer is graded
  // against the run's randomized motion-graph problem (within ±1 whole number). The
  // THROUGH-BALL ANIMATION is unchanged: a correct answer threads it (the ball
  // flies the play's own connecting speed v_b = D/t_meet); a wrong one is
  // mis-weighted so the defender cuts it out.
  const fire = useCallback((value: number) => {
    const g = gameRef.current
    const p = g.play
    const correct = Math.abs(value - answerOf(g.problem)) <= tolOf(g.problem)
    const thread = answerSpeed(p)                       // the play's connecting speed
    const vb = correct ? thread : thread * (Math.random() < 0.5 ? 0.6 : 1.55)
    g.vb = vb; g.played = value; g.badPass = false
    const cr = passResult(vb, p)
    let outcome = classify(cr)
    if (correct) outcome = 'connected'
    else if (outcome === 'connected') outcome = 'late'  // guard: a miss must never read as connected
    g.outcome = outcome
    g.crossT = cr ? cr.tb : Infinity
    g.crossS = p.D
    const clean = outcome === 'connected'
    if (clean) { g.interceptS = NaN; g.interceptT = Infinity }
    else {
      if (vb > 0.05) { g.interceptS = clamp(Math.min(p.defD, p.D - 0.5), 1.5, p.D); g.interceptT = g.interceptS / vb }
      else { g.interceptS = 0.7; g.interceptT = 1.0 }
    }
    g.defRunDur = 0.9
    g.t = 0; g.released = true; g.contacted = false; g.resolved = false; g.scored = false; g.celebrate = 0
    g.phase = 'fly'
    // The "thump" is fired at CONTACT (in the loop), not on the button press, so the
    // sound lands with the boot meeting the ball. Just warm the audio context here.
    if (soundRef.current) sfx.current.ensure()
    setPhase('fly')
  }, [])

  // Set up the flight + downfield interception for an objectively BAD placement.
  // No physics outcome, never scores, never teaches — the defender just reads it.
  const fireBad = useCallback(() => {
    const g = gameRef.current
    const p = g.play
    const vb = Math.max(6, p.D / p.tMeet) // a plausible pace toward the bad spot
    g.vb = vb; g.badPass = true
    g.outcome = null
    g.crossT = Infinity; g.crossS = p.D
    g.interceptS = clamp(p.D * 0.5, 1.5, p.D - 0.5); g.interceptT = g.interceptS / vb
    g.defRunDur = 0.9
    g.t = 0; g.released = true; g.contacted = false; g.resolved = false; g.scored = false; g.celebrate = 0
    g.phase = 'fly'
    if (soundRef.current) sfx.current.ensure()
    setPhase('fly')
  }, [])

  // CLICK in the aim phase: place the pass at the reticle ground spot, judge it,
  // and either ask the question (good) or take the turnover (bad).
  const placePass = useCallback(() => {
    const g = gameRef.current
    if (g.phase !== 'aim') return
    const now = performance.now()
    const gx = g.aimGX, gz = g.aimGZ
    const { along, across, good } = judgePlacement(g.roamHeading, g.roamX, g.roamZ, gx, gz)
    g.play = buildPlacedPlay(g.roamX, g.roamZ, gx, gz, along, across)
    // Seed the defender's loiter from where the marker actually is RIGHT NOW
    // (projected onto the new pass line) so he flows out of his marking run into
    // the interception/loiter without teleporting.
    const rx = g.defX, rz = g.defZ - RELEASE.z
    g.play.defD = clamp(rx * g.play.bdx + rz * g.play.bdz, 2, g.play.D)
    g.play.defOff = rx * g.play.bdz - rz * g.play.bdx
    g.commitAt = now
    if (soundRef.current) sfx.current.ensure()
    if (good) {
      g.solveElapsedMs = 0
      g.phase = 'solve'
      setAnswerStr('')
      setPhase('solve')
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
    const p = g.play
    g.phase = 'result'
    if (g.badPass) {
      // Objective turnover: no score, no teaching lesson.
      if (soundRef.current) { sfx.current.steal(); sfx.current.miss() }
      setStreak(0)
      setBadPass(true)
      setPhase('result')
      return
    }
    const clean = g.outcome === 'connected'
    if (clean) {
      g.scored = true; g.celebrate = 1
      spawnConfetti(g, project(p.sx, 1.0, p.sz))
      if (soundRef.current) { sfx.current.pass(); sfx.current.cheer() }
      const s = streakRef.current + 1
      setStreak(s)
      if (s > bestRef.current) { setBest(s); void saveHighScore('motion-graphs', s) }
      if (!goalFiredRef.current) {
        goalFiredRef.current = true
        const sc = sceneRef.current
        sc.onChange({ ...sc.state, connections: Number(sc.state.connections ?? 0) + 1 })
        sc.onGoal?.()
      }
    } else {
      // Wrong answer: the defender cuts it out (the existing miss animation) and a
      // brief result line states the correct answer — no remediation lesson.
      if (soundRef.current) { sfx.current.steal(); sfx.current.miss() }
      setStreak(0)
      setMissMsg(missText(g.problem, g.played))
    }
    setPhase('result')
  }, [project])

  // Timeout: the solve clock expired with no pass played. The lurking defender
  // steps up and robs the ball off your feet — a non-lesson turnover.
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
  }, [])

  const endRobbery = useCallback(() => {
    const g = gameRef.current
    if (g.phase !== 'robbed') return
    g.phase = 'result'
    setPhase('result')
  }, [])

  const actionsRef = useRef({ placePass, playPass, resolve, dispossess, endRobbery })
  actionsRef.current = { placePass, playPass, resolve, dispossess, endRobbery }

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
    if (sy <= HORIZON + 6) return // above the pitch — ignore
    // Inverse of the forward projection for a ground point (y=0):
    //   sy = HORIZON + EYE_Y·scale            -> scale = (sy - HORIZON) / EYE_Y
    //   scale = FOCAL / (z + CAM_BACK)         -> z = FOCAL/scale - CAM_BACK
    //   sx = W/2 + x·scale                     -> x = (sx - W/2) / scale
    // The CAM_BACK subtraction un-does the camera pull-back so the reticle lands
    // exactly under the cursor (and the green safe zone, drawn via project, matches
    // the judged region since both live in the same world coordinates).
    const scale = (sy - HORIZON) / EYE_Y
    const z = clamp(FOCAL / scale - CAM_BACK, 5, 22)
    const x = clamp((sx - W / 2) / scale, -ROAM.x - 2, ROAM.x + 2)
    g.aimGX = x; g.aimGZ = z
  }
  function onPointerDown() {
    const g = gameRef.current
    if (g.phase === 'aim') actionsRef.current.placePass()
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
    const commitFade = g.phase === 'aim' ? 0 : clamp((now - g.commitAt) / 320, 0, 1)

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

    // ---- AIM safe zone: the channel a good through ball must land in. Anchored
    // to the runner's LIVE roam position + heading and drawn flat on the pitch so
    // it slides/rotates with him. Reuses judgePlacement's exact thresholds, so the
    // highlighted region == the accepted region. Aim only — hidden once committed.
    if (g.phase === 'aim') {
      drawSafeZone(ctx, project, g.roamX, g.roamZ, g.roamHeading, now)
    }

    // Ball-travel clock: 0 at the contact frame, so the ball is at rest through the
    // windup and everything downstream (flight, run, lunge) keys off the same hit.
    const tf = Math.max(0, g.t - WINDUP_S)
    const cleanThread = g.outcome === 'connected' && !g.badPass
    const cutOut = g.badPass || (!!g.outcome && !cleanThread)

    // ---- the placed spot (target ring) — only after a commit ----
    if (g.phase !== 'aim') {
      ctx.save(); ctx.globalAlpha = commitFade
      drawSpotRing(ctx, project(p.sx, 0.02, p.sz), now, g.badPass)
      ctx.restore()
    }

    // ---- defender (ALWAYS on the pitch: marks the roaming runner during aim,
    // then flows straight into his interception/robbery behaviour after commit).
    // A won ball ALWAYS settles at his FEET — these flags hand it to the single ball
    // renderer below so there is never a second ball and never a ball in his hands. ----
    let ballHolder: 'def' | 'mate' | null = null
    let holderFeet: P2 | null = null
    let holderCapS = 0   // where on the ball line the ball was at the moment of capture
    let holderSince = 0  // seconds since capture → drives the deflect/cushion settle
    if (g.phase === 'aim') {
      // MARKING: shadow the roaming teammate, goal-side + a step inside, legs
      // running the whole time so the player can see he must lead him into space.
      drawPlayer(ctx, project(g.defX, 0, g.defZ), project(g.defX, 1.84, g.defZ), FOE_KIT, now, true, false, 'normal', undefined, true, false, true)
    } else {
      // No alpha fade here — the marker is already on screen and his loiter is
      // seeded from his live position, so the commit is continuous (no pop).
      if (g.robbed) {
        // TIMEOUT ROBBERY: the lurking defender steps all the way up, reaches a boot
        // in and nicks the ball off your feet — settling it at HIS feet.
        const u = clamp(g.t / ROB_CLOSE_S, 0, 1)
        const e = easeInOut(u)
        const robS = lerp(p.defD, 1.0, e)
        const robLat = lerp(p.defOff, 0, e)
        const robRunning = u < 0.86
        const fpt = ballAt(p, robS, 0, robLat)
        const hpt = ballAt(p, robS, 1.84, robLat)
        const reach = clamp((u - 0.6) / 0.4, 0, 1)
        const origin = ballAt(p, 0, 0)
        const reachDir = Math.sign(origin.sx - fpt.sx) || -1
        drawPlayer(ctx, fpt, hpt, FOE_KIT, now, robRunning, false, 'normal', reach > 0 ? { reach, reachDir } : undefined, true, false, true)
        if (g.t >= ROB_CLOSE_S) { ballHolder = 'def'; holderFeet = fpt; holderCapS = 0; holderSince = g.t - ROB_CLOSE_S }
      } else {
        // DOWNFIELD INTERCEPTION: pre-contact he just loiters/marks (the pass has not
        // been struck). At contact he steps across the line, reaches a leg in and
        // meets the ball exactly at the interception point, deflecting it to his feet.
        let defS = p.defD, defLat = p.defOff, defRunning = true
        let reach = 0
        if ((g.phase === 'fly' || g.phase === 'result') && cutOut && g.contacted) {
          // Fit the lunge inside [contact, interceptT] so he never pre-empts the hit,
          // and always arrives right as the ball gets there (tight, no teleport).
          const lunge = Math.min(g.defRunDur, Math.max(0.25, g.interceptT))
          const tp = clamp((tf - (g.interceptT - lunge)) / lunge, 0, 1)
          const e = easeInOut(tp)
          defS = lerp(p.defD, g.interceptS, e)
          defLat = lerp(p.defOff, 0, e)
          defRunning = tp > 0.02 && tp < 0.84
          reach = clamp((tp - 0.58) / 0.42, 0, 1)   // boot pokes across as he meets it
          if (tf >= g.interceptT) { ballHolder = 'def'; holderCapS = g.interceptS; holderSince = tf - g.interceptT }
        } else if ((g.phase === 'fly' || g.phase === 'result') && cleanThread && g.contacted) {
          // A clean thread beats him: he lunges but the ball is already past his boot.
          const tp = easeInOut(clamp((tf - (g.crossT - 0.6)) / 0.6, 0, 1))
          defLat = lerp(p.defOff, p.defOff * 0.45, tp)
          defRunning = tp > 0.02 && tp < 0.7
          reach = clamp((tp - 0.55) / 0.45, 0, 1) * 0.6
        }
        const fpt = ballAt(p, defS, 0, defLat)
        const hpt = ballAt(p, defS, 1.84, defLat)
        const linePt = ballAt(p, defS, 0, 0)
        const reachDir = Math.sign(linePt.sx - fpt.sx) || (p.side > 0 ? -1 : 1)
        drawPlayer(ctx, fpt, hpt, FOE_KIT, now, defRunning, false, 'normal', reach > 0 ? { reach, reachDir } : undefined, true, false, true)
        if (ballHolder === 'def') holderFeet = fpt
      }
    }

    // ---- runner (teammate): on a clean thread he runs onto it and takes it down at
    // his FEET on arrival (the ball is handed to the single ball renderer below). ----
    let rFeet: P2, rHead: P2, runnerRunning: boolean
    let runnerAct: { reach: number; reachDir: number } | undefined
    if (g.phase === 'aim') {
      // Free roam — drawn from his live world position, not on any line.
      rFeet = project(g.roamX, 0, g.roamZ); rHead = project(g.roamX, 1.84, g.roamZ)
      runnerRunning = true
    } else if (g.badPass) {
      // Bad ball: he never gets it; he holds where he was at the click.
      rFeet = runAt(p, 0, 0, 0); rHead = runAt(p, 0, 1.84, 0)
      runnerRunning = false
    } else if (g.robbed) {
      rFeet = runAt(p, 0, 0, 0); rHead = runAt(p, 0, 1.84, 0)
      runnerRunning = false
    } else if (g.phase === 'fly' || g.phase === 'result') {
      // Runs from R0 onto the spot; reaches the spot (L) exactly at t_meet (from contact).
      const runnerS = clamp(p.vr * tf, 0, p.L + 6)
      rFeet = runAt(p, runnerS, 0, 0); rHead = runAt(p, runnerS, 1.84, 0)
      runnerRunning = g.phase === 'fly'
      if (cleanThread && g.contacted && tf >= g.crossT) {
        // He has arrived onto the ball: cushion it to his feet and stop the run.
        ballHolder = 'mate'; holderFeet = rFeet; holderCapS = g.crossS; holderSince = tf - g.crossT
        runnerRunning = false
        const ru = clamp(holderSince / RECEIVE_S, 0, 1)
        const spot = ballAt(p, g.crossS, 0)
        runnerAct = { reach: (1 - ru) * 0.7, reachDir: Math.sign(spot.sx - rFeet.sx) || 1 }
      }
    } else if (g.phase === 'solve') {
      // Waiting on the through ball: he jogs on the spot at R0 (no translation).
      rFeet = runAt(p, 0, 0, 0); rHead = runAt(p, 0, 1.84, 0)
      runnerRunning = true
    } else {
      rFeet = runAt(p, 0, 0, 0); rHead = runAt(p, 0, 1.84, 0)
      runnerRunning = false
    }
    drawPlayer(ctx, rFeet, rHead, TEAM_KIT, now, runnerRunning, false, 'normal', runnerAct)

    // ---- aim reticle (pulsing selector that follows the pointer) ----
    if (g.phase === 'aim') {
      const live = judgePlacement(g.roamHeading, g.roamX, g.roamZ, g.aimGX, g.aimGZ)
      drawReticle(ctx, project(g.aimGX, 0.02, g.aimGZ), now, live.good)
    }

    // ---- ball: EXACTLY ONE on screen, fully authoritative here. It rests at your
    // feet through the windup, LAUNCHES at the contact frame (tf=0), flies the very
    // same line as before, then either deflects to the defender's feet or is cushioned
    // to the teammate's feet. The player figures never draw a ball of their own. ----
    const drawGroundBall = (s: number, spin: number, squash: number, dx = 0) => {
      const bp = ballAt(p, Math.min(s, p.D), BALL_R)
      const sh = ballAt(p, Math.min(s, p.D), 0.01)
      ctx.fillStyle = 'rgba(0,0,0,0.3)'
      ctx.beginPath(); ctx.ellipse(sh.sx + dx, sh.sy, BALL_R * sh.scale * 1.3, BALL_R * sh.scale * 0.5, 0, 0, Math.PI * 2); ctx.fill()
      drawBall(ctx, bp.sx + dx, bp.sy, Math.max(4, BALL_R * bp.scale), spin, squash)
    }
    if (ballHolder) {
      // Captured: a quick eased cushion/deflection from the line point to the feet,
      // with a squash on impact and a small puff so the touch reads.
      const hf = holderFeet!
      const settleT = ballHolder === 'def' ? DEFLECT_S : RECEIVE_S
      const u = easeOut(clamp(holderSince / settleT, 0, 1))
      const cap = ballAt(p, Math.min(holderCapS, p.D), BALL_R)
      const restR = Math.max(4, BALL_R * hf.scale)
      const bx = lerp(cap.sx, hf.sx + restR * 1.1, u)
      const by = lerp(cap.sy, hf.sy - restR * 0.7, u)
      const r = Math.max(4, BALL_R * lerp(cap.scale, hf.scale, u))
      ctx.fillStyle = 'rgba(0,0,0,0.3)'
      ctx.beginPath(); ctx.ellipse(bx, by + r * 0.8, r * 1.25, r * 0.45, 0, 0, Math.PI * 2); ctx.fill()
      drawBall(ctx, bx, by, r, now / 300, (1 - u) * 0.45)
      if (holderSince < 0.18) drawPuff(ctx, cap, holderSince / 0.18, ballHolder === 'def' ? '255,215,223' : '223,245,230')
    } else if (g.robbed) {
      // Resting at your feet with a nervous jitter as he closes you down.
      const jitter = Math.sin(now / 70) * Math.min(3, g.t * 6)
      drawGroundBall(0, now / 600, 0, jitter)
    } else if ((g.phase === 'fly' || g.phase === 'result') && g.contacted) {
      // In flight, the ball's own clock starting at the contact frame.
      let bs = Math.max(0, g.vb * tf)
      if (cleanThread) bs = Math.min(bs, g.crossS)
      else if (cutOut) bs = Math.min(bs, g.interceptS)
      else bs = Math.min(bs, p.D)
      const launchSq = Math.max(0, 0.4 - tf * 4)   // brief squash right off the boot
      drawGroundBall(bs, bs * 2.2, launchSq)
      if (tf < 0.14) drawPuff(ctx, ballAt(p, 0, BALL_R), tf / 0.14, '255,244,207')
    } else {
      // At rest at the pass origin: aim, solve, and the pre-contact windup.
      drawGroundBall(0, now / 600, 0)
    }

    // ---- YOUR passer avatar (third-person): always on screen, every phase ----
    // Drawn last among the world figures so this nearest (cz = CAM_BACK) player sits
    // in front. Idle while aiming/solving; during fly he runs the struck-pass timeline
    // (plant → backswing → swing-through to CONTACT → follow-through → settle to watch);
    // arms-up cheer on a connected thread; a flat stand for a turnover/robbery.
    {
      const feet = project(SELF.x, 0, SELF.z)
      const head = project(SELF.x, 1.84, SELF.z)
      let selfPose: 'normal' | 'cheer' = 'normal'
      let kickT: number | null = null
      if (g.phase === 'fly' && !g.robbed) {
        // Feed the swing the fly clock; past the follow-through he settles and watches.
        if (g.t <= WINDUP_S + FOLLOW_S + 0.25) kickT = g.t
      } else if (g.phase === 'result' && g.scored && cleanThread) {
        selfPose = 'cheer'
      }
      drawPlayer(ctx, feet, head, selfKitRef.current, now, false, false, selfPose, kickT != null ? { kickT } : undefined, false, true)
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
      const label = `Solve for ${g.problem.varName}: SPACE to play` + calcLabel
      drawTimer(ctx, left, total, warn ? `Hurry! ${Math.ceil(left)}s left` : label, warn ? '#ff3b5f' : '#7ec8ff', warn)
    }
  }, [project, runAt, ballAt])

  // ===== Loop =====
  useEffect(() => {
    let last = performance.now()
    const update = (now: number, dt: number) => {
      const g = gameRef.current
      const act = actionsRef.current
      if (g.phase === 'aim') updateRoam(g, now, dt)
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
        // CONTACT FRAME: the boot reaches the ball → launch the thump exactly here.
        if (!g.contacted && g.t >= WINDUP_S) {
          g.contacted = true
          if (soundRef.current) { sfx.current.ensure(); sfx.current.pass() }
        }
        // Ball-travel clock runs from contact, so resolution timing is unchanged
        // relative to the flight (only the fixed windup is added up front).
        const tf = g.t - WINDUP_S
        if (tf >= 0) {
          const clean = g.outcome === 'connected' && !g.badPass
          const end = clean
            ? (Number.isFinite(g.crossT) ? g.crossT + 0.25 : T_MAX)
            : g.interceptT + 0.45
          if (tf >= end) act.resolve()
        }
      }
      if (g.celebrate > 0) g.celebrate = Math.max(0, g.celebrate - dt)
      if (g.particles.length) {
        for (const pt of g.particles) { pt.x += pt.vx * dt; pt.y += pt.vy * dt; pt.vy += 760 * dt; pt.life -= dt; pt.rot += pt.vr * dt }
        g.particles = g.particles.filter((pt) => pt.life > 0)
      }
    }
    const loop = (now: number) => {
      const dt = Math.min(0.04, (now - last) / 1000); last = now
      update(now, dt)
      draw()
      const ph = gameRef.current.phase
      if (ph === 'fly') rerender()
      rafRef.current = requestAnimationFrame(loop)
    }
    rafRef.current = requestAnimationFrame(loop)
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current) }
  }, [draw, rerender])

  function toggleSound() { setSound((v) => { if (!v) sfx.current.ensure(); return !v }) }

  // ===== Side-panel data =====
  const g = gameRef.current
  const prob = g.problem
  const outcome = g.outcome
  // A WRONG numeric answer raises the animated worked-solution lesson (full-screen
  // over the stage). While it is up the lesson owns its own continue/skip buttons,
  // so the click-anywhere-to-continue capture must stand down (only the connected /
  // bad-pass / robbed results keep the click-to-continue flow).
  const showLesson = phase === 'result' && !!missMsg && !badPass && !robbed
  const canClickContinue = phase === 'result' && !showLesson

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
          className={`soccer__canvas soccer__canvas--${phase === 'aim' ? 'meter' : phase}`}
          onPointerMove={onPointerMove}
          onPointerDown={onPointerDown}
        />
        <button type="button" className="soccer__sound" onClick={toggleSound} aria-label="Toggle sound">{sound ? '🔊' : '🔈'}</button>

        {phase === 'result' && outcome === 'connected' && !badPass && (
          <div className="soccer__banner soccer__banner--goal">
            <strong>CONNECTED!</strong>
            <span>Threaded. Click anywhere to continue.</span>
          </div>
        )}

        {showLesson && (
          <PassLesson prob={g.problem} used={g.played} onDone={nextRun} />
        )}

        {phase === 'result' && badPass && (
          <div className="soccer__banner soccer__banner--miss">
            <strong>Bad pass</strong>
            <span>Through balls lead your teammate into space. Click anywhere to try again.</span>
          </div>
        )}

        {phase === 'result' && robbed && (
          <div className="soccer__banner soccer__banner--save">
            <strong>TOO SLOW ⛔</strong>
            <span>He checked his run. Dispossessed. Click anywhere to try again.</span>
          </div>
        )}

        {/* In-game calculator overlay during solve (same placement as the penalty). */}
        {phase === 'solve' && showCalc && <Calculator onClose={() => setShowCalc(false)} />}
      </div>

      <div className="soccer__side">
        {phase === 'solve' && (
          <>
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
        </>
      )}

        {phase === 'result' && outcome === 'connected' && !badPass && (
          <p className="soccer__tip">Threaded it: your diagonal pass reached the spot just as he ran onto it. <b>Streak {streak}</b> · best {best}.</p>
        )}

        <div className="sim__controls">
          <div className="soccer__buttons">
            {phase === 'aim' && <button type="button" className="btn btn--primary" onClick={placePass}>Play the pass ▸</button>}
            {phase === 'solve' && <button type="button" className="btn btn--primary" onClick={playPass} disabled={!answerStr}>Play the pass ⚽</button>}
            {phase === 'fly' && <button type="button" className="btn btn--primary" disabled>Pass in flight…</button>}
            {phase === 'result' && <button type="button" className="btn btn--primary" onClick={nextRun}>Next run →</button>}
            <button type="button" className="btn btn--ghost" onClick={nextRun}>↻ Restart</button>
          </div>
          </div>
      </div>
    </div>
  )
}

// ============================================================================
// Wrong-answer worked-solution LESSON (mirrors KinematicsSim's `Remediation`
// stepper, minus the "try for yourself" sandbox — the product decision is that
// ONLY the shooting drill keeps that). A missed numeric answer swaps the brief
// miss banner for this animated, multi-step walkthrough that rebuilds the run's
// motion-graph relation one digestible sub-step at a time (state the givens →
// write the formula → plug in → compute), ending on the EXACT graded answer
// (answerOf(prob)). Each step is a fill-the-blank multiple choice with a stable
// per-mount random correct slot; picking wrong reveals the worked value, picking
// right advances. When the student finishes (or skips) we hand control back to
// the existing click-to-continue flow via onDone → nextRun.
// ============================================================================
type Opt = { label: string; correct: boolean }
type LessonStep = {
  n: string
  cmp?: boolean
  prompt: string
  options: Opt[]
  gate: 'check' | 'correct'
  card: (blank: ReactNode) => ReactNode
  solution: ReactNode
}

function PassLesson({ prob, used, onDone }: { prob: Problem; used: number; onDone: () => void }) {
  const correct = answerOf(prob)
  const unit = prob.unit
  const { a, b, c } = prob.nums
  // Step count is fixed per kind (the 3-given relations decompose into 2 worked
  // steps; the single-division relations read each given then divide → 3 steps).
  const N = prob.kind === 'position' || prob.kind === 'time' ? 2 : 3

  const [stepIdx, setStepIdx] = useState(0)
  const [answered, setAnswered] = useState<boolean[]>(() => Array(N).fill(false))
  const [pick, setPick] = useState<number | null>(null)
  const [checked, setChecked] = useState(false)
  const [revealed, setRevealed] = useState(false)
  const [showLessonCalc, setShowLessonCalc] = useState(false)
  // Stable-per-mount random correct-option slot per step, so the right answer
  // isn't always in the same position (mirrors kinematics' `slots`).
  const slots = useMemo(() => Array.from({ length: N }, () => Math.floor(Math.random() * 3)), [N])
  useEffect(() => { setPick(null); setChecked(false); setRevealed(false) }, [stepIdx])

  // Count-up "time spent learning" bar. There is no sandbox here, so it simply
  // counts up (no auto-skip) — the student leaves via the continue/skip buttons.
  const LEARN_LIMIT = 120
  const [elapsed, setElapsed] = useState(0)
  useEffect(() => {
    const start = performance.now()
    const id = window.setInterval(() => setElapsed((performance.now() - start) / 1000), 100)
    return () => window.clearInterval(id)
  }, [])
  const barPct = Math.min(100, (elapsed / LEARN_LIMIT) * 100)

  const fmtMS = (x: number) => `${round1(x).toFixed(1)} m/s`
  const fmtM = (x: number) => `${round1(x).toFixed(1)} m`
  const fmtS = (x: number) => `${round1(x).toFixed(1)} s`
  const ans = (x: number) => `${round1(x).toFixed(1)} ${unit}`

  // Build 3 options from a correct value + distractors. Any distractor whose label
  // collides with the correct label (after rounding) is nudged to a clearly
  // different plausible value; `offset` rotates which slot holds the correct one.
  const mkOpts = (correctVal: number, distractorVals: number[], fmt: (x: number) => string, offset: number): Opt[] => {
    const correctLabel = fmt(correctVal)
    const seen = new Set<string>([correctLabel])
    const dist: string[] = []
    for (const dv of distractorVals) {
      let v = dv, label = fmt(v), guard = 0
      while (seen.has(label) && guard < 12) { v = v * 1.08 + 0.4; label = fmt(v); guard++ }
      seen.add(label); dist.push(label)
    }
    const opts: Opt[] = [{ label: correctLabel, correct: true }, ...dist.map((l) => ({ label: l, correct: false }))]
    const k = offset % opts.length
    return [...opts.slice(k), ...opts.slice(0, k)]
  }

  // ---- The worked steps, rebuilt for THIS problem kind, ending on the answer ----
  let steps: LessonStep[]
  if (prob.kind === 'velocity') {
    // v = Δx / Δt — read the rise, read the run, then take the slope.
    steps = [
      {
        n: '1', prompt: 'Read the rise off the graph: how far did it move (Δx)?',
        options: mkOpts(a, [b, a + b], fmtM, slots[0]), gate: 'check',
        card: (blank) => (<>
          <div className="soccer__step-formula">The slope of a position–time line is the velocity: v = Δx / Δt</div>
          <div className="soccer__step-plug">rise Δx = {blank}</div>
        </>),
        solution: <>The line climbs Δx = <b>{a} m</b> — that's the rise.</>,
      },
      {
        n: '2', prompt: 'Now the run: how long did that take (Δt)?',
        options: mkOpts(b, [a, Math.max(1, a - b)], fmtS, slots[1]), gate: 'check',
        card: (blank) => (<>
          <div className="soccer__step-formula">The run is the time across the bottom of the line: Δt</div>
          <div className="soccer__step-plug">run Δt = {blank}</div>
        </>),
        solution: <>It took Δt = <b>{b} s</b> — that's the run.</>,
      },
      {
        n: '★', cmp: true, prompt: 'Now produce the answer: what is the velocity v?',
        options: mkOpts(correct, [used, b / a], fmtMS, slots[2]), gate: 'correct',
        card: (blank) => (<>
          <div className="soccer__step-formula">Slope = velocity: v = Δx / Δt</div>
          <div className="soccer__step-plug">= {a} / {b} = {blank}</div>
        </>),
        solution: <>v = {a} / {b} = <b>{ans(correct)}</b>.</>,
      },
    ]
  } else if (prob.kind === 'position') {
    // x = x₀ + v · t — distance covered, then add the head start.
    const prod = b * c
    steps = [
      {
        n: '1', prompt: 'First, how far does it travel in that time (Δx = v · t)?',
        options: mkOpts(prod, [b + c, a + prod], fmtM, slots[0]), gate: 'check',
        card: (blank) => (<>
          <div className="soccer__step-formula">Distance covered at a constant velocity: Δx = v · t</div>
          <div className="soccer__step-plug">= {b} · {c} = {blank}</div>
        </>),
        solution: <>Δx = {b} · {c} = <b>{fmtM(prod)}</b>.</>,
      },
      {
        n: '★', cmp: true, prompt: 'Now produce the answer: what position x does it reach?',
        options: mkOpts(correct, [used, a + b + c], ans, slots[1]), gate: 'correct',
        card: (blank) => (<>
          <div className="soccer__step-formula">Add the head start: x = x₀ + v · t</div>
          <div className="soccer__step-plug">= {a} + {prod} = {blank}</div>
        </>),
        solution: <>x = {a} + {prod} = <b>{ans(correct)}</b>.</>,
      },
    ]
  } else if (prob.kind === 'time') {
    // t = (x − x₀) / v — displacement first, then divide by the velocity.
    const disp = a - b
    steps = [
      {
        n: '1', prompt: 'First, how far is it from the start (Δx = x − x₀)?',
        options: mkOpts(disp, [a + b, c], fmtM, slots[0]), gate: 'check',
        card: (blank) => (<>
          <div className="soccer__step-formula">Displacement still to cover: Δx = x − x₀</div>
          <div className="soccer__step-plug">= {a} − {b} = {blank}</div>
        </>),
        solution: <>Δx = {a} − {b} = <b>{fmtM(disp)}</b>.</>,
      },
      {
        n: '★', cmp: true, prompt: 'Now produce the answer: how long until it gets there (t)?',
        options: mkOpts(correct, [used, c > 0 ? a / c : 0], fmtS, slots[1]), gate: 'correct',
        card: (blank) => (<>
          <div className="soccer__step-formula">Time = displacement / velocity: t = Δx / v</div>
          <div className="soccer__step-plug">= {disp} / {c} = {blank}</div>
        </>),
        solution: <>t = {disp} / {c} = <b>{ans(correct)}</b>.</>,
      },
    ]
  } else {
    // passspeed: v_b = D / t — read the pass distance, the meet time, then divide.
    steps = [
      {
        n: '1', prompt: 'How far must the pass travel to reach the spot (D)?',
        options: mkOpts(a, [b, a + b], fmtM, slots[0]), gate: 'check',
        card: (blank) => (<>
          <div className="soccer__step-formula">Lead the runner: the ball must cover the pass distance D…</div>
          <div className="soccer__step-plug">D = {blank}</div>
        </>),
        solution: <>The pass covers D = <b>{a} m</b> to reach the spot.</>,
      },
      {
        n: '2', prompt: 'When does the runner arrive at that spot (t)?',
        options: mkOpts(b, [a, Math.max(1, a - b)], fmtS, slots[1]), gate: 'check',
        card: (blank) => (<>
          <div className="soccer__step-formula">…in the same time the runner takes to get there: t</div>
          <div className="soccer__step-plug">t = {blank}</div>
        </>),
        solution: <>He reaches the spot at t = <b>{b} s</b>.</>,
      },
      {
        n: '★', cmp: true, prompt: 'Now produce the answer: what pass speed v_b threads it?',
        options: mkOpts(correct, [used, b / a], fmtMS, slots[2]), gate: 'correct',
        card: (blank) => (<>
          <div className="soccer__step-formula">Pass speed = distance / time: v_b = D / t</div>
          <div className="soccer__step-plug">= {a} / {b} = {blank}</div>
        </>),
        solution: <>v_b = {a} / {b} = <b>{ans(correct)}</b>.</>,
      },
    ]
  }

  const cur = steps[stepIdx]
  const last = stepIdx === N - 1
  const stepDone = answered[stepIdx]
  const pickedOpt = pick === null ? null : cur.options[pick]
  const pickedCorrect = !!pickedOpt?.correct

  // "What went wrong" verdict about the player's ACTUAL wrong answer.
  const tooHigh = used > correct
  const verdict = `You played ${round1(used)} ${unit} — that's ${tooHigh ? 'too high' : 'too low'}. Working through ${prob.formula} gives ${round1(correct)} ${unit}.`

  // Pick a value for the blank (re-arms Check). Locked once the step is satisfied.
  const choose = (i: number) => {
    if (stepDone) return
    setPick(i); setChecked(false)
  }
  // Grade the picked value. Teaching steps proceed either way (a wrong check reveals
  // the worked value to learn from); the final answer gate only proceeds when correct.
  const checkAnswer = () => {
    if (pick === null || stepDone) return
    setChecked(true)
    if (pickedCorrect) {
      setAnswered((arr) => { const next = [...arr]; next[stepIdx] = true; return next })
    } else if (cur.gate === 'check') {
      setRevealed(true)
      setAnswered((arr) => { const next = [...arr]; next[stepIdx] = true; return next })
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
          <div className="soccer__lesson-emoji">😖</div>
          <div>
            <h2 className="soccer__lesson-title">Cut out!</h2>
            <p className="soccer__lesson-sub">{verdict}</p>
          </div>
        </div>

        <div className="soccer__lesson-chips">
          {prob.givens.map((gv, i) => (
            <div key={i} className="chip"><span>{gv.label}</span><strong>{gv.expr}</strong></div>
          ))}
          <div className="chip chip--lock"><span>find</span><strong>{prob.varName}</strong></div>
        </div>

        <div className="soccer__stepper">
          <div className="soccer__stepper-progress">
            <span>Step {stepIdx + 1} of {N}</span>
            <div className="soccer__stepper-dots">
              {steps.map((_, i) => <i key={i} className={i === stepIdx ? 'is-on' : i < stepIdx ? 'is-done' : ''} />)}
            </div>
          </div>
          {/* keyed so each reveal replays the swap animation. The blank is filled by
              picking a value below, then checking it. */}
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
          <div className={`soccer__learnbar${barPct >= 100 ? ' is-ending' : ''}`}>
            <span>⏱ Time spent learning</span>
            <div className="soccer__learnbar-track"><div className="soccer__learnbar-fill" style={{ width: `${barPct}%` }} /></div>
            <span className="soccer__learnbar-num">{elapsed.toFixed(0)}s</span>
          </div>
          <div className="soccer__lesson-actions">
            <button type="button" className="btn btn--ghost" onClick={() => setStepIdx((i) => Math.max(0, i - 1))} disabled={stepIdx === 0}>← Back</button>
            {!last ? (
              <button type="button" className="btn btn--primary soccer__try-btn" onClick={() => setStepIdx((i) => Math.min(N - 1, i + 1))} disabled={!stepDone}>{stepDone ? 'Next →' : 'Answer to continue'}</button>
            ) : (
              <>
                <button type="button" className="btn btn--ghost" onClick={onDone}>Skip explanation</button>
                <button type="button" className="btn btn--primary soccer__try-btn" onClick={onDone} disabled={!stepDone}>Play the next run →</button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ============================================================================
// Canvas drawing helpers (adapted from KinematicsSim's render kit)
// ============================================================================

// Full team kits: a coordinated jersey + shorts + socks with a collar, shirt
// number and sock bands, so the teammate (blue) and the defender (red) read as
// real kitted players.
const TEAM_KIT = {
  jersey: '#2f6df0', jerseyDark: '#1f4ec2', jerseyHi: '#6c9bff', collar: '#0d2f7a',
  shorts: '#13234d', shortsDark: '#0c1834', sock: '#2f6df0', sockBand: '#ffffff',
  boot: '#15171f', number: '#ffffff', num: 9, skin: '#e8b48a', skinShade: '#c98f64', hair: '#2c2016', hairStyle: 0,
}
// Opponent defender: a RED kit drawn with the SAME shared renderers as YOUR PLAYER
// (athletic build, clean jersey-sleeve arms, sock-coloured shins, white shorts). The
// shared lower body uses sock = the red jersey + boot/bootDark for the cleat; the head
// uses the same skin tone as YOUR PLAYER so he reads as the same kind of footballer.
const FOE_KIT = {
  jersey: '#ef4444', jerseyDark: '#b91c1c', jerseyHi: '#fca5a5', collar: '#7f1010',
  shorts: '#3a0d0d', shortsDark: '#250707', sock: '#ef4444', sockBand: '#ffe8e8',
  boot: '#1a1d24', bootDark: '#05060a', number: '#ffffff', num: 4, skin: '#caa074', skinShade: '#a67d53', hair: '#1a130c', hairStyle: 3,
}
// YOU — same blue side as the teammate, but a distinct number/hair/skin so the passer
// in the foreground reads as a separate player from the runner he is feeding.
// YOUR PLAYER's FIXED body identity. Per the loadout contract, ONLY the jersey design
// (jersey/jerseyDark/jerseyHi/number/accent/pattern) and boot (boot/bootDark) get
// overridden by usePlayerKit; everything below — white shorts, blue socks, collar,
// skin, hair — stays exactly as declared here so the back-view body reads correctly.
const SELF_KIT = {
  jersey: '#2f6df0', jerseyDark: '#1f4ec2', jerseyHi: '#6c9bff', collar: '#0d2f7a',
  shorts: '#f3f5fa', shortsDark: '#cfd6e4', sock: '#2f6df0', sockBand: '#ffffff',
  boot: '#15171f', bootDark: '#05060a', number: '#ffffff', num: 10, skin: '#caa074', skinShade: '#a67d53', hair: '#0f0a06', hairStyle: 1,
}
type Kit = typeof TEAM_KIT

function drawHair(ctx: CanvasRenderingContext2D, cx: number, headY: number, headR: number, style: number, color: string, back = false) {
  ctx.fillStyle = color
  if (back) {
    // Back of the head: a fuller cap covering most of the skull (no face shows). A
    // small style flourish keeps the silhouette varied per figure.
    ctx.beginPath(); ctx.arc(cx, headY, headR * 1.04, Math.PI * 0.8, Math.PI * 2.2); ctx.fill()
    ctx.beginPath(); ctx.ellipse(cx, headY + headR * 0.12, headR * 0.98, headR * 0.82, 0, 0, Math.PI * 2); ctx.fill()
    if (style === 2) { ctx.beginPath(); ctx.arc(cx, headY - headR * 1.0, headR * 0.4, 0, Math.PI * 2); ctx.fill() }
    else if (style === 3) {
      ctx.fillRect(cx - headR * 1.04, headY - headR * 0.2, headR * 0.3, headR * 1.2)
      ctx.fillRect(cx + headR * 0.74, headY - headR * 0.2, headR * 0.3, headR * 1.2)
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

// The translucent green "safe zone" drawn during AIM. It is the EXACT region a
// click is graded as a good through ball by judgePlacement: along the runner's
// heading within [LEAD_MIN, LEAD_MAX] ahead of him, and within ±CHANNEL_HALF of
// his run line. We reuse those same constants here so the highlight is precisely
// what gets accepted — no drift between the visual and the grader.
//
// Anchoring: judgePlacement maps a world point to (along, across) via the runner's
// heading h = (sin θ, cos θ):
//   along  = dx·hx + dz·hz ,  across = dx·hz − dz·hx   (dx,dz = spot − runner).
// That 2×2 matrix is its own inverse, so a zone point at (along a, across c) sits
// at the LIVE runner position:
//   gx = rx + a·hx + c·hz ,  gz = rz + a·hz − c·hx .
// We rebuild it every frame from the runner's live roam (rx, rz, heading), then
// project each corner through the SAME ground projection used for the run/space,
// so it slides + rotates with him and scales correctly with depth.
function drawSafeZone(
  ctx: CanvasRenderingContext2D,
  project: (x: number, y: number, z: number) => P2,
  rx: number, rz: number, heading: number, now: number,
) {
  const hx = Math.sin(heading), hz = Math.cos(heading)
  // Inverse of judgePlacement: (along a, across c) → world ground point.
  const pt = (a: number, c: number): P2 => project(rx + a * hx + c * hz, 0.02, rz + a * hz - c * hx)
  const pulse = 0.5 + 0.5 * Math.sin(now / 430)      // 0..1 soft breathing
  const amp = 0.82 + 0.18 * pulse
  // Four corners of the accepted rectangle in (along, across) space. Perspective
  // maps straight world lines to straight screen lines, so corners suffice.
  const nL = pt(LEAD_MIN, -CHANNEL_HALF), nR = pt(LEAD_MIN, CHANNEL_HALF)
  const fR = pt(LEAD_MAX, CHANNEL_HALF), fL = pt(LEAD_MAX, -CHANNEL_HALF)
  const quad = () => {
    ctx.beginPath()
    ctx.moveTo(nL.sx, nL.sy); ctx.lineTo(nR.sx, nR.sy)
    ctx.lineTo(fR.sx, fR.sy); ctx.lineTo(fL.sx, fL.sy); ctx.closePath()
  }
  ctx.save()
  ctx.lineJoin = 'round'
  // Depth-graded translucent green fill: brighter near him, softer into distance.
  const nearMid = pt(LEAD_MIN, 0), farMid = pt(LEAD_MAX, 0)
  const grad = ctx.createLinearGradient(nearMid.sx, nearMid.sy, farMid.sx, farMid.sy)
  grad.addColorStop(0, `rgba(46,224,127,${0.30 * amp})`)
  grad.addColorStop(1, `rgba(46,224,127,${0.12 * amp})`)
  ctx.fillStyle = grad; quad(); ctx.fill()
  // Soft outer glow edge, then a crisp inner outline so it reads but doesn't hide
  // the player or reticle that draw on top of it.
  ctx.strokeStyle = `rgba(90,255,170,${0.16 + 0.12 * pulse})`; ctx.lineWidth = 9; quad(); ctx.stroke()
  ctx.strokeStyle = `rgba(190,255,215,${0.55 + 0.25 * pulse})`; ctx.lineWidth = 2.4; quad(); ctx.stroke()
  // Quiet hint label sitting flat in the channel.
  const lbl = pt((LEAD_MIN + LEAD_MAX) / 2, 0)
  ctx.fillStyle = `rgba(225,255,238,${0.55 + 0.2 * pulse})`
  ctx.font = '700 12px Plus Jakarta Sans, sans-serif'; ctx.textAlign = 'center'
  ctx.fillText('lead him in here', lbl.sx, lbl.sy)
  ctx.textAlign = 'left'
  ctx.restore()
}

// The pulsing aim reticle that follows the pointer over the pitch during aim —
// mirrors the penalty game's aim selector (yellow crosshair) and tints green when
// the spot would be a good through ball into space.
function drawReticle(ctx: CanvasRenderingContext2D, at: P2, now: number, good: boolean) {
  const pulse = 1 + Math.sin(now / 220) * 0.14
  const r = 16 * pulse
  const col = good ? '#3ef08a' : '#ffe14d'
  ctx.save()
  ctx.strokeStyle = col; ctx.lineWidth = 2.5
  ctx.beginPath(); ctx.arc(at.sx, at.sy, r, 0, Math.PI * 2); ctx.stroke()
  ctx.beginPath()
  ctx.moveTo(at.sx - r - 7, at.sy); ctx.lineTo(at.sx - 7, at.sy)
  ctx.moveTo(at.sx + 7, at.sy); ctx.lineTo(at.sx + r + 7, at.sy)
  ctx.moveTo(at.sx, at.sy - r - 7); ctx.lineTo(at.sx, at.sy - 7)
  ctx.moveTo(at.sx, at.sy + 7); ctx.lineTo(at.sx, at.sy + r + 7)
  ctx.stroke()
  ctx.fillStyle = good ? 'rgba(62,240,138,0.3)' : 'rgba(255,225,77,0.25)'
  ctx.beginPath(); ctx.arc(at.sx, at.sy, 5, 0, Math.PI * 2); ctx.fill()
  ctx.restore()
}

// The placed-pass target on the ground — a pulsing ring at the chosen spot. Green
// for a good through ball, red for an objectively bad one the defender will read.
function drawSpotRing(ctx: CanvasRenderingContext2D, ctr: P2, now: number, bad: boolean) {
  const pulse = 1 + Math.sin(now / 240) * 0.12
  const rad = Math.max(10, 0.7 * ctr.scale) * pulse
  const col = bad ? '255,91,110' : '54,224,127'
  const glowR = rad * 2.2
  const glow = ctx.createRadialGradient(ctr.sx, ctr.sy, rad * 0.3, ctr.sx, ctr.sy, glowR)
  glow.addColorStop(0, `rgba(${col},0.42)`); glow.addColorStop(0.55, `rgba(${col},0.16)`); glow.addColorStop(1, `rgba(${col},0)`)
  ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(ctr.sx, ctr.sy, glowR, 0, Math.PI * 2); ctx.fill()
  ctx.fillStyle = `rgba(${col},0.16)`; ctx.beginPath(); ctx.arc(ctr.sx, ctr.sy, rad, 0, Math.PI * 2); ctx.fill()
  ctx.strokeStyle = `rgba(${col},0.95)`; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(ctr.sx, ctr.sy, rad, 0, Math.PI * 2); ctx.stroke()
  ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(ctr.sx, ctr.sy, 3, 0, Math.PI * 2); ctx.fill()
  ctx.fillStyle = bad ? '#ffd7df' : '#eafff2'
  ctx.font = '800 13px Plus Jakarta Sans, sans-serif'; ctx.textAlign = 'center'
  ctx.fillText(bad ? 'poor ball' : 'the space', ctr.sx, ctr.sy - rad - 8)
  ctx.textAlign = 'left'
}

// Draws a kitted player given his already-projected feet + head points. `pose`
// optionally raises both arms ('cheer') for a celebration reaction. `act` optionally
// drives a special lower body for ONE figure at a time: a struck-pass swing (`kickT`)
// for your passer, or a steal lunge (`reach`/`reachDir`) for the defender/teammate.
// With no `act` the legs use the ordinary running/idle stride, so the unchanged
// callers (marking, roaming, solving) look exactly as before.
type PlayerAct = { kickT?: number; reach?: number; reachDir?: number }
// Render YOUR PLAYER's equipped jersey design in the accent colour. The caller has
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

function drawPlayer(ctx: CanvasRenderingContext2D, feet: P2, head: P2, kit: Kit, now: number, running: boolean, hasBall: boolean, pose: 'normal' | 'cheer' = 'normal', act?: PlayerAct, faceCamera = false, isSelf = false, isFoe = false) {
  // The opponent defender shares YOUR PLAYER's standardised renderers (canonical
  // athletic build + drawPlayerLegs/Shorts/Arms) so he reads as the same kind of
  // footballer in a RED kit, just front-facing. `shared` gates that body path; the
  // loadout artwork (jersey pattern) stays YOUR-PLAYER-only via `isSelf`.
  const shared = isSelf || isFoe
  const scale = feet.scale
  if (scale < 4) return
  const ph = now / 80
  const bob = running ? Math.abs(Math.sin(ph)) * 0.055 * scale : 0
  const cx = feet.sx
  const footY = feet.sy - bob
  const wBody = Math.max(5, 0.4 * scale)
  const lw = Math.max(3, 0.15 * scale)

  ctx.fillStyle = 'rgba(0,0,0,0.26)'
  ctx.beginPath(); ctx.ellipse(cx, feet.sy + 1, wBody * 0.95, wBody * 0.32, 0, 0, Math.PI * 2); ctx.fill()

  ctx.lineCap = 'round'
  // ---- lower body: a struck-pass swing, a steal lunge, or the ordinary stride ----
  // leanX shifts the upper body/hips (a weight shift) while the support foot stays
  // planted; dip lowers the body a touch (knee bend) for plant/lunge weight.
  let leanX = 0, dip = 0
  let footLx: number, footLy: number, footRx: number, footRy: number
  const kt = act?.kickT
  if (kt != null) {
    let ke: number, ll: number   // kicking-foot through-swing (back→through) & up-lift
    if (kt < PLANT_S) {                          // plant + backswing (anticipation)
      const u = kt / PLANT_S
      ke = -0.45 * easeOut(u); ll = 0.10 * u
      dip = 0.05 * scale * u; leanX = -0.12 * wBody * u
    } else if (kt < WINDUP_S) {                  // downswing — accelerate INTO contact
      const u = (kt - PLANT_S) / (WINDUP_S - PLANT_S)
      const e = u * u
      ke = lerp(-0.45, 1, e); ll = lerp(0.10, 0.62, e)
      dip = 0.05 * scale * (1 - u); leanX = lerp(-0.12 * wBody, 0.46 * wBody, e)
    } else if (kt < WINDUP_S + FOLLOW_S) {       // follow-through — decelerate
      const u = (kt - WINDUP_S) / FOLLOW_S
      const e = easeOut(u)
      ke = lerp(1, 0.18, e); ll = lerp(0.62, 0.08, e)
      leanX = lerp(0.46 * wBody, 0.05 * wBody, e)
    } else {                                     // settle to a watchful stand
      const u = clamp((kt - (WINDUP_S + FOLLOW_S)) / 0.25, 0, 1)
      ke = lerp(0.18, 0, u); ll = lerp(0.08, 0, u); leanX = lerp(0.05 * wBody, 0, u)
    }
    footLx = cx - wBody * 0.4; footLy = footY                       // support foot planted
    footRx = (cx + leanX) + wBody * 0.22 + ke * wBody * 1.4         // kicking foot drives at the ball
    footRy = footY - Math.max(0, ll) * scale * 0.5
  } else if (act?.reach) {
    const rdir = act.reachDir ?? 1
    const e = easeOut(act.reach)
    leanX = rdir * 0.34 * wBody * e
    dip = 0.05 * scale * e
    footLx = cx - rdir * wBody * 0.34; footLy = footY              // trailing foot
    footRx = (cx + leanX) + rdir * (wBody * 0.5 + e * wBody * 1.05) // poking foot reaches in
    footRy = footY - e * 0.05 * scale
  } else {
    const swing = running ? Math.sin(ph) * 0.28 * scale : wBody * 0.4
    const lift = running ? Math.max(0, Math.cos(ph)) * 0.15 * scale : 0
    footLx = cx - swing; footLy = footY - lift
    footRx = cx + swing; footRy = footY
  }
  const bx = cx + leanX
  const headY = head.sy - bob + dip
  // YOUR PLAYER + the opponent defender (shared) use the SHARED canonical athletic build
  // (src/lib/playerCanvas): the figure spans its top-of-head anchor (headY) → feet (footY),
  // and head/torso/leg ratios come straight from bodyMetrics so they match every other drill
  // + the card. The teammate keeps its bespoke fraction-based proportions.
  const m = shared ? bodyMetrics(headY, footY) : null
  const headR = m ? m.headR : Math.max(3.5, 0.17 * scale)
  const hipY = m ? m.hipY : headY + (footY - headY) * 0.52
  const shoulderY = m ? m.shoulderY : headY + (footY - headY) * 0.3
  const torsoH = hipY - shoulderY + 2
  const legSpan = footY - headY
  // Head sits JUST above the shoulders on a short neck stub (rather than floating at
  // the tall head.sy anchor): head centre is one radius + a tiny neck above shoulderY.
  const neckH = m ? m.neckH : headR * 0.22
  const headCY = m ? m.headCY : shoulderY - neckH - headR

  // ---- LEGS: two-bone (thigh skin → shin sock) with a slight knee bow + taper.
  // Hips fan out a touch; each foot anchor (footLx/y, footRx/y) is preserved EXACTLY.
  const legW = m ? m.legW : lw
  const bodyDetail = scale > 14
  // YOUR PLAYER's hips sit a touch wider so the two legs read as clearly separate
  // limbs from behind (a visible inseam gap); the teammate keeps the tighter base.
  const hipSpread = isSelf ? 0.25 : 0.16
  const hipLx = bx - wBody * hipSpread, hipRx = bx + wBody * hipSpread
  const drawLeg = (footX: number, footYp: number, hipX: number) => {
    const mx = (hipX + footX) / 2, my = (hipY + footYp) / 2
    const dx = footX - hipX, dy = footYp - hipY, len = Math.hypot(dx, dy) || 1
    const nx = -dy / len, ny = dx / len
    const bow = legW * 0.3                                                  // SLIGHT knee bend only
    const side = Math.sign(footX - hipX) || 1
    let kx = mx + nx * bow, ky = my + ny * bow
    if ((kx - mx) * side < 0) { kx = mx - nx * bow; ky = my - ny * bow }   // knee bows forward
    ctx.strokeStyle = kit.skin; ctx.lineWidth = legW * 1.1                  // thigh (skin), modest taper
    ctx.beginPath(); ctx.moveTo(hipX, hipY); ctx.lineTo(kx, ky); ctx.stroke()
    ctx.strokeStyle = kit.sock; ctx.lineWidth = legW * 0.92                 // shin (sock) ≈ thigh
    ctx.beginPath(); ctx.moveTo(kx, ky); ctx.lineTo(footX, footYp); ctx.stroke()
    ctx.strokeStyle = kit.sockBand; ctx.lineWidth = legW * 0.9
    ctx.beginPath(); ctx.moveTo(lerp(kx, footX, 0.12), lerp(ky, footYp, 0.12)); ctx.lineTo(lerp(kx, footX, 0.26), lerp(ky, footYp, 0.26)); ctx.stroke()
  }

  // ---- BOOTS: darker, elongated, tilted toward the toe; centred on the foot anchor.
  const bootDark = (kit as any).bootDark ?? kit.boot
  const drawBoot = (fx: number, fy: number) => {
    const tilt = clamp((fx - bx) / (wBody * 0.9), -1, 1) * 0.4
    ctx.save(); ctx.translate(fx, fy); ctx.rotate(tilt)
    ctx.fillStyle = kit.boot
    ctx.beginPath(); ctx.ellipse(0, 0, legW * 1.25, legW * 0.5, 0, 0, Math.PI * 2); ctx.fill()
    ctx.fillStyle = isSelf ? bootDark : kit.boot
    ctx.beginPath(); ctx.ellipse((Math.sign(tilt) || 1) * legW * 0.9, legW * 0.06, legW * 0.55, legW * 0.4, 0, 0, Math.PI * 2); ctx.fill()   // toe
    if (isSelf) {                                                                                   // dark sole line under the boot
      ctx.fillStyle = bootDark
      ctx.beginPath(); ctx.ellipse(0, legW * 0.34, legW * 1.18, legW * 0.16, 0, 0, Math.PI * 2); ctx.fill()
    }
    ctx.fillStyle = 'rgba(255,255,255,0.10)'
    ctx.beginPath(); ctx.ellipse(-legW * 0.3, -legW * 0.2, legW * 0.5, legW * 0.16, 0, 0, Math.PI * 2); ctx.fill()   // sheen
    ctx.restore()
  }

  // YOUR PLAYER (the foreground passer) uses the shared standardised lower-body renderer
  // (src/lib/playerCanvas) so the legs + white shorts look identical across every drill.
  // Pass the body centre as the hip CENTRE (the helper spreads the hips itself) and the
  // existing animated foot anchors, so the running gait + pass/kick timing are unchanged.
  // sock = jersey colour; boot/bootDark = the equipped cleats. The opponent defender reuses
  // this SAME pose object (red sock/jersey). The teammate keeps its bespoke legs + boots
  // (and shorts) below, byte-for-byte.
  const selfPose = {
    hipX: bx, hipY,
    lFootX: footLx, lFootY: footLy, rFootX: footRx, rFootY: footRy,
    legW, sock: kit.sock, boot: kit.boot, bootDark, detail: bodyDetail,
  }
  if (shared) {
    drawPlayerLegs(ctx, selfPose)
  } else {
    drawLeg(footLx, footLy, hipLx)
    drawLeg(footRx, footRy, hipRx)
    drawBoot(footLx, footLy)
    drawBoot(footRx, footRy)
  }

  // Contact flash at the boot exactly as the swing meets the ball — sells the strike.
  if (kt != null && Math.abs(kt - WINDUP_S) < 0.06) {
    const f = 1 - Math.abs(kt - WINDUP_S) / 0.06
    const r0 = legW * (1.3 + f * 1.8)
    const fg = ctx.createRadialGradient(footRx, footRy, 0, footRx, footRy, r0)
    fg.addColorStop(0, `rgba(255,250,225,${0.85 * f})`); fg.addColorStop(1, 'rgba(255,250,225,0)')
    ctx.fillStyle = fg; ctx.beginPath(); ctx.arc(footRx, footRy, r0, 0, Math.PI * 2); ctx.fill()
  }

  // ---- SHORTS (teammate / defender only) ----
  // YOUR PLAYER's white shorts are the shared standardised shorts, drawn AFTER the
  // torso via drawPlayerShorts(ctx, pose) further below.
  if (!shared) {
    // Teammate (only): unchanged waistband + two short thigh covers.
    const sw = wBody * 1.04
    const sR = Math.max(2, wBody * 0.16)
    const shortLen = Math.max(6, legSpan * 0.2)   // how far down the thigh the short reaches
    const shortW = legW * 1.85                     // flared wider than the bare thigh
    const drawShort = (footX: number, footYp: number, hipX: number, color: string) => {
      const dx = footX - hipX, dy = footYp - hipY, len = Math.hypot(dx, dy) || 1
      const ex = hipX + (dx / len) * shortLen, ey = hipY + (dy / len) * shortLen
      ctx.strokeStyle = color; ctx.lineWidth = shortW
      ctx.beginPath(); ctx.moveTo(hipX, hipY); ctx.lineTo(ex, ey); ctx.stroke()
    }
    drawShort(footLx, footLy, hipLx, kit.shorts)
    drawShort(footRx, footRy, hipRx, kit.shortsDark)                                     // shade the far leg
    ctx.fillStyle = kit.shorts                                                            // waistband bridges the hips
    roundRect(ctx, bx - sw / 2, hipY - legSpan * 0.07, sw, Math.max(5, legSpan * 0.14), sR); ctx.fill()
  }

  // ---- TORSO: shoulders wider than the waist (slight taper), rounded shoulders, a
  // centre shade stripe and an edge highlight. Same shoulderY/hipY anchors.
  const shW = m ? m.shoulderW : wBody * 1.08, waW = m ? m.waistW : wBody * 0.84
  const torsoBot = shoulderY + torsoH
  const shR = Math.max(2, wBody * 0.22)
  const torsoPath = () => {
    ctx.beginPath()
    ctx.moveTo(bx - shW / 2, shoulderY + shR)
    ctx.quadraticCurveTo(bx - shW / 2, shoulderY, bx - shW / 2 + shR, shoulderY)
    ctx.lineTo(bx + shW / 2 - shR, shoulderY)
    ctx.quadraticCurveTo(bx + shW / 2, shoulderY, bx + shW / 2, shoulderY + shR)
    ctx.lineTo(bx + waW / 2, torsoBot)
    ctx.lineTo(bx - waW / 2, torsoBot)
    ctx.closePath()
  }
  ctx.fillStyle = kit.jersey; torsoPath(); ctx.fill()
  ctx.save(); torsoPath(); ctx.clip()
  ctx.fillStyle = kit.jerseyDark; ctx.fillRect(bx + wBody * 0.12, shoulderY + 2, wBody * 0.34, torsoH)
  ctx.fillStyle = kit.jerseyHi; ctx.fillRect(bx - wBody * 0.42, shoulderY + torsoH * 0.12, wBody * 0.13, torsoH * 0.62)
  // YOUR PLAYER's loadout artwork: draw the equipped jersey design in the accent
  // colour, clipped to the torso, over the base shading (number is added on top below).
  if (isSelf) {
    const pattern = ((kit as any).pattern ?? 'plain') as JerseyPattern
    const accent = (kit as any).accent ?? kit.jerseyDark
    drawJerseyPattern(ctx, pattern, accent, bx - shW / 2, shoulderY, shW, torsoH)
  }
  ctx.restore()

  if (wBody > 9) {
    ctx.fillStyle = kit.number
    ctx.font = `800 ${Math.round(wBody * 0.5)}px Plus Jakarta Sans, sans-serif`
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
    ctx.fillText(String(kit.num), bx, shoulderY + torsoH * 0.52)
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic'
  }

  // YOUR PLAYER's shared standardised WHITE shorts, drawn AFTER the torso/jersey/number
  // (same pose object as the legs above).
  if (shared) {
    drawPlayerShorts(ctx, selfPose)
  }

  // ---- NECK: a SHORT skin stub roughly as wide as the head, seating the head just
  // above the shoulders (visible height ≈ 0.22·headR). Drawn under the collar + head.
  const neckW = headR * 1.3
  const neckTop = headCY + headR * 0.7
  if (shoulderY + 2 > neckTop) {
    ctx.fillStyle = kit.skin
    ctx.fillRect(bx - neckW / 2, neckTop, neckW, shoulderY + 2 - neckTop)
    ctx.fillStyle = kit.skinShade
    ctx.fillRect(bx + neckW * 0.06, neckTop, neckW * 0.4, shoulderY + 2 - neckTop)
  }

  ctx.fillStyle = kit.collar; ctx.fillRect(bx - wBody * 0.2, shoulderY, wBody * 0.4, Math.max(1.5, torsoH * 0.1))

  // ---- ARMS: upper arm (sleeve) → forearm (skin) with a slight elbow bow + taper,
  // and a small skin hand at the end. The shoulder start and hand end match the
  // previous single-line arms EXACTLY, so the swing/cheer/idle posing is unchanged.
  const armW = m ? m.armW : Math.max(2, 0.1 * scale)
  const armSwing = running ? Math.sin(ph + Math.PI) * 0.18 * scale : 0
  const drawArm = (sx: number, sy: number, hx: number, hy: number, sideSign: number) => {
    const mx = (sx + hx) / 2, my = (sy + hy) / 2
    const dx = hx - sx, dy = hy - sy, len = Math.hypot(dx, dy) || 1
    const nx = -dy / len, ny = dx / len
    const bow = armW * 0.5                                                       // SLIGHT elbow bend only
    let ex = mx + nx * bow, ey = my + ny * bow
    if ((ex - bx) * sideSign < 0) { ex = mx - nx * bow; ey = my - ny * bow }   // elbow bows outward
    ctx.strokeStyle = kit.jerseyDark; ctx.lineWidth = armW * 1.3                 // upper arm (sleeve), modest taper
    ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(ex, ey); ctx.stroke()
    ctx.strokeStyle = kit.skin; ctx.lineWidth = armW * 1.05                      // forearm (skin) ≈ upper arm
    ctx.beginPath(); ctx.moveTo(ex, ey); ctx.lineTo(hx, hy); ctx.stroke()
    ctx.fillStyle = kit.skin; ctx.beginPath(); ctx.arc(hx, hy, armW * 0.85, 0, Math.PI * 2); ctx.fill()   // hand
  }
  if (shared) {
    // YOUR PLAYER and the opponent defender use the SHARED standardised arm renderer
    // (src/lib/playerCanvas) so the jersey sleeve + skin forearm match the card model and
    // every other drill. Start from the canonical idle hand placement, then ADD the existing
    // run/pass/cheer/lunge offsets so each figure's animation is unchanged. Drawn AFTER torso.
    const hands = idleHands(bx, m!)
    if (pose === 'cheer') {                              // both arms thrown up in celebration
      const upY = shoulderY - wBody * 0.78
      const reach = wBody * 0.5
      hands.lHandX = bx - reach; hands.lHandY = upY
      hands.rHandX = bx + reach; hands.rHandY = upY
    } else if (kt != null) {                            // counter-balance swing during the pass
      const handY = shoulderY + wBody * 0.7
      const lead = clamp(leanX / (0.46 * wBody), -1, 1)
      hands.lHandX = bx - wBody * (0.6 + lead * 0.5); hands.lHandY = handY
      hands.rHandX = bx + wBody * (0.55 - lead * 0.35); hands.rHandY = handY - wBody * lead * 0.3
    } else if (act?.reach) {                            // defender's steal lunge — lead arm reaches in
      const rdir = act.reachDir ?? 1
      const e = easeOut(act.reach)
      const handY = shoulderY + wBody * 0.7
      hands.lHandX = bx + rdir * wBody * (0.2 + e * 0.95); hands.lHandY = handY - e * wBody * 0.18
      hands.rHandX = bx - rdir * wBody * 0.5; hands.rHandY = handY + e * wBody * 0.1
    } else if (running) {                               // running arm swing
      hands.lHandX -= armSwing
      hands.rHandX += armSwing
    }
    drawPlayerArms(ctx, {
      cx: bx, shoulderY: m!.shoulderY, shoulderW: m!.shoulderW, armW: m!.armW,
      ...hands, sleeve: kit.jersey, sleeveDark: kit.jerseyDark,
    })
  } else if (pose === 'cheer') {
    // Both arms thrown up in celebration.
    const upY = shoulderY - wBody * 0.78
    const reach = wBody * 0.5
    drawArm(bx - wBody * 0.5, shoulderY + 2, bx - reach, upY, -1)
    drawArm(bx + wBody * 0.5, shoulderY + 2, bx + reach, upY, 1)
  } else if (kt != null) {
    // Counter-balance: the leading arm swings opposite the kicking leg for momentum.
    const handY = shoulderY + wBody * 0.7
    const lead = clamp(leanX / (0.46 * wBody), -1, 1)
    drawArm(bx - wBody * 0.5, shoulderY + 2, bx - wBody * (0.6 + lead * 0.5), handY, -1)
    drawArm(bx + wBody * 0.5, shoulderY + 2, bx + wBody * (0.55 - lead * 0.35), handY - wBody * lead * 0.3, 1)
  } else {
    const handY = shoulderY + wBody * 0.85
    const handReach = wBody * 0.62
    drawArm(bx - wBody * 0.5, shoulderY + 2, bx - handReach - armSwing, handY, -1)
    drawArm(bx + wBody * 0.5, shoulderY + 2, bx + handReach + armSwing, handY, 1)
  }

  // Safety net only: the ball at feet is normally drawn by the single ball renderer,
  // so callers pass hasBall=false. Kept so the param stays meaningful and no figure
  // can ever silently lose the won ball.
  if (hasBall) {
    const br = Math.max(4, BALL_R * scale)
    const bbx = bx + wBody * 0.5
    const by = feet.sy
    ctx.fillStyle = 'rgba(0,0,0,0.3)'
    ctx.beginPath(); ctx.ellipse(bbx, by + 2, br * 1.2, br * 0.45, 0, 0, Math.PI * 2); ctx.fill()
    drawBall(ctx, bbx, by - br * 0.7, br, now / 320, 0)
  }

  // ---- HEAD: round head + small skin ears + hair. Big enough → cheek/jaw shade and,
  // for camera-facing figures, a brow/eye line. Figures facing AWAY show the back of
  // the head (full hair, no face) so YOU/the runner read as turned downfield.
  const detail = scale > 24
  if (detail) {
    ctx.fillStyle = kit.skin
    ctx.beginPath(); ctx.ellipse(bx - headR * 0.95, headCY + headR * 0.05, headR * 0.34, headR * 0.42, 0, 0, Math.PI * 2); ctx.fill()
    ctx.fillStyle = kit.skinShade
    ctx.beginPath(); ctx.ellipse(bx + headR * 0.95, headCY + headR * 0.05, headR * 0.34, headR * 0.42, 0, 0, Math.PI * 2); ctx.fill()
  }
  ctx.fillStyle = kit.skin; ctx.beginPath(); ctx.arc(bx, headCY, headR, 0, Math.PI * 2); ctx.fill()
  if (detail) {
    ctx.fillStyle = kit.skinShade
    ctx.beginPath(); ctx.arc(bx, headCY, headR, -Math.PI * 0.42, Math.PI * 0.42); ctx.fill()   // shade on the right cheek/jaw
  }
  drawHair(ctx, bx, headCY, headR, kit.hairStyle, kit.hair, !faceCamera)
  if (detail && faceCamera) {
    const eyeY = headCY - headR * 0.04
    const eyeDx = headR * 0.38
    const eyeR = Math.max(1, headR * 0.15)
    ctx.fillStyle = '#241a14'
    ctx.beginPath(); ctx.arc(bx - eyeDx, eyeY, eyeR, 0, Math.PI * 2); ctx.fill()
    ctx.beginPath(); ctx.arc(bx + eyeDx, eyeY, eyeR, 0, Math.PI * 2); ctx.fill()
    ctx.strokeStyle = 'rgba(20,12,8,0.55)'; ctx.lineWidth = Math.max(1, headR * 0.1)
    ctx.beginPath(); ctx.moveTo(bx - eyeDx - eyeR, eyeY - eyeR * 1.6); ctx.lineTo(bx - eyeDx + eyeR, eyeY - eyeR * 1.8); ctx.stroke()
    ctx.beginPath(); ctx.moveTo(bx + eyeDx - eyeR, eyeY - eyeR * 1.8); ctx.lineTo(bx + eyeDx + eyeR, eyeY - eyeR * 1.6); ctx.stroke()
  }
  ctx.lineCap = 'butt'
}

// A brief contact puff — an expanding fading ring + a few specks — drawn at the spot
// where the boot meets the ball (launch, deflection or cushion) so the hit reads.
function drawPuff(ctx: CanvasRenderingContext2D, at: P2, u: number, rgb: string) {
  if (u < 0 || u > 1) return
  const r = Math.max(6, 0.5 * at.scale) * (0.4 + u * 1.3)
  const a = (1 - u) * 0.8
  ctx.save()
  ctx.strokeStyle = `rgba(${rgb},${a})`; ctx.lineWidth = 2 + (1 - u) * 2
  ctx.beginPath(); ctx.arc(at.sx, at.sy, r, 0, Math.PI * 2); ctx.stroke()
  ctx.fillStyle = `rgba(${rgb},${a})`
  for (let i = 0; i < 5; i++) {
    const ang = (Math.PI * 2 * i) / 5 + u * 2
    const rr = r * (0.7 + 0.3 * ((i % 2) ? 1 : 0.6))
    ctx.beginPath(); ctx.arc(at.sx + Math.cos(ang) * rr, at.sy + Math.sin(ang) * rr * 0.6, Math.max(1, 1.6 * (1 - u)), 0, Math.PI * 2); ctx.fill()
  }
  ctx.restore()
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
    ctx.fillText('PASS WINDOW CLOSING', W / 2, 24)
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
