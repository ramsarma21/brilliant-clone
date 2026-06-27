import { useRef, useState } from 'react'

// Daily wheel of fortune. Eight equal-looking slices (so the odds aren't obvious), but the
// pick is weighted: 0 coins is the RAREST outcome (a zero feels awful), the 5–25 range is
// the most common, and the big 35/50 hits are deliberately scarce. Rewards span 0–50 coins.
type Segment = { value: number; weight: number; color: string }

// Wheel order is shuffled so neighbouring values don't telegraph the weighting.
const SEGMENTS: Segment[] = [
  { value: 10, weight: 24, color: '#7c5cff' },
  { value: 50, weight: 4, color: '#ffb703' },
  { value: 5, weight: 22, color: '#22b8cf' },
  { value: 20, weight: 18, color: '#5c7cff' },
  { value: 0, weight: 2, color: '#ff5c7c' },
  { value: 25, weight: 14, color: '#2bd4a0' },
  { value: 15, weight: 22, color: '#9b5cff' },
  { value: 35, weight: 6, color: '#ff8c42' },
]

const SLICE = 360 / SEGMENTS.length
const SPIN_MS = 4200

/** Weighted pick → index into SEGMENTS. */
function pickIndex(): number {
  const total = SEGMENTS.reduce((s, x) => s + x.weight, 0)
  let r = Math.random() * total
  for (let i = 0; i < SEGMENTS.length; i++) {
    r -= SEGMENTS[i].weight
    if (r < 0) return i
  }
  return SEGMENTS.length - 1
}

/** SVG wedge path for a slice spanning [startDeg, endDeg] clockwise from the top. */
function wedge(cx: number, cy: number, r: number, startDeg: number, endDeg: number): string {
  const a0 = ((startDeg - 90) * Math.PI) / 180
  const a1 = ((endDeg - 90) * Math.PI) / 180
  const x0 = cx + r * Math.cos(a0)
  const y0 = cy + r * Math.sin(a0)
  const x1 = cx + r * Math.cos(a1)
  const y1 = cy + r * Math.sin(a1)
  const large = endDeg - startDeg > 180 ? 1 : 0
  return `M${cx},${cy} L${x0.toFixed(2)},${y0.toFixed(2)} A${r},${r} 0 ${large} 1 ${x1.toFixed(2)},${y1.toFixed(2)} Z`
}

type Phase = 'idle' | 'spinning' | 'won'

export function DailyWheel({
  onCollect,
  onClose,
}: {
  /** Credit the won coins (parent also stamps the wheel as spent for today). */
  onCollect: (amount: number) => void
  onClose: () => void
}) {
  const [rotation, setRotation] = useState(0)
  const [phase, setPhase] = useState<Phase>('idle')
  const [resultIdx, setResultIdx] = useState<number | null>(null)
  const [collecting, setCollecting] = useState(false)
  const timer = useRef<number | null>(null)

  const reward = resultIdx != null ? SEGMENTS[resultIdx].value : 0

  const spin = () => {
    if (phase === 'spinning') return
    const idx = pickIndex()
    const center = idx * SLICE + SLICE / 2
    const jitter = (Math.random() - 0.5) * (SLICE - 12) // stay comfortably inside the slice
    // Land slice `idx` under the top pointer: rotation ≡ -center (mod 360), plus full spins.
    const currentMod = ((rotation % 360) + 360) % 360
    const desiredMod = ((-center % 360) + 360) % 360
    let delta = desiredMod - currentMod
    if (delta < 0) delta += 360
    const next = rotation + 360 * 5 + delta + jitter
    setResultIdx(idx)
    setRotation(next)
    setPhase('spinning')
    if (timer.current) window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setPhase('won'), SPIN_MS + 120)
  }

  const collect = () => {
    if (collecting) return
    setCollecting(true)
    // Let the coin-burst play, then bank the coins and close.
    window.setTimeout(() => {
      onCollect(reward)
      onClose()
    }, 900)
  }

  return (
    <div
      className="wheel-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Daily wheel"
      onClick={(e) => {
        if (e.target === e.currentTarget && phase !== 'spinning' && !collecting) onClose()
      }}
    >
      <div className="wheel-modal">
        <header className="wheel-modal__head">
          <div className="wheel-modal__title">
            <span className="eyebrow">Daily reward</span>
            <h2>Spin the wheel</h2>
          </div>
          {phase !== 'spinning' && !collecting && (
            <button className="wheel-modal__close" type="button" onClick={onClose} aria-label="Close">
              ✕
            </button>
          )}
        </header>

        <div className="wheel-stage">
          <span className="wheel-pointer" aria-hidden />
          <div className="wheel-spinner-wrap">
            <svg
              className="wheel-svg"
              viewBox="0 0 300 300"
              style={{
                transform: `rotate(${rotation}deg)`,
                transition: phase === 'spinning' ? `transform ${SPIN_MS}ms cubic-bezier(0.16, 0.84, 0.28, 1)` : 'none',
              }}
            >
              {SEGMENTS.map((seg, i) => {
                const start = i * SLICE
                const mid = start + SLICE / 2
                const lr = 96
                const a = ((mid - 90) * Math.PI) / 180
                const lx = 150 + lr * Math.cos(a)
                const ly = 150 + lr * Math.sin(a)
                return (
                  <g key={i}>
                    <path d={wedge(150, 150, 140, start, start + SLICE)} fill={seg.color} stroke="rgba(255,255,255,0.35)" strokeWidth={2} />
                    <text
                      x={lx}
                      y={ly}
                      textAnchor="middle"
                      dominantBaseline="central"
                      transform={`rotate(${mid} ${lx} ${ly})`}
                      className="wheel-label"
                    >
                      {seg.value}
                    </text>
                  </g>
                )
              })}
              <circle cx="150" cy="150" r="140" fill="none" stroke="rgba(255,255,255,0.6)" strokeWidth={4} />
            </svg>
            <div className="wheel-hub" aria-hidden>
              <span className="coin-icon" />
            </div>
          </div>
        </div>

        <div className="wheel-foot">
          {phase === 'won' ? (
            <>
              <div className={`wheel-result${reward === 0 ? ' wheel-result--zero' : ''}`}>
                {reward === 0 ? (
                  <strong>So close! No coins this time.</strong>
                ) : (
                  <strong>
                    You won +{reward}
                    <span className="coin-icon" aria-hidden />!
                  </strong>
                )}
              </div>
              <button type="button" className="wheel-btn" onClick={collect} disabled={collecting}>
                {reward === 0 ? 'Collect →' : `Collect +${reward} →`}
              </button>
            </>
          ) : (
            <button type="button" className="wheel-btn wheel-btn--spin" onClick={spin} disabled={phase === 'spinning'}>
              {phase === 'spinning' ? 'Spinning…' : 'SPIN'}
            </button>
          )}
        </div>

        {collecting && reward > 0 && (
          <div className="coin-fly" aria-hidden>
            {Array.from({ length: Math.min(12, Math.max(5, Math.round(reward / 4))) }, (_, i) => (
              <span
                key={i}
                className="coin-fly__coin coin-icon"
                style={{ '--i': i, '--dx': `${(Math.random() - 0.5) * 120}px` } as React.CSSProperties}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
