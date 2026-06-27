import { useState } from 'react'

// The flashy 90+ skill-point gamble wheel. The OUTCOME is decided by the rigged engine
// (passed in via `getResult`); this component just sells the fantasy — all ten numbers look
// equally winnable, the 10 sits between common values so the pointer keeps stopping right
// next to the jackpot (near-miss), and the spin is loud and bouncy.

// Wheel order: 10 is flanked by 6 and 3 (both common draws) to maximise "so close!" moments.
const WHEEL_ORDER = [7, 2, 9, 4, 1, 6, 10, 3, 5, 8]
const SLICE = 360 / WHEEL_ORDER.length
const SPIN_MS = 4600

const SLICE_COLOR: Record<number, string> = {
  1: '#5566a8',
  2: '#5c7cff',
  3: '#22b8cf',
  4: '#6a5cff',
  5: '#2bd4a0',
  6: '#9b5cff',
  7: '#4b6bd6',
  8: '#ff8c42',
  9: '#ff5c9d',
  10: '#ffb703',
}

type Phase = 'idle' | 'spinning' | 'won'

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

export function PointsWheel({
  getResult,
  onCollect,
  onClose,
}: {
  /** Resolve the rigged 1–10 result (called once, when SPIN is pressed). */
  getResult: () => number
  /** Bank the gambled result (replaces the safe +5). */
  onCollect: (value: number) => void
  onClose: () => void
}) {
  const [rotation, setRotation] = useState(0)
  const [phase, setPhase] = useState<Phase>('idle')
  const [result, setResult] = useState<number | null>(null)

  const spin = () => {
    if (phase !== 'idle') return
    const value = getResult()
    const idx = WHEEL_ORDER.indexOf(value)
    const center = idx * SLICE + SLICE / 2
    const jitter = (Math.random() - 0.5) * (SLICE - 8)
    const currentMod = ((rotation % 360) + 360) % 360
    const desiredMod = ((-center % 360) + 360) % 360
    let delta = desiredMod - currentMod
    if (delta < 0) delta += 360
    setResult(value)
    setRotation(rotation + 360 * 6 + delta + jitter)
    setPhase('spinning')
    window.setTimeout(() => setPhase('won'), SPIN_MS + 120)
  }

  const jackpot = result === 10

  return (
    <div
      className="wheel-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Bonus skill-point spin"
      onClick={(e) => {
        // No backing out mid-spin or after the result — the gamble is committed.
        if (e.target === e.currentTarget && phase === 'idle') onClose()
      }}
    >
      <div className={`wheel-modal wheel-modal--points${jackpot && phase === 'won' ? ' is-jackpot' : ''}`}>
        <header className="wheel-modal__head">
          <div className="wheel-modal__title">
            <span className="eyebrow">Skill points</span>
            <h2>Bonus spin</h2>
          </div>
          {phase === 'idle' && (
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
                transition: phase === 'spinning' ? `transform ${SPIN_MS}ms cubic-bezier(0.13, 0.86, 0.22, 1)` : 'none',
              }}
            >
              {WHEEL_ORDER.map((value, i) => {
                const start = i * SLICE
                const mid = start + SLICE / 2
                const lr = 100
                const a = ((mid - 90) * Math.PI) / 180
                const lx = 150 + lr * Math.cos(a)
                const ly = 150 + lr * Math.sin(a)
                return (
                  <g key={i}>
                    <path
                      d={wedge(150, 150, 140, start, start + SLICE)}
                      fill={SLICE_COLOR[value]}
                      stroke={value === 10 ? '#fff6cf' : 'rgba(255,255,255,0.32)'}
                      strokeWidth={value === 10 ? 3 : 2}
                    />
                    <text
                      x={lx}
                      y={ly}
                      textAnchor="middle"
                      dominantBaseline="central"
                      transform={`rotate(${mid} ${lx} ${ly})`}
                      className={`wheel-label${value === 10 ? ' wheel-label--jackpot' : ''}`}
                    >
                      {value}
                    </text>
                  </g>
                )
              })}
              <circle cx="150" cy="150" r="140" fill="none" stroke="rgba(255,255,255,0.6)" strokeWidth={4} />
            </svg>
            <div className="wheel-hub wheel-hub--points" aria-hidden>
              🎯
            </div>
          </div>
        </div>

        <div className="wheel-foot">
          {phase === 'won' && result != null ? (
            <>
              <div className={`wheel-result${jackpot ? ' wheel-result--jackpot' : ''}`}>
                <strong>
                  +{result} skill point{result === 1 ? '' : 's'}
                </strong>
              </div>
              <button type="button" className="wheel-btn" onClick={() => { onCollect(result); onClose() }}>
                Collect +{result} →
              </button>
            </>
          ) : (
            <button type="button" className="wheel-btn wheel-btn--spin" onClick={spin} disabled={phase === 'spinning'}>
              {phase === 'spinning' ? 'Spinning…' : 'SPIN'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
