import { useEffect, useMemo, useState } from 'react'

const reduced = (): boolean =>
  typeof window !== 'undefined' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches

type Particle = { id: number; dx: number; dy: number; delay: number; rot: number; scale: number }

/**
 * A burst of gold coins flying outward from the center of the host element.
 * Pure CSS particles, no deps. Self-cleans after the animation. Under
 * prefers-reduced-motion it renders nothing (the count-up still conveys reward).
 */
export function CoinBurst({
  count = 18,
  spread = 220,
  durationMs = 900,
  onDone,
}: {
  count?: number
  spread?: number
  durationMs?: number
  onDone?: () => void
}) {
  const [done, setDone] = useState(false)
  const particles = useMemo<Particle[]>(() => {
    if (reduced()) return []
    return Array.from({ length: count }, (_, i) => {
      const angle = (Math.PI * 2 * i) / count + (Math.random() - 0.5) * 0.6
      const dist = spread * (0.5 + Math.random() * 0.6)
      return {
        id: i,
        dx: Math.cos(angle) * dist,
        dy: Math.sin(angle) * dist - spread * 0.25,
        delay: Math.random() * 90,
        rot: (Math.random() - 0.5) * 720,
        scale: 0.7 + Math.random() * 0.7,
      }
    })
  }, [count, spread])

  useEffect(() => {
    if (particles.length === 0) {
      onDone?.()
      return
    }
    const t = window.setTimeout(() => {
      setDone(true)
      onDone?.()
    }, durationMs + 120)
    return () => window.clearTimeout(t)
  }, [particles.length, durationMs, onDone])

  if (done || particles.length === 0) return null

  return (
    <div className="coinburst" aria-hidden>
      {particles.map((p) => (
        <span
          key={p.id}
          className="coinburst__coin"
          style={
            {
              '--dx': `${p.dx}px`,
              '--dy': `${p.dy}px`,
              '--rot': `${p.rot}deg`,
              '--scale': p.scale,
              '--delay': `${p.delay}ms`,
              '--dur': `${durationMs}ms`,
            } as React.CSSProperties
          }
        />
      ))}
    </div>
  )
}

export default CoinBurst
