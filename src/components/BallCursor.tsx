import { useEffect, useRef, useState } from 'react'

const INTERACTIVE = 'a,button,input,textarea,select,label,[role="button"],.quiz-opt,.unit-card,.combine-card,.next-card,.qtest__jump-dot'

// A soccer-ball cursor that smoothly chases the pointer, pulses over anything
// clickable, and squashes like a struck ball on press. Disabled on touch /
// coarse-pointer devices (where a custom cursor only gets in the way).
export function BallCursor() {
  const ref = useRef<HTMLDivElement>(null)
  const [hover, setHover] = useState(false)
  const [down, setDown] = useState(false)
  const [off, setOff] = useState(false)

  useEffect(() => {
    if (typeof window === 'undefined') return
    if (window.matchMedia('(pointer: coarse)').matches) return

    const el = ref.current
    if (!el) return
    document.body.classList.add('has-ball-cursor')

    let tx = window.innerWidth / 2
    let ty = window.innerHeight / 2
    let x = tx
    let y = ty
    let raf = 0

    const onMove = (e: PointerEvent) => {
      tx = e.clientX
      ty = e.clientY
      setOff(false)
      const t = e.target as Element | null
      setHover(Boolean(t && t.closest(INTERACTIVE)))
    }
    const onDown = () => setDown(true)
    const onUp = () => setDown(false)
    const onOut = (e: PointerEvent) => { if (!e.relatedTarget) setOff(true) }

    const loop = () => {
      // Tight, responsive follow with just a touch of smoothing so it never
      // visibly trails the pointer. Snap when within a pixel to avoid drift.
      const dx = tx - x
      const dy = ty - y
      if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) {
        x = tx
        y = ty
      } else {
        x += dx * 0.82
        y += dy * 0.82
      }
      el.style.transform = `translate3d(${x}px, ${y}px, 0)`
      raf = requestAnimationFrame(loop)
    }

    window.addEventListener('pointermove', onMove, { passive: true })
    window.addEventListener('pointerdown', onDown)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointerout', onOut)
    raf = requestAnimationFrame(loop)

    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerdown', onDown)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointerout', onOut)
      document.body.classList.remove('has-ball-cursor')
    }
  }, [])

  return (
    <div
      ref={ref}
      className={`ballcursor ${hover ? 'is-hover' : ''} ${down ? 'is-down' : ''} ${off ? 'is-off' : ''}`}
      aria-hidden
    >
      <span className="ballcursor__trail" />
      <svg className="ballcursor__ball" viewBox="0 0 100 100">
        <circle cx="50" cy="50" r="47" fill="#ffffff" stroke="#10131c" strokeWidth="3" />
        <polygon points="50,28 65,39 59,57 41,57 35,39" fill="#10131c" />
        <polygon points="50,3 58,18 50,26 42,18" fill="#10131c" />
        <polygon points="93,38 86,55 73,49 76,33" fill="#10131c" />
        <polygon points="79,84 63,80 67,63 83,68" fill="#10131c" />
        <polygon points="37,80 21,84 17,68 33,63" fill="#10131c" />
        <polygon points="7,38 24,33 27,49 14,55" fill="#10131c" />
      </svg>
    </div>
  )
}
