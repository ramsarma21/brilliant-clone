import { useCallback, useEffect, useRef, useState } from 'react'
import {
  W, H, BALL_R, GOAL_W_HALF,
  buildStaticBackground, buildGradients, drawWorld, drawVignette, drawGoal,
  drawWorldBall, drawWorldPlayer, drawPlayer, project, makeKit, BASE_YOU_KIT,
  clamp, lerp, easeOut, easeIn,
  type Kit, type V3, type Gradients,
} from '../../../lib/pitch3d'
import { usePlayerKit } from '../../../lib/playerKit'
import { useCameraSettle, type MatchDrillProps } from '../matchDrill'
import { Calculator } from '../../sims/Calculator'
import './matchDrills.css'

// ============================================================================
// MATCH HEADER DRILL — the in-match version of the Energy unit's "Headers"
// drill, rebuilt on the SHARED third-person pitch (lib/pitch3d) so it can be
// HANDED INTO from a bridging transition rather than cut to.
//
// It OPENS at the exact handoff state (DRILL_ENTRY['header']): you in the box,
// the cross ALREADY IN THE AIR dropping in, a marker beside you and the goal
// ahead — i.e. the transition's final frame. The camera then eases from the
// handoff pan into the solve framing while the header menu slides in.
//
// The physics + question + grading are copied from EnergySim: energy
// conservation mgh = ½mv² cancels the mass, so the leap that wins the cross is
//   • findV: v = √(2·g·h)   (take-off speed for a reach height)
//   • findH: h = v² / (2g)   (reach height for a take-off speed)
// on the SAME constant gravity g = 10 m/s². ONE attempt: a correct answer
// guarantees the header is buried (onResolve(true)); a wrong answer or a 30 s
// timeout is a turnover (onResolve(false)). It never loops, fires onGoal or
// persists a high score. After it settles it HOLDS the final frame.
// ============================================================================

// ---- Camera / world (metres) ----
const SOLVE_CAMX = 0.1 // the camera eases here from entry.camX to frame the header
const SETTLE_MS = 700
const GOAL_Z = 14 // the goal line, up-pitch ahead of you (entry ball sits at z = 9)
const GRAV = 10 // the constant: every header fights the SAME gravity

// ---- Solve economy (FIXED — no difficulty scaling, identical to EnergySim) ----
const SOLVE_MS = 30000 // a flat 30 s to read the leap and commit
const SOLVE_WARN_MS = 10000
const CALC_DRAIN = 1.25 // opening the calculator drains the clock at 1.25×

// ---- Leap animation ----
const HEAD_H = 1.7 // metres the ball meets the forehead above the feet
const FLY_DUR = 1.9 // seconds the executed header plays out
const U_TAKEOFF = 0.18
const U_CONTACT = 0.46 // the header (apex of the jump = meeting the cross)
const U_LAND = 0.8

const round1 = (x: number) => Math.round(x * 10) / 10
const randInt = (lo: number, hi: number) => lo + Math.floor(Math.random() * (hi - lo + 1))
const parseNum = (s: string): number => { const v = parseFloat(s); return Number.isFinite(v) ? v : 0 }
const pulse = (u: number, c: number, w: number) => Math.max(0, 1 - Math.abs(u - c) / w)
const jumpArc = (u: number, peak: number, takeoff = U_TAKEOFF, land = U_LAND): number => {
  if (u <= takeoff || u >= land) return 0
  const k = (u - takeoff) / (land - takeoff)
  return peak * 4 * k * (1 - k)
}

// ============================================================================
// The three headers (copied from EnergySim): each a real leap aimed at a
// different part of the goal, so each maps to an honest v = √(2gh) question.
// ============================================================================
type Dir = 'findV' | 'findH'
type HeaderId = 'flick' | 'back' | 'tower'

