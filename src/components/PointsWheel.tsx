import { useState, type ReactNode } from 'react'
import { CoinBurst } from './ui/CoinBurst'
import { sfxFanfare, sfxTick } from '../game/sfx'

// A flashy reward wheel. The OUTCOME is always decided OUTSIDE this component
// (passed via `getResult`) — this just sells the spin with real anticipation
// easing. Two presets:
//   • Skill-point gamble (default): 1–10 wheel, rigged engine supplies the value.
//   • Coin "Bonus spin": a multiplier wheel for a perfect Coin Farm run. The
//     multiplier RANGE is disclosed up front (e.g. ×2–×5) so it reads as a game
//     reward / bonus spin, not a slot machine.

// Default 1–10 order for the skill-point gamble.
const SP_ORDER = [7, 2, 9, 4, 1, 6, 10, 3, 5, 8]
const SPIN_MS = 4600

const SP_SLICE_COLOR: Record<number, string> = {
  1: '#5566a8', 2: '#5c7cff', 3: '#22b8cf', 4: '#6a5cff', 5: '#2bd4a0',
  6: '#9b5cff', 7: '#4b6bd6', 8: '#ff8c42', 9: '#ff5c9d', 10: '#ffb703',
}

// Coin multiplier palette — warmer the bigger the bonus (gold = jackpot).
const COIN_SLICE_COLOR: Record<number, string> = {
  2: '#3fd17a', 3: '#ff8c42', 5: '#ffb703',
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

const prefersReduced = (): boolean =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

export function PointsWheel({
  getResult,
  onCollect,
  onClose,
  // --- generalization (defaults preserve the skill-point gamble) ---
  variant = 'sp',
  segments,
  jackpotValue,
  eyebrow,
  title,
  rangeLabel,
  hubIcon,
  formatResult,
}: {
  /** Resolve the predetermined result (called once, when SPIN is pressed). */
  getResult: () => number
  /** Bank the result. */
  onCollect: (value: number) => void
  onClose: () => void
  variant?: 'sp' | 'coin'
  /** Wheel slice values (defaults to the 1–10 SP order, or the coin multiplier ring). */
  segments?: number[]
  /** Value treated as the jackpot (gold + celebration). */
  jackpotValue?: number
  eyebrow?: string
  title?: string
  /** Disclosed range line shown under the title (compliance / honesty). */
  rangeLabel?: string
  hubIcon?: ReactNode
  /** Render the result label (defaults: "+N skill points" / "×N coins"). */
  formatResult?: (value: number) => ReactNode
}) {
  const isCoin = variant === 'coin'
  const order = segments ?? (isCoin ? [2, 3, 2, 5, 2, 3, 5, 3] : SP_ORDER)
  const slice = 360 / order.length
  const jackpot = jackpotValue ?? (isCoin ? 5 : 10)
  const colorOf = (v: number) =>
    isCoin ? COIN_SLICE_COLOR[v] ?? '#3fd17a' : SP_SLICE_COLOR[v] ?? '#5c7cff'

  const [rotation, setRotation] = useState(0)
  const [phase, setPhase] = useState<Phase>('idle')
  const [result, setResult] = useState<number | null>(null)

  const spin = () => {
    if (phase !== 'idle') return
    const value = getResult()
    // Land on a random slice that carries the drawn value (handles repeated values).
    const matches = order.map((v, i) => (v === value ? i : -1)).filter((i) => i >= 0)
    const idx = matches.length ? matches[Math.floor(Math.random() * matches.length)] : 0
    const center = idx * slice + slice / 2
    const jitter = (Math.random() - 0.5) * (slice - 8)
    const currentMod = ((rotation % 360) + 360) % 360
    const desiredMod = ((-center % 360) + 360) % 360
    let delta = desiredMod - currentMod
    if (delta < 0) delta += 360
    setResult(value)
    sfxTick()
    const reduced = prefersReduced()
    setRotation(reduced ? rotation : rotation + 360 * 6 + delta + jitter)
    setPhase('spinning')
    const land = () => {
      setPhase('won')
      if (value === jackpot) sfxFanfare()
      if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
        try { navigator.vibrate(value === jackpot ? [40, 30, 60] : 30) } catch { /* ignore */ }
      }
    }
    if (reduced) land()
    else window.setTimeout(land, SPIN_MS + 120)
  }

  const isJackpot = result === jackpot
  const defaultFormat = (v: number): ReactNode =>
    isCoin ? <>×{v} coins</> : <>+{v} skill point{v === 1 ? '' : 's'}</>
  const fmt = formatResult ?? defaultFormat

  return (
    <div
      className={`wheel-overlay${isCoin ? ' bonus-wheel' : ''}`}
      role="dialog"
      aria-modal="true"
      aria-label={title ?? 'Bonus spin'}
      onClick={(e) => {
        if (e.target === e.currentTarget && phase === 'idle') onClose()
      }}
    >
      <div className={`wheel-modal wheel-modal--points${isCoin ? ' wheel-modal--coin' : ''}${isJackpot && phase === 'won' ? ' is-jackpot' : ''}`}>
        {isJackpot && phase === 'won' && <CoinBurst count={26} spread={260} />}
        <header className="wheel-modal__head">
          <div className="wheel-modal__title">
            <span className="eyebrow">{eyebrow ?? (isCoin ? 'Bonus spin' : 'Skill points')}</span>
            <h2>{title ?? (isCoin ? 'Coin multiplier' : 'Bonus spin')}</h2>
            {rangeLabel && <span className="wheel-modal__range">{rangeLabel}</span>}
          </div>
          {phase === 'idle' && (
            <button className="wheel-modal__close" type="button" onClick={onClose} aria-label="Close">✕</button>
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
              {order.map((value, i) => {
                const start = i * slice
                const mid = start + slice / 2
                const lr = 100
                const a = ((mid - 90) * Math.PI) / 180
                const lx = 150 + lr * Math.cos(a)
                const ly = 150 + lr * Math.sin(a)
                return (
                  <g key={i}>
                    <path
                      d={wedge(150, 150, 140, start, start + slice)}
                      fill={colorOf(value)}
                      stroke={value === jackpot ? '#fff6cf' : 'rgba(255,255,255,0.32)'}
                      strokeWidth={value === jackpot ? 3 : 2}
                    />
                    <text
                      x={lx}
                      y={ly}
                      textAnchor="middle"
                      dominantBaseline="central"
                      transform={`rotate(${mid} ${lx} ${ly})`}
                      className={`wheel-label${value === jackpot ? ' wheel-label--jackpot' : ''}`}
                    >
                      {isCoin ? `×${value}` : value}
                    </text>
                  </g>
                )
              })}
              <circle cx="150" cy="150" r="140" fill="none" stroke="rgba(255,255,255,0.6)" strokeWidth={4} />
            </svg>
            <div className={`wheel-hub wheel-hub--points${isCoin ? ' wheel-hub--coin' : ''}`} aria-hidden>
              {hubIcon ?? (isCoin ? <span className="coin-icon" /> : '🎯')}
            </div>
          </div>
        </div>

        <div className="wheel-foot">
          {phase === 'won' && result != null ? (
            <>
              <div className={`wheel-result${isJackpot ? ' wheel-result--jackpot' : ''}`}>
                <strong>{fmt(result)}</strong>
              </div>
              <button type="button" className="wheel-btn" onClick={() => { onCollect(result); onClose() }}>
                Collect →
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
