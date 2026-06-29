import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  project, drawWorld, drawVignette, buildStaticBackground, buildGradients,
  drawWorldPlayer, drawWorldBall, drawBall, makeKit, BASE_YOU_KIT,
  W, H, BALL_R, clamp, lerp, easeOut,
  type Kit, type Gradients, type PlayerAction, type V3,
} from '../../../lib/pitch3d'
import { usePlayerKit } from '../../../lib/playerKit'
import { drawKeeper, drawGoalNet, GK_KIT, type GkKit, type KeeperDive } from '../../sims/GoalieSim'
import { Calculator } from '../../sims/Calculator'
import { useCameraSettle, type MatchDrillProps } from '../matchDrill'

// ============================================================================
// MATCH GOALIE DRILL — the Impulse "Make the save" drill, played as ONE moment
// inside a live match on the SHARED pitch3d renderer.
//
// It is HANDED INTO by the `keeperScramble` transition: an opponent is clean
// through, bearing down on your goal, and it opens at the EXACT world state the
// transition ended in (DRILL_ENTRY['goalie']). The camera then settles into the
// solve framing while the striker bears down. You commit to a side (keys 1-3),
// solve ONE impulse–momentum question (J = Δp = m·v = F·Δt, m = 0.43 kg,
// Δt = 0.1 s), and your dive plays out. In match mode the shot goes WHERE YOU
// COMMITTED, so a correct impulse guarantees the save. One attempt only:
//   save        → onResolve(true)
//   conceded    → onResolve(false)
//   30 s timeout → onResolve(false)
// onResolve fires EXACTLY once, then the final frame is held.
//
// The keeper + goal net are lifted from GoalieSim (drawKeeper / drawGoalNet);
// the rest of the world (striker, ball, pitch) renders through pitch3d so the
// handoff from the transition reads continuously (same camera, same look).
// ============================================================================

// ---- camera / scene geometry (pitch3d world metres) ----
const SOLVE_CAMX = 0 // settle target (entry.camX is also ~0 → a calm hold)
const SETTLE_MS = 700 // camera settle + striker "bears down" duration
const GOAL_Z = 0.35 // the goal-line plane (nearest the camera), as in GoalieSim
const STRIKER_RUN_FROM = 11.5 // striker's depth at the handoff — he's bearing down from distance
const STRIKER_SET_Z = 8.0 // where he plants over the ball and strikes (a readable ~6 m shot to the line)
const STRIKER_SET_X = 2.2 // he attacks from an angle (well off-centre) so he never stacks behind the keeper
const BALL_START_X = 1.7 // ball sits just inside his planted foot
const BALL_AHEAD = 0.5 // ball sits this far in front of the striker's feet

// ---- solve economy (FLAT — no scaling) ----
const SOLVE_MS = 30000
const SOLVE_WARN_MS = 10000

// ---- save animation ----
const FLY_DUR = 1.9
const CONTACT_FRAC = 0.30

// ---- physics constants (identical to GoalieSim) ----
const BALL_M = 0.43 // kg
const DT = 0.1 // s

const parseNum = (s: string): number => { const v = parseFloat(s); return Number.isFinite(v) ? v : 0 }
const pulse = (u: number, c: number, w: number) => Math.max(0, 1 - Math.abs(u - c) / w)
const randInt = (lo: number, hi: number) => lo + Math.floor(Math.random() * (hi - lo + 1))

// ============================================================================
// IMPULSE PROBLEM (copied faithfully from GoalieSim — same givens / grading /
// tolerance / display copy). Each round each move gets an independent question.
// ============================================================================
type Dir = 'findJ' | 'findV' | 'findF' | 'findJ_fromF'
type MoveId = 'left' | 'mid' | 'right'

type MoveDef = {
  id: MoveId
  key: string
  name: string
  emoji: string
  blurb: string
  side: -1 | 0 | 1
  shot: string
}

