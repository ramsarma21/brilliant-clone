import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { SimProps } from './types'
import { Calculator } from './Calculator'

// ============================================================================
// Motion-Graphs unit — soccer skill = PASSING (the through-ball).
//
// This is the penalty game's sibling, rendered in the SAME first-person pseudo-3D
// world (shared camera/projection + render style as KinematicsSim). Where the
// penalty is a projectile-into-a-ring problem, this is a CONSTANT-VELOCITY,
// lead-the-runner problem — the heart of Motion Graphs (slope = velocity,
// x = x₀ + v·t).
//
// It mirrors the penalty's full structure: a difficulty-scaled solve countdown,
// an in-game Calculator (with a 1.25× time drain while open), difficulty-scaled
// progressive hints, a DEFENDER who sprints in to intercept a mis-weighted pass
// (the keeper-save analogue), and an animated post-miss teaching lesson followed
// by a "try for yourself" sandbox — all swapped to the passing/graph content.
//
// Madden-meter solve structure (identical to the penalty):
//   • The meter LOCKS one variable, alternating each run:
//       – 'speed' run: meter locks the RELEASE TIMING t_d; you solve PASS SPEED v_b.
//       – 'time'  run: meter locks the PASS SPEED v_b;     you solve RELEASE TIMING t_d.
//   • The OTHER variable has EXACTLY ONE answer: the ball must reach the centre of
//     the space (X*) at the instant the runner arrives there (t_meet).
//
// Everything is deterministic — a correctly weighted pass always threads through.
// ============================================================================

// ---- Camera / canvas (identical feel to KinematicsSim) ----
const W = 900
const H = 560
const HORIZON = H * 0.4
const EYE_Y = 1.6
const FOCAL = 560

// ---- World (metres) ----
const RELEASE = { y: 0.12, z: 0.8 } // ground ball resting at your feet
const BALL_R = 0.13
const ZONE_HALF = 1.7 // half-width of the catchable space, in metres ALONG the channel
const LANE_HALF = 1.25 // half-width of the drawn passing channel
const POS_MAX = 40 // metres of channel shown on the graph
const T_MAX = 7 // seconds shown on the graph

// ---- UNIFIED RISK/REWARD AXIS ----
// `diff` (0 = easy … 1 = hard) comes from where the player LOCKS the meter and
// drives EVERYTHING, so a safe lock and an ambitious lock feel genuinely different:
//   • TIME       — easy locks get the most solve time, hard locks the least.
//   • STRICTNESS — easy → full plugged-in scaffold; hard → recall nudge only,
//                  and the calculator's time bleed bites harder.
//   • INTERCEPTION — easy/safe passes are predictable and easy to cut out (HIGH
//                  prob); ambitious/hard passes get through far more often (LOW).
// Net: a safe pass = lots of time + help but likely cut out; a hard pass = little
// time + no help but a much higher success rate. That's the gamble.
const SOLVE_MS_EASY = 40000   // diff = 0 (safest lock): a generous 40 s
const SOLVE_MS_MIN = 18000    // diff = 1 (hardest lock): a tight 18 s
const SOLVE_WARN_MS = 10000   // last 10 s get an urgent red countdown
const solveMsForDiff = (diff: number) => Math.round(lerp(SOLVE_MS_EASY, SOLVE_MS_MIN, clamp(diff, 0, 1)))

// The calculator's time drain is lenient on easy locks, punishing on hard ones.
const calcDrainForDiff = (diff: number) => lerp(1.12, 1.6, clamp(diff, 0, 1))

// Defender interception probability (the keeper-save analogue), INVERTED: a safe,
// easy pass is predictable and easy to read (HIGH cut-out chance); an ambitious,
// hard pass succeeds far more often (LOW cut-out chance). Rolled once at strike on
// practice/unlimited runs only — the first lesson run + the sandbox thread cleanly.
const interceptProbFor = (diff: number) => clamp(0.85 - 0.72 * diff, 0.08, 0.9)

const BEST_KEY = 'physics-passing-best'

type P2 = { sx: number; sy: number; scale: number }
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v))
const round1 = (x: number) => Math.round(x * 10) / 10
const lerp = (a: number, b: number, t: number) => a + (b - a) * t
// Smooth accel→decel — used for the defender's interception lunge so it never snaps.
const easeInOut = (u: number) => (u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2)
const parseNum = (s: string): number => { const v = parseFloat(s); return Number.isFinite(v) ? v : 0 }

type Phase = 'aim' | 'meter' | 'solve' | 'fly' | 'result'
type SolveFor = 'speed' | 'time'
type Outcome = 'connected' | 'early' | 'late' | 'soft'

type Play = {
  x0: number       // runner's head start ahead of you (m along the channel)
  vr: number       // runner's constant speed (m/s) = slope of his line
  tMeet: number    // the instant the runner reaches the centre of the space (s)
  target: number   // X* = x0 + vr·tMeet, centre of the space (m along the channel)
  vbMin: number    // slowest pass that still reaches X* by t_meet (= target / tMeet)
  dir: number      // run bearing this round (rad off straight-ahead), randomised
  side: 1 | -1     // which side the run leans toward (drives the defender offset)
  ux: number       // unit channel direction (lateral)
  uz: number       // unit channel direction (forward/depth)
  defS: number     // a defender loiters at this channel position
  defOff: number   // ...offset to the side of the lane
}

function makePlay(prevDir: number): Play {
  const vr = [3, 4, 5][Math.floor(Math.random() * 3)]
  const x0 = [6, 8, 10][Math.floor(Math.random() * 3)]
  const tMeet = [3, 4][Math.floor(Math.random() * 2)]
  const target = x0 + vr * tMeet
  // The teammate makes a fresh run on a RANDOM bearing every round (kept inside a
  // forward cone so the run stays on-screen and the lead-the-runner geometry holds).
  let ang = (Math.random() * 2 - 1) * 0.5            // ≈ ±29° off straight-ahead
  if (Math.abs(ang - prevDir) < 0.25) ang += (ang >= prevDir ? 1 : -1) * 0.28 // vary it vs last run
  ang = clamp(ang, -0.55, 0.55)
  const ux = Math.sin(ang), uz = Math.cos(ang)
  const side: 1 | -1 = ux >= 0 ? 1 : -1
  return {
    x0, vr, tMeet, target,
    vbMin: target / tMeet,
    dir: ang, side, ux, uz,
    defS: target * 0.6, defOff: -side * 2.2,
  }
}

// Meter (t∈[0,1]) → the LOCKED value, for each mode.
const meterToTd = (t: number, p: Play) => round1(t * 0.45 * p.tMeet)
const meterToVb = (t: number, p: Play) => round1(p.vbMin * (1.2 + t * 0.8))

// The one correct answer, given the locked value.
const answerSpeed = (p: Play, td: number) => p.target / (p.tMeet - td) // v_b = X* / (t_meet − t_d)
const answerTime = (p: Play, vb: number) => p.tMeet - p.target / vb     // t_d = t_meet − X* / v_b

// Where a chosen pass crosses the runner's line, or null if too slow to ever catch him.
function crossing(vb: number, td: number, p: Play): { t: number; s: number } | null {
  if (vb <= p.vr + 0.001) return null
  const t = (p.x0 + vb * td) / (vb - p.vr)
  if (t < td) return null
  return { t, s: vb * (t - td) }
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
  solveFor: SolveFor
  meterT: number
  meterDir: 1 | -1
  lockedTd: number   // set on a 'speed' run (meter result)
  lockedVb: number   // set on a 'time' run (meter result)
  diff: number       // 0..1 difficulty from the meter lock (drives the hint scaffold)
  solveMs: number
  solveElapsedMs: number // accrues 1× normally, 1.25× while the calculator is open
  vb: number         // the pass speed actually played
  td: number         // the release delay actually played
  t: number          // fly clock
  released: boolean
  // Outcome decided ONCE at strike (like the penalty's shotKind), applied by the fly loop.
  outcome: Outcome | null
  crossT: number     // time the ball catches the runner (Infinity if never)
  crossS: number     // channel position of the catch
  // Defender interception (the keeper-save analogue) — set when a miss is struck.
  // `luckFail` = a perfectly-weighted pass that the defender still reads & cuts out
  // (the "unlucky save" analogue), rolled once at strike on practice/unlimited runs.
  interceptS: number
  interceptT: number
  defRunDur: number
  luckFail: boolean
  resolved: boolean
  scored: boolean
  celebrate: number
  particles: Particle[]
  // Sandbox "try for yourself" pass: reuses the fly mechanics but never scores.
  sandbox: boolean
  sandboxResetAt: number
}

