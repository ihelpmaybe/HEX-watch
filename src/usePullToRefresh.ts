import { useEffect, useRef, useState } from 'react'

const THRESHOLD = 68
const MAX_PULL = 112

export function usePullToRefresh(onRefresh: () => Promise<void>, disabled: boolean) {
  const [pull, setPull] = useState(0)
  const [refreshing, setRefreshing] = useState(false)
  const onRefreshRef = useRef(onRefresh)
  const disabledRef = useRef(disabled)
  const refreshingRef = useRef(false)
  onRefreshRef.current = onRefresh
  disabledRef.current = disabled
  refreshingRef.current = refreshing

  useEffect(() => {
    let startY = 0
    let tracking = false
    let current = 0
    let armed = false

    function atTop() {
      return (window.scrollY || document.documentElement.scrollTop) <= 0
    }

    function onStart(y: number) {
      if (disabledRef.current || refreshingRef.current) return
      if (!atTop()) return
      tracking = true
      startY = y
      current = 0
      armed = false
    }

    function onMove(y: number, event: Event) {
      if (!tracking) return
      const dy = y - startY
      if (dy <= 0 || !atTop()) {
        if (current > 0) {
          current = 0
          armed = false
          setPull(0)
        }
        if (dy > 8) tracking = false
        return
      }
      event.preventDefault()
      current = Math.min(MAX_PULL, dy * 0.42)
      armed = current >= THRESHOLD
      setPull(current)
    }

    async function onEnd() {
      if (!tracking) return
      tracking = false
      const shouldRefresh = armed && !disabledRef.current
      armed = false
      current = 0
      setPull(0)
      if (!shouldRefresh) return
      setRefreshing(true)
      refreshingRef.current = true
      try {
        await onRefreshRef.current()
      } finally {
        refreshingRef.current = false
        setRefreshing(false)
      }
    }

    function touchStart(event: TouchEvent) {
      onStart(event.touches[0].clientY)
    }
    function touchMove(event: TouchEvent) {
      onMove(event.touches[0].clientY, event)
    }
    function pointerStart(event: PointerEvent) {
      if (event.pointerType === 'touch') return
      if (event.clientY > 140) return
      onStart(event.clientY)
    }
    function pointerMove(event: PointerEvent) {
      if (event.pointerType === 'touch') return
      if (!tracking) return
      onMove(event.clientY, event)
    }

    window.addEventListener('touchstart', touchStart, { passive: true })
    window.addEventListener('touchmove', touchMove, { passive: false })
    window.addEventListener('touchend', onEnd)
    window.addEventListener('touchcancel', onEnd)
    window.addEventListener('pointerdown', pointerStart)
    window.addEventListener('pointermove', pointerMove)
    window.addEventListener('pointerup', onEnd)
    window.addEventListener('pointercancel', onEnd)

    return () => {
      window.removeEventListener('touchstart', touchStart)
      window.removeEventListener('touchmove', touchMove)
      window.removeEventListener('touchend', onEnd)
      window.removeEventListener('touchcancel', onEnd)
      window.removeEventListener('pointerdown', pointerStart)
      window.removeEventListener('pointermove', pointerMove)
      window.removeEventListener('pointerup', onEnd)
      window.removeEventListener('pointercancel', onEnd)
    }
  }, [])

  return { pull, refreshing, armed: pull >= THRESHOLD }
}