const MOVES: MoveDef[] = [
  { id: 'left', key: '1', name: 'Dive left', emoji: '⬅️', side: -1, blurb: 'Spring low to your left post', shot: 'rifles it to your left' },
  { id: 'mid', key: '2', name: 'Watch middle', emoji: '🧤', side: 0, blurb: 'Hold the centre and catch it', shot: 'drills it down the middle' },
  { id: 'right', key: '3', name: 'Stay right', emoji: '➡️', side: 1, blurb: 'Cover the right and dive across', shot: 'curls it to your right' },
]

const DIRS: Dir[] = ['findJ', 'findV', 'findF', 'findJ_fromF']

const FORMULA: Record<Dir, string> = {
  findJ: 'J = m · v', findV: 'v = J / m', findF: 'F = J / Δt', findJ_fromF: 'J = F · Δt',
}
const ANSWER_FIELD: Record<Dir, string> = {
  findJ: 'Impulse J (N·s)', findV: 'Shot speed v (m/s)', findF: 'Force F (N)', findJ_fromF: 'Impulse J (N·s)',
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
  m: number
  dt: number
  givenVar: 'v' | 'J' | 'F'
  givenVal: number
  answerVar: 'J' | 'v' | 'F'
  answer: number
  unit: string
}

const answerOf = (p: Problem) => p.answer
// flat ±1 — rounding to the nearest whole number (up OR down) is accepted.
const tolOf = (_p: Problem) => 1.0001

function makeProblem(move: MoveDef, dir: Dir): Problem {
  const m = BALL_M, dt = DT
  const g = randInt(1, 50)
  if (dir === 'findJ') return { move, dir, m, dt, givenVar: 'v', givenVal: g, answerVar: 'J', answer: m * g, unit: 'N·s' }
  if (dir === 'findV') return { move, dir, m, dt, givenVar: 'J', givenVal: g, answerVar: 'v', answer: g / m, unit: 'm/s' }
  if (dir === 'findF') return { move, dir, m, dt, givenVar: 'J', givenVal: g, answerVar: 'F', answer: g / dt, unit: 'N' }
  return { move, dir, m, dt, givenVar: 'F', givenVal: g, answerVar: 'J', answer: g * dt, unit: 'N·s' }
}

function makeRound(): Problem[] {
  return MOVES.map((move) => makeProblem(move, DIRS[Math.floor(Math.random() * DIRS.length)]))
}

function plugText(p: Problem): string {
  if (p.dir === 'findJ') return `${p.m} · ${p.givenVal}`
  if (p.dir === 'findV') return `${p.givenVal} / ${p.m}`
  if (p.dir === 'findF') return `${p.givenVal} / ${p.dt}`
  return `${p.givenVal} · ${p.dt}`
}

function contextSentence(p: Problem): string {
  const s = p.move.shot
  if (p.dir === 'findJ') return `He ${s} at v = ${p.givenVal} m/s. What impulse J = m·v must your gloves take out of it?`
  if (p.dir === 'findV') return `He ${s} carrying momentum p = ${p.givenVal} N·s. How fast is it coming — v = J/m?`
  if (p.dir === 'findF') return `He ${s} with momentum p = ${p.givenVal} N·s and you parry it in Δt = 0.1 s. What force F = J/Δt do your hands apply?`
  return `He ${s} and your gloves push back with F = ${p.givenVal} N over Δt = 0.1 s. What impulse J = F·Δt is that?`
}

function givenList(p: Problem): { label: string; val: string; key?: boolean }[] {
  if (p.dir === 'findJ') return [{ label: 'Ball mass', val: `m = ${p.m} kg` }, { label: 'Shot speed', val: `v = ${p.givenVal} m/s`, key: true }]
  if (p.dir === 'findV') return [{ label: 'Ball mass', val: `m = ${p.m} kg` }, { label: 'Momentum', val: `p = ${p.givenVal} N·s`, key: true }]
  if (p.dir === 'findF') return [{ label: 'Contact time', val: `Δt = ${p.dt} s` }, { label: 'Momentum', val: `p = ${p.givenVal} N·s`, key: true }]
  return [{ label: 'Contact time', val: `Δt = ${p.dt} s` }, { label: 'Hand force', val: `F = ${p.givenVal} N`, key: true }]
}

