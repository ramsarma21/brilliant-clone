import { useMemo } from 'react'
import { Slider } from '../ui/Slider'
import { Readout } from './ProjectileSim'
import { forces, round } from '../../lib/physics'
import type { SimProps } from './types'
import { n } from './types'

const VW = 420
const VH = 200

export function ForcesSim({ state, onChange }: SimProps) {
  const force = n(state, 'force', 20)
  const mass = n(state, 'mass', 5)
  const friction = n(state, 'friction', 0.3)
  const g = n(state, 'gravity', 9.8)

  const result = useMemo(() => forces(force, mass, friction, g), [force, mass, friction, g])

  const groundY = VH - 40
  const crateSize = 38 + mass * 3
  const crateX = 70
  const arrowScale = 1.1

  return (
    <div className="sim">
      <svg className="sim__canvas" viewBox={`0 0 ${VW} ${VH}`} role="img" aria-label="Crate on a surface with force arrows">
        <rect x="0" y="0" width={VW} height={VH} rx="12" className="sim__bg" />
        <line x1="10" y1={groundY} x2={VW - 10} y2={groundY} className="sim__ground" />

        <rect
          x={crateX}
          y={groundY - crateSize}
          width={crateSize}
          height={crateSize}
          rx="6"
          className={result.isMoving ? 'sim__crate sim__crate--moving' : 'sim__crate'}
        />

        {/* applied force arrow */}
        <Arrow
          x={crateX + crateSize}
          y={groundY - crateSize / 2}
          dx={force * arrowScale}
          color="var(--accent)"
          label={`F=${round(force)}N`}
        />
        {/* friction arrow (opposing) */}
        <Arrow
          x={crateX}
          y={groundY - crateSize / 2}
          dx={-(result.isMoving ? result.kineticFriction : Math.min(force, result.maxStaticFriction)) * arrowScale}
          color="#e2725b"
          label="friction"
        />
      </svg>

      <div className="sim__readouts">
        <Readout label="Net force" value={`${round(result.netForce)} N`} />
        <Readout label="Acceleration" value={`${round(result.acceleration, 2)} m/s²`} />
        <Readout label="Status" value={result.isMoving ? 'Moving' : 'At rest'} />
      </div>

      <div className="sim__controls">
        <Slider label="Applied force" value={force} min={0} max={120} step={1} unit="N" onChange={(v) => onChange({ ...state, force: v })} />
        <Slider label="Mass" value={mass} min={1} max={20} step={1} unit="kg" onChange={(v) => onChange({ ...state, mass: v })} />
        <Slider label="Friction (μ)" value={friction} min={0} max={0.8} step={0.05} onChange={(v) => onChange({ ...state, friction: v })} />
      </div>
    </div>
  )
}

function Arrow({
  x,
  y,
  dx,
  color,
  label,
}: {
  x: number
  y: number
  dx: number
  color: string
  label: string
}) {
  if (Math.abs(dx) < 1) return null
  const x2 = x + dx
  const dir = Math.sign(dx)
  const head = 7 * dir
  return (
    <g className="sim__arrow" style={{ stroke: color, fill: color }}>
      <line x1={x} y1={y} x2={x2} y2={y} strokeWidth="3" />
      <polygon points={`${x2},${y} ${x2 - head},${y - 5} ${x2 - head},${y + 5}`} />
      <text x={(x + x2) / 2} y={y - 10} className="sim__arrow-text" textAnchor="middle">
        {label}
      </text>
    </g>
  )
}
