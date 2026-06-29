import { useCallback, useEffect, useRef, useState } from 'react'
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

// ---- Gameplay tuning ----
const RUN_SPEED = 3.0
const CLOSE_SPEED = 6.6
const LANE_SPEED = 5.2
const GOALIE_DIST = 6.5
const TOTAL_DEFENDERS = 3
const SPAWN_MS = 1500
const START_DIST = 34
const SOLVE_MS = 120000 // 2 minutes to work out the shot
const TARGET_R = 0.55 // m — land inside this circle (in the goal plane) to score

type P2 = { sx: number; sy: number; scale: number }
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v))
const parseNum = (s: string): number => { const v = parseFloat(s); return Number.isFinite(v) ? v : 0 }

// One valid (angle, force) pair that lands the ball at height h after distance d.
// Used to show a recommended answer in the inputs while testing.
function recommendShot(d: number, h: number): { angle: number; force: number } {
  const h0 = RELEASE.y
  const alpha = Math.atan2(h - h0, d)
  const theta = alpha + (8 * Math.PI) / 180 // a little loft so it arcs onto the spot
  const denom = Math.cos(theta) ** 2 * (d * Math.tan(theta) - (h - h0))
  const v = denom > 0 ? Math.sqrt((G * d * d) / (2 * denom)) : 25
  return { angle: clamp((theta * 180) / Math.PI, 1, 85), force: clamp(v, 1, 45) }
}

type Phase = 'run' | 'aim' | 'solve' | 'fly' | 'result'
type Defender = { z: number; x: number; ph: number }
type Ball = { x: number; y: number; z: number; vx: number; vy: number; vz: number; spin: number; squash: number }
type Result = { kind: 'goal' | 'save' | 'miss'; text: string }
type Review = { angle: number; force: number; d: number; h: number; vx: number; vy: number; t: number; y: number; dist: number; kind: 'goal' | 'save' | 'miss' }

type Game = {
  phase: Phase
  distToGoal: number
  playerX: number
  defenders: Defender[]
  spawned: number
  beaten: number
  canShoot: boolean
  nextSpawnAt: number
  keys: { left: boolean; right: boolean }
  aimStart: number
  shotDist: number
  cross: { x: number; y: number }
  target: { x: number; h: number } | null
  shotD: number
  solveStart: number
  aimX: number
  ball: Ball | null
  trail: { x: number; y: number; z: number }[]
  force: number
  launchAngle: number
  goalZ: number
  resolved: boolean
  caught: boolean
  pending: { res: Result; review: Review } | null
  holdUntil: number
  dive: { dir: number; t: number; x: number; y: number; z: number } | null
  netShake: number
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
  phase: 'run', distToGoal: dist, playerX: 0, defenders: [], spawned: 0, beaten: 0,
  canShoot: false, nextSpawnAt: 0, keys: { left: false, right: false },
  aimStart: 0, shotDist: dist, cross: { x: 0, y: 1.2 }, target: null, shotD: dist - RELEASE.z,
  solveStart: 0, aimX: 0, ball: null, trail: [], force: 22, launchAngle: 18, goalZ: dist, resolved: false,
  caught: false, pending: null, holdUntil: 0, dive: null, netShake: 0,
})

// ARCHIVED PROTOTYPE — the original first-person free-dribble-and-shoot game (commit
// 2d59787, "Build physics MVP with first-person soccer free-kick game"). Restored
// verbatim and made standalone so it can be played from the #soccer-classic dev route.
// You dribble in with Arrow / A-D keys, beat the spawned defenders, then Space to enter
// aim → solve the (angle, force) and shoot. Not wired into the live lesson flow.
type ClassicProps = {
  state?: Record<string, unknown>
  onChange?: (next: Record<string, unknown>) => void
  showGoal?: boolean
  onGoal?: () => void
}