const newGame = (play: Play, solveFor: SolveFor): Game => ({
  phase: 'aim', play, solveFor,
  meterT: 0, meterDir: 1,
  lockedTd: 0, lockedVb: 0, diff: 0, solveMs: SOLVE_MS_EASY, solveElapsedMs: 0,
  vb: 0, td: 0, t: 0, released: false,
  outcome: null, crossT: Infinity, crossS: 0,
  interceptS: NaN, interceptT: Infinity, defRunDur: 0.75, luckFail: false,
  resolved: false, scored: false, celebrate: 0, particles: [],
  sandbox: false, sandboxResetAt: 0,
})

type MissData = { play: Play; solveFor: SolveFor; lockedTd: number; lockedVb: number; used: number; diff: number }

export function MotionSim({ state, onChange, showGoal, onGoal }: SimProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [phase, setPhase] = useState<Phase>('aim')
  const [answerStr, setAnswerStr] = useState('')
  const [streak, setStreak] = useState(0)
  const [best, setBest] = useState(() => { try { return Number(localStorage.getItem(BEST_KEY) ?? 0) || 0 } catch { return 0 } })
  const [sound, setSound] = useState(true)
  const [showCalc, setShowCalc] = useState(false)
  const [missData, setMissData] = useState<MissData | null>(null)
  // A correct pass that the defender still read & cut out (the unlucky-save case):
  // no score, no teaching lesson — just a quick "play on" retry, like the penalty.
  const [unlucky, setUnlucky] = useState(false)
  const [sandboxBusy, setSandboxBusy] = useState(false)
  const [sandboxResult, setSandboxResult] = useState<{ kind: 'goal' | 'miss'; text: string } | null>(null)
  // Re-render tick so the React side-panel graph follows the live game state.
  const [, force] = useState(0)
  const rerender = useCallback(() => force((n) => n + 1), [])

  const sfx = useRef(new Sfx())
  const soundRef = useRef(sound); soundRef.current = sound
  const showCalcRef = useRef(showCalc); showCalcRef.current = showCalc
  const solveModeRef = useRef<SolveFor>('speed')
  const prevDirRef = useRef<number>(0)
  const gameRef = useRef<Game>(newGame(makePlay(0), 'speed'))
  const rafRef = useRef<number | null>(null)
  const bgRef = useRef<HTMLCanvasElement | null>(null)
  const gradRef = useRef<{ grass: CanvasGradient; vignette: CanvasGradient } | null>(null)
  const sceneRef = useRef({ onChange, state, onGoal, showGoal })
  sceneRef.current = { onChange, state, onGoal, showGoal }
  const goalFiredRef = useRef(false)
  const answerRef = useRef(answerStr); answerRef.current = answerStr
  const streakRef = useRef(streak); streakRef.current = streak
  const bestRef = useRef(best); bestRef.current = best
  // Try-for-yourself preview: when active, the draw loop renders a live candidate
  // pass line for `value` (the variable being solved) instead of the frozen scene.
  const previewRef = useRef<{ active: boolean; value: number }>({ active: false, value: 0 })
  const setPreview = useCallback((p: { active: boolean; value: number } | null) => {
    previewRef.current = p ?? { active: false, value: 0 }
    if (!previewRef.current.active) {
      const g = gameRef.current
      if (g.sandbox) {
        g.sandbox = false; g.sandboxResetAt = 0; g.particles = []
        g.scored = false; g.resolved = false
        if (g.phase === 'fly') g.phase = 'result'
      }
      setSandboxBusy(false); setSandboxResult(null)
    }
  }, [])

  // ---- projection ----
  const project = useCallback((x: number, y: number, z: number): P2 => {
    const cz = Math.max(0.05, z)
    const scale = FOCAL / cz
    return { sx: W / 2 + x * scale, sy: HORIZON - (y - EYE_Y) * scale, scale }
  }, [])
  const atS = useCallback((p: Play, s: number, y: number, lateral = 0): P2 => {
    const px = p.uz, pz = -p.ux
    const gx = p.ux * s + px * lateral
    const gz = RELEASE.z + p.uz * s + pz * lateral
    return project(gx, y, gz)
  }, [project])

  // ===== Actions =====
  const nextRun = useCallback(() => {
    previewRef.current = { active: false, value: 0 }
    const play = makePlay(prevDirRef.current)
    prevDirRef.current = play.dir
    gameRef.current = newGame(play, solveModeRef.current)
    goalFiredRef.current = false
    setAnswerStr(''); setShowCalc(false); setMissData(null); setUnlucky(false)
    setSandboxBusy(false); setSandboxResult(null)
    setPhase('aim')
  }, [])

  const startMeter = useCallback(() => {
    const g = gameRef.current
    if (g.phase !== 'aim') return
    g.solveFor = solveModeRef.current
    solveModeRef.current = g.solveFor === 'speed' ? 'time' : 'speed'
    g.phase = 'meter'; g.meterT = 0; g.meterDir = 1
    if (soundRef.current) sfx.current.ensure()
    setPhase('meter')
  }, [])

  const lockMeter = useCallback(() => {
    const g = gameRef.current
    if (g.phase !== 'meter') return
    if (g.solveFor === 'speed') g.lockedTd = meterToTd(g.meterT, g.play)
    else g.lockedVb = meterToVb(g.meterT, g.play)
    g.diff = clamp(g.meterT, 0, 1)
    g.solveMs = solveMsForDiff(g.diff) // easy lock = more time, hard lock = less
    g.phase = 'solve'; g.solveElapsedMs = 0
    if (soundRef.current) sfx.current.whistle()
    setAnswerStr('')
    setPhase('solve')
  }, [])

  // Shared strike core. Decides the outcome ONCE (deterministic) and, on a miss,
  // sets up the defender's interception run. `sandbox` shots never score.
  const fire = useCallback((vb: number, td: number, sandbox: boolean) => {
    const g = gameRef.current
    const p = g.play
    g.vb = vb; g.td = td; g.sandbox = sandbox
    const cr = crossing(vb, td, p)
    let outcome: Outcome
    if (!cr) outcome = 'soft'
    else if (cr.s < p.target - ZONE_HALF) outcome = 'early'
    else if (cr.s > p.target + ZONE_HALF) outcome = 'late'
    else outcome = 'connected'
    g.outcome = outcome
    g.crossT = cr ? cr.t : Infinity
    g.crossS = cr ? cr.s : 0
    // Keeper-save analogue: a correctly weighted pass threads cleanly on the first
    // lesson run (showGoal) and in the try-yourself sandbox; on practice/unlimited
    // runs we roll once — harder locks are more likely to be read & cut out.
    const firstRun = !!sceneRef.current.showGoal
    g.luckFail = outcome === 'connected' && !sandbox && !firstRun && Math.random() < interceptProbFor(g.diff)
    const cleanThread = outcome === 'connected' && !g.luckFail
    if (cleanThread) { g.interceptS = NaN; g.interceptT = Infinity }
    else {
      const reach = cr ? cr.s : POS_MAX
      if (vb > 0.05) { g.interceptS = clamp(Math.min(p.defS, reach - 0.5), 1.5, POS_MAX); g.interceptT = td + g.interceptS / vb }
      else { g.interceptS = 0.7; g.interceptT = td + 1.0 }
    }
    g.defRunDur = 0.9
    // Both real and sandbox shots run on the SAME t=0 timebase: the runner sets off
    // from x₀, the ball is held until the release timing t_d, then flies at v_b.
    // Keeping one clock means the chosen pass speed AND the chosen release timing are
    // visibly reflected (a slow pass crawls, a fast pass zips, a later release leaves
    // later) and the crossing/intercept end conditions line up with the drawn motion.
    g.t = 0; g.released = false; g.resolved = false; g.scored = false; g.celebrate = 0
    g.phase = 'fly'
    if (soundRef.current) { sfx.current.ensure(); sfx.current.pass() }
    // Sandbox shots keep the React phase on 'result' so the try-view stays mounted;
    // only the gameRef phase flips. Real shots advance the React phase.
    if (!sandbox) setPhase('fly')
  }, [])

  const playPass = useCallback(() => {
    const g = gameRef.current
    if (g.phase !== 'solve') return
    const ans = parseNum(answerRef.current)
    if (g.solveFor === 'speed') fire(clamp(ans, 0, 30), g.lockedTd, false)
    else fire(g.lockedVb, clamp(ans, 0, g.play.tMeet), false)
  }, [fire])

  const sandboxShoot = useCallback((value: number) => {
    const g = gameRef.current
    if (g.sandbox && g.phase === 'fly') return
    previewRef.current = { active: false, value }
    setSandboxBusy(true); setSandboxResult(null)
    if (g.solveFor === 'speed') fire(clamp(value, 0, 30), g.lockedTd, true)
    else fire(g.lockedVb, clamp(value, 0, g.play.tMeet), true)
  }, [fire])

  const resolve = useCallback(() => {
    const g = gameRef.current
    if (g.resolved) return
    g.resolved = true
    const p = g.play
    const outcome = g.outcome
    const cleanThread = outcome === 'connected' && !g.luckFail
    g.phase = 'result'
    if (cleanThread) {
      g.scored = true; g.celebrate = 1
      spawnConfetti(g, atS(p, p.target, 1.0))
      if (soundRef.current) { sfx.current.pass(); sfx.current.cheer() }
      if (g.sandbox) {
        setSandboxResult({ kind: 'goal', text: 'Perfect weight — threaded straight past the defender!' })
        setSandboxBusy(false)
      } else {
        const s = streakRef.current + 1
        setStreak(s)
        if (s > bestRef.current) { setBest(s); try { localStorage.setItem(BEST_KEY, String(s)) } catch { /* ignore */ } }
        if (!goalFiredRef.current) {
          goalFiredRef.current = true
          const sc = sceneRef.current
          sc.onChange({ ...sc.state, connections: Number(sc.state.connections ?? 0) + 1 })
          sc.onGoal?.()
        }
      }
    } else if (outcome === 'connected') {
      // Correct weight, but the defender read it — the unlucky-save case. No score,
      // no teaching lesson (the maths was right); just reset the streak and play on.
      if (soundRef.current) { sfx.current.steal(); sfx.current.miss() }
      setStreak(0)
      setUnlucky(true)
    } else {
      if (soundRef.current) { sfx.current.steal(); sfx.current.miss() }
      if (g.sandbox) {
        setSandboxResult({ kind: 'miss', text: interceptText(outcome, g.solveFor) })
        g.sandboxResetAt = (performance.now?.() ?? 0) + 1200
      } else {
        setStreak(0)
        setMissData({ play: p, solveFor: g.solveFor, lockedTd: g.lockedTd, lockedVb: g.lockedVb, used: g.solveFor === 'speed' ? g.vb : g.td, diff: g.diff })
      }
    }
    setPhase('result')
  }, [atS])

  const actionsRef = useRef({ startMeter, lockMeter, playPass, resolve, sandboxShoot })
  actionsRef.current = { startMeter, lockMeter, playPass, resolve, sandboxShoot }

  // ===== Input =====
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      const g = gameRef.current
      const typing = (e.target as HTMLElement)?.tagName === 'INPUT'
      if ((e.key === ' ' || e.code === 'Space') && !typing) {
        e.preventDefault()
        if (g.phase === 'aim') actionsRef.current.startMeter()
        else if (g.phase === 'meter') actionsRef.current.lockMeter()
        else if (g.phase === 'solve' && answerRef.current) actionsRef.current.playPass()
      }
    }
    window.addEventListener('keydown', down)
    return () => window.removeEventListener('keydown', down)
  }, [])

  function onPointerDown() {
    const g = gameRef.current
    if (g.phase === 'aim') actionsRef.current.startMeter()
    else if (g.phase === 'meter') actionsRef.current.lockMeter()
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
    const preview = previewRef.current.active && g.phase === 'result'

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

    drawChannel(ctx, atS, p, now)

    const t = g.t
    const sRun = p.x0 + p.vr * t
    const running = g.phase === 'fly' && !preview

    // ---- defender (sprints in to cut out a mis-weighted OR unlucky-read pass) ----
    const cleanThread = g.outcome === 'connected' && !g.luckFail
    const cutOut = !!g.outcome && !cleanThread
    let defS = p.defS, defLat = p.defOff, defRunning = false, defHasBall = false
    if (!preview && (g.phase === 'fly' || g.phase === 'result') && cutOut) {
      // Smooth accel→decel lunge into the lane, finishing exactly as the ball arrives.
      const tp = clamp((t - (g.interceptT - g.defRunDur)) / g.defRunDur, 0, 1)
      const e = easeInOut(tp)
      defS = lerp(p.defS, g.interceptS, e)
      defLat = lerp(p.defOff, 0, e)
      defRunning = tp > 0.02 && tp < 0.98
      defHasBall = t >= g.interceptT
    } else if (!preview && (g.phase === 'fly' || g.phase === 'result') && cleanThread) {
      // beaten: a smooth half-step toward the lane, but the ball is already gone
      const tp = easeInOut(clamp((t - (g.crossT - 0.6)) / 0.6, 0, 1))
      defLat = lerp(p.defOff, p.defOff * 0.45, tp)
      defRunning = tp > 0.02 && tp < 0.7
    }
    drawPlayer(ctx, atS, p, defS, defLat, FOE_KIT, now, defRunning, defHasBall)

    // ---- runner (teammate) ----
    const runnerS = (g.phase === 'fly' || g.phase === 'result') && !preview ? Math.min(sRun, POS_MAX) : p.x0
    drawPlayer(ctx, atS, p, runnerS, 0, TEAM_KIT, now, running, false)

    // ---- try-for-yourself live preview line ----
    if (preview) {
      const vb = g.solveFor === 'speed' ? previewRef.current.value : g.lockedVb
      const td = g.solveFor === 'speed' ? g.lockedTd : previewRef.current.value
      drawPreviewLane(ctx, atS, p, vb, td, now)
    }

    // ---- ball ----
    if (!preview && ((g.phase === 'fly' && g.released) || (g.phase === 'result' && !defHasBall && cleanThread))) {
      let bs = Math.max(0, g.vb * (t - g.td))
      if (cleanThread) bs = Math.min(bs, g.crossS)
      else bs = Math.min(bs, g.interceptS)
      const bp = atS(p, Math.min(bs, POS_MAX), BALL_R)
      const shadow = atS(p, Math.min(bs, POS_MAX), 0.01)
      ctx.fillStyle = 'rgba(0,0,0,0.28)'
      ctx.beginPath(); ctx.ellipse(shadow.sx, shadow.sy, BALL_R * shadow.scale * 1.3, BALL_R * shadow.scale * 0.5, 0, 0, Math.PI * 2); ctx.fill()
      drawBall(ctx, bp.sx, bp.sy, Math.max(4, BALL_R * bp.scale), bs * 2.2, 0)
    } else if (!preview && !(g.phase === 'fly' || g.phase === 'result')) {
      const groundY = H - 34
      ctx.fillStyle = 'rgba(0,0,0,0.32)'
      ctx.beginPath(); ctx.ellipse(W / 2, groundY + 8, 44, 13, 0, 0, Math.PI * 2); ctx.fill()
      drawBall(ctx, W / 2, groundY - 4, 38, now / 600, 0)
    }

    ctx.fillStyle = gradRef.current.vignette; ctx.fillRect(-30, -30, W + 60, H + 60)

    if (!preview && g.particles.length) {
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
    if (g.phase === 'meter') {
      const setsTime = g.solveFor === 'speed'
      const val = setsTime ? meterToTd(g.meterT, p) : meterToVb(g.meterT, p)
      drawMeter(ctx, g.meterT,
        setsTime ? `RELEASE TIMING: t_d = ${val.toFixed(1)} s` : `PASS POWER: v_b = ${val.toFixed(1)} m/s`,
        setsTime ? '#7ec8ff' : '#ff9e4d')
    }
    if (g.phase === 'aim') {
      drawTopLabel(ctx, 'Read the run', `Next you'll lock the ${g.solveFor === 'speed' ? 'release timing' : 'pass power'}. SPACE / click to start the meter.`)
    }
    if (g.phase === 'solve') {
      const total = g.solveMs / 1000
      const left = Math.max(0, (g.solveMs - g.solveElapsedMs) / 1000)
      const warn = left <= SOLVE_WARN_MS / 1000
      const calcLabel = showCalcRef.current ? ` (calc: ${calcDrainForDiff(g.diff).toFixed(2)}× drain)` : ''
      const label = (g.solveFor === 'speed' ? 'Solve pass speed v_b: SPACE to play' : 'Solve release t_d: SPACE to play') + calcLabel
      drawTimer(ctx, left, total, warn ? `Hurry! ${Math.ceil(left)}s left` : label, warn ? '#ff3b5f' : '#7ec8ff', warn)
    }
    if (g.phase === 'fly' && !preview && cutOut && g.t >= g.interceptT) {
      drawTopLabel(ctx, 'Intercepted! 🧤', g.luckFail ? 'Well-weighted, but the defender read it and cut it out.' : 'The defender read the pass and cut it out.')
    }
  }, [project, atS])

  // ===== Loop =====
  useEffect(() => {
    let last = performance.now()
    const update = (now: number, dt: number) => {
      const g = gameRef.current
      const act = actionsRef.current
      if (g.phase === 'meter') {
        g.meterT += g.meterDir * dt * 0.55 * (1 + 0.4 * g.meterT)
        if (g.meterDir === 1 && g.meterT >= 1) { g.meterT = 1; g.meterDir = -1 }
        else if (g.meterDir === -1 && g.meterT <= 0) { g.meterT = 0; act.lockMeter() }
      }
      if (g.phase === 'solve') {
        g.solveElapsedMs += dt * 1000 * (showCalcRef.current ? calcDrainForDiff(g.diff) : 1)
        if (g.solveElapsedMs >= g.solveMs) act.playPass()
      }
      if (g.phase === 'fly') {
        g.t += dt
        if (g.t >= g.td) g.released = true
        const end = (g.outcome === 'connected' && !g.luckFail)
          ? (Number.isFinite(g.crossT) ? g.crossT + 0.25 : T_MAX)
          : g.interceptT + 0.45
        if (g.t >= end) act.resolve()
      }
      if (g.celebrate > 0) g.celebrate = Math.max(0, g.celebrate - dt)
      if (g.particles.length) {
        for (const pt of g.particles) { pt.x += pt.vx * dt; pt.y += pt.vy * dt; pt.vy += 760 * dt; pt.life -= dt; pt.rot += pt.vr * dt }
        g.particles = g.particles.filter((pt) => pt.life > 0)
      }
      // Sandbox miss: after the steal, clear it and return to the try-aim view.
      if (g.sandbox && g.sandboxResetAt > 0 && now >= g.sandboxResetAt) {
        g.sandboxResetAt = 0; g.scored = false; g.resolved = false; g.particles = []
        g.phase = 'result'
        previewRef.current = { active: true, value: previewRef.current.value }
        setSandboxBusy(false)
      }
    }
    const loop = (now: number) => {
      const dt = Math.min(0.04, (now - last) / 1000); last = now
      update(now, dt)
      draw()
      const ph = gameRef.current.phase
      if (ph === 'fly' || ph === 'meter') rerender()
      rafRef.current = requestAnimationFrame(loop)
    }
    rafRef.current = requestAnimationFrame(loop)
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current) }
  }, [draw, rerender])

  function toggleSound() { setSound((v) => { if (!v) sfx.current.ensure(); return !v }) }

  // ===== Side-panel data =====
  const g = gameRef.current
  const p = g.play
  const outcome = g.outcome
  const canClickContinue = phase === 'result' && outcome === 'connected' && !missData
  // Difficulty-scaled hint scaffold: easy lock → full plugged-in formula,
  // medium → bare formula, hard → no formula (recall nudge only).
  const scaffold: 'full' | 'partial' | 'none' = g.diff < 0.33 ? 'full' : g.diff <= 0.66 ? 'partial' : 'none'

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
          onPointerDown={onPointerDown}
        />
        <button type="button" className="soccer__sound" onClick={toggleSound} aria-label="Toggle sound">{sound ? '🔊' : '🔈'}</button>

        {phase === 'aim' && (
          <div className="soccer__prompt">
            <strong>Through-ball!</strong> A teammate is sprinting into the green space and a defender is lurking. Lead the runner so your pass threads past the defender into the space. Click or press <kbd>Space</kbd> to start the power meter.
          </div>
        )}
        {phase === 'meter' && (
          <div className="soccer__prompt">
            Meter sweeps SLOW → FAST, then rebounds once. <kbd>Space</kbd> or click to lock {g.solveFor === 'speed' ? 'your release timing' : 'your pass power'}; then solve for the rest.
          </div>
        )}
        {phase === 'fly' && <div className="soccer__prompt">{g.released ? 'Pass is on…' : 'Hold it… timing the run…'}</div>}

        {phase === 'result' && outcome === 'connected' && !unlucky && !missData && (
          <div className="soccer__banner soccer__banner--goal">
            <strong>CONNECTED!</strong>
            <span>Threaded. Click anywhere to continue.</span>
          </div>
        )}

        {phase === 'result' && unlucky && (
          <div className="soccer__banner soccer__banner--save">
            <strong>RIGHT ANSWER 🧤</strong>
            <span>Safe pass read. Click anywhere.</span>
          </div>
        )}

        {/* In-game calculator overlay during solve (same placement as the penalty). */}
        {phase === 'solve' && showCalc && <Calculator onClose={() => setShowCalc(false)} />}

        {/* Animated post-miss teaching lesson + try-for-yourself sandbox.
            Gated on `missData` alone — it is set ONLY on a real mis-weighted pass
            (never on a clean thread or the unlucky-but-correct read), so the lesson
            appears only when the answer was actually wrong, and it STAYS mounted
            through a sandbox shot even when that shot momentarily connects. */}
        {phase === 'result' && missData && (
          <Remediation
            data={missData}
            onDone={nextRun}
            setPreview={setPreview}
            onShoot={(v) => actionsRef.current.sandboxShoot(v)}
            sandboxBusy={sandboxBusy}
            sandboxResult={sandboxResult}
          />
        )}
      </div>

      <div className="soccer__side">
        {phase === 'solve' && (
          <>
            <div className="soccer__givens">
              <div className="is-key"><span>Hit the space at</span><strong>X* = {p.target} m</strong></div>
              <div className="is-key"><span>Runner reaches it at</span><strong>t = {p.tMeet} s</strong></div>
              {g.solveFor === 'speed'
                ? <div className="is-key"><span>Your release (locked)</span><strong>t_d = {g.lockedTd.toFixed(1)} s</strong></div>
                : <div className="is-key"><span>Your power (locked)</span><strong>v_b = {g.lockedVb.toFixed(1)} m/s</strong></div>}
              <div><span>Head start</span><strong>x₀ = {p.x0} m</strong></div>
              <div><span>Runner speed</span><strong>v_r = {p.vr} m/s</strong></div>
            </div>
            <div className="soccer__method">
              <div className="soccer__method-head">
                <span>{g.solveFor === 'speed' ? 'Solve for the pass speed v_b' : 'Solve for the release timing t_d'}</span>
                <button type="button" className="soccer__calc-toggle" onClick={() => setShowCalc((v) => !v)}>🧮 {showCalc ? 'Hide' : 'Calc'}</button>
              </div>
              {scaffold === 'full' && (
                <div className="soccer__steps">
                  {g.solveFor === 'speed'
                    ? <code>v_b = X* / (t − t_d) = {p.target} / ({p.tMeet} − {g.lockedTd.toFixed(1)})</code>
                    : <code>t_d = t − X* / v_b = {p.tMeet} − {p.target} / {g.lockedVb.toFixed(1)}</code>}
                </div>
              )}
              {scaffold === 'partial' && (
                <div className="soccer__steps">
                  {g.solveFor === 'speed'
                    ? <code>v_b = X* / (t − t_d)</code>
                    : <code>t_d = t − X* / v_b</code>}
                </div>
              )}
              {scaffold === 'none' && (
                <p className="soccer__tip">Recall: x = x₀ + v·t — use the calculator if you need it.</p>
              )}
              <div className="soccer__inputs">
                <label className="soccer__field">
                  <span>{g.solveFor === 'speed' ? 'Pass speed v_b (m/s)' : 'Release timing t_d (s)'}</span>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={answerStr}
                    placeholder={(g.solveFor === 'speed' ? answerSpeed(p, g.lockedTd) : answerTime(p, g.lockedVb)).toFixed(1)}
                    onChange={(e) => setAnswerStr(e.target.value)}
                  />
                </label>
              </div>
            </div>
          </>
        )}

        {phase === 'result' && outcome === 'connected' && !unlucky && !missData && (
          <p className="soccer__tip">Threaded it: your pass line crossed the runner's right in the space. <b>Streak {streak}</b> · best {best}.</p>
        )}

        <div className="sim__controls">
          <div className="soccer__buttons">
            {phase === 'meter' && <button type="button" className="btn btn--primary" onClick={lockMeter}>Lock it (Space)</button>}
            {phase === 'solve' && <button type="button" className="btn btn--primary" onClick={playPass} disabled={!answerStr}>Play the pass ⚽</button>}
            {phase === 'aim' && <button type="button" className="btn btn--primary" onClick={startMeter}>Start the meter ▸</button>}
            {phase === 'fly' && <button type="button" className="btn btn--primary" disabled>Pass in flight…</button>}
            {phase === 'result' && <button type="button" className="btn btn--primary" onClick={nextRun}>Next run →</button>}
            <button type="button" className="btn btn--ghost" onClick={nextRun}>↻ Restart</button>
          </div>
        </div>
      </div>
    </div>
  )
}

