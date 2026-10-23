import { useEffect, useRef, useState } from 'react'
import { useApp } from '../state/store'

/** Chrome-style zoom bubble — shows after Ctrl+= / Ctrl+- / Ctrl+0 or menu zoom. */
export default function ZoomBubble(): JSX.Element | null {
  const zoom = useApp((s) => s.zoom)
  const [visible, setVisible] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!zoom) return
    setVisible(true)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => setVisible(false), 2600)
    return () => {
      if (timer.current) clearTimeout(timer.current)
    }
  }, [zoom])

  if (!zoom || !visible) return null

  return (
    <div className="zoom-bubble">
      <button
        className="zoom-btn"
        title="Zoom out (Ctrl+-)"
        onClick={() => {
          void window.aether.tabs.zoom('out')
          if (timer.current) clearTimeout(timer.current)
          timer.current = setTimeout(() => setVisible(false), 2600)
        }}
      >
        −
      </button>
      <button
        className="zoom-pct"
        title="Reset zoom (Ctrl+0)"
        onClick={() => {
          void window.aether.tabs.zoom('reset')
          setVisible(false)
        }}
      >
        {zoom.percent}%
      </button>
      <button
        className="zoom-btn"
        title="Zoom in (Ctrl+=)"
        onClick={() => {
          void window.aether.tabs.zoom('in')
          if (timer.current) clearTimeout(timer.current)
          timer.current = setTimeout(() => setVisible(false), 2600)
        }}
      >
        +
      </button>
    </div>
  )
}