// ============================================================================
// SCENE — the striker plant + strike, the ball's flight and the keeper's dive at
// progress u ∈ [0,1]. Mirrors GoalieSim.saveScene with the match's geometry: the
// striker plants and strikes from STRIKER_SET_Z (~8 m out, a touch off-centre) so
// the shot travels a readable arc to the keeper near the goal line (keeperZ).
// ============================================================================
type FlyScene = {
  striker: { x: number; z: number; running: boolean; foot: V3 | null; lean: number }
  ball: V3
  keeper: KeeperDive | null
  caught: boolean
  netBulge: number
  netAt: V3 | null
  contact: number
}

function matchFlyScene(
  side: number | null, shotDir: number, fate: 'save' | 'goal', yTarget: number, keeperZ: number, u: number,
): FlyScene {
  const cF = CONTACT_FRAC
  const targetX = shotDir * 2.4
  const setZ = STRIKER_SET_Z
  const setX = STRIKER_SET_X
  const ballZ0 = setZ - BALL_AHEAD
  const ballX0 = BALL_START_X

  // striker: plant over the ball, strike at contact, short follow-through
  const strikerAt = () => {
    if (u < cF) {
      const inContact = u > cF - 0.08 && u < cF + 0.03
      return { x: setX, z: setZ, running: false, foot: inContact ? { x: lerp(setX, ballX0, 0.5), y: BALL_R, z: ballZ0 + 0.05 } : null, lean: shotDir * 0.2 }
    }
    const k = easeOut((u - cF) / (1 - cF))
    return { x: lerp(setX, setX + shotDir * 0.4, k * 0.6), z: lerp(setZ, setZ - 0.5, k), running: false, foot: null, lean: shotDir * 0.25 * (1 - k) }
  }

  // ball: at his feet, then struck toward the committed corner (or the net)
  const ballAt = (): V3 => {
    if (u < cF) return { x: ballX0, y: BALL_R, z: ballZ0 }
    const k = clamp((u - cF) / (1 - cF), 0, 1)
    const e = easeOut(k)
    const endZ = fate === 'save' ? keeperZ : GOAL_Z
    const z = lerp(ballZ0, endZ, e)
    const x = lerp(ballX0, targetX, e)
    const arc = Math.sin(Math.PI * Math.min(1, k)) * 0.5
    const y = Math.max(BALL_R, lerp(BALL_R, yTarget, e) + arc)
    return { x, y, z }
  }

  // keeper: commits to the chosen side and dives so the gloves meet the ball at u≈1
  const dStart = cF + 0.02
  const d = clamp((u - dStart) / 0.62, 0, 1)
  const reach: V3 = { x: (side ?? 0) * 2.4, y: yTarget, z: keeperZ }
  const keeper: KeeperDive | null = side != null && u >= dStart ? { t: d, reach, beaten: fate === 'goal' } : null
  const caught = fate === 'save' && d >= 0.9
  const netBulge = fate === 'goal' ? clamp((u - 0.9) / 0.1, 0, 1) : 0
  const netAt = fate === 'goal' ? { x: targetX, y: yTarget, z: GOAL_Z } : null
  const contact = pulse(u, cF, 0.05)

  return { striker: strikerAt(), ball: ballAt(), keeper, caught, netBulge, netAt, contact }
}

// ============================================================================
type Phase = 'menu' | 'solve' | 'fly' | 'result'
type Game = {
  phase: Phase
  problems: Problem[]
  picked: Problem | null
  side: number | null
  shotDir: number
  fate: 'save' | 'goal'
  yTarget: number
  solveMs: number
  t: number
  resolved: boolean
}

