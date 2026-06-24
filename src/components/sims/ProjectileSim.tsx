import { useMemo } from 'react'
import { Slider } from '../ui/Slider'
import { projectile, projectilePoint, round } from '../../lib/physics'
import type { SimProps } from './types'
import { n } from './types'

const VW = 420
const VH = 240
const PAD = 28
const WORLD_X = 60 // meters across
const WORLD_Y = 30 // meters tall
const TARGET = 40
const HEIGHT_LIMIT = 12

export function ProjectileSim({ state, onChange, showGoal }: SimProps) {
  const speed = n(state, 'speed', 20)
  const angle = n(state, 'angle', 45)
  const g = n(state, 'gravity', 9.8)

  const result = useMemo(() => projectile(speed, angle, g), [speed, angle, g])

  const toX = (mx: number) => PAD + (mx / WORLD_X) * (VW - 2 * PAD)
  const toY = (my: number) => VH - PAD - (my / WORLD_Y) * (VH - 2 * PAD)

  const path = useMemo(() => {
    const pts: string[] = []
    const steps = 60
    const tof = result.timeOfFlight
    for (let i = 0; i <= steps; i++) {
      const t = (tof * i) / steps
      const p = projectilePoint(speed, angle, t, g)
      pts.push(`${toX(p.x).toFixed(1)},${toY(Math.max(0, p.y)).toFixed(1)}`)
    }
    return pts.join(' ')
  }, [speed, angle, g, result.timeOfFlight])

  const landX = toX(result.range)
  const groundY = toY(0)
  const launcherLen = 26
  const rad = (angle * Math.PI) / 180

  const onTarget = Math.abs(result.range - TARGET) <= 1.5 && result.maxHeight <= HEIGHT_LIMIT

  return (
    <div className="sim">
      <svg className="sim__canvas" viewBox={`0 0 ${VW} ${VH}`} role="img" aria-label="Projectile trajectory">
        <rect x="0" y="0" width={VW} height={VH} rx="12" className="sim__bg" />
        <line x1={PAD} y1={groundY} x2={VW - PAD} y2={groundY} className="sim__ground" />

        {showGoal && (
          <>
            <line
              x1={PAD}
              y1={toY(HEIGHT_LIMIT)}
              x2={VW - PAD}
              y2={toY(HEIGHT_LIMIT)}
              className="sim__limit"
            />
            <text x={PAD + 4} y={toY(HEIGHT_LIMIT) - 4} className="sim__limit-text">
              height limit {HEIGHT_LIMIT} m
            </text>
            <g>
              <line x1={toX(TARGET)} y1={groundY} x2={toX(TARGET)} y2={groundY - 26} className="sim__flagpole" />
              <polygon
                points={`${toX(TARGET)},${groundY - 26} ${toX(TARGET) + 16},${groundY - 21} ${toX(TARGET)},${groundY - 16}`}
                className={onTarget ? 'sim__flag sim__flag--hit' : 'sim__flag'}
              />
            </g>
          </>
        )}

        <polyline points={path} className="sim__trajectory" fill="none" />

        {/* launcher */}
        <line
          x1={toX(0)}
          y1={groundY}
          x2={toX(0) + Math.cos(rad) * launcherLen}
          y2={groundY - Math.sin(rad) * launcherLen}
          className="sim__launcher"
        />
        <circle cx={toX(0)} cy={groundY} r="5" className="sim__pivot" />
        <circle cx={landX} cy={groundY} r="4" className="sim__landing" />
      </svg>

      <div className="sim__readouts">
        <Readout label="Range" value={`${round(result.range)} m`} />
        <Readout label="Max height" value={`${round(result.maxHeight)} m`} />
        <Readout label="Time of flight" value={`${round(result.timeOfFlight, 2)} s`} />
      </div>

      <div className="sim__controls">
        <Slider
          label="Launch speed"
          value={speed}
          min={5}
          max={50}
          step={1}
          unit="m/s"
          onChange={(v) => onChange({ ...state, speed: v })}
        />
        <Slider
          label="Launch angle"
          value={angle}
          min={0}
          max={90}
          step={1}
          unit="°"
          onChange={(v) => onChange({ ...state, angle: v })}
        />
      </div>
    </div>
  )
}

export function Readout({ label, value }: { label: string; value: string }) {
  return (
    <div className="readout">
      <span className="readout__label">{label}</span>
      <span className="readout__value">{value}</span>
    </div>
  )
}
