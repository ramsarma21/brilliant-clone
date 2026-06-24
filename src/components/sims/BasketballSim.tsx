import { useCallback, useEffect, useRef, useState } from 'react'
import { Slider } from '../ui/Slider'
import type { SimProps } from './types'
import { n } from './types'

// ---- World (meters) ----
const G = 9.8
const RELEASE = { y: 1.15, z: 0.78 } // ball leaves the hands here (first-person viewmodel)
const RIM_Y = 3.05
const RIM_R = 0.225
const BALL_R = 0.12
const BOARD = { halfW: 0.9, bottom: 2.9, top: 3.95, offset: 0.16 }

// ---- Camera / canvas ----
const W = 900
const H = 560
const HORIZON = H * 0.46
const EYE_Y = 1.5
const FOCAL = 540

type P2 = { sx: number; sy: number; scale: number }
function project(x: number, y: number, z: number): P2 {
  const cz = Math.max(0.05, z)
  const scale = FOCAL / cz
  return { sx: W / 2 + x * scale, sy: HORIZON - (y - EYE_Y) * scale, scale }
}

type Outcome = 'make' | 'short' | 'long'
type Plan = { vx: number; vy: number; t: number; yRim: number; outcome: Outcome }

// Pure 2D projectile straight at the hoop. `distance` = horizontal travel to the rim.
function planShot(speed: number, angleDeg: number, distance: number): Plan {
  const th = (angleDeg * Math.PI) / 180
  const vx = speed * Math.cos(th)
  const vy = speed * Math.sin(th)
  const t = vx > 0.05 ? distance / vx : Infinity
  const yRim = RELEASE.y + vy * t - 0.5 * G * t * t
  const tol = RIM_R - BALL_R * 0.45
  let outcome: Outcome
  if (yRim < RIM_Y - tol) outcome = 'short'
  else if (yRim > RIM_Y + tol) outcome = 'long'
  else outcome = 'make'
  return { vx, vy, t, yRim, outcome }
}

const COACH: Record<Outcome, string> = {
  make: 'Swish! The ball reached the rim line exactly at 3.05 m — height at rim matched rim height.',
  short: 'Short — the ball was still below 3.05 m when it arrived at the rim. Either add speed, or steepen the angle so more speed goes into vy.',
  long: 'Long — the ball was still above 3.05 m at the rim, so it sailed over. Ease off the speed, or flatten the angle a touch.',
}

const randomDistance = () => Math.round((3.8 + Math.random() * 2.4) * 10) / 10