export function MatchGoalieDrill({ entry, teamColor, oppColor, onResolve }: MatchDrillProps) {
  const youKit = usePlayerKit<Kit>(BASE_YOU_KIT)
  // YOUR keeper wears your team colours over the GK glove kit.
  const keeperKit = useMemo<GkKit>(() => ({
    jersey: youKit.jersey, jerseyDark: youKit.jerseyDark, jerseyHi: youKit.jerseyHi,
    collar: youKit.collar, shorts: youKit.shorts, sock: youKit.sock, sockBand: youKit.sockBand,
    boot: youKit.boot, skin: youKit.skin, skinDark: youKit.skinDark,
    glove: GK_KIT.glove, gloveCuff: youKit.accent ?? GK_KIT.gloveCuff, hair: youKit.hair,
  }), [youKit])
  const strikerKit = useMemo<Kit>(() => makeKit(oppColor, { face: 'front', num: 9 }), [oppColor])
  void teamColor // your kit already drives the keeper; teamColor kept for contract parity

  const { camX } = useCameraSettle(entry.camX, SOLVE_CAMX, SETTLE_MS)

  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [phase, setPhase] = useState<Phase>('menu')
  const [answerStr, setAnswerStr] = useState('')
  const [showCalc, setShowCalc] = useState(false)
  const [, force] = useState(0)
  const rerender = useCallback(() => force((n) => n + 1), [])

  const gameRef = useRef<Game>({
    phase: 'menu', problems: makeRound(), picked: null, side: null, shotDir: 0,
    fate: 'goal', yTarget: 1.05, solveMs: 0, t: 0, resolved: false,
  })
  const rafRef = useRef<number | null>(null)
  const bgRef = useRef<HTMLCanvasElement | null>(null)
  const gradRef = useRef<Gradients | null>(null)
  const mountRef = useRef<number>(performance.now())
  const camXRef = useRef(camX); camXRef.current = camX
  const answerRef = useRef(answerStr); answerRef.current = answerStr
  const keeperKitRef = useRef(keeperKit); keeperKitRef.current = keeperKit
  const strikerKitRef = useRef(strikerKit); strikerKitRef.current = strikerKit

  // single-shot resolve (ref-guarded), per the match-drill contract
  const onResolveRef = useRef(onResolve); onResolveRef.current = onResolve
  const resolvedOnceRef = useRef(false)
  const resolveOnce = useCallback((success: boolean) => {
    if (resolvedOnceRef.current) return
    resolvedOnceRef.current = true
    onResolveRef.current?.(success)
  }, [])

  // ===== actions =====
  const pickMove = useCallback((p: Problem) => {
    const g = gameRef.current
    if (g.phase !== 'menu') return
    g.picked = p
    g.solveMs = 0
    g.phase = 'solve'
    setAnswerStr('')
    setPhase('solve')
  }, [])

  const fire = useCallback((value: number) => {
    const g = gameRef.current
    const p = g.picked
    if (!p || g.phase !== 'solve') return
    const correct = Math.abs(value - answerOf(p)) <= tolOf(p)
    // MATCH MODE: the shot goes WHERE YOU COMMITTED, so a correct impulse saves.
    g.side = p.move.side
    g.shotDir = p.move.side
    g.fate = correct ? 'save' : 'goal'
    g.yTarget = p.move.side === 0 ? 0.95 : 1.1
    g.t = 0
    g.phase = 'fly'
    setShowCalc(false)
    setPhase('fly')
  }, [])

  const playMove = useCallback(() => {
    fire(parseNum(answerRef.current))
  }, [fire])

  // ran out of time: he buries it down the middle of an empty net (keeper rooted)
  const timeout = useCallback(() => {
    const g = gameRef.current
    if (g.phase !== 'solve') return
    g.side = null
    g.shotDir = 0
    g.fate = 'goal'
    g.yTarget = 0.95
    g.t = 0
    g.phase = 'fly'
    setShowCalc(false)
    setPhase('fly')
  }, [])

  const resolve = useCallback(() => {
    const g = gameRef.current
    if (g.resolved) return
    g.resolved = true
    g.phase = 'result'
    setPhase('result')
    resolveOnce(g.fate === 'save')
  }, [resolveOnce])

  const actionsRef = useRef({ playMove, timeout, resolve, pickMove })
  actionsRef.current = { playMove, timeout, resolve, pickMove }

  // ===== input =====
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      const g = gameRef.current
      const typing = (e.target as HTMLElement)?.tagName === 'INPUT'
      if (g.phase === 'menu' && !typing) {
        const pr = g.problems.find((q) => q.move.key === e.key)
        if (pr) { e.preventDefault(); actionsRef.current.pickMove(pr) }
        return
      }
      if ((e.key === 'Enter' || e.key === ' ' || e.code === 'Space') && !typing) {
        if (g.phase === 'solve' && answerRef.current) { e.preventDefault(); actionsRef.current.playMove() }
      }
    }
    window.addEventListener('keydown', down)
    return () => window.removeEventListener('keydown', down)
  }, [])

  // ===== draw =====
  const draw = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const g = gameRef.current
    const now = performance.now()
    const cx = camXRef.current
    const proj = (x: number, y: number, z: number) => project(x, y, z, cx)

    const dpr = Math.min(2, window.devicePixelRatio || 1)
    const rect = canvas.getBoundingClientRect()
    const bw = Math.max(1, Math.round(rect.width * dpr))
    const bh = Math.max(1, Math.round(rect.height * dpr))
    if (canvas.width !== bw || canvas.height !== bh) { canvas.width = bw; canvas.height = bh }
    ctx.setTransform(canvas.width / W, 0, 0, canvas.height / H, 0, 0)
    ctx.clearRect(0, 0, W, H)

    if (!gradRef.current) gradRef.current = buildGradients(ctx)
    if (!bgRef.current) bgRef.current = buildStaticBackground()
    drawWorld(ctx, bgRef.current, gradRef.current, cx)

    const drawContact = (pt: V3, intensity: number) => {
      if (intensity <= 0.03) return
      const p = proj(pt.x, pt.y, pt.z)
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

    if (g.phase === 'fly' || g.phase === 'result') {
      const u = g.phase === 'fly' ? clamp(g.t / FLY_DUR, 0, 1) : 1
      const sc = matchFlyScene(g.side, g.shotDir, g.fate, g.yTarget, entry.you.z, u)
      // far → near: striker, then ball/keeper by depth, then the goal net on top.
      let strikerAct: PlayerAction | undefined
      if (sc.striker.foot) {
        const fp = proj(sc.striker.foot.x, sc.striker.foot.y, sc.striker.foot.z)
        strikerAct = { footX: fp.sx, footY: fp.sy, lean: sc.striker.lean }
      }
      drawWorldPlayer(ctx, { x: sc.striker.x, z: sc.striker.z }, strikerKitRef.current, now, sc.striker.running, false, strikerAct, cx)
      const ballBehindKeeper = sc.ball.z > entry.you.z + 0.25
      if (ballBehindKeeper) drawWorldBall(ctx, sc.ball, g.t * 11, sc.contact * 0.4, cx)
      drawKeeper(ctx, proj, 0, entry.you.z, sc.keeper, now, keeperKitRef.current)
      if (!ballBehindKeeper && !sc.caught) drawWorldBall(ctx, sc.ball, g.t * 11, sc.contact * 0.4, cx)
      if (sc.caught && sc.keeper) {
        const gp = proj(sc.keeper.reach.x, sc.keeper.reach.y, sc.keeper.reach.z)
        drawBall(ctx, gp.sx, gp.sy, Math.max(4, BALL_R * gp.scale), now / 400, 0)
      }
      if (sc.contact > 0.03) drawContact({ x: BALL_START_X, y: BALL_R + 0.2, z: STRIKER_SET_Z - BALL_AHEAD }, sc.contact)
      const np = sc.netAt ? proj(sc.netAt.x, sc.netAt.y, sc.netAt.z) : null
      drawGoalNet(ctx, proj, sc.netBulge, np ? np.sx : null, np ? np.sy : null)
    } else {
      // menu / solve: the striker bears down from distance over the ball, you hold a ready stance.
      const approach = clamp((now - mountRef.current) / SETTLE_MS, 0, 1)
      const sz = lerp(entry.foe?.z ?? STRIKER_RUN_FROM, STRIKER_SET_Z, easeOut(approach))
      const sx = lerp(entry.foe?.x ?? STRIKER_SET_X, STRIKER_SET_X, easeOut(approach))
      const bz = sz - BALL_AHEAD
      const ball: V3 = { x: BALL_START_X, y: BALL_R, z: bz }
      const fp = proj(ball.x, ball.y, ball.z)
      const strikerAct: PlayerAction = { footX: fp.sx, footY: fp.sy, lean: 0.18 }
      drawWorldPlayer(ctx, { x: sx, z: sz }, strikerKitRef.current, now, approach < 1, false, strikerAct, cx)
      drawWorldBall(ctx, ball, now / 220, 0, cx)
      const shuffle = Math.sin(now / 520) * 0.18
      drawKeeper(ctx, proj, shuffle, entry.you.z, null, now, keeperKitRef.current)
      drawGoalNet(ctx, proj, 0, null, null)
    }

    drawVignette(ctx, gradRef.current)
  }, [entry])

  // ===== loop =====
  useEffect(() => {
    let last = performance.now()
    const update = (dt: number) => {
      const g = gameRef.current
      const act = actionsRef.current
      if (g.phase === 'solve') {
        g.solveMs += dt * 1000
        if (g.solveMs >= SOLVE_MS) act.timeout()
      }
      if (g.phase === 'fly') {
        g.t += dt
        if (g.t >= FLY_DUR + 0.3) act.resolve()
      }
    }
    const loop = (now: number) => {
      const dt = Math.min(0.04, (now - last) / 1000); last = now
      update(dt)
      draw()
      const ph = gameRef.current.phase
      if (ph === 'menu' || ph === 'solve' || ph === 'fly') rerender()
      rafRef.current = requestAnimationFrame(loop)
    }
    rafRef.current = requestAnimationFrame(loop)
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current) }
  }, [draw, rerender])

  // ===== overlay data =====
  const g = gameRef.current
  const p = g.picked
  const left = Math.max(0, (SOLVE_MS - g.solveMs) / 1000)
  const warn = left <= SOLVE_WARN_MS / 1000

  return (
    <div className={`sim soccer${phase === 'solve' ? ' soccer--solving' : ''}`}>
      <div className="soccer__stage">
        <canvas
          ref={canvasRef}
          width={W}
          height={H}
          className={`soccer__canvas soccer__canvas--${phase === 'menu' ? 'meter' : phase}`}
        />

        {/* SAVE MENU — commit to a side with the key shown, or click it. */}
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

        {/* result feedback — non-interactive; the orchestrator owns what's next. */}
        {phase === 'result' && (
          <div className={`soccer__banner ${g.fate === 'save' ? 'soccer__banner--goal' : 'soccer__banner--save'}`} style={{ pointerEvents: 'none' }}>
            <strong>{g.fate === 'save' ? 'SAVED IT! 🧤' : 'HE SCORED 😖'}</strong>
            <span>{g.fate === 'save'
              ? `${p?.move.name ?? 'The save'} timed perfectly — you took the shot's momentum away.`
              : 'The shot beat your hands this time.'}</span>
          </div>
        )}

        {phase === 'solve' && showCalc && <Calculator onClose={() => setShowCalc(false)} />}
      </div>

      <div className="soccer__side">
        {phase === 'menu' && (
          <div className="soccer__givens">
            <div className="is-key"><span>A save is</span><strong>J = Δp</strong></div>
            <div><span>Ball mass</span><strong>m = 0.43 kg</strong></div>
            <div className="is-key"><span>Shot goes</span><strong>your way</strong></div>
          </div>
        )}

        {phase === 'solve' && p && (
          <>
            <div className="soccer__givens">
              <div className="is-key"><span>Save</span><strong>{p.move.emoji} {p.move.name}</strong></div>
              <div className={warn ? 'is-key' : undefined}><span>Time left</span><strong style={warn ? { color: '#ff6b8a' } : undefined}>{left.toFixed(1)}s</strong></div>
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

        <div className="sim__controls">
          <div className="soccer__buttons">
            {phase === 'menu' && <button type="button" className="btn btn--primary" disabled>Pick a side ▸</button>}
            {phase === 'solve' && <button type="button" className="btn btn--primary" onClick={playMove} disabled={!answerStr}>Make the save 🧤</button>}
            {phase === 'fly' && <button type="button" className="btn btn--primary" disabled>Here it comes…</button>}
            {phase === 'result' && <button type="button" className="btn btn--primary" disabled>{g.fate === 'save' ? 'Saved!' : 'Conceded'}</button>}
          </div>
        </div>
      </div>
    </div>
  )
}
