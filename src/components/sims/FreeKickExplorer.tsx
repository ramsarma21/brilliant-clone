import { useEffect, useRef, useState } from 'react'
import { Slider } from '../ui/Slider'
import { projectilePoint, round } from '../../lib/physics'
import { sfxKick, sfxCheer, sfxWhistle } from '../../game/sfx'
import type { SimProps } from './types'
import { n } from './types'

// ============================================================================
// FREE-KICK EXPLORER — the interactive, PhET-style slider sandbox for the
// Kinematics lesson. You DRAG launch speed + angle and watch the trajectory
// bend toward the goal in real time, with the physics read out live
// (vₓ = v·cosθ, v_y = v·sinθ, height at the goal line, time of flight). Then
// you take the shot. This is the LEARNING surface — pure exploration of the
// relationship — and it is deliberately NOT the arcade match minigame.
// ============================================================================

const VW = 460
const VH = 250
const PAD = 30
const WORLD_X = 30 // metres shown across
const WORLD_Y = 13 // metres shown up
const G = 10
const D = 24 // distance to the goal line (m)
const GOAL_H = 2.6 // crossbar height (m)
const TARGET_Y = 2.0 // the spot you aim for, up in the corner (m)
const TARGET_R = 0.55 // how close the ball must pass to score (m)
const KEEP_COVER = 1.1 // the keeper covers everything below this through the middle (m)

type Outcome = 'short' | 'over' | 'saved' | 'goal'

function analyse(speed: number, angle: number): { yAtGoal: number; range: number; outcome: Outcome } {
  const rad = (angle * Math.PI) / 180
  const vx = speed * Math.cos(rad)
  const vy = speed * Math.sin(rad)
  const tof = (2 * vy) / G
  const range = vx * tof
  const tGoal = vx > 0.01 ? D / vx : Infinity
  const yAtGoal = vy * tGoal - 0.5 * G * tGoal * tGoal
  let outcome: Outcome
  if (range < D || yAtGoal < 0) outcome = 'short'
  else if (yAtGoal > GOAL_H) outcome = 'over'
  else if (Math.abs(yAtGoal - TARGET_Y) <= TARGET_R) outcome = 'goal'
  else outcome = 'saved' // inside the goal but not in the corner — keeper gets there
  return { yAtGoal, range, outcome }
}