class Sfx {
  ctx: AudioContext | null = null
  noise: AudioBuffer | null = null
  ensure() {
    if (!this.ctx) {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
      this.ctx = new AC()
      const len = this.ctx.sampleRate * 0.4
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
  shoot() { this.burst(900, 0.6, 0.12, 0.12) }
  swish() { this.burst(2600, 2, 0.22, 0.25) }
  bank() { this.burst(300, 1.2, 0.1, 0.3) }
  rim() { this.tone(820, 0.1, 'triangle', 0.16) }
  bounce() { this.tone(170, 0.08, 'sine', 0.2) }
  make() { this.tone(523, 0.12, 'sine', 0.2); this.tone(784, 0.18, 'sine', 0.2, 0.1) }
}

type Particle = { x: number; y: number; vx: number; vy: number; life: number; color: string }
type Ball = { y: number; z: number; vy: number; vz: number; spin: number }

export function BasketballSim({ state, onChange, showGoal }: SimProps) {
  const speed = n(state, 'power', 8)
  const angle = n(state, 'angle', 55)

  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [distance, setDistance] = useState(() => (showGoal ? randomDistance() : 4.5))
  const [makes, setMakes] = useState(0)
  const [shots, setShots] = useState(0)
  const [streak, setStreak] = useState(0)
  const [result, setResult] = useState<{ made: boolean; text: string } | null>(null)
  const [flying, setFlying] = useState(false)
  const [showArc, setShowArc] = useState(true)
  const [showVectors, setShowVectors] = useState(true)
  const [sound, setSound] = useState(true)

  const sfx = useRef<Sfx>(new Sfx())
  const soundRef = useRef(sound); soundRef.current = sound

  const scene = useRef({ speed, angle, distance, showArc, showVectors, flying, makes, shots, streak, state, showGoal, onChange })
  scene.current = { speed, angle, distance, showArc, showVectors, flying, makes, shots, streak, state, showGoal, onChange }

  const ballRef = useRef<Ball | null>(null)
  const trailRef = useRef<{ y: number; z: number }[]>([])
  const particlesRef = useRef<Particle[]>([])
  const shakeRef = useRef(0)
  const flashRef = useRef(0)
  const resolveRef = useRef<{ done: boolean; endT: number; t: number; banked: boolean }>({ done: true, endT: 0, t: 0, banked: false })
  const rafRef = useRef<number | null>(null)

  const plan = planShot(speed, angle, distance)

  const initedChallenge = useRef(false)
  useEffect(() => {
    if (showGoal && !initedChallenge.current) {
      initedChallenge.current = true
      setMakes(0)
      onChange({ ...state, makes: 0 })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showGoal])

  const draw = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const s = scene.current
    const now = performance.now()
    const dist = s.distance
    const rimZ = RELEASE.z + dist
    const live = planShot(s.speed, s.angle, dist)

    ctx.clearRect(0, 0, W, H)
    ctx.save()
    if (shakeRef.current > 0.4) ctx.translate((Math.random() - 0.5) * shakeRef.current, (Math.random() - 0.5) * shakeRef.current)

    // ===== Back wall =====
    const wall = ctx.createLinearGradient(0, 0, 0, HORIZON)
    wall.addColorStop(0, '#0a0f24'); wall.addColorStop(1, '#1b2347')
    ctx.fillStyle = wall; ctx.fillRect(-30, -30, W + 60, HORIZON + 30)
    for (const lx of [0.2, 0.5, 0.8]) {
      const g = ctx.createRadialGradient(W * lx, 26, 4, W * lx, 26, 60)
      g.addColorStop(0, 'rgba(255,255,240,0.5)'); g.addColorStop(1, 'rgba(255,255,240,0)')
      ctx.fillStyle = g; ctx.fillRect(W * lx - 60, -10, 120, 100)
    }
    for (let r = 0; r < 5; r++) for (let c = 0; c < 64; c++) {
      ctx.fillStyle = `rgba(${110 + (c * 9) % 130},${110 + (r * 26) % 110},${170},0.22)`
      ctx.fillRect(6 + c * 14, 40 + r * 15, 8, 8)
    }
    ctx.fillStyle = '#5b5ef0'; ctx.fillRect(W / 2 - 90, 4, 180, 40)
    ctx.fillStyle = '#fff'; ctx.textAlign = 'center'
    ctx.font = '800 16px Plus Jakarta Sans, sans-serif'; ctx.fillText('PHYSICS CUP', W / 2, 30)

    // ===== Floor =====
    const floor = ctx.createLinearGradient(0, HORIZON, 0, H)
    floor.addColorStop(0, '#b78a4e'); floor.addColorStop(0.5, '#cf9f5e'); floor.addColorStop(1, '#e7c074')
    ctx.fillStyle = floor; ctx.fillRect(-30, HORIZON, W + 60, H - HORIZON + 30)
    ctx.strokeStyle = 'rgba(90,60,20,0.18)'; ctx.lineWidth = 1
    for (let gx = -7; gx <= 7; gx++) {
      const a = project(gx, 0, 1.8), b = project(gx, 0, 16)
      ctx.beginPath(); ctx.moveTo(a.sx, a.sy); ctx.lineTo(b.sx, b.sy); ctx.stroke()
    }
    for (let gz = 2; gz <= 14; gz += 1.5) {
      const a = project(-7, 0, gz), b = project(7, 0, gz)
      ctx.beginPath(); ctx.moveTo(a.sx, a.sy); ctx.lineTo(b.sx, b.sy); ctx.stroke()
    }
    const key = [project(-2.44, 0, 2.2), project(2.44, 0, 2.2), project(1.5, 0, rimZ), project(-1.5, 0, rimZ)]
    ctx.beginPath(); key.forEach((p, i) => (i === 0 ? ctx.moveTo(p.sx, p.sy) : ctx.lineTo(p.sx, p.sy))); ctx.closePath()
    ctx.fillStyle = 'rgba(60,100,200,0.3)'; ctx.fill()
    ctx.strokeStyle = 'rgba(255,255,255,0.7)'; ctx.lineWidth = 2; ctx.stroke()

    // distance measuring line from the player's feet to the rim base
    const fA = project(0, 0.01, RELEASE.z), fB = project(0, 0.01, rimZ)
    ctx.setLineDash([5, 5]); ctx.strokeStyle = 'rgba(255,255,255,0.85)'; ctx.lineWidth = 2
    ctx.beginPath(); ctx.moveTo(fA.sx, fA.sy); ctx.lineTo(fB.sx, fB.sy); ctx.stroke(); ctx.setLineDash([])
    const mid = project(0, 0.01, RELEASE.z + dist / 2)
    ctx.fillStyle = 'rgba(8,10,24,0.8)'; roundRect(ctx, mid.sx - 42, mid.sy - 12, 84, 22, 8); ctx.fill()
    ctx.fillStyle = '#ffd166'; ctx.font = '700 13px Inter, sans-serif'; ctx.textAlign = 'center'
    ctx.fillText(`d = ${dist.toFixed(1)} m`, mid.sx, mid.sy + 4)

    // ===== Hoop =====
    const bz = rimZ + BOARD.offset
    const poleTop = project(0, BOARD.bottom, bz + 0.4), poleBot = project(0, 0, bz + 0.4)
    ctx.strokeStyle = '#2c3357'; ctx.lineWidth = Math.max(4, 0.12 * poleTop.scale)
    ctx.beginPath(); ctx.moveTo(poleTop.sx, poleTop.sy); ctx.lineTo(poleBot.sx, poleBot.sy); ctx.stroke()
    const bc = [project(-BOARD.halfW, BOARD.top, bz), project(BOARD.halfW, BOARD.top, bz), project(BOARD.halfW, BOARD.bottom, bz), project(-BOARD.halfW, BOARD.bottom, bz)]
    ctx.beginPath(); bc.forEach((c, i) => (i === 0 ? ctx.moveTo(c.sx, c.sy) : ctx.lineTo(c.sx, c.sy))); ctx.closePath()
    ctx.fillStyle = 'rgba(245,247,255,0.92)'; ctx.fill(); ctx.strokeStyle = '#aeb4cc'; ctx.lineWidth = 2; ctx.stroke()
    const sq = [project(-0.3, 3.45, bz), project(0.3, 3.45, bz), project(0.3, 3.05, bz), project(-0.3, 3.05, bz)]
    ctx.beginPath(); sq.forEach((c, i) => (i === 0 ? ctx.moveTo(c.sx, c.sy) : ctx.lineTo(c.sx, c.sy))); ctx.closePath()
    ctx.strokeStyle = '#e8732c'; ctx.lineWidth = 3; ctx.stroke()
    // rim
    const rf = project(0, RIM_Y, rimZ - RIM_R), rb = project(0, RIM_Y, rimZ + RIM_R)
    const rl = project(-RIM_R, RIM_Y, rimZ), rr = project(RIM_R, RIM_Y, rimZ)
    const rcx = (rl.sx + rr.sx) / 2, rcy = (rf.sy + rb.sy) / 2
    const rrx = Math.abs(rr.sx - rl.sx) / 2, rry = Math.max(3, Math.abs(rb.sy - rf.sy) / 2)
    if (live.outcome === 'make' && !s.flying) { ctx.save(); ctx.shadowColor = '#22c55e'; ctx.shadowBlur = 18 }
    ctx.strokeStyle = '#f4661f'; ctx.lineWidth = 4
    ctx.beginPath(); ctx.ellipse(rcx, rcy, rrx, rry, 0, 0, Math.PI * 2); ctx.stroke()
    if (live.outcome === 'make' && !s.flying) ctx.restore()
    // net
    ctx.strokeStyle = 'rgba(255,255,255,0.62)'; ctx.lineWidth = 1.2
    const nb = project(0, RIM_Y - 0.45, rimZ)
    const sway = ballRef.current && ballRef.current.y < RIM_Y && ballRef.current.y > RIM_Y - 0.6 ? Math.sin(now / 45) * 4 : 0
    for (let a = 0; a < Math.PI * 2; a += Math.PI / 7) {
      const nx = rcx + Math.cos(a) * rrx, ny = rcy + Math.sin(a) * rry
      ctx.beginPath(); ctx.moveTo(nx, ny); ctx.lineTo(nb.sx + Math.cos(a) * rrx * 0.4 + sway, nb.sy); ctx.stroke()
    }
    // rim-height reference line across the rim plane (3.05 m)
    const refL = project(-0.8, RIM_Y, rimZ), refR = project(0.8, RIM_Y, rimZ)
    ctx.setLineDash([4, 4]); ctx.strokeStyle = 'rgba(244,102,31,0.55)'; ctx.lineWidth = 1.5
    ctx.beginPath(); ctx.moveTo(refL.sx, refL.sy); ctx.lineTo(refR.sx, refR.sy); ctx.stroke(); ctx.setLineDash([])

    // ===== Predicted arc =====
    if (s.showArc && !s.flying && Number.isFinite(live.t)) {
      ctx.setLineDash([6, 7]); ctx.lineWidth = 2.5
      ctx.strokeStyle = live.outcome === 'make' ? 'rgba(34,197,94,0.95)' : 'rgba(245,158,11,0.9)'
      ctx.beginPath()
      const tEnd = Math.min(live.t * 1.05, 4)
      for (let i = 0; i <= 48; i++) {
        const t = (tEnd * i) / 48
        const y = RELEASE.y + live.vy * t - 0.5 * G * t * t
        if (y < 0) break
        const p = project(0, y, RELEASE.z + live.vx * t)
        if (i === 0) ctx.moveTo(p.sx, p.sy); else ctx.lineTo(p.sx, p.sy)
      }
      ctx.stroke(); ctx.setLineDash([])
    }

    // ===== Ghost: where the ball ARRIVES at the rim distance =====
    if (!s.flying && Number.isFinite(live.t) && live.yRim > 0) {
      const gp = project(0, live.yRim, rimZ)
      const gr = Math.max(4, BALL_R * gp.scale)
      const good = live.outcome === 'make'
      ctx.fillStyle = good ? 'rgba(34,197,94,0.30)' : 'rgba(245,158,11,0.28)'
      ctx.beginPath(); ctx.arc(gp.sx, gp.sy, gr, 0, Math.PI * 2); ctx.fill()
      ctx.strokeStyle = good ? '#22c55e' : '#f59e0b'; ctx.lineWidth = 2
      ctx.beginPath(); ctx.arc(gp.sx, gp.sy, gr, 0, Math.PI * 2); ctx.stroke()
      // callout
      ctx.fillStyle = good ? '#22c55e' : '#f59e0b'; ctx.font = '700 12px Inter, sans-serif'; ctx.textAlign = 'left'
      const label = `arrives at ${live.yRim.toFixed(2)} m`
      ctx.fillText(label, gp.sx + gr + 6, gp.sy - 2)
      ctx.fillStyle = 'rgba(255,255,255,0.75)'; ctx.font = '600 10px Inter, sans-serif'
      ctx.fillText(live.outcome === 'short' ? 'below rim → SHORT' : live.outcome === 'long' ? 'above rim → LONG' : 'on the rim line ✓', gp.sx + gr + 6, gp.sy + 11)
    }

    // ===== Trail =====
    for (let i = 0; i < trailRef.current.length; i++) {
      const tp = trailRef.current[i]; const p = project(0, tp.y, tp.z)
      ctx.fillStyle = `rgba(245,120,40,${(i / trailRef.current.length) * 0.35})`
      ctx.beginPath(); ctx.arc(p.sx, p.sy, Math.max(2, BALL_R * p.scale * 0.7), 0, Math.PI * 2); ctx.fill()
    }

    // ===== Ball =====
    const bob = !s.flying ? Math.sin(now / 300) * 0.02 : 0
    const bw = ballRef.current ?? { y: RELEASE.y + bob, z: RELEASE.z, vy: 0, vz: 0, spin: now / 600 }
    const shp = project(0, 0, bw.z)
    ctx.fillStyle = 'rgba(0,0,0,0.2)'
    ctx.beginPath(); ctx.ellipse(shp.sx, shp.sy, BALL_R * shp.scale * 1.1, BALL_R * shp.scale * 0.4, 0, 0, Math.PI * 2); ctx.fill()
    const bp = project(0, bw.y, bw.z)
    const br = Math.max(4, BALL_R * bp.scale)
    if (!s.flying) drawHands(ctx, bp.sx, bp.sy, br)
    ctx.save(); ctx.translate(bp.sx, bp.sy); ctx.rotate(bw.spin)
    const bg = ctx.createRadialGradient(-br * 0.35, -br * 0.4, br * 0.2, 0, 0, br)
    bg.addColorStop(0, '#ffb066'); bg.addColorStop(0.6, '#e87a26'); bg.addColorStop(1, '#c5560f')
    ctx.fillStyle = bg; ctx.beginPath(); ctx.arc(0, 0, br, 0, Math.PI * 2); ctx.fill()
    ctx.strokeStyle = 'rgba(45,16,0,0.7)'; ctx.lineWidth = Math.max(1, br * 0.07)
    ctx.beginPath(); ctx.arc(0, 0, br, 0, Math.PI * 2)
    ctx.moveTo(-br, 0); ctx.quadraticCurveTo(0, -br * 0.55, br, 0)
    ctx.moveTo(-br, 0); ctx.quadraticCurveTo(0, br * 0.55, br, 0)
    ctx.moveTo(0, -br); ctx.lineTo(0, br); ctx.stroke()
    ctx.fillStyle = 'rgba(255,255,255,0.25)'
    ctx.beginPath(); ctx.ellipse(-br * 0.35, -br * 0.4, br * 0.28, br * 0.18, -0.6, 0, Math.PI * 2); ctx.fill()
    ctx.restore()

    // ===== vx / vy vectors at release =====
    if (s.showVectors && !s.flying) {
      const o = project(0, RELEASE.y, RELEASE.z)
      const up = project(0, RELEASE.y + 1, RELEASE.z)
      const fwd = project(0, RELEASE.y, RELEASE.z + 1)
      const vS = 0.05
      arrow(ctx, o.sx, o.sy, o.sx + (fwd.sx - o.sx) * live.vx * vS, o.sy + (fwd.sy - o.sy) * live.vx * vS, '#22c55e', `vx ${live.vx.toFixed(1)}`)
      arrow(ctx, o.sx, o.sy, o.sx, o.sy - (o.sy - up.sy) * live.vy * vS, '#60a5fa', `vy ${live.vy.toFixed(1)}`)
    }

    // ===== Particles =====
    for (const p of particlesRef.current) {
      ctx.globalAlpha = Math.max(0, p.life); ctx.fillStyle = p.color
      ctx.beginPath(); ctx.arc(p.x, p.y, 3, 0, Math.PI * 2); ctx.fill()
    }
    ctx.globalAlpha = 1

    // ===== Vignette / flash =====
    const vg = ctx.createRadialGradient(W / 2, H / 2, H * 0.3, W / 2, H / 2, H * 0.75)
    vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,0.4)')
    ctx.fillStyle = vg; ctx.fillRect(-30, -30, W + 60, H + 60)
    if (flashRef.current > 0.01) { ctx.fillStyle = `rgba(255,255,255,${flashRef.current * 0.4})`; ctx.fillRect(0, 0, W, H) }

    // ===== GIVENS panel =====
    ctx.textAlign = 'left'
    ctx.fillStyle = 'rgba(8,10,24,0.8)'; roundRect(ctx, 12, 12, 196, 112, 12); ctx.fill()
    ctx.fillStyle = '#8ea0ff'; ctx.font = '700 11px Inter, sans-serif'; ctx.fillText('GIVENS (fixed)', 24, 30)
    ctx.fillStyle = '#fff'; ctx.font = '600 12px Inter, sans-serif'
    ctx.fillText(`distance to rim  d = ${dist.toFixed(1)} m`, 24, 50)
    ctx.fillText(`rim height        = 3.05 m`, 24, 68)
    ctx.fillText(`release height h₀ = 1.15 m`, 24, 86)
    ctx.fillText(`gravity         g = 9.8 m/s²`, 24, 104)
    ctx.fillStyle = '#5b6b9a'; ctx.font = '600 10px Inter, sans-serif'
    ctx.fillText('You set v and θ to make it work →', 24, 120)

    // ===== Scoreboard =====
    ctx.fillStyle = 'rgba(8,10,24,0.8)'; roundRect(ctx, W - 176, 12, 164, 50, 12); ctx.fill()
    ctx.fillStyle = '#fff'; ctx.font = '700 16px Plus Jakarta Sans, sans-serif'
    ctx.fillText(`${s.makes}/${s.shots} made`, W - 164, 36)
    ctx.fillStyle = '#ffd166'; ctx.font = '600 12px Inter, sans-serif'; ctx.fillText(`🔥 streak ${s.streak}`, W - 164, 52)

    ctx.restore()
  }, [])