export function SoccerSimClassic({ state = {}, onChange = () => {}, showGoal, onGoal }: ClassicProps = {}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [phase, setPhase] = useState<Phase>('run')
  const [message, setMessage] = useState<Result | null>(null)
  const [review, setReview] = useState<Review | null>(null)
  const [shotInfo, setShotInfo] = useState<{ d: number; h: number; x: number } | null>(null)
  const [goals, setGoals] = useState(0)
  const [ready, setReady] = useState(false)
  const [sound, setSound] = useState(true)
  const [showCalc, setShowCalc] = useState(false)
  const [record, setRecord] = useState(0)
  const recordRef = useRef(0); recordRef.current = record
  // Typed inputs (no sliders — you must work out and enter the numbers)
  const [angleStr, setAngleStr] = useState('')
  const [forceStr, setForceStr] = useState('')
  const angle = parseNum(angleStr)
  const force = parseNum(forceStr)

  const sfx = useRef<Sfx>(new Sfx())
  const soundRef = useRef(sound); soundRef.current = sound
  const gameRef = useRef<Game>(newGame(START_DIST))
  const rafRef = useRef<number | null>(null)
  const timeoutRef = useRef<number | null>(null)

  const sceneRef = useRef({ onChange, state, showGoal })
  sceneRef.current = { onChange, state, showGoal }
  const onGoalRef = useRef(onGoal); onGoalRef.current = onGoal
  const goalSignaledRef = useRef(false)
  const inputsRef = useRef({ angle, force })
  inputsRef.current = { angle, force }
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
      gameRef.current = newGame(START_DIST)
      gameRef.current.nextSpawnAt = performance.now() + 600
      setPhase('run'); setMessage(null); setShotInfo(null); setReady(false); setReview(null)
    }, ms)
  }, [])

  const fail = useCallback((text: string) => {
    const g = gameRef.current
    if (g.phase === 'result') return
    g.phase = 'result'; g.resolved = true
    if (soundRef.current) sfx.current.steal()
    setMessage({ kind: 'miss', text }); setPhase('result')
    scheduleReset(1900)
  }, [scheduleReset])

  const finishShot = useCallback((res: Result) => {
    const g = gameRef.current
    if (g.resolved) return
    g.resolved = true; g.phase = 'result'
    if (res.kind === 'goal') {
      g.netShake = 14
      if (soundRef.current) { sfx.current.net(); sfx.current.cheer() }
      const s = sceneRef.current
      const next = (Number(s.state.goals) || 0) + 1
      s.onChange({ ...s.state, power: inputsRef.current.force, angle: inputsRef.current.angle, goals: next })
      setGoals((p) => p + 1)
      // First-run challenge: signal the lesson to move on after the celebration.
      if (s.showGoal && onGoalRef.current && !goalSignaledRef.current) {
        goalSignaledRef.current = true
        onGoalRef.current()
      }
    } else if (soundRef.current) sfx.current.save()
    setMessage(res); setPhase('result')
    scheduleReset(res.kind === 'goal' ? 2400 : 2000)
  }, [scheduleReset])

  const enterAim = useCallback(() => {
    const g = gameRef.current
    if (g.phase !== 'run' || !g.canShoot) return
    if (soundRef.current) sfx.current.ensure()
    g.phase = 'aim'; g.aimStart = performance.now(); g.shotDist = g.distToGoal
    g.cross = { x: g.playerX, y: 1.3 }
    setPhase('aim')
  }, [])

  const lockTarget = useCallback(() => {
    const g = gameRef.current
    if (g.phase !== 'aim') return
    g.target = { x: g.cross.x, h: g.cross.y }
    g.aimX = g.cross.x
    g.shotD = g.shotDist - RELEASE.z
    g.goalZ = g.shotDist
    g.phase = 'solve'; g.solveStart = performance.now()
    setShotInfo({ d: g.shotD, h: g.cross.y, x: g.cross.x })
    setAngleStr(''); setForceStr('') // force a fresh, typed answer
    setPhase('solve')
  }, [])

  const shoot = useCallback(() => {
    const g = gameRef.current
    if (g.phase !== 'solve' || !g.target) return
    const angleVal = clamp(inputsRef.current.angle, 1, 85)
    const f = clamp(inputsRef.current.force, 1, 45)
    const a = (angleVal * Math.PI) / 180
    const vForward = f * Math.cos(a)
    const vUp = f * Math.sin(a)
    const tCross = vForward > 0.1 ? g.shotD / vForward : 999
    const vLat = (g.target.x - g.playerX) / tCross // auto-aimed at your chosen spot
    g.ball = { x: g.playerX, y: RELEASE.y, z: RELEASE.z, vx: vLat, vy: vUp, vz: vForward, spin: 0, squash: 0 }
    g.trail = []
    g.force = f; g.launchAngle = angleVal; g.resolved = false; g.phase = 'fly'; g.dive = null
    if (soundRef.current) { sfx.current.ensure(); sfx.current.kick() }
    setPhase('fly')
  }, [])

  // keep latest action closures for the loop
  const actions = { enterAim, lockTarget, shoot, fail, finishShot }
  const actionsRef = useRef(actions)
  actionsRef.current = actions

  // ===== Input =====
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      const g = gameRef.current
      const typing = (e.target as HTMLElement)?.tagName === 'INPUT'
      if (e.key === 'ArrowLeft' || e.key === 'a') g.keys.left = true
      if (e.key === 'ArrowRight' || e.key === 'd') g.keys.right = true
      if ((e.key === ' ' || e.code === 'Space') && !typing) {
        e.preventDefault()
        if (g.phase === 'run') actionsRef.current.enterAim()
        else if (g.phase === 'solve') actionsRef.current.shoot()
      }
    }
    const up = (e: KeyboardEvent) => {
      const g = gameRef.current
      if (e.key === 'ArrowLeft' || e.key === 'a') g.keys.left = false
      if (e.key === 'ArrowRight' || e.key === 'd') g.keys.right = false
    }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up) }
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
    if (gameRef.current.phase === 'aim') { e.preventDefault(); lockTarget() }
  }

  // ===== Draw =====
  const draw = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const g = gameRef.current
    const now = performance.now()
    const goalZ = g.phase === 'fly' || g.phase === 'result' ? g.goalZ : g.distToGoal

    ctx.clearRect(0, 0, W, H)
    ctx.save()
    if (g.netShake > 0.4) ctx.translate((Math.random() - 0.5) * g.netShake, (Math.random() - 0.5) * g.netShake)
    // first-person head-bob while running
    if (g.phase === 'run') {
      const moving = g.keys.left || g.keys.right
      ctx.translate(Math.sin(now / 130) * (moving ? 4 : 2), Math.abs(Math.sin(now / 160)) * 4)
    }

    // ---- Sky / stadium ----
    const sky = ctx.createLinearGradient(0, 0, 0, HORIZON)
    sky.addColorStop(0, '#0a1430'); sky.addColorStop(1, '#1d2b54')
    ctx.fillStyle = sky; ctx.fillRect(-30, -30, W + 60, HORIZON + 30)
    ctx.fillStyle = 'rgba(20,28,60,0.9)'; ctx.fillRect(-30, HORIZON - 54, W + 60, 54)
    for (let r = 0; r < 4; r++) for (let c = 0; c < 72; c++) {
      ctx.fillStyle = `rgba(${150 + (c * 7) % 90},${150 + (r * 30) % 80},${190},0.3)`
      ctx.fillRect(4 + c * 12.6, HORIZON - 50 + r * 12, 8, 7)
    }
    for (const lx of [0.16, 0.84]) {
      const gl = ctx.createRadialGradient(W * lx, 18, 4, W * lx, 18, 70)
      gl.addColorStop(0, 'rgba(255,255,235,0.55)'); gl.addColorStop(1, 'rgba(255,255,235,0)')
      ctx.fillStyle = gl; ctx.fillRect(W * lx - 70, -10, 140, 110)
    }

    // ---- Pitch ----
    const grass = ctx.createLinearGradient(0, HORIZON, 0, H)
    grass.addColorStop(0, '#1f7a37'); grass.addColorStop(1, '#2fa64e')
    ctx.fillStyle = grass; ctx.fillRect(-30, HORIZON, W + 60, H - HORIZON + 30)
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
    drawGoal(ctx, rel, goalZ, g.netShake)

    // ---- Keeper ----
    drawKeeper(ctx, rel, goalZ - 0.2, g.dive, now)

    // ---- Defenders (sorted far→near, with a running cycle) ----
    const defs = [...g.defenders].sort((a, b) => b.z - a.z)
    for (const d of defs) drawRunner(ctx, rel, d.x, d.z, now / 90 + d.ph)

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
    if (g.target && (g.phase === 'solve' || g.phase === 'fly' || g.phase === 'result')) {
      const tp = rel(g.target.x, g.target.h, g.goalZ)
      const gp = rel(g.target.x, 0, g.goalZ)
      const rad = Math.max(10, TARGET_R * tp.scale)
      const pulse = 1 + Math.sin(now / 220) * 0.12
      // dashed height line from the ground up to the circle
      ctx.setLineDash([4, 5]); ctx.strokeStyle = 'rgba(255,225,77,0.6)'; ctx.lineWidth = 1.5
      ctx.beginPath(); ctx.moveTo(gp.sx, gp.sy); ctx.lineTo(tp.sx, tp.sy); ctx.stroke(); ctx.setLineDash([])
      // glowing pulsing scoring ring
      ctx.save(); ctx.shadowColor = '#ffe14d'; ctx.shadowBlur = 20 + Math.sin(now / 220) * 10
      ctx.fillStyle = 'rgba(255,225,77,0.16)'; ctx.beginPath(); ctx.arc(tp.sx, tp.sy, rad * pulse, 0, Math.PI * 2); ctx.fill()
      ctx.strokeStyle = 'rgba(255,225,77,0.98)'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(tp.sx, tp.sy, rad * pulse, 0, Math.PI * 2); ctx.stroke()
      ctx.restore()
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
    // ---- Ball trail ----
    for (let i = 0; i < g.trail.length; i++) {
      const tp = g.trail[i]; const p = rel(tp.x, tp.y, tp.z)
      ctx.fillStyle = `rgba(255,255,255,${(i / g.trail.length) * 0.3})`
      ctx.beginPath(); ctx.arc(p.sx, p.sy, Math.max(1.5, BALL_R * p.scale * 0.6), 0, Math.PI * 2); ctx.fill()
    }

    // ---- Ball ----
    if (g.ball) {
      // World-space ball in flight / held by the keeper.
      const bx = g.ball.x, by = g.ball.y, bz = g.ball.z
      const shadow = rel(bx, 0.01, bz)
      ctx.fillStyle = 'rgba(0,0,0,0.28)'
      ctx.beginPath(); ctx.ellipse(shadow.sx, shadow.sy, BALL_R * shadow.scale * 1.2, BALL_R * shadow.scale * 0.45, 0, 0, Math.PI * 2); ctx.fill()
      const bp = rel(bx, by, bz)
      const br = Math.max(4, BALL_R * bp.scale)
      drawBall(ctx, bp.sx, bp.sy, br, g.ball.spin, g.ball.squash)
    } else {
      // First-person dribble ball drawn in screen space so it's always visible,
      // low and centred like a real viewmodel. Bounces, rolls and sways.
      const dribble = g.phase === 'run'
      const beat = Math.abs(Math.sin(now / 150)) // 0 = touch on the turf, 1 = top of bounce
      const groundY = H - 36
      const vr = 40
      const cxs = W / 2 + (dribble ? Math.sin(now / 125) * 30 : 0)
      const cys = groundY - (dribble ? beat * 78 : 6)
      // contact shadow shrinks as the ball lifts
      const sw = 1.15 - (dribble ? beat * 0.45 : 0)
      ctx.fillStyle = `rgba(0,0,0,${0.32 - (dribble ? beat * 0.16 : 0)})`
      ctx.beginPath(); ctx.ellipse(cxs, groundY + 8, vr * sw, vr * 0.34 * sw, 0, 0, Math.PI * 2); ctx.fill()
      const squash = dribble ? Math.max(0, (1 - beat) * 0.22) : 0
      const spin = dribble ? now / 65 : now / 400
      drawBall(ctx, cxs, cys, vr, spin, squash)
    }

    // ---- Vignette ----
    const vg = ctx.createRadialGradient(W / 2, H / 2, H * 0.32, W / 2, H / 2, H * 0.8)
    vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,0.42)')
    ctx.fillStyle = vg; ctx.fillRect(-30, -30, W + 60, H + 60)

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
    if (g.phase === 'run') {
      ctx.fillStyle = 'rgba(8,12,28,0.8)'; roundRect(ctx, 12, 60, 230, 64, 12); ctx.fill()
      ctx.fillStyle = '#fff'; ctx.font = '700 14px Plus Jakarta Sans, sans-serif'
      ctx.fillText(`Distance to goal: ${g.distToGoal.toFixed(0)} m`, 24, 84)
      ctx.fillStyle = g.canShoot ? '#7ef0a0' : '#ffd166'; ctx.font = '600 12px Inter, sans-serif'
      ctx.fillText(g.canShoot ? 'Path clear — press SPACE to shoot!' : `Defenders to beat: ${TOTAL_DEFENDERS - g.beaten}`, 24, 106)
      ctx.fillStyle = 'rgba(255,255,255,0.6)'; ctx.font = '600 11px Inter, sans-serif'
      ctx.fillText('← →  dodge', 24, 121)
    }
    if (g.phase === 'aim') {
      const left = Math.max(0, 5 - (now - g.aimStart) / 1000)
      drawTimer(ctx, left, 5, 'PICK YOUR SPOT — click the goal', left < 2 ? '#ff6b6b' : '#ffe14d')
    }
    if (g.phase === 'solve') {
      const left = Math.max(0, SOLVE_MS / 1000 - (now - g.solveStart) / 1000)
      drawTimer(ctx, left, SOLVE_MS / 1000, 'TYPE ANGLE + FORCE — press SPACE to strike', left < 20 ? '#ff6b6b' : '#7ec8ff')
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
    gameRef.current.nextSpawnAt = performance.now() + 700
    let last = performance.now()

    const update = (now: number, dt: number) => {
      const g = gameRef.current
      const act = actionsRef.current

      if (g.phase === 'run') {
        if (g.keys.left) g.playerX -= LANE_SPEED * dt
        if (g.keys.right) g.playerX += LANE_SPEED * dt
        g.playerX = clamp(g.playerX, -GOAL_W_HALF - 1, GOAL_W_HALF + 1)
        g.distToGoal -= RUN_SPEED * dt

        if (g.spawned < TOTAL_DEFENDERS && now >= g.nextSpawnAt) {
          g.defenders.push({ z: Math.min(g.distToGoal - 3, 15), x: (Math.random() * 2 - 1) * 3, ph: Math.random() * 6.28 })
          g.spawned++; g.nextSpawnAt = now + SPAWN_MS
        }
        for (const d of g.defenders) {
          d.z -= CLOSE_SPEED * dt
          d.x += clamp(g.playerX - d.x, -1, 1) * 0.7 * dt // mild homing
        }
        const survivors: Defender[] = []
        for (const d of g.defenders) {
          if (d.z <= 0.9) {
            if (Math.abs(d.x - g.playerX) < 0.95) { act.fail('Tackled! The defender stripped the ball. Dodge with ← →.'); return }
            g.beaten++
          } else survivors.push(d)
        }
        g.defenders = survivors
        if (g.beaten >= TOTAL_DEFENDERS && !g.canShoot) { g.canShoot = true; setReady(true) }
        if (g.distToGoal <= GOALIE_DIST) { act.fail('The keeper rushed out and smothered the ball — shoot sooner next time!'); return }
      }

      if (g.phase === 'aim' && now - g.aimStart >= 5000) act.lockTarget()
      if (g.phase === 'solve' && now - g.solveStart >= SOLVE_MS) act.shoot()

      if (g.phase === 'fly' && g.ball && !g.caught) {
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
          // ground before the goal → keeper rushes out and smothers it (a save)
          if (g.ball.y - BALL_R <= 0 && g.ball.z < g.goalZ - 0.2) {
            const x = g.ball.x, zland = g.ball.z
            const dist = Math.hypot(x - tx, th)
            g.dive = { dir: x >= 0 ? 1 : -1, t: 0, x, y: 0.28, z: zland }
            g.caught = true
            g.ball.y = BALL_R; g.ball.vx = g.ball.vy = g.ball.vz = 0; g.ball.squash = 0.5
            g.pending = { res: { kind: 'save', text: 'The keeper read it early, rushed off his line and smothered the ball before it reached the goal — give it more pace.' }, review: { angle: g.launchAngle, force: g.force, d: g.shotD, h: th, vx, vy: vy0, t, y: 0, dist, kind: 'save' } }
            if (soundRef.current) sfx.current.save()
            break
          }
          // crossing the goal plane
          if (pz < g.goalZ && g.ball.z >= g.goalZ) {
            const y = g.ball.y, x = g.ball.x
            const inFrame = y > 0.05 && y < CROSSBAR && Math.abs(x) < GOAL_W_HALF - 0.05
            const dist = Math.hypot(x - tx, y - th)
            const review: Review = { angle: g.launchAngle, force: g.force, d: g.shotD, h: th, vx, vy: vy0, t, y, dist, kind: 'goal' }
            if (!inFrame) {
              review.kind = 'miss'
              setReview(review)
              act.finishShot({ kind: 'miss', text: y >= CROSSBAR ? 'Over the bar! Too much height — flatten the angle or ease the force.' : 'Outside the goal — off the frame entirely.' })
            } else if (dist <= TARGET_R) {
              review.kind = 'goal'
              setReview(review)
              act.finishShot({ kind: 'goal', text: 'Buried it in your spot — clean strike!' })
            } else {
              // On target but off the ring → the keeper saves it. Stop the ball at
              // the save point and let the dive finish before the popup shows.
              review.kind = 'save'
              const hy = Math.max(0.25, Math.min(CROSSBAR - 0.1, y))
              g.dive = { dir: x >= 0 ? 1 : -1, t: 0, x, y: hy, z: g.goalZ }
              g.caught = true
              g.ball.x = x; g.ball.y = hy; g.ball.z = g.goalZ - 0.06
              g.ball.vx = g.ball.vy = g.ball.vz = 0; g.ball.squash = 0
              g.pending = { res: { kind: 'save', text: `On target, but ${dist.toFixed(2)} m off your ring — the keeper got across and palmed it away. Tune θ and v to land it in the glowing ring.` }, review }
              if (soundRef.current) sfx.current.save()
            }
            break
          }
          g.trail.push({ x: g.ball.x, y: g.ball.y, z: g.ball.z })
          if (g.trail.length > 18) g.trail.shift()
        }
        if (g.ball.squash > 0) g.ball.squash *= 0.86
        if (g.ball.y - BALL_R <= 0 && g.ball.vy < 0) { g.ball.y = BALL_R; g.ball.vy *= -0.4; g.ball.vz *= 0.6; g.ball.squash = 0.5 }
      }

      // keeper dive animation
      if (g.dive) g.dive.t = Math.min(1, g.dive.t + dt * 2.2)
      // once the keeper's dive has fully played out, reveal the save popup
      if (g.pending && g.dive && g.dive.t >= 1) {
        if (g.holdUntil === 0) g.holdUntil = now + 420
        else if (now >= g.holdUntil) { const p = g.pending; g.pending = null; g.holdUntil = 0; setReview(p.review); act.finishShot(p.res) }
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

  const rec = shotInfo ? recommendShot(shotInfo.d, shotInfo.h) : null

  return (
    <div className="sim soccer">
      <div className="soccer__stage">
        <canvas
          ref={canvasRef}
          width={W}
          height={H}
          className={`soccer__canvas soccer__canvas--${phase}`}
          onPointerMove={onPointerMove}
          onPointerDown={onPointerDown}
        />
        {showGoal && <div className="soccer__hud"><span className="soccer__target">⚽ Goals {goals} / 1</span></div>}
        <button type="button" className="bball__sound" onClick={toggleSound} aria-label="Toggle sound">{sound ? '🔊' : '🔈'}</button>
        {message && (
          <div className={`soccer__banner soccer__banner--${message.kind}`}>
            <strong>{message.kind === 'goal' ? '🥅 GOAL!' : message.kind === 'save' ? '🧤 Saved' : '❌ Miss'}</strong>
            <span>{message.text}</span>
          </div>
        )}
        {phase === 'run' && (
          <div className="soccer__prompt">
            <strong>Dribble in</strong> — use <kbd>←</kbd> <kbd>→</kbd> to dodge defenders. Beat all {TOTAL_DEFENDERS}, then press <kbd>Space</kbd> to shoot before the keeper closes you down.
          </div>
        )}
        {phase === 'aim' && (
          <div className="soccer__prompt">
            <strong>5 seconds:</strong> move the mouse and <strong>click the spot</strong> in the goal you want to hit. That becomes your glowing target ring.
          </div>
        )}
        {phase === 'solve' && showCalc && <Calculator onClose={() => setShowCalc(false)} />}
      </div>

      {phase === 'solve' && shotInfo && (
        <>
          <div className="soccer__givens">
            <div className="is-key"><span>📏 Distance</span><strong>d = {shotInfo.d.toFixed(1)} m</strong></div>
            <div className="is-key"><span>📐 Height</span><strong>h = {shotInfo.h.toFixed(2)} m</strong></div>
            <div><span>Release height</span><strong>h₀ = {RELEASE.y.toFixed(2)} m</strong></div>
            <div><span>Gravity</span><strong>g = 9.8 m/s²</strong></div>
          </div>
          <div className="soccer__method">
            <div className="soccer__method-head">
              <span>Solve for θ and v, then type them in</span>
              <button type="button" className="soccer__calc-toggle" onClick={() => setShowCalc((v) => !v)}>🧮 {showCalc ? 'Hide' : 'Calc'}</button>
            </div>
            <div className="bball__steps">
              <code>vₓ = v · cosθ&nbsp;&nbsp;&nbsp;v_y = v · sinθ</code>
              <code>t = d / vₓ = {shotInfo.d.toFixed(1)} / vₓ</code>
              <code>y = h₀ + v_y·t − ½·g·t²&nbsp;&nbsp;⟶ make y = h = {shotInfo.h.toFixed(2)} m</code>
            </div>
            <div className="soccer__inputs">
              <label className="soccer__field">
                <span>Launch angle θ (°)</span>
                <input type="text" inputMode="decimal" value={angleStr} placeholder={rec ? rec.angle.toFixed(1) : 'e.g. 14'} onChange={(e) => setAngleStr(e.target.value)} />
              </label>
              <label className="soccer__field">
                <span>Strike force v (m/s)</span>
                <input type="text" inputMode="decimal" value={forceStr} placeholder={rec ? rec.force.toFixed(1) : 'e.g. 24'} onChange={(e) => setForceStr(e.target.value)} />
              </label>
            </div>
          </div>
        </>
      )}

      {phase === 'result' && review && (
        <div className={`soccer__review soccer__review--${review.kind}`}>
          <div className="soccer__review-head">How your numbers played out</div>
          <div className="bball__steps">
            <code>You entered:&nbsp; θ = {review.angle.toFixed(1)}°,&nbsp; v = {review.force.toFixed(1)} m/s&nbsp; (d = {review.d.toFixed(1)} m, your spot h = {review.h.toFixed(2)} m)</code>
            <code>vₓ = v·cosθ = {review.vx.toFixed(2)} m/s&nbsp;&nbsp;&nbsp;v_y = v·sinθ = {review.vy.toFixed(2)} m/s</code>
            <code>t = d / vₓ = {review.t > 50 ? '—' : review.t.toFixed(2)} s&nbsp;&nbsp;&nbsp;⟶&nbsp; y = h₀ + v_y·t − ½g·t² = {review.y.toFixed(2)} m</code>
            <code className="bball__compare">{review.kind === 'goal' ? 'Landed inside your ring — goal!' : review.kind === 'save' ? `${review.dist.toFixed(2)} m off your ring — the keeper reached it. Get y closer to h.` : 'Off the goal frame entirely — rework the numbers.'}</code>
          </div>
        </div>
      )}

      {phase === 'solve' && (
        <p className="bball__tip">🎯 Solve θ and v so the ball lands in the glowing ring.</p>
      )}

      <div className="sim__controls">
        <div className="bball__buttons">
          {phase === 'run' && <button type="button" className="btn btn--primary" onClick={enterAim} disabled={!ready}>{ready ? '⚽ Shoot (Space)' : 'Beat the defenders…'}</button>}
          {phase === 'solve' && <button type="button" className="btn btn--primary" onClick={shoot} disabled={!angleStr || !forceStr}>⚽ Strike!</button>}
          {(phase === 'aim' || phase === 'fly' || phase === 'result') && <button type="button" className="btn btn--primary" disabled>{phase === 'aim' ? 'Pick a spot…' : phase === 'fly' ? 'Ball in flight…' : '…'}</button>}
          <button type="button" className="btn btn--ghost" onClick={() => { if (timeoutRef.current) window.clearTimeout(timeoutRef.current); gameRef.current = newGame(START_DIST); gameRef.current.nextSpawnAt = performance.now() + 400; setPhase('run'); setMessage(null); setShotInfo(null); setReady(false); setReview(null); setAngleStr(''); setForceStr(''); setShowCalc(false); goalSignaledRef.current = false }}>↻ Restart run</button>
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

// A defender running toward the camera, with a leg/arm cycle and body bob.
function drawRunner(ctx: CanvasRenderingContext2D, rel: RelFn, x: number, z: number, phase: number) {
  const feet0 = rel(x, 0, z)
  const head0 = rel(x, 1.78, z)
  const scale = feet0.scale
  const bob = Math.abs(Math.sin(phase)) * 0.05 * scale
  const cx = feet0.sx
  const footY = feet0.sy - bob
  const headY = head0.sy - bob
  const hipY = headY + (footY - headY) * 0.52
  const shoulderY = headY + (footY - headY) * 0.34
  const wBody = Math.max(4, 0.34 * scale)
  const swing = Math.sin(phase) * 0.26 * scale
  const lift = Math.max(0, Math.cos(phase)) * 0.14 * scale
  // legs (alternating)
  ctx.strokeStyle = '#7a0f0f'; ctx.lineWidth = Math.max(3, 0.13 * scale); ctx.lineCap = 'round'
  ctx.beginPath(); ctx.moveTo(cx, hipY); ctx.lineTo(cx + swing, footY); ctx.stroke()
  ctx.beginPath(); ctx.moveTo(cx, hipY); ctx.lineTo(cx - swing, footY - lift); ctx.stroke()
  // torso
  ctx.fillStyle = '#e23b3b'
  roundRect(ctx, cx - wBody / 2, shoulderY, wBody, hipY - shoulderY + 2, Math.max(2, wBody * 0.25)); ctx.fill()
  // arms swing opposite the legs
  ctx.strokeStyle = '#e23b3b'; ctx.lineWidth = Math.max(2, 0.1 * scale)
  ctx.beginPath(); ctx.moveTo(cx - wBody / 2, shoulderY + 2); ctx.lineTo(cx - wBody * 0.55 - swing * 0.6, shoulderY + wBody * 0.7); ctx.stroke()
  ctx.beginPath(); ctx.moveTo(cx + wBody / 2, shoulderY + 2); ctx.lineTo(cx + wBody * 0.55 + swing * 0.6, shoulderY + wBody * 0.7); ctx.stroke()
  // head
  ctx.fillStyle = '#e8b48a'
  ctx.beginPath(); ctx.arc(cx, headY, Math.max(3, 0.16 * scale), 0, Math.PI * 2); ctx.fill()
  ctx.lineCap = 'butt'
}

// The goalkeeper: a ready stance that shuffles, then a dramatic dive on a save.
function drawKeeper(ctx: CanvasRenderingContext2D, rel: RelFn, z: number, dive: { dir: number; t: number; x: number; y: number; z: number } | null, now: number) {
  const baseFeet = rel(0, 0, z)
  const scale = baseFeet.scale
  const wBody = Math.max(5, 0.4 * scale)
  if (dive) {
    // A real dive: the keeper launches off the ground and his whole body (fixed
    // length, not stretched) leaps across and rotates from upright to horizontal,
    // arms reaching out so the gloves land right on the ball.
    const e = 1 - Math.pow(1 - dive.t, 2) // ease-out
    const sp = rel(dive.x, Math.max(0.3, dive.y), dive.z) // the ball / save point (may be off the line)
    const base = rel(0, 0.95, z) // standing chest height
    const L = Math.max(16, wBody * 2.6) // constant torso length
    const lift = Math.sin(Math.PI * Math.min(1, e)) * wBody * 1.5 // leap off the turf
    // body centre travels ~80% of the way (arms cover the rest) along a leap arc
    const cx = base.sx + (sp.sx - base.sx) * e * 0.8
    const cy = base.sy + (sp.sy - base.sy) * e * 0.8 - lift
    // gloves reach the ball exactly
    const gx = base.sx + (sp.sx - base.sx) * e
    const gy = base.sy + (sp.sy - base.sy) * e - lift * 0.4
    // rotate from upright (−90°) to a dive aimed at the ball
    const targetAng = Math.atan2(sp.sy - base.sy, sp.sx - base.sx)
    const ang = -Math.PI / 2 + (targetAng + Math.PI / 2) * e
    const leadX = cx + Math.cos(ang) * L * 0.5, leadY = cy + Math.sin(ang) * L * 0.5
    const tailX = cx - Math.cos(ang) * L * 0.5, tailY = cy - Math.sin(ang) * L * 0.5
    const perp = ang + Math.PI / 2
    ctx.lineCap = 'round'
    // trailing legs kicking up behind
    ctx.strokeStyle = '#15301f'; ctx.lineWidth = Math.max(3, 0.13 * scale)
    ctx.beginPath(); ctx.moveTo(tailX, tailY); ctx.lineTo(tailX - Math.cos(ang) * wBody * 1.3 + Math.cos(perp) * wBody * 0.5, tailY - Math.sin(ang) * wBody * 1.3 + Math.sin(perp) * wBody * 0.5); ctx.stroke()
    ctx.beginPath(); ctx.moveTo(tailX, tailY); ctx.lineTo(tailX - Math.cos(ang) * wBody * 1.5 - Math.cos(perp) * wBody * 0.5, tailY - Math.sin(ang) * wBody * 1.5 - Math.sin(perp) * wBody * 0.5); ctx.stroke()
    // torso (constant length capsule)
    ctx.save(); ctx.translate(cx, cy); ctx.rotate(ang)
    ctx.fillStyle = '#ffd23f'; roundRect(ctx, -L / 2, -wBody * 0.55, L, wBody * 1.1, wBody * 0.5); ctx.fill()
    ctx.restore()
    // head at the leading end
    ctx.fillStyle = '#e8b48a'; ctx.beginPath(); ctx.arc(leadX, leadY, Math.max(3, 0.17 * scale), 0, Math.PI * 2); ctx.fill()
    // both arms reaching from the chest to the gloves
    ctx.strokeStyle = '#ffd23f'; ctx.lineWidth = Math.max(3, 0.12 * scale)
    const shx = cx + Math.cos(ang) * L * 0.32, shy = cy + Math.sin(ang) * L * 0.32
    ctx.beginPath(); ctx.moveTo(shx + Math.cos(perp) * wBody * 0.3, shy + Math.sin(perp) * wBody * 0.3); ctx.lineTo(gx, gy); ctx.stroke()
    ctx.beginPath(); ctx.moveTo(shx - Math.cos(perp) * wBody * 0.3, shy - Math.sin(perp) * wBody * 0.3); ctx.lineTo(gx, gy); ctx.stroke()
    // gloves catching the ball
    ctx.fillStyle = '#fff'; ctx.strokeStyle = '#c3cad6'; ctx.lineWidth = 2
    ctx.beginPath(); ctx.arc(gx, gy, Math.max(4, wBody * 0.62), 0, Math.PI * 2); ctx.fill(); ctx.stroke()
    ctx.lineCap = 'butt'
    return
  }
  // idle: shuffle side to side, knees bent, arms out (ready)
  const shuffle = Math.sin(now / 480) * 0.35
  const feet = rel(shuffle, 0, z); const head = rel(shuffle, 1.7, z)
  const cx = feet.sx
  const hipY = head.sy + (feet.sy - head.sy) * 0.55
  const shoulderY = head.sy + (feet.sy - head.sy) * 0.34
  ctx.strokeStyle = '#1c1c1c'; ctx.lineWidth = Math.max(3, 0.13 * scale); ctx.lineCap = 'round'
  ctx.beginPath(); ctx.moveTo(cx, hipY); ctx.lineTo(cx - wBody * 0.5, feet.sy); ctx.stroke()
  ctx.beginPath(); ctx.moveTo(cx, hipY); ctx.lineTo(cx + wBody * 0.5, feet.sy); ctx.stroke()
  ctx.fillStyle = '#ffd23f'
  roundRect(ctx, cx - wBody / 2, shoulderY, wBody, hipY - shoulderY + 2, Math.max(2, wBody * 0.25)); ctx.fill()
  // ready arms out to the sides
  ctx.strokeStyle = '#ffd23f'; ctx.lineWidth = Math.max(2, 0.11 * scale)
  ctx.beginPath(); ctx.moveTo(cx - wBody / 2, shoulderY + 2); ctx.lineTo(cx - wBody * 1.1, shoulderY + wBody * 0.3); ctx.stroke()
  ctx.beginPath(); ctx.moveTo(cx + wBody / 2, shoulderY + 2); ctx.lineTo(cx + wBody * 1.1, shoulderY + wBody * 0.3); ctx.stroke()
  ctx.fillStyle = '#e8b48a'; ctx.beginPath(); ctx.arc(cx, head.sy, Math.max(3, 0.16 * scale), 0, Math.PI * 2); ctx.fill()
  ctx.lineCap = 'butt'
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

function drawTimer(ctx: CanvasRenderingContext2D, left: number, total: number, label: string, color: string) {
  ctx.fillStyle = 'rgba(8,12,28,0.82)'; roundRect(ctx, W / 2 - 170, 12, 340, 50, 14); ctx.fill()
  ctx.textAlign = 'center'; ctx.fillStyle = color; ctx.font = '800 22px Plus Jakarta Sans, sans-serif'
  const txt = total >= 90 ? `${Math.floor(left / 60)}:${String(Math.floor(left % 60)).padStart(2, '0')}` : `${left.toFixed(1)}s`
  ctx.fillText(txt, W / 2, 36)
  ctx.fillStyle = '#cfd6ea'; ctx.font = '600 11px Inter, sans-serif'; ctx.fillText(label, W / 2, 52)
  // bar
  ctx.fillStyle = 'rgba(255,255,255,0.15)'; roundRect(ctx, W / 2 - 150, 56, 300, 4, 2); ctx.fill()
  ctx.fillStyle = color; roundRect(ctx, W / 2 - 150, 56, 300 * clamp(left / total, 0, 1), 4, 2); ctx.fill()
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