type HeaderDef = {
  id: HeaderId
  key: string
  name: string
  emoji: string
  blurb: string
  ctxV: (h: number) => string
  ctxH: (v: number) => string
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

const PEAK: Record<HeaderId, number> = { flick: 0.95, back: 1.45, tower: 1.95 }

// Where in the goal each header is aimed. The cross swings in from the right
// (entry ball x > 0), so the NEAR post is the +x post. Three clearly different
// destinations: low near post, across to the far post, and down the middle.
function goalTarget(id: HeaderId): V3 {
  if (id === 'flick') return { x: GOAL_W_HALF - 0.8, y: 0.55, z: GOAL_Z + 0.2 } // near post, low
  if (id === 'back') return { x: -(GOAL_W_HALF - 0.8), y: 1.2, z: GOAL_Z + 0.2 } // far post
  return { x: 0.1, y: 0.4, z: GOAL_Z + 0.2 } // towering: down the middle
}

// ============================================================================
// Problem + grading (copied verbatim from EnergySim so the question is the
// same): the given variable is a random integer 1–50, g = 10 m/s² is constant,
// and the unknown is the matching rearrangement of v = √(2gh).
// ============================================================================
type Problem = {
  header: HeaderDef
  dir: Dir
  g: number
  h: number
  v: number
  answer: number
  unit: string
}

const answerOf = (p: Problem) => p.answer
// Accept anything within 1.0 of the exact decimal so rounding either way is fine.
const tolOf = (_p: Problem) => 1.0001

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

function makeMenu(): Problem[] {
  return HEADERS.map((hd) => makeProblem(hd, Math.random() < 0.5 ? 'findV' : 'findH'))
}

// ---- minimal sound (same toolkit as the sims) ----
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
  cheer() { this.burst(900, 0.4, 0.6, 0.28) }
  clear() { this.tone(150, 0.22, 'sawtooth', 0.2) }
  miss() { this.burst(240, 1, 0.18, 0.26) }
}

type Phase = 'menu' | 'solve' | 'fly' | 'done'
type Outcome = 'goal' | 'lost' | 'timeout'

type Game = {
  phase: Phase
  picked: Problem | null
  outcome: Outcome | null
  solveElapsedMs: number
  t: number // seconds into the fly animation
  // the ball's hover position the instant the header was fired (so the leap
  // starts the cross exactly where it was hanging — no visual jump).
  fireBall: V3
  played: number
}

type Scene = {
  ball: V3
  you: { x: number; z: number; y: number; running: boolean }
  foe: { x: number; z: number; y: number; running: boolean }
  keeper: { x: number; z: number }
  contact: number
  shake: number
}