  useEffect(() => {
    const spawn = (px: number, py: number) => {
      const cols = ['#f4661f', '#22c55e', '#ffffff', '#ffd166']
      for (let i = 0; i < 28; i++) {
        const a = Math.random() * Math.PI * 2, sp = 2 + Math.random() * 5
        particlesRef.current.push({ x: px, y: py, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 2.5, life: 1, color: cols[i % cols.length] })
      }
    }
    const finish = (made: boolean, outcome: Outcome) => {
      const s = scene.current
      setResult({ made, text: made ? COACH.make : COACH[outcome] })
      setShots((p) => p + 1)
      if (made) {
        if (soundRef.current) sfx.current.make()
        shakeRef.current = 11; flashRef.current = 1
        const r = project(0, RIM_Y, RELEASE.z + s.distance); spawn(r.sx, r.sy)
        setStreak((p) => p + 1)
        setMakes((p) => {
          const next = p + 1
          s.onChange({ ...s.state, power: s.speed, angle: s.angle, made: true, makes: next, shots: s.shots + 1 })
          if (s.showGoal) setTimeout(() => setDistance(randomDistance()), 850)
          return next
        })
      } else {
        setStreak(0)
        s.onChange({ ...s.state, power: s.speed, angle: s.angle, made: false, shots: s.shots + 1 })
      }
    }
    const endFlight = () => {
      ballRef.current = null; trailRef.current = []
      resolveRef.current = { done: true, endT: 0, t: 0, banked: false }
      setFlying(false)
    }

    let last = performance.now()
    const loop = (now: number) => {
      const dt = Math.min(0.04, (now - last) / 1000); last = now
      const s = scene.current
      const ball = ballRef.current
      const res = resolveRef.current
      const rimZ = RELEASE.z + s.distance

      if (ball && s.flying) {
        const bz = rimZ + BOARD.offset
        const sub = 4, h = dt / sub
        for (let k = 0; k < sub; k++) {
          const pz = ball.z, py = ball.y
          ball.vy -= G * h
          ball.y += ball.vy * h; ball.z += ball.vz * h
          ball.spin += ball.vz * h * 1.3
          res.t += h
          if (!res.done && py > RIM_Y && ball.y <= RIM_Y && ball.vy < 0) {
            const r = Math.abs(ball.z - rimZ)
            if (r < RIM_R - BALL_R * 0.45) { res.done = true; res.endT = res.t + 0.55; if (soundRef.current) sfx.current.swish(); finish(true, 'make') }
            else if (r < RIM_R + 0.07) { ball.vy *= -0.45; ball.vz *= 0.5; if (soundRef.current) sfx.current.rim() }
          }
          if (!res.banked && pz < bz && ball.z >= bz && ball.y > BOARD.bottom && ball.y < BOARD.top) {
            ball.z = bz; ball.vz = -Math.abs(ball.vz) * 0.45; ball.vy *= 0.86; res.banked = true
            if (soundRef.current) sfx.current.bank()
          }
          if (ball.y - BALL_R <= 0 && ball.vy < 0) {
            ball.y = BALL_R; ball.vy = -ball.vy * 0.5; ball.vz *= 0.7
            if (soundRef.current && Math.abs(ball.vy) > 0.6) sfx.current.bounce()
          }
        }
        trailRef.current.push({ y: ball.y, z: ball.z })
        if (trailRef.current.length > 14) trailRef.current.shift()

        const settled = ball.y <= BALL_R + 0.02 && Math.abs(ball.vy) < 0.5
        const gone = ball.z > rimZ + 1.4 || ball.z < 0.2
        if (res.done && res.t >= res.endT) endFlight()
        else if (!res.done && (settled || gone || res.t > 5)) { finish(false, planShot(s.speed, s.angle, s.distance).outcome); endFlight() }
      }

      const ps = particlesRef.current
      for (const p of ps) { p.vy += 0.25; p.x += p.vx; p.y += p.vy; p.life -= dt * 1.3 }
      particlesRef.current = ps.filter((p) => p.life > 0)
      if (shakeRef.current > 0) shakeRef.current *= 0.86
      if (flashRef.current > 0) flashRef.current *= 0.82

      draw()
      rafRef.current = requestAnimationFrame(loop)
    }
    rafRef.current = requestAnimationFrame(loop)
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current) }
  }, [draw])

  function shoot() {
    if (flying) return
    if (soundRef.current) { sfx.current.ensure(); sfx.current.shoot() }
    setResult(null)
    const p = planShot(speed, angle, distance)
    ballRef.current = { y: RELEASE.y, z: RELEASE.z, vy: p.vy, vz: p.vx, spin: 0 }
    trailRef.current = []
    resolveRef.current = { done: false, endT: 0, t: 0, banked: false }
    setFlying(true)
  }

  function toggleSound() { setSound((v) => { if (!v) sfx.current.ensure(); return !v }) }

  const tStr = Number.isFinite(plan.t) ? plan.t.toFixed(2) : '—'
  const half = Number.isFinite(plan.t) ? 0.5 * G * plan.t * plan.t : NaN

  return (
    <div className="sim bball">
      <div className="bball__stage">
        <canvas ref={canvasRef} width={W} height={H} className="bball__canvas" />
        {showGoal && <div className="bball__hud"><span className="bball__target">🎯 Makes {makes} / 3</span></div>}
        <button type="button" className="bball__sound" onClick={toggleSound} aria-label="Toggle sound">{sound ? '🔊' : '🔈'}</button>
        {result && (
          <div className={`bball__coach bball__coach--${result.made ? 'make' : 'miss'}`}>
            <strong>{result.made ? '🏀 Bucket!' : 'Miss'}</strong>
            <span>{result.text}</span>
          </div>
        )}
      </div>

      {/* Worked-physics solver — shows WHY the chosen v and θ make or miss */}
      <div className={`bball__solver bball__solver--${plan.outcome}`}>
        <div className="bball__solver-head">
          <span>Will it go in? Solve it before you shoot:</span>
          <span className={`bball__verdict bball__verdict--${plan.outcome}`}>
            {plan.outcome === 'make' ? 'ON TARGET ✓' : plan.outcome === 'short' ? 'SHORT ✕' : 'LONG ✕'}
          </span>
        </div>
        <div className="bball__steps">
          <code>vₓ = v·cosθ = {speed.toFixed(1)}·cos{angle.toFixed(0)}° = {plan.vx.toFixed(2)} m/s</code>
          <code>v_y = v·sinθ = {speed.toFixed(1)}·sin{angle.toFixed(0)}° = {plan.vy.toFixed(2)} m/s</code>
          <code>t = d / vₓ = {distance.toFixed(1)} / {plan.vx.toFixed(2)} = {tStr} s</code>
          <code>
            y = h₀ + v_y·t − ½g·t² = 1.15 + {(plan.vy * (Number.isFinite(plan.t) ? plan.t : 0)).toFixed(2)} − {Number.isFinite(half) ? half.toFixed(2) : '—'}
            {' = '}
            <strong className={`bball__yrim bball__yrim--${plan.outcome}`}>{Number.isFinite(plan.yRim) ? plan.yRim.toFixed(2) : '—'} m</strong>
          </code>
          <code className="bball__compare">
            compare to rim 3.05 m → {plan.outcome === 'make' ? 'matches: swish' : plan.outcome === 'short' ? 'too low: add v or θ' : 'too high: lower v or θ'}
          </code>
        </div>
      </div>

      <p className="bball__tip">
        🎯 You can’t just feel this one out. Read the <strong>givens</strong>, set your <strong>release speed v</strong> and <strong>launch angle θ</strong> so the ball’s height when it reaches the rim distance equals <strong>3.05 m</strong>, then shoot to verify. The green ghost-ball shows where your shot arrives.
      </p>

      <div className="sim__controls">
        <Slider label="Release speed  v" value={speed} min={5} max={14} step={0.1} unit="m/s" onChange={(v) => onChange({ ...state, power: v })} />
        <Slider label="Launch angle  θ" value={angle} min={20} max={75} step={1} unit="°" onChange={(v) => onChange({ ...state, angle: v })} />
        <div className="bball__buttons">
          <button type="button" className="btn btn--primary" onClick={shoot} disabled={flying}>🏀 Shoot</button>
          <button type="button" className={`btn btn--ghost ${showArc ? 'is-active' : ''}`} onClick={() => setShowArc((v) => !v)}>Arc</button>
          <button type="button" className={`btn btn--ghost ${showVectors ? 'is-active' : ''}`} onClick={() => setShowVectors((v) => !v)}>vx / vy</button>
          {!showGoal && <button type="button" className="btn btn--ghost" onClick={() => setDistance(randomDistance())}>New distance</button>}
        </div>
      </div>
    </div>
  )
}

