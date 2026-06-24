import { useEffect, useRef, useState } from 'react'
import { Readout } from './ProjectileSim'
import type { SimProps } from './types'
import { n } from './types'

const VW = 420
const VH = 220
const PAD = 34
const POS_MAX = 10
const KEYS = ['p0', 'p1', 'p2', 'p3'] as const
const T_MAX = KEYS.length - 1

export function MotionGraphSim({ state, onChange }: SimProps) {
  const positions = KEYS.map((k) => n(state, k, 0))
  const svgRef = useRef<SVGSVGElement | null>(null)
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const [t, setT] = useState(0)
  const [playing, setPlaying] = useState(true)

  const plotW = VW - 2 * PAD
  const plotH = VH - 2 * PAD
  const tToX = (ti: number) => PAD + (ti / T_MAX) * plotW
  const posToY = (p: number) => PAD + plotH - (p / POS_MAX) * plotH
  const yToPos = (y: number) =>
    Math.max(0, Math.min(POS_MAX, ((PAD + plotH - y) / plotH) * POS_MAX))

  useEffect(() => {
    if (!playing) return
    let raf = 0
    let last = performance.now()
    const tick = (now: number) => {
      const dt = (now - last) / 1000
      last = now
      setT((prev) => {
        const next = prev + dt * 0.8
        return next > T_MAX ? 0 : next
      })
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [playing])

  function clientToPos(e: React.PointerEvent): number {
    const svg = svgRef.current
    if (!svg) return 0
    const rect = svg.getBoundingClientRect()
    const y = ((e.clientY - rect.top) / rect.height) * VH
    return Math.round(yToPos(y) * 2) / 2
  }

  function handleMove(e: React.PointerEvent) {
    if (dragIndex === null) return
    const p = clientToPos(e)
    onChange({ ...state, [KEYS[dragIndex]]: p })
  }

  // Interpolated object position at current time t.
  const seg = Math.min(T_MAX - 1, Math.floor(t))
  const frac = t - seg
  const objPos = positions[seg] + (positions[seg + 1] - positions[seg]) * frac
  const trackY = VH - 14
  const objX = PAD + (objPos / POS_MAX) * plotW

  const linePoints = positions.map((p, i) => `${tToX(i)},${posToY(p)}`).join(' ')

  return (
    <div className="sim">
      <svg
        ref={svgRef}
        className="sim__canvas"
        viewBox={`0 0 ${VW} ${VH}`}
        onPointerMove={handleMove}
        onPointerUp={() => setDragIndex(null)}
        onPointerLeave={() => setDragIndex(null)}
        role="img"
        aria-label="Editable position-time graph"
      >
        <rect x="0" y="0" width={VW} height={VH} rx="12" className="sim__bg" />
        {/* axes */}
        <line x1={PAD} y1={PAD} x2={PAD} y2={PAD + plotH} className="sim__axis" />
        <line x1={PAD} y1={PAD + plotH} x2={PAD + plotW} y2={PAD + plotH} className="sim__axis" />
        <text x={PAD - 6} y={PAD + 4} className="sim__axis-text" textAnchor="end">
          pos
        </text>
        <text x={PAD + plotW} y={PAD + plotH + 16} className="sim__axis-text" textAnchor="end">
          time
        </text>

        <polyline points={linePoints} className="sim__trajectory" fill="none" />

        {positions.map((p, i) => (
          <circle
            key={KEYS[i]}
            cx={tToX(i)}
            cy={posToY(p)}
            r={dragIndex === i ? 11 : 9}
            className="sim__handle"
            onPointerDown={(e) => {
              e.currentTarget.setPointerCapture(e.pointerId)
              setDragIndex(i)
            }}
          />
        ))}

        {/* current time marker */}
        <line x1={tToX(t)} y1={PAD} x2={tToX(t)} y2={PAD + plotH} className="sim__limit" />

        {/* object track */}
        <line x1={PAD} y1={trackY} x2={PAD + plotW} y2={trackY} className="sim__ground" />
        <circle cx={objX} cy={trackY} r="7" className="sim__object" />
      </svg>

      <div className="sim__readouts">
        <Readout label="Object position" value={`${objPos.toFixed(1)} m`} />
        <Readout label="Time" value={`${t.toFixed(1)} s`} />
        <button type="button" className="btn btn--ghost" onClick={() => setPlaying((p) => !p)}>
          {playing ? 'Pause' : 'Play'}
        </button>
      </div>
      <p className="sim__hint-text">Drag the four points to shape the motion.</p>
    </div>
  )
}
