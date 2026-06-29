import { useEffect } from 'react'

// Locks page scrolling while a modal/popup is mounted. A shared counter means
// several overlapping locks behave correctly — scrolling only returns once the
// last locker unmounts. Call this unconditionally inside a component that is
// only mounted while its popup is open.
let lockCount = 0
let prevOverflow = ''
let prevPaddingRight = ''

export function useBodyScrollLock(active = true): void {
  useEffect(() => {
    if (!active) return
    const body = document.body
    if (lockCount === 0) {
      prevOverflow = body.style.overflow
      prevPaddingRight = body.style.paddingRight
      // Compensate for the vanishing scrollbar so the layout doesn't shift.
      const sbw = window.innerWidth - document.documentElement.clientWidth
      if (sbw > 0) body.style.paddingRight = `${sbw}px`
      body.style.overflow = 'hidden'
    }
    lockCount += 1
    return () => {
      lockCount -= 1
      if (lockCount === 0) {
        body.style.overflow = prevOverflow
        body.style.paddingRight = prevPaddingRight
      }
    }
  }, [active])
}
