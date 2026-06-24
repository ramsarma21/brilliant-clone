import { useMemo } from 'react'
import { Slider } from '../ui/Slider'
import { Readout } from './ProjectileSim'
import { energy, frictionlessFinalSpeed, round } from '../../lib/physics'
import type { SimProps } from './types'
import { n } from './types'

const VW = 420
const VH = 200

export function EnergySim({ state, onChange }: SimProps) {
  const height = n(state, 'height', 5)
  const mass = n(state, 'mass', 2)
  const friction = n(state, 'friction', 0)
  const g = n(state, 'gravity', 9.8)

  const result = useMemo(() => energy(mass, height, friction, g), [mass, height, friction, g])
  const finalSpeed =
    friction > 0.001 ? result.finalSpeed : frictionlessFinalSpeed(height, g)

  // Ramp geometry: fixed base, height scales the apex.
  const baseY = VH - 30
  const leftX = 40
  const rightX = 230
  const apexY = baseY - 12 - (height / 10) * (baseY - 40)

  const total = result.potentialEnergy || 1
  const peFrac = 1
  const keFrac = result.kineticEnergy / total
  const thFrac = result.thermalEnergy / total

  const barArea = { x: 270, y: 40, w: 110, h: baseY - 40 }
  const barW = 28
  const gap = 12

  const drawBar = (i: number, frac: number, color: string, label: string) => {
    const h = Math.max(2, frac * barArea.h)
    const x = barArea.x + i * (barW + gap)
    const y = barArea.y + barArea.h - h
    return (
      <g key={label}>
        <rect x={x} y={y} width={barW} height={h} rx="3" style={{ fill: color }} />
        <text x={x + barW / 2} y={barArea.y + barArea.h + 14} textAnchor="middle" className="sim__axis-text">
          {label}
        </text>
      </g>
    )
  }

  return (
    <div className="sim">
      <svg className="sim__canvas" viewBox={`0 0 ${VW} ${VH}`} role="img" aria-label="Ramp with energy bar chart">
        <rect x="0" y="0" width={VW} height={VH} rx="12" className="sim__bg" />
        {/* ramp */}
        <polygon
          points={`${leftX},${apexY} ${rightX},${baseY} ${leftX},${baseY}`}
          className="sim__ramp"
        />
        <circle cx={leftX + 8} cy={apexY - 6} r="8" className="sim__object" />
        <line x1={leftX} y1={baseY} x2={rightX + 10} y2={baseY} className="sim__ground" />
        <text x={leftX} y={apexY - 12} className="sim__axis-text">{`h = ${round(height)} m`}</text>

        {/* energy bars */}
        {drawBar(0, peFrac, 'var(--accent)', 'PE')}
        {drawBar(1, keFrac, '#2bb673', 'KE')}
        {drawBar(2, thFrac, '#e2725b', 'Heat')}
      </svg>

      <div className="sim__readouts">
        <Readout label="Final speed" value={`${round(finalSpeed, 2)} m/s`} />
        <Readout label="Kinetic E" value={`${round(result.kineticEnergy)} J`} />
        <Readout label="Friction" value={friction > 0.001 ? 'On' : 'Off'} />
      </div>

      <div className="sim__controls">
        <Slider label="Ramp height" value={height} min={0.5} max={10} step={0.5} unit="m" onChange={(v) => onChange({ ...state, height: v })} />
        <Slider label="Mass" value={mass} min={1} max={10} step={1} unit="kg" onChange={(v) => onChange({ ...state, mass: v })} />
        <Slider label="Friction loss" value={friction} min={0} max={0.6} step={0.05} onChange={(v) => onChange({ ...state, friction: v })} />
      </div>
    </div>
  )
}