export function MatchHeaderDrill({ entry, oppColor, onResolve }: MatchDrillProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [phase, setPhase] = useState<Phase>('menu')
  const [answerStr, setAnswerStr] = useState('')
  const [showCalc, setShowCalc] = useState(false)
  const [sound, setSound] = useState(true)
  const [, force] = useState(0)
  const rerender = useCallback(() => force((n) => n + 1), [])

  const { camX } = useCameraSettle(entry.camX, SOLVE_CAMX, SETTLE_MS)
  const camXRef = useRef(entry.camX); camXRef.current = camX

  // The menu of three headers for this single attempt.
  const menuRef = useRef<Problem[]>(makeMenu())

  const gameRef = useRef<Game>({
    phase: 'menu', picked: null, outcome: null, solveElapsedMs: 0,
    t: 0, fireBall: { ...entry.ball }, played: 0,
  })

  const sfx = useRef(new Sfx())
  const soundRef = useRef(sound); soundRef.current = sound
  const showCalcRef = useRef(showCalc); showCalcRef.current = showCalc
  const answerRef = useRef(answerStr); answerRef.current = answerStr
  const onResolveRef = useRef(onResolve); onResolveRef.current = onResolve
  const resolvedRef = useRef(false)

  // YOUR PLAYER wears the equipped loadout (drives YOUR kit everywhere). The
  // marker + keeper are recoloured from the (de-clashed) opponent colour.
  const youKit = usePlayerKit<Kit>(BASE_YOU_KIT)
  const youKitRef = useRef<Kit>(youKit); youKitRef.current = youKit
  const foeKit = useRef<Kit>(makeKit(oppColor, { face: 'front', num: 4 }))
  const gkKit = useRef<Kit>(makeKit(oppColor, { face: 'front', num: 1, hairStyle: 1 }))
  useEffect(() => {
    foeKit.current = makeKit(oppColor, { face: 'front', num: 4 })
    gkKit.current = makeKit(oppColor, { face: 'front', num: 1, hairStyle: 1 })
  }, [oppColor])

  const bgRef = useRef<HTMLCanvasElement | null>(null)
  const gradRef = useRef<Gradients | null>(null)

  const settle = useCallback((success: boolean) => {
    if (resolvedRef.current) return
    resolvedRef.current = true
    onResolveRef.current?.(success)
  }, [])

  // ===== Actions =====
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

  const fire = useCallback((value: number) => {
    const g = gameRef.current
    const p = g.picked
    if (!p || g.phase !== 'solve') return
    const correct = Math.abs(value - answerOf(p)) <= tolOf(p)
    g.played = value
    g.outcome = correct ? 'goal' : 'lost'
    g.fireBall = hoverBall(entry.ball, performance.now())
    g.t = 0
    g.phase = 'fly'
    if (soundRef.current) sfx.current.ensure()
    setPhase('fly')
  }, [entry.ball])

  const playHeader = useCallback(() => {
    const g = gameRef.current
    if (g.phase !== 'solve') return
    fire(parseNum(answerRef.current))
  }, [fire])

  // The header animation finished — bury it or it was cleared. Report once.
  const finishFly = useCallback(() => {
    const g = gameRef.current
    if (g.phase !== 'fly') return
    g.phase = 'done'
    if (g.outcome === 'goal') {
      if (soundRef.current) { sfx.current.thud(); sfx.current.cheer() }
      settle(true)
    } else {
      if (soundRef.current) { sfx.current.clear(); sfx.current.miss() }
      settle(false)
    }
    setPhase('done')
  }, [settle])

  // 30 s solve clock expired without a committed header: the cross is cleared.
  const timeout = useCallback(() => {
    const g = gameRef.current
    if (g.phase !== 'solve') return
    g.outcome = 'timeout'
    g.phase = 'done'
    if (soundRef.current) { sfx.current.ensure(); sfx.current.clear() }
    settle(false)
    setPhase('done')
  }, [settle])

  const actionsRef = useRef({ playHeader, pickHeader })
  actionsRef.current = { playHeader, pickHeader }

  // ===== Input — keys 1-3 pick a header, Enter commits the answer =====
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      const g = gameRef.current
      const typing = (e.target as HTMLElement)?.tagName === 'INPUT'
      if (g.phase === 'menu' && !typing) {
        const m = menuRef.current.find((pr) => pr.header.key === e.key)
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
    const cam = camXRef.current

    const dpr = Math.min(2, window.devicePixelRatio || 1)
    const rect = canvas.getBoundingClientRect()
    const bw = Math.max(1, Math.round(rect.width * dpr))
    const bh = Math.max(1, Math.round(rect.height * dpr))
    if (canvas.width !== bw || canvas.height !== bh) { canvas.width = bw; canvas.height = bh }
    ctx.setTransform(canvas.width / W, 0, 0, canvas.height / H, 0, 0)
    ctx.clearRect(0, 0, W, H)

    if (!bgRef.current) bgRef.current = buildStaticBackground()
    if (!gradRef.current) gradRef.current = buildGradients(ctx)

    drawWorld(ctx, bgRef.current, gradRef.current, cam)

    const sc = sceneAt(g, entry, now)
    drawGoal(ctx, GOAL_Z, cam, sc.shake)

    // a leaping player: lifted feet + head so the jump reads (drawWorldPlayer
    // plants at y = 0, so for the airborne header we project the lifted anchors).
    const drawLeaper = (x: number, z: number, y: number, kit: Kit, running: boolean) => {
      if (y < 0.02) { drawWorldPlayer(ctx, { x, z }, kit, now, running, false, undefined, cam); return }
      drawPlayer(ctx, project(x, y, z, cam), project(x, y + 1.84, z, cam), kit, now, running, false)
    }

    // depth-sort the players + the airborne ball, far -> near.
    type Ent = { z: number; draw: () => void }
    const ents: Ent[] = [
      { z: sc.keeper.z, draw: () => drawWorldPlayer(ctx, sc.keeper, gkKit.current, now, false, false, undefined, cam) },
      { z: sc.foe.z, draw: () => drawLeaper(sc.foe.x, sc.foe.z, sc.foe.y, foeKit.current, sc.foe.running) },
      { z: sc.you.z, draw: () => drawLeaper(sc.you.x, sc.you.z, sc.you.y, youKitRef.current, sc.you.running) },
      { z: sc.ball.z, draw: () => drawWorldBall(ctx, sc.ball, now / 110, 0, cam) },
    ]
    ents.sort((a, b) => b.z - a.z)
    for (const e of ents) e.draw()

    // header contact flash
    if (sc.contact > 0.03) {
      const cp = project(sc.ball.x, sc.ball.y, sc.ball.z, cam)
      const r = Math.max(7, BALL_R * cp.scale)
      const k = clamp(sc.contact, 0, 1)
      ctx.save()
      ctx.globalAlpha = k * 0.85; ctx.fillStyle = 'rgba(255,255,255,0.95)'
      ctx.beginPath(); ctx.arc(cp.sx, cp.sy, r * (0.5 + 0.45 * k), 0, Math.PI * 2); ctx.fill()
      ctx.globalAlpha = k * 0.7; ctx.strokeStyle = 'rgba(255,236,180,0.95)'; ctx.lineWidth = Math.max(1.5, r * 0.14)
      ctx.beginPath(); ctx.arc(cp.sx, cp.sy, r * (1.05 + (1 - k) * 1.5), 0, Math.PI * 2); ctx.stroke()
      ctx.restore()
    }

    drawVignette(ctx, gradRef.current)
  }, [entry])

  // ===== Loop =====
  const rafRef = useRef<number | null>(null)
  useEffect(() => {
    let last = performance.now()
    const loop = (now: number) => {
      const dt = Math.min(0.04, (now - last) / 1000); last = now
      const g = gameRef.current
      if (g.phase === 'solve') {
        g.solveElapsedMs += dt * 1000 * (showCalcRef.current ? CALC_DRAIN : 1)
        if (g.solveElapsedMs >= SOLVE_MS) timeout()
      }
      if (g.phase === 'fly') {
        g.t += dt
        if (g.t >= FLY_DUR + 0.35) finishFly()
      }
      draw()
      if (gameRef.current.phase !== 'done') rerender()
      rafRef.current = requestAnimationFrame(loop)
    }
    rafRef.current = requestAnimationFrame(loop)
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current) }
  }, [draw, rerender, timeout, finishFly])

  const toggleSound = () => setSound((v) => { if (!v) sfx.current.ensure(); return !v })

  // ===== Side-panel data =====
  const g = gameRef.current
  const p = g.picked
  const left = Math.max(0, (SOLVE_MS - g.solveElapsedMs) / 1000)
  const warn = left <= SOLVE_WARN_MS / 1000
  const pct = clamp((left / (SOLVE_MS / 1000)) * 100, 0, 100)

  return (
    <div className="mhdrill">
      <div className="mhdrill__stage">
        <canvas ref={canvasRef} width={W} height={H} className="mhdrill__canvas" />
        <button type="button" className="mhdrill__sound" onClick={toggleSound} aria-label="Toggle sound">{sound ? '🔊' : '🔈'}</button>

        {/* SOLVE TIMER — the flat 30 s clock to read the cross and commit. */}
        {phase === 'solve' && (
          <div className={`mhdrill__timer${warn ? ' mhdrill__timer--warn' : ''}`}>
            <div className="mhdrill__timer-fill" style={{ width: `${pct}%` }} />
            <span>{warn ? `Hurry! ${Math.ceil(left)} s left` : `Read the leap — ${Math.ceil(left)} s`}{showCalc ? ' · calc 1.25× drain' : ''}</span>
          </div>
        )}

        {/* HEADER MENU — pick a header with its key (1/2/3) or click it. */}
        {phase === 'menu' && (
          <div className="mhdrill__menu">
            {menuRef.current.map((pr) => (
              <button key={pr.header.id} type="button" className="mhdrill__move" onClick={() => pickHeader(pr)}>
                <div className="mhdrill__move-head">
                  <span className="mhdrill__key">{pr.header.key}</span>
                  <strong>{pr.header.emoji} {pr.header.name}</strong>
                </div>
                <span className="mhdrill__move-blurb">{pr.header.blurb}</span>
                <span className="mhdrill__move-dir">{pr.dir === 'findV' ? 'find the take-off speed v = √(2gh)' : 'find the height h = v²/2g'}</span>
              </button>
            ))}
          </div>
        )}

        {/* SOLVE PANEL — the SAME energy question + grading as EnergySim. */}
        {phase === 'solve' && p && (
          <div className="mhdrill__panel">
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
                    onKeyDown={(e) => { if (e.key === 'Enter' && answerStr) { e.preventDefault(); playHeader() } }}
                    autoFocus
                  />
                </label>
              </div>
              <p className="soccer__tip" style={{ margin: '6px 0 0', fontSize: 12 }}>Round to the nearest whole number — up or down is fine.</p>
              <div className="soccer__buttons" style={{ marginTop: 12 }}>
                <button type="button" className="btn btn--primary" onClick={playHeader} disabled={!answerStr}>Go up for it ⚽</button>
              </div>
            </div>
          </div>
        )}

        {/* RESULT — a brief banner; the frame is then held for the orchestrator. */}
        {phase === 'done' && g.outcome === 'goal' && (
          <div className="mhdrill__banner mhdrill__banner--goal">
            <strong>GOAL! 🥅</strong>
            <span>{p ? `${p.header.name} buried — energy was spot on.` : 'Header buried!'}</span>
          </div>
        )}
        {phase === 'done' && g.outcome === 'lost' && (
          <div className="mhdrill__banner mhdrill__banner--miss">
            <strong>BEATEN IN THE AIR 🤿</strong>
            <span>{p ? missText(p, g.played) : 'He climbed above you and headed it clear.'}</span>
          </div>
        )}
        {phase === 'done' && g.outcome === 'timeout' && (
          <div className="mhdrill__banner mhdrill__banner--miss">
            <strong>TOO SLOW ⛔</strong>
            <span>The cross was cleared before you committed.</span>
          </div>
        )}

        {phase === 'solve' && showCalc && <Calculator onClose={() => setShowCalc(false)} />}
      </div>
    </div>
  )
}