function drawHands(ctx: CanvasRenderingContext2D, cx: number, cy: number, br: number) {
  ctx.fillStyle = '#caa07a'
  for (const side of [-1, 1]) {
    ctx.beginPath()
    ctx.moveTo(cx + side * br * 1.4, H)
    ctx.quadraticCurveTo(cx + side * br * 1.3, cy + br * 0.2, cx + side * br * 0.5, cy)
    ctx.lineTo(cx + side * br * 0.2, cy + br * 0.7)
    ctx.quadraticCurveTo(cx + side * br * 1.0, cy + br * 1.4, cx + side * br * 1.9, H)
    ctx.closePath(); ctx.fill()
  }
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath(); ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath()
}

function arrow(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number, color: string, label: string) {
  if (Math.hypot(x2 - x1, y2 - y1) < 6) return
  const ang = Math.atan2(y2 - y1, x2 - x1)
  ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = 3
  ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke()
  ctx.beginPath(); ctx.moveTo(x2, y2)
  ctx.lineTo(x2 - 9 * Math.cos(ang - 0.4), y2 - 9 * Math.sin(ang - 0.4))
  ctx.lineTo(x2 - 9 * Math.cos(ang + 0.4), y2 - 9 * Math.sin(ang + 0.4))
  ctx.closePath(); ctx.fill()
  ctx.font = '600 12px Inter, sans-serif'; ctx.textAlign = 'center'; ctx.fillText(label, x2, y2 - 8)
}