export function FreeKickExplorer({ state, onChange, showGoal, onGoal }: SimProps) {
  const speed = n(state, 'speed', 18)
  const angle = n(state, 'angle', 20)
  const scored = n(state, 'scored', 0)

  const toX = (mx: number) => PAD + (mx / WORLD_X) * (VW - 2 * PAD)
  const toY = (my: number) => VH - PAD - (my / WORLD_Y) * (VH - 2 * PAD)

  const rad = (angle * Math.PI) / 180
  const vx = speed * Math.cos(rad)
  const vy = speed * Math.sin(rad)
  const live = analyse(speed, angle)
  const tGoal = vx > 0.01 ? D / vx : 0

  const [flying, setFlying] = useState(false)
  const [ball, setBall] = useState<{ x: number; y: number } | null>(null)
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null)
  const rafRef = useRef<number | undefined>(undefined)
  const firedGoal = useRef(false)

  useEffect(() => () => { if (rafRef.current) cancelAnimationFrame(rafRef.current) }, [])

  // sample the predicted arc up to the goal line (or landing)
  const arc: string[] = []
  {
    const tof = (2 * vy) / G
    const tEnd = Math.min(Number.isFinite(tGoal) && tGoal > 0 ? tGoal * 1.04 : tof, Math.max(tof, 0.1))
    const steps = 48
    for (let i = 0; i <= steps; i++) {
      const t = (tEnd * i) / steps
      const p = projectilePoint(speed, angle, t, G)
      if (p.y < 0) break
      arc.push(`${toX(p.x).toFixed(1)},${toY(p.y).toFixed(1)}`)
    }
  }

  function shoot() {
    if (flying) return
    setMsg(null)
    setFlying(true)
    sfxKick()
    const shotSpeed = speed
    const shotAngle = angle
    const verdict = analyse(shotSpeed, shotAngle)
    const start = performance.now()
    const SPEEDUP = 1.7
    const tick = (now: number) => {
      const t = ((now - start) / 1000) * SPEEDUP
      const p = projectilePoint(shotSpeed, shotAngle, t, G)
      const reachedGoal = p.x >= D
      const landed = p.y < 0 && t > 0.05
      if (reachedGoal || landed) {
        setBall({ x: Math.min(p.x, D), y: Math.max(0, reachedGoal ? verdict.yAtGoal : 0) })
        setFlying(false)
        if (verdict.outcome === 'goal') {
          sfxCheer()
          setMsg({ text: 'Top corner! The ball was at the right height exactly when it reached the goal.', ok: true })
          onChange({ ...state, speed: shotSpeed, angle: shotAngle, scored: scored + 1 })
          if (!firedGoal.current) { firedGoal.current = true; onGoal?.() }
        } else {
          sfxWhistle()
          const why =
            verdict.outcome === 'over' ? 'Over the bar. Too much height for this distance — flatten the angle or take pace off.'
            : verdict.outcome === 'short' ? 'Dropped short. It never reached the goal line — add pace or lift the angle.'
            : 'Keeper saves it. In the goal, but not up in the corner — aim higher into the target ring.'
          setMsg({ text: why, ok: false })
        }
        return
      }
      setBall(p)
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
  }

  const verdictLabel =
    live.outcome === 'goal' ? 'on target' : live.outcome === 'over' ? 'over the bar' : live.outcome === 'short' ? 'drops short' : "in the keeper's reach"
  const verdictClass = live.outcome === 'goal' ? 'out-in' : live.outcome === 'short' ? 'out-short' : 'out-over'

  const groundY = toY(0)
  const shownBall = ball ?? { x: 0, y: 0 }

  return (
    <div className="sim">
      <svg className="sim__canvas" viewBox={`0 0 ${VW} ${VH}`} role="img" aria-label="Free-kick trajectory">
        <rect x="0" y="0" width={VW} height={VH} rx="12" className="sim__bg" />
        <line x1={PAD} y1={groundY} x2={VW - PAD} y2={groundY} className="sim__ground" />

        {/* goal frame at the goal line */}
        <line x1={toX(D)} y1={groundY} x2={toX(D)} y2={toY(GOAL_H)} stroke="#e9eefc" strokeWidth={3} />
        <line x1={toX(D)} y1={toY(GOAL_H)} x2={toX(D) + 30} y2={toY(GOAL_H)} stroke="#e9eefc" strokeWidth={3} />
        <line x1={toX(D) + 30} y1={toY(GOAL_H)} x2={toX(D) + 30} y2={groundY} stroke="#e9eefc" strokeWidth={2} opacity={0.5} />
        {/* net hint */}
        {[0.5, 1.3, 2.1].map((h) => (
          <line key={h} x1={toX(D)} y1={toY(h)} x2={toX(D) + 30} y2={toY(h)} stroke="#9aa3c4" strokeWidth={0.6} opacity={0.35} />
        ))}

        {/* keeper (flavour: shows the low/central area that's covered) */}
        <rect x={toX(D - 2.2)} y={toY(KEEP_COVER)} width={toX(D) - toX(D - 2.2)} height={groundY - toY(KEEP_COVER)} fill="#f5a623" opacity={0.18} />
        <rect x={toX(D - 1.1) - 4} y={toY(1.7)} width={8} height={toY(0) - toY(1.7)} rx={3} fill="#f5a623" opacity={0.8} />

        {/* target ring up in the corner */}
        {showGoal !== false && (
          <circle
            cx={toX(D)} cy={toY(TARGET_Y)} r={(TARGET_R / WORLD_Y) * (VH - 2 * PAD)}
            className={live.outcome === 'goal' ? 'sim__flag sim__flag--hit' : 'sim__flag'}
            fill="none" strokeWidth={3} stroke={live.outcome === 'goal' ? '#3fd17a' : '#ffd23f'}
            opacity={0.95}
          />
        )}

        {/* predicted dashed arc */}
        <polyline points={arc.join(' ')} fill="none" stroke="#7ec8ff" strokeWidth={2} strokeDasharray="5 5" opacity={0.85} />

        {/* the kicker */}
        <circle cx={toX(0)} cy={groundY} r={5} className="sim__pivot" />
        <line x1={toX(0)} y1={groundY} x2={toX(0) + Math.cos(rad) * 26} y2={groundY - Math.sin(rad) * 26} className="sim__launcher" />

        {/* live ball */}
        <circle cx={toX(shownBall.x)} cy={toY(shownBall.y)} r={5} fill="#ffffff" stroke="#1a1a1a" strokeWidth={1} />
      </svg>

      <div className="sim__readouts">
        <Readout label="vₓ = v·cosθ" value={`${round(vx)} m/s`} />
        <Readout label="v_y = v·sinθ" value={`${round(vy)} m/s`} />
        <Readout label="Height at goal" value={live.outcome === 'short' ? '— (short)' : `${round(Math.max(0, live.yAtGoal))} m`} />
        <Readout label="Time to goal" value={Number.isFinite(tGoal) && tGoal > 0 ? `${round(tGoal, 2)} s` : '—'} />
      </div>

      <p className="sim__verdict">
        Predicted: <b className={verdictClass}>{verdictLabel}</b>
        {scored > 0 && <span className="sim__scored"> · {scored} scored</span>}
      </p>
      {msg && <p className={`sim__msg ${msg.ok ? 'out-in' : 'out-over'}`}>{msg.text}</p>}

      <div className="sim__controls">
        <Slider label="Launch speed v" value={speed} min={10} max={30} step={1} unit="m/s" onChange={(v) => onChange({ ...state, speed: v })} />
        <Slider label="Launch angle θ" value={angle} min={5} max={55} step={1} unit="°" onChange={(v) => onChange({ ...state, angle: v })} />
      </div>

      <div className="sim__actions">
        <button className="btn btn--primary" disabled={flying} onClick={shoot}>Take the shot ⚽</button>
      </div>
    </div>
  )
}

function Readout({ label, value }: { label: string; value: string }) {
  return (
    <div className="readout">
      <span className="readout__label">{label}</span>
      <span className="readout__value">{value}</span>
    </div>
  )
}
