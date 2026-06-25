import { useMemo } from 'react'
import { Slider } from '../ui/Slider'
import { Readout } from './ProjectileSim'
import { circuit, round } from '../../lib/physics'
import type { SimProps } from './types'
import { n } from './types'

const VW = 420
const VH = 200

export function CircuitsSim({ state, onChange }: SimProps) {
  const closed = Boolean(state.closed)
  const layout = state.layout === 'parallel' ? 'parallel' : 'series'
  const bulbCount = n(state, 'bulbCount', 1)
  const voltage = n(state, 'voltage', 6)
  const resistance = n(state, 'resistance', 6)

  const result = useMemo(
    () => circuit(voltage, bulbCount, resistance, layout, closed),
    [voltage, bulbCount, resistance, layout, closed],
  )

  const wireClass = closed && result.lit ? 'sim__wire sim__wire--live' : 'sim__wire'
  const bulbPositions = bulbCount === 1 ? [210] : [160, 270]

  return (
    <div className="sim">
      <svg className="sim__canvas" viewBox={`0 0 ${VW} ${VH}`} role="img" aria-label="Simple circuit">
        <rect x="0" y="0" width={VW} height={VH} rx="12" className="sim__bg" />

        {/* battery */}
        <g>
          <rect x="30" y="80" width="24" height="40" rx="3" className="sim__battery" />
          <text x="42" y="135" textAnchor="middle" className="sim__axis-text">{`${voltage}V`}</text>
        </g>

        {/* loop wires */}
        <polyline
          points={`54,90 100,90 ${VW - 60},90`}
          className={wireClass}
          fill="none"
        />
        <polyline
          points={`54,110 100,110 ${VW - 60},110 ${VW - 60},90`}
          className={wireClass}
          fill="none"
        />

        {/* switch */}
        <g onClick={() => onChange({ ...state, closed: !closed })} style={{ cursor: 'pointer' }}>
          <circle cx="100" cy="110" r="4" className="sim__node" />
          <line
            x1="100"
            y1="110"
            x2={closed ? 134 : 126}
            y2={closed ? 110 : 92}
            className="sim__switch"
          />
          <circle cx="134" cy="110" r="4" className="sim__node" />
          <text x="117" y="135" textAnchor="middle" className="sim__axis-text">
            {closed ? 'closed' : 'open'}
          </text>
        </g>

        {/* bulbs */}
        {bulbPositions.map((bx, i) => (
          <g key={i}>
            <circle
              cx={bx}
              cy={layout === 'parallel' && bulbCount > 1 ? (i === 0 ? 90 : 110) : 90}
              r="14"
              className="sim__bulb"
              style={{
                fill: `rgba(255, 196, 0, ${result.lit ? 0.25 + result.brightness * 0.7 : 0})`,
              }}
            />
            <circle
              cx={bx}
              cy={layout === 'parallel' && bulbCount > 1 ? (i === 0 ? 90 : 110) : 90}
              r="14"
              className="sim__bulb-ring"
            />
          </g>
        ))}
      </svg>

      <div className="sim__readouts">
        <Readout label="Current" value={`${round(result.current, 2)} A`} />
        <Readout label="Total R" value={Number.isFinite(result.totalResistance) ? `${round(result.totalResistance, 1)} Ω` : '– Ω'} />
        <Readout label="Bulb" value={result.lit ? 'Lit' : 'Off'} />
      </div>

      <div className="sim__controls">
        <div className="seg">
          <button
            type="button"
            className={`btn ${closed ? 'btn--primary' : 'btn--ghost'}`}
            onClick={() => onChange({ ...state, closed: !closed })}
          >
            {closed ? 'Switch: Closed' : 'Switch: Open'}
          </button>
          <div className="seg__group">
            <button
              type="button"
              className={`btn btn--ghost ${layout === 'series' ? 'is-active' : ''}`}
              onClick={() => onChange({ ...state, layout: 'series' })}
            >
              Series
            </button>
            <button
              type="button"
              className={`btn btn--ghost ${layout === 'parallel' ? 'is-active' : ''}`}
              onClick={() => onChange({ ...state, layout: 'parallel' })}
            >
              Parallel
            </button>
          </div>
          <div className="seg__group">
            <button
              type="button"
              className={`btn btn--ghost ${bulbCount === 1 ? 'is-active' : ''}`}
              onClick={() => onChange({ ...state, bulbCount: 1 })}
            >
              1 bulb
            </button>
            <button
              type="button"
              className={`btn btn--ghost ${bulbCount === 2 ? 'is-active' : ''}`}
              onClick={() => onChange({ ...state, bulbCount: 2 })}
            >
              2 bulbs
            </button>
          </div>
        </div>
        <Slider label="Battery voltage" value={voltage} min={1.5} max={12} step={1.5} unit="V" onChange={(v) => onChange({ ...state, voltage: v })} />
        <Slider label="Bulb resistance" value={resistance} min={2} max={12} step={1} unit="Ω" onChange={(v) => onChange({ ...state, resistance: v })} />
      </div>
    </div>
  )
}