function interceptText(outcome: Outcome | null, solveFor: SolveFor): string {
  if (outcome === 'early') return solveFor === 'speed' ? 'Too much pace — it reached him before the space, easy to read. Ease off.' : 'Released too early — it met him before the space. Hold it a touch longer.'
  if (outcome === 'late') return solveFor === 'speed' ? 'Too little pace — it rolled in behind the run. Add more.' : 'Released too late — it rolled in behind the run. Let it go sooner.'
  return 'Underhit — far too slow, the defender just stepped across it.'
}

// ============================================================================
// Post-miss remediation — an animated, fill-the-blank teaching lesson followed
// by a "try for yourself" sandbox. Ported 1:1 from the penalty's Remediation
// structure (paced step reveal, MCQ gates, worked-solution reveal, learn-time
// bar, calculator, then a slider-driven live preview + sandbox shot), with the
// physics swapped to the passing / lead-the-runner content.
// ============================================================================
type Opt = { label: string; correct: boolean }
type LStep = { n: string; cmp?: boolean; prompt: string; options: Opt[]; gate: 'check' | 'correct'; card: (blank: ReactNode) => ReactNode; solution: ReactNode }

function Remediation({
  data, onDone, setPreview, onShoot, sandboxBusy, sandboxResult,
}: {
  data: MissData
  onDone: () => void
  setPreview: (p: { active: boolean; value: number } | null) => void
  onShoot: (value: number) => void
  sandboxBusy: boolean
  sandboxResult: { kind: 'goal' | 'miss'; text: string } | null
}) {
  const { play, solveFor, lockedTd, lockedVb, used } = data
  const correct = solveFor === 'speed' ? answerSpeed(play, lockedTd) : answerTime(play, lockedVb)
  const unit = solveFor === 'speed' ? 'm/s' : 's'
  const varName = solveFor === 'speed' ? 'pass speed v_b' : 'release timing t_d'
  // Same difficulty scaffold as the in-solve panel: harder locks reveal less.
  const lessonScaffold: 'full' | 'partial' | 'none' = data.diff < 0.33 ? 'full' : data.diff <= 0.66 ? 'partial' : 'none'

  const predict = (value: number) => {
    const vb = solveFor === 'speed' ? value : lockedVb
    const td = solveFor === 'speed' ? lockedTd : value
    return crossing(vb, td, play)
  }

  const [view, setView] = useState<'lesson' | 'try'>('lesson')
  const [stepIdx, setStepIdx] = useState(0)
  const [val, setVal] = useState(used > 0 ? used : correct)
  const [answered, setAnswered] = useState<boolean[]>(() => Array(4).fill(false))
  const [pick, setPick] = useState<number | null>(null)
  const [checked, setChecked] = useState(false)
  const [revealed, setRevealed] = useState(false)
  const [showLessonCalc, setShowLessonCalc] = useState(false)
  const slots = useMemo(() => Array.from({ length: 4 }, () => Math.floor(Math.random() * 3)), [])
  useEffect(() => { setPick(null); setChecked(false); setRevealed(false) }, [stepIdx])

  const liveCross = predict(val)
  const inZone = !!liveCross && Math.abs(liveCross.s - play.target) <= ZONE_HALF

  // "What went wrong" verdict about the player's actual mis-weighted pass.
  const missCross = predict(used)
  const verdict = !missCross
    ? 'Your pass was too slow to ever catch the run — it never crossed his line.'
    : missCross.s < play.target
      ? `Your pass met the runner at ${missCross.s.toFixed(1)} m — before the ${play.target} m space, at his feet.`
      : `Your pass met the runner at ${missCross.s.toFixed(1)} m — beyond the ${play.target} m space, behind the run.`

  // "Time spent learning" — counts up across both views; running out in the try
  // view auto-skips the run.
  const LEARN_LIMIT = 120
  const [elapsed, setElapsed] = useState(0)
  useEffect(() => {
    const start = performance.now()
    const id = window.setInterval(() => setElapsed((performance.now() - start) / 1000), 100)
    return () => window.clearInterval(id)
  }, [])
  useEffect(() => () => setPreview(null), [setPreview])
  useEffect(() => { if (view === 'try' && elapsed >= LEARN_LIMIT) onDone() }, [view, elapsed, onDone])
  const barPct = Math.min(100, (elapsed / LEARN_LIMIT) * 100)
  const timedOutSoon = view === 'try' && elapsed >= LEARN_LIMIT - 10

  const sliderMin = solveFor === 'speed' ? 3 : 0
  const sliderMax = solveFor === 'speed' ? 22 : play.tMeet

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

  // ---- Try-for-yourself HUD over the live scene + preview line ----
  if (view === 'try') {
    const scored = sandboxResult?.kind === 'goal'
    const lastShot = sandboxResult && sandboxResult.kind !== 'goal' ? sandboxResult : null
    return (
      <div className="soccer__try">
        <div className="soccer__try-givens">
          <span>X* = {play.target} m</span>
          <span>t_meet = {play.tMeet} s</span>
          <span>{solveFor === 'speed' ? `t_d = ${lockedTd.toFixed(1)} s (fixed)` : `v_b = ${lockedVb.toFixed(1)} m/s (fixed)`}</span>
        </div>
        <div className="soccer__try-bar">
          <div className="soccer__try-top">
            <strong>🎯 Try for yourself: drag your {varName}, then play it</strong>
            <span className={`soccer__try-verdict${inZone ? ' is-good' : ''}`}>
              {sandboxBusy
                ? '⚽ Pass on its way…'
                : inZone
                  ? '✓ Line crosses in the space, play it!'
                  : !liveCross ? 'Too slow — never catches the run' : `crosses at ${liveCross.s.toFixed(1)} m · need ${play.target} m`}
            </span>
          </div>
          {lastShot && (
            <div className="soccer__try-last soccer__try-last--miss">
              <strong>🧤 Cut out!</strong> {lastShot.text} <em>(adjust and play again).</em>
            </div>
          )}
          <label className="slider soccer__try-slider">
            <span className="slider__label">
              <span>Your {varName}</span>
              <span className="slider__value">{val.toFixed(1)} {unit}{inZone ? '  ✓' : ''}</span>
            </span>
            <input type="range" min={sliderMin} max={sliderMax} step={0.1} value={val} disabled={sandboxBusy} onChange={(e) => onSlide(parseFloat(e.target.value))} />
          </label>
          {learnBar}
          <div className="soccer__try-actions">
            <button type="button" className="btn btn--ghost" onClick={backToLesson}>← Back to lesson</button>
            <button type="button" className="btn btn--primary soccer__try-shoot" onClick={() => onShoot(val)} disabled={sandboxBusy}>{sandboxBusy ? 'Passing…' : '⚽ Play it!'}</button>
            <button type="button" className="btn btn--ghost" onClick={onDone}>Skip / restart ↻</button>
          </div>
        </div>

        {scored && (
          <div className="soccer__try-congrats" onClick={onDone}>
            <div className="soccer__try-congrats-card" onClick={(e) => e.stopPropagation()}>
              <div className="soccer__try-congrats-emoji">🎉</div>
              <h2>THREADED IT!</h2>
              <p>{sandboxResult?.text}</p>
              <button type="button" className="btn btn--primary soccer__try-btn" onClick={onDone}>Play a fresh run →</button>
              <span className="soccer__try-congrats-hint">click anywhere to start a new run</span>
            </div>
          </div>
        )}
      </div>
    )
  }

  // ---- Worked walkthrough built from the CORRECT, threading pass ----
  const r1 = (x: number) => Math.round(x * 10) / 10
  const r2 = (x: number) => Math.round(x * 100) / 100
  const runDist = play.vr * play.tMeet
  const X = play.target
  const avail = r1(play.tMeet - lockedTd)          // speed mode: time the pass has
  const ballTime = r2(X / lockedVb)                // time mode: time ball needs at v_b
  // The lesson's correct answer is the SAME value the sim grades against — the
  // exact solution rounded for display — so the "recommended" option provably
  // threads the pass when played. (answerSpeed/answerTime ARE the sim's solve.)
  const finalSpeed = r1(answerSpeed(play, lockedTd))
  const finalTime = r1(answerTime(play, lockedVb))

  const m = (x: number) => `${x.toFixed(1)} m`
  const sFmt = (x: number) => `${x.toFixed(1)} s`
  const sp = (x: number) => `${x.toFixed(1)} m/s`

  // The sim's own pass grader: would this candidate value thread the run? Mirrors
  // fire()'s outcome test (the pass line must cross the run within ±ZONE_HALF of
  // X*). Used to reject any distractor that would ALSO connect, so the final step
  // has exactly one right answer.
  const threadsSpeed = (v: number) => { const cr = crossing(clamp(v, 0, 30), lockedTd, play); return !!cr && Math.abs(cr.s - play.target) <= ZONE_HALF }
  const threadsTime = (v: number) => { const cr = crossing(lockedVb, clamp(v, 0, play.tMeet), play); return !!cr && Math.abs(cr.s - play.target) <= ZONE_HALF }

  // Build a step's MCQ options. Guarantees EXACTLY ONE right answer:
  //  • the correct value is the only option flagged `correct`, and
  //  • each distractor is rejected (then nudged away) if it reads the same as the
  //    correct answer at display precision (dedupe by numeric value, not just the
  //    string label) OR — when `threads` is supplied for the final answer step —
  //    if it would itself thread the pass (which would make it a 2nd right answer).
  const mkOpts = (
    correctVal: number,
    distractors: number[],
    fmt: (x: number) => string,
    offset: number,
    threads?: (v: number) => boolean,
  ): Opt[] => {
    const correctLabel = fmt(correctVal)
    const seen = new Set<string>([correctLabel])
    const invalid = (v: number) => seen.has(fmt(v)) || (threads ? threads(v) : false)
    const dist: string[] = []
    for (const dv of distractors) {
      let v = dv, guard = 0
      while (invalid(v) && guard < 40) { v = v * 1.08 + 0.13; guard++ }
      seen.add(fmt(v)); dist.push(fmt(v))
    }
    const opts: Opt[] = [{ label: correctLabel, correct: true }, ...dist.map((l) => ({ label: l, correct: false }))]
    const k = offset % opts.length
    return [...opts.slice(k), ...opts.slice(0, k)]
  }

  if (import.meta.env.DEV) {
    const near = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol
    const grader = solveFor === 'speed' ? answerSpeed(play, lockedTd) : answerTime(play, lockedVb)
    const shown = solveFor === 'speed' ? finalSpeed : finalTime
    console.assert(near(shown, grader, 0.6), `passing lesson: shown answer ${shown} far from grader ${grader.toFixed(2)}`)
    console.assert(near(play.x0 + runDist, X, 1e-6), 'passing lesson: x0 + v_r·t != X*')
  }

  const steps: LStep[] = solveFor === 'speed'
    ? [
        {
          n: '1', prompt: 'How far does the runner cover by the time he reaches the space?',
          options: mkOpts(runDist, [play.x0, runDist + play.x0], m, slots[0]), gate: 'check',
          card: (blank) => (<>
            <div className="soccer__step-formula">Distance run = v_r · t_meet</div>
            <div className="soccer__step-plug">= {play.vr} · {play.tMeet} = {blank}</div>
          </>),
          solution: <>v_r · t_meet = {play.vr} · {play.tMeet} = <b>{m(runDist)}</b></>,
        },
        {
          n: '2', prompt: 'So where is the centre of the space, X* (his position then)?',
          options: mkOpts(X, [runDist, X + play.vr], m, slots[1]), gate: 'check',
          card: (blank) => (<>
            <div className="soccer__step-formula">x = x₀ + v_r · t_meet</div>
            <div className="soccer__step-plug">= {play.x0} + {runDist} = {blank}</div>
          </>),
          solution: <>x₀ + v_r·t_meet = {play.x0} + {runDist} = <b>{m(X)}</b></>,
        },
        {
          n: '3', prompt: 'You release at t_d, so how long does your pass have to reach X*?',
          options: mkOpts(avail, [play.tMeet, lockedTd], sFmt, slots[2]), gate: 'check',
          card: (blank) => (<>
            <div className="soccer__step-formula">Pass travel time = t_meet − t_d</div>
            <div className="soccer__step-plug">= {play.tMeet} − {lockedTd.toFixed(1)} = {blank}</div>
          </>),
          solution: <>t_meet − t_d = {play.tMeet} − {lockedTd.toFixed(1)} = <b>{sFmt(avail)}</b></>,
        },
        {
          n: '★', cmp: true, prompt: 'Now produce the answer: which pass speed v_b threads it through?',
          options: mkOpts(finalSpeed, [used, r1(X / play.tMeet)], sp, slots[3], threadsSpeed), gate: 'correct',
          card: (blank) => (<>
            {lessonScaffold !== 'none' && <div className="soccer__step-formula">v_b = X* / (t_meet − t_d)</div>}
            {lessonScaffold === 'full' && (
              <div className="soccer__step-recap">
                <span className="soccer__recap-lead">Work it out:</span>
                <div className="soccer__recap-eq">1) X* = {m(X)}</div>
                <div className="soccer__recap-eq">2) time available = {sFmt(avail)}</div>
                <div className="soccer__recap-eq soccer__recap-eq--final">3) v_b = {X} ÷ {avail.toFixed(1)} = ?</div>
              </div>
            )}
            {lessonScaffold === 'none' && <div className="soccer__step-recap"><span className="soccer__recap-lead">Recall x = x₀ + v·t and rearrange it yourself — the calculator is below.</span></div>}
            <div className="soccer__step-plug">v_b = {blank}</div>
          </>),
          solution: <>v_b = X* / (t_meet − t_d) = {X} ÷ {avail.toFixed(1)} = <b>{sp(finalSpeed)}</b></>,
        },
      ]
    : [
        {
          n: '1', prompt: 'How far does the runner cover by the time he reaches the space?',
          options: mkOpts(runDist, [play.x0, runDist + play.x0], m, slots[0]), gate: 'check',
          card: (blank) => (<>
            <div className="soccer__step-formula">Distance run = v_r · t_meet</div>
            <div className="soccer__step-plug">= {play.vr} · {play.tMeet} = {blank}</div>
          </>),
          solution: <>v_r · t_meet = {play.vr} · {play.tMeet} = <b>{m(runDist)}</b></>,
        },
        {
          n: '2', prompt: 'So where is the centre of the space, X* (his position then)?',
          options: mkOpts(X, [runDist, X + play.vr], m, slots[1]), gate: 'check',
          card: (blank) => (<>
            <div className="soccer__step-formula">x = x₀ + v_r · t_meet</div>
            <div className="soccer__step-plug">= {play.x0} + {runDist} = {blank}</div>
          </>),
          solution: <>x₀ + v_r·t_meet = {play.x0} + {runDist} = <b>{m(X)}</b></>,
        },
        {
          n: '3', prompt: 'At your locked speed v_b, how long does the ball take to reach X*?',
          options: mkOpts(ballTime, [play.tMeet, r2(X / (lockedVb * 2))], sFmt, slots[2]), gate: 'check',
          card: (blank) => (<>
            <div className="soccer__step-formula">Ball time = X* / v_b</div>
            <div className="soccer__step-plug">= {X} / {lockedVb.toFixed(1)} = {blank}</div>
          </>),
          solution: <>X* / v_b = {X} / {lockedVb.toFixed(1)} = <b>{sFmt(ballTime)}</b></>,
        },
        {
          n: '★', cmp: true, prompt: 'Now produce the answer: when do you release (t_d) so it arrives as he does?',
          options: mkOpts(finalTime, [used, play.tMeet], sFmt, slots[3], threadsTime), gate: 'correct',
          card: (blank) => (<>
            {lessonScaffold !== 'none' && <div className="soccer__step-formula">t_d = t_meet − X* / v_b</div>}
            {lessonScaffold === 'full' && (
              <div className="soccer__step-recap">
                <span className="soccer__recap-lead">Work it out:</span>
                <div className="soccer__recap-eq">1) ball needs {sFmt(ballTime)} to reach X*</div>
                <div className="soccer__recap-eq">2) he arrives at t_meet = {sFmt(play.tMeet)}</div>
                <div className="soccer__recap-eq soccer__recap-eq--final">3) t_d = {play.tMeet} − {ballTime.toFixed(1)} = ?</div>
              </div>
            )}
            {lessonScaffold === 'none' && <div className="soccer__step-recap"><span className="soccer__recap-lead">Recall x = x₀ + v·t and rearrange it yourself — the calculator is below.</span></div>}
            <div className="soccer__step-plug">t_d = {blank}</div>
          </>),
          solution: <>t_d = t_meet − X* / v_b = {play.tMeet} − {ballTime.toFixed(1)} = <b>{sFmt(finalTime)}</b></>,
        },
      ]

  const N = steps.length
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

  return (
    <div className="soccer__lesson">
      <div className="soccer__lesson-inner">
        <div className="soccer__lesson-head">
          <div className="soccer__lesson-emoji">🧤</div>
          <div>
            <h2 className="soccer__lesson-title">Defender cut it out!</h2>
            <p className="soccer__lesson-sub">{verdict}</p>
          </div>
        </div>

        <div className="soccer__lesson-chips">
          <div className="chip"><span>head start</span><strong>x₀ = {play.x0} m</strong></div>
          <div className="chip"><span>runner speed</span><strong>v_r = {play.vr} m/s</strong></div>
          <div className="chip"><span>the space</span><strong>X* = {play.target} m</strong></div>
          <div className="chip"><span>reaches it at</span><strong>t = {play.tMeet} s</strong></div>
          <div className="chip chip--lock">
            <span>{solveFor === 'speed' ? 'locked release' : 'locked power'}</span>
            <strong>{solveFor === 'speed' ? `t_d = ${lockedTd.toFixed(1)} s` : `v_b = ${lockedVb.toFixed(1)} m/s`}</strong>
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
                const stateCls = chosen
                  ? (checked ? (o.correct ? ' is-correct' : ' is-wrong') : ' is-picked')
                  : (stepDone && o.correct ? ' is-correct' : '')
                return (
                  <button key={i} type="button" className={`soccer__quiz-opt${stateCls}`} onClick={() => choose(i)} disabled={stepDone}>
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

// ============================================================================
// Canvas drawing helpers (adapted from KinematicsSim's render kit)
// ============================================================================
type AtSFn = (p: Play, s: number, y: number, lateral?: number) => P2

// Full team kits (restored from the archived jersey rendering): a coordinated
// jersey + shorts + socks with a collar, shirt number and sock bands, so the
// teammate (blue) and the defender (red) read as real kitted players.
const TEAM_KIT = {
  jersey: '#2f6df0', jerseyDark: '#1f4ec2', jerseyHi: '#6c9bff', collar: '#0d2f7a',
  shorts: '#13234d', shortsDark: '#0c1834', sock: '#2f6df0', sockBand: '#ffffff',
  boot: '#15171f', number: '#ffffff', num: 9, skin: '#e8b48a', hair: '#2c2016', hairStyle: 0,
}
const FOE_KIT = {
  jersey: '#ef4444', jerseyDark: '#b91c1c', jerseyHi: '#fca5a5', collar: '#7f1010',
  shorts: '#3a0d0d', shortsDark: '#250707', sock: '#ef4444', sockBand: '#ffe8e8',
  boot: '#15171f', number: '#ffffff', num: 4, skin: '#d9a06b', hair: '#1a130c', hairStyle: 3,
}
type Kit = typeof TEAM_KIT

// A few stylised hair styles (from the archive), flat fills only so it's cheap.
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

function drawChannel(ctx: CanvasRenderingContext2D, atS: AtSFn, p: Play, now: number) {
  // No lane lines or distance markers — just the live "space" the teammate is
  // sprinting into. The run bearing changes every round, so the pitch stays clean.
  const pulse = 1 + Math.sin(now / 260) * 0.08
  const za = atS(p, p.target - ZONE_HALF, 0.01, LANE_HALF), zb = atS(p, p.target - ZONE_HALF, 0.01, -LANE_HALF)
  const zc = atS(p, p.target + ZONE_HALF, 0.01, -LANE_HALF), zd = atS(p, p.target + ZONE_HALF, 0.01, LANE_HALF)
  const ctr = atS(p, p.target, 0.01)
  const glowR = Math.max(20, LANE_HALF * ctr.scale * 1.4) * pulse
  const glow = ctx.createRadialGradient(ctr.sx, ctr.sy, 4, ctr.sx, ctr.sy, glowR)
  glow.addColorStop(0, 'rgba(54,224,127,0.5)'); glow.addColorStop(0.6, 'rgba(54,224,127,0.18)'); glow.addColorStop(1, 'rgba(54,224,127,0)')
  ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(ctr.sx, ctr.sy, glowR, 0, Math.PI * 2); ctx.fill()
  ctx.fillStyle = 'rgba(54,224,127,0.22)'
  ctx.beginPath(); ctx.moveTo(za.sx, za.sy); ctx.lineTo(zb.sx, zb.sy); ctx.lineTo(zc.sx, zc.sy); ctx.lineTo(zd.sx, zd.sy); ctx.closePath(); ctx.fill()
  ctx.strokeStyle = 'rgba(54,224,127,0.9)'; ctx.lineWidth = 2.5; ctx.stroke()
  const lbl = atS(p, p.target, 1.4)
  ctx.fillStyle = '#eafff2'; ctx.font = '800 13px Plus Jakarta Sans, sans-serif'; ctx.textAlign = 'center'
  ctx.fillText('the space', lbl.sx, lbl.sy)
  ctx.textAlign = 'left'
}

function drawPlayer(ctx: CanvasRenderingContext2D, atS: AtSFn, p: Play, s: number, lateral: number, kit: Kit, now: number, running: boolean, hasBall: boolean) {
  const feet = atS(p, s, 0, lateral)
  const head = atS(p, s, 1.84, lateral)
  const scale = feet.scale
  if (scale < 4) return
  const ph = now / 80
  const bob = running ? Math.abs(Math.sin(ph)) * 0.055 * scale : 0
  const cx = feet.sx
  const footY = feet.sy - bob
  const headY = head.sy - bob
  const hipY = headY + (footY - headY) * 0.52
  const shoulderY = headY + (footY - headY) * 0.3
  const wBody = Math.max(5, 0.4 * scale)
  const lw = Math.max(3, 0.15 * scale)
  const headR = Math.max(3.5, 0.17 * scale)
  const torsoH = hipY - shoulderY + 2

  // ground shadow
  ctx.fillStyle = 'rgba(0,0,0,0.26)'
  ctx.beginPath(); ctx.ellipse(cx, feet.sy + 1, wBody * 0.95, wBody * 0.32, 0, 0, Math.PI * 2); ctx.fill()

  ctx.lineCap = 'round'
  // --- legs: team-colour socks down each shin, a white sock band, then boots ---
  const swing = running ? Math.sin(ph) * 0.28 * scale : wBody * 0.4
  const lift = running ? Math.max(0, Math.cos(ph)) * 0.15 * scale : 0
  const footLx = cx - swing, footLy = footY - lift
  const footRx = cx + swing, footRy = footY
  ctx.strokeStyle = kit.sock; ctx.lineWidth = lw
  ctx.beginPath(); ctx.moveTo(cx, hipY); ctx.lineTo(footLx, footLy); ctx.stroke()
  ctx.beginPath(); ctx.moveTo(cx, hipY); ctx.lineTo(footRx, footRy); ctx.stroke()
  ctx.strokeStyle = kit.sockBand; ctx.lineWidth = lw * 0.95
  ctx.beginPath(); ctx.moveTo(cx + (footLx - cx) * 0.42, hipY + (footLy - hipY) * 0.46); ctx.lineTo(cx + (footLx - cx) * 0.56, hipY + (footLy - hipY) * 0.6); ctx.stroke()
  ctx.beginPath(); ctx.moveTo(cx + (footRx - cx) * 0.42, hipY + (footRy - hipY) * 0.46); ctx.lineTo(cx + (footRx - cx) * 0.56, hipY + (footRy - hipY) * 0.6); ctx.stroke()
  ctx.fillStyle = kit.boot
  ctx.beginPath(); ctx.ellipse(footRx, footRy, lw * 0.8, lw * 0.45, 0, 0, Math.PI * 2); ctx.fill()
  ctx.beginPath(); ctx.ellipse(footLx, footLy, lw * 0.8, lw * 0.45, 0, 0, Math.PI * 2); ctx.fill()

  // --- shorts: a rounded band across the hips with a darker side panel ---
  const shortsH = Math.max(3, torsoH * 0.32)
  ctx.fillStyle = kit.shorts; roundRect(ctx, cx - wBody / 2, hipY - shortsH * 0.55, wBody, shortsH, Math.max(2, wBody * 0.18)); ctx.fill()
  ctx.fillStyle = kit.shortsDark; ctx.fillRect(cx + wBody * 0.14, hipY - shortsH * 0.55, wBody * 0.36, shortsH)

  // --- torso jersey (flat team colour) with side shade + light edge ---
  ctx.fillStyle = kit.jersey; roundRect(ctx, cx - wBody / 2, shoulderY, wBody, torsoH, Math.max(2, wBody * 0.3)); ctx.fill()
  ctx.fillStyle = kit.jerseyDark; ctx.fillRect(cx + wBody * 0.16, shoulderY + 2, wBody * 0.34, torsoH - 2)
  ctx.fillStyle = kit.jerseyHi; ctx.fillRect(cx - wBody * 0.4, shoulderY + torsoH * 0.12, wBody * 0.12, torsoH * 0.6)

  // --- arms swing opposite the legs; short jersey sleeves over the shoulders ---
  const armW = Math.max(2, 0.1 * scale)
  const armSwing = running ? Math.sin(ph + Math.PI) * 0.18 * scale : 0
  const handY = hasBall ? shoulderY + torsoH * 0.55 : shoulderY + wBody * 0.85
  const handReach = hasBall ? wBody * 0.2 : wBody * 0.62
  ctx.strokeStyle = kit.skin; ctx.lineWidth = armW
  ctx.beginPath(); ctx.moveTo(cx - wBody * 0.5, shoulderY + 2); ctx.lineTo(cx - handReach - armSwing, handY); ctx.stroke()
  ctx.beginPath(); ctx.moveTo(cx + wBody * 0.5, shoulderY + 2); ctx.lineTo(cx + handReach + armSwing, handY); ctx.stroke()
  ctx.strokeStyle = kit.jerseyDark; ctx.lineWidth = armW * 1.5
  ctx.beginPath(); ctx.moveTo(cx - wBody * 0.5, shoulderY + 3); ctx.lineTo(cx - wBody * 0.66, shoulderY + wBody * 0.34); ctx.stroke()
  ctx.beginPath(); ctx.moveTo(cx + wBody * 0.5, shoulderY + 3); ctx.lineTo(cx + wBody * 0.66, shoulderY + wBody * 0.34); ctx.stroke()

  // --- collar + shirt number ---
  ctx.fillStyle = kit.collar; ctx.fillRect(cx - wBody * 0.2, shoulderY, wBody * 0.4, Math.max(1.5, torsoH * 0.1))
  if (wBody > 9 && !hasBall) {
    ctx.fillStyle = kit.number
    ctx.font = `800 ${Math.round(wBody * 0.5)}px Plus Jakarta Sans, sans-serif`
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
    ctx.fillText(String(kit.num), cx, shoulderY + torsoH * 0.52)
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic'
  }

  if (hasBall) drawBall(ctx, cx, handY + wBody * 0.1, Math.max(4, BALL_R * scale * 0.9), now / 200, 0)

  // --- head, skin tone + seed-driven hair ---
  ctx.fillStyle = kit.skin; ctx.beginPath(); ctx.arc(cx, headY, headR, 0, Math.PI * 2); ctx.fill()
  drawHair(ctx, cx, headY, headR, kit.hairStyle, kit.hair)
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

// Live candidate pass line on the lane during the try-for-yourself sandbox.
function drawPreviewLane(ctx: CanvasRenderingContext2D, atS: AtSFn, p: Play, vb: number, td: number, now: number) {
  const cr = crossing(vb, td, p)
  const reach = cr ? Math.min(cr.s, POS_MAX) : POS_MAX
  const inZone = !!cr && Math.abs(cr.s - p.target) <= ZONE_HALF
  const color = inZone ? '#3ef08a' : '#ff8fcf'
  const N = 40
  ctx.lineCap = 'round'
  const trace = () => {
    ctx.beginPath()
    for (let i = 0; i <= N; i++) { const s = (i / N) * reach; const pt = atS(p, s, BALL_R); if (i === 0) ctx.moveTo(pt.sx, pt.sy); else ctx.lineTo(pt.sx, pt.sy) }
  }
  ctx.strokeStyle = inZone ? 'rgba(62,240,138,0.25)' : 'rgba(255,143,207,0.22)'; ctx.lineWidth = 11; trace(); ctx.stroke()
  ctx.strokeStyle = color; ctx.lineWidth = 4; trace(); ctx.stroke()
  for (let i = 2; i < N; i += 5) { const pt = atS(p, (i / N) * reach, BALL_R); ctx.fillStyle = color; ctx.beginPath(); ctx.arc(pt.sx, pt.sy, 2.6, 0, Math.PI * 2); ctx.fill() }
  if (cr) {
    const ep = atS(p, reach, BALL_R)
    const pulse = 1 + Math.sin(now / 180) * 0.18
    ctx.strokeStyle = color; ctx.lineWidth = 3
    ctx.beginPath(); ctx.arc(ep.sx, ep.sy, 9 * pulse, 0, Math.PI * 2); ctx.stroke()
    ctx.fillStyle = color; ctx.beginPath(); ctx.arc(ep.sx, ep.sy, 4, 0, Math.PI * 2); ctx.fill()
    if (inZone) {
      ctx.textAlign = 'center'
      ctx.fillStyle = '#0b3a22'; ctx.font = '800 24px "Baloo 2", "Plus Jakarta Sans", sans-serif'; ctx.fillText('THREADED!', ep.sx + 1, ep.sy - 19)
      ctx.fillStyle = '#5dffa6'; ctx.fillText('THREADED!', ep.sx, ep.sy - 20)
      ctx.textAlign = 'left'
    }
  }
  ctx.lineCap = 'butt'
}

function drawMeter(ctx: CanvasRenderingContext2D, t: number, label: string, color: string) {
  const bw = 380, bx = W / 2 - bw / 2, by = 20, bh = 26
  ctx.fillStyle = 'rgba(8,12,28,0.86)'; roundRect(ctx, bx - 14, by - 14, bw + 28, bh + 64, 14); ctx.fill()
  const grad = ctx.createLinearGradient(bx, 0, bx + bw, 0)
  grad.addColorStop(0, '#3fb67a'); grad.addColorStop(0.5, color); grad.addColorStop(1, '#ff5c7a')
  ctx.fillStyle = 'rgba(255,255,255,0.08)'; roundRect(ctx, bx, by, bw, bh, 8); ctx.fill()
  ctx.fillStyle = grad; roundRect(ctx, bx, by, bw * t, bh, 8); ctx.fill()
  const mx = bx + bw * t
  ctx.fillStyle = '#fff'; roundRect(ctx, mx - 3, by - 6, 6, bh + 12, 3); ctx.fill()
  ctx.beginPath(); ctx.moveTo(mx - 7, by - 6); ctx.lineTo(mx + 7, by - 6); ctx.lineTo(mx, by + 2); ctx.closePath(); ctx.fill()
  ctx.font = '800 10px Plus Jakarta Sans, sans-serif'
  ctx.textAlign = 'left'; ctx.fillStyle = '#7ef0a0'; ctx.fillText('SLOW', bx + 2, by + bh + 14)
  ctx.textAlign = 'right'; ctx.fillStyle = '#ff8aa0'; ctx.fillText('FAST', bx + bw - 2, by + bh + 14)
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

function drawTopLabel(ctx: CanvasRenderingContext2D, title: string, sub: string) {
  ctx.fillStyle = 'rgba(8,12,28,0.82)'; roundRect(ctx, W / 2 - 200, 12, 400, 50, 14); ctx.fill()
  ctx.textAlign = 'center'
  ctx.fillStyle = '#ffe14d'; ctx.font = '800 18px Plus Jakarta Sans, sans-serif'; ctx.fillText(title, W / 2, 33)
  ctx.fillStyle = '#cfd6ea'; ctx.font = '600 11px Inter, sans-serif'; ctx.fillText(sub, W / 2, 51)
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