// On a wrong answer: a one-line correction that states the exact answer.
function missText(p: Problem, used: number): string {
  if (p.dir === 'findV') {
    return used > p.v
      ? `Too much spring — ${round1(used)} m/s overshoots. v = √(2gh) = ${round1(p.v)} m/s.`
      : `Not enough spring — ${round1(used)} m/s stays low. v = √(2gh) = ${round1(p.v)} m/s.`
  }
  return used > p.h
    ? `Too high — ${round1(used)} m. h = v²/2g = ${round1(p.h)} m.`
    : `Too low — ${round1(used)} m. h = v²/2g = ${round1(p.h)} m.`
}

// ============================================================================
// SCENE — where the ball, you, the marker and the keeper are this frame.
//   • menu / solve: the cross HANGS in the air (a gentle hover) over the box
//     while you decide the header — i.e. it stays at the handoff state.
//   • fly: you leap; on a CORRECT answer you climb highest and head the cross
//     past the keeper into the goal target; on a WRONG answer the marker
//     out-jumps you and heads it clear back out of the box.
// ============================================================================
function hoverBall(base: V3, now: number): V3 {
  return { x: base.x, y: base.y + 0.45 + 0.3 * Math.sin(now / 420), z: base.z }
}

function sceneAt(g: Game, entry: MatchDrillProps['entry'], now: number): Scene {
  const youHome = entry.you
  const foeHome = entry.foe ?? { x: 1.0, z: 9.0 }
  const keeper = { x: clamp(0.1, -(GOAL_W_HALF - 1), GOAL_W_HALF - 1), z: GOAL_Z - 0.45 }

  if (g.phase !== 'fly' && g.phase !== 'done') {
    // the cross hangs in the air; everyone is set, waiting to attack.
    return {
      ball: hoverBall(entry.ball, now),
      you: { x: youHome.x, z: youHome.z, y: 0, running: false },
      foe: { x: foeHome.x, z: foeHome.z, y: 0, running: false },
      keeper,
      contact: 0, shake: 0,
    }
  }

  // The executed header. Held on the final frame once phase === 'done'.
  const u = g.phase === 'done' ? 1 : clamp(g.t / FLY_DUR, 0, 1)
  const p = g.picked
  const id: HeaderId = p ? p.header.id : 'tower'
  const won = g.outcome === 'goal'

  if (g.outcome === 'timeout') {
    // never jumped: hold the hanging cross dropping limply to the turf.
    const k = easeOut(u)
    return {
      ball: { x: entry.ball.x, y: lerp(entry.ball.y + 0.45, BALL_R, k), z: entry.ball.z },
      you: { x: youHome.x, z: youHome.z, y: 0, running: false },
      foe: { x: foeHome.x, z: foeHome.z, y: 0, running: false },
      keeper, contact: 0, shake: 0,
    }
  }

  const peak = PEAK[id]
  const groundK = easeOut(clamp(u / U_TAKEOFF, 0, 1))
  const target = goalTarget(id)

  // your run-up + leap; you drift slightly toward the post you attack.
  const youPeak = won ? peak : peak * 0.6
  const youX = lerp(youHome.x, -0.1 + target.x * 0.16, groundK)
  const youZ = lerp(youHome.z, entry.ball.z - 0.15, groundK)
  const youY = jumpArc(u, youPeak)

  // the marker: beaten to a won ball (climbs lower), out-jumps you on a loss.
  const foePeak = won ? peak * 0.5 : peak * 1.05
  const foeY = jumpArc(u, foePeak, U_TAKEOFF + (won ? 0.05 : -0.02), U_LAND)
  const foeX = lerp(foeHome.x, won ? foeHome.x : 0.3, groundK)
  const foeZ = lerp(foeHome.z, youZ + 0.1, groundK)

  // who wins the header decides where contact happens + where the ball goes.
  const winnerX = won ? youX : foeX
  const winnerZ = won ? youZ : foeZ
  const winnerPeak = won ? youPeak : foePeak
  const contactH = winnerPeak + HEAD_H
  const contactPt: V3 = { x: winnerX, y: contactH, z: winnerZ }

  const start = g.fireBall
  let ball: V3
  let shake = 0
  if (u < U_CONTACT) {
    // the cross drops onto the winner's forehead.
    const k = (u - 0) / U_CONTACT
    const ek = easeOut(k)
    ball = {
      x: lerp(start.x, contactPt.x, ek),
      y: lerp(start.y, contactH, k) + 1.1 * Math.sin(Math.PI * k),
      z: lerp(start.z, contactPt.z, ek),
    }
  } else {
    const k = (u - U_CONTACT) / (1 - U_CONTACT)
    if (won) {
      const ek = easeOut(k)
      const x = lerp(contactPt.x, target.x, ek)
      const z = lerp(contactPt.z, target.z, ek)
      let y: number
      if (id === 'flick') y = lerp(contactH, target.y, ek) // glanced flat + low
      else if (id === 'back') y = lerp(contactH, target.y, ek) + 0.8 * Math.sin(Math.PI * k) // looped across
      else y = lerp(contactH, target.y, easeIn(k)) // powered straight down
      ball = { x, y, z }
      shake = clamp((u - 0.9) / 0.08, 0, 1) // net ripple as it crosses the line
    } else {
      // headed clear: back across the box and out, down to the turf away from goal.
      const ek = easeOut(k)
      ball = {
        x: lerp(contactPt.x, foeHome.x + 3.2, ek),
        y: lerp(contactH, BALL_R, ek) + 0.7 * Math.sin(Math.PI * k),
        z: lerp(contactPt.z, winnerZ - 3.6, ek),
      }
    }
  }

  // the keeper commits toward a won header's target (and is beaten); on a loss
  // he barely moves.
  const diveK = won ? easeOut(clamp((u - U_CONTACT) / (1 - U_CONTACT), 0, 1)) : 0
  const keeperX = clamp(lerp(0.1, target.x * 0.7, diveK), -(GOAL_W_HALF - 0.6), GOAL_W_HALF - 0.6)

  return {
    ball,
    you: { x: youX, z: youZ, y: youY, running: u < U_TAKEOFF },
    foe: { x: foeX, z: foeZ, y: foeY, running: u < U_TAKEOFF },
    keeper: { x: keeperX, z: keeper.z },
    contact: pulse(u, U_CONTACT, 0.06),
    shake,
  }
}
