import { useEffect, useRef, useState } from 'react'
import { useApp } from '../state/store'
import type { FindResult } from '../../../shared/types'

/** Chrome-style find-in-page bar (Ctrl+F). Lives above the web area, top-right. */
export default function FindBar(): JSX.Element | null {
  const activeId = useApp((s) => s.activeId)
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [res, setRes] = useState<{ active: number; matches: number } | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // menu (Ctrl+F) or future shortcuts ask the chrome to open the bar
  useEffect(() => {
    return window.aether.state.onFindShow(() => {
      setOpen(true)
      setTimeout(() => inputRef.current?.select(), 30)
    })
  }, [])

  // local Ctrl+F when the chrome UI itself has focus
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault()
        setOpen(true)
        setTimeout(() => inputRef.current?.select(), 30)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // run the search (debounced)
  useEffect(() => {
    if (!open || !activeId) return
    const t = setTimeout(() => {
      if (q.trim()) void window.aether.find.start(activeId, q, true)
      else void window.aether.find.stop(activeId)
    }, 200)
    return () => clearTimeout(t)
  }, [q, open, activeId])

  // live match counter from main
  useEffect(() => {
    return window.aether.find.onResult((raw) => {
      const r = raw as FindResult
      if (r.tabId === useApp.getState().activeId) setRes({ active: r.active, matches: r.matches })
    })
  }, [])

  // switching tabs invalidates the count
  useEffect(() => {
    setRes(null)
  }, [activeId])

  const close = (): void => {
    setOpen(false)
    setRes(null)
    if (activeId) void window.aether.find.stop(activeId)
  }

  const step = (forward: boolean): void => {
    if (activeId && q.trim()) void window.aether.find.start(activeId, q, forward)
  }

  if (!open) return null

  return (
    <div className="findbar" role="search">
      <input
        ref={inputRef}
        value={q}
        placeholder="Find in page"
        autoFocus
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            step(!e.shiftKey)
          } else if (e.key === 'Escape') {
            e.preventDefault()
            close()
          }
        }}
        spellCheck={false}
      />
      <span className="find-count">{q.trim() ? (res ? `${res.active}/${res.matches}` : '…') : ''}</span>
      <button className="find-btn" onClick={() => step(false)} title="Previous match (Shift+Enter)">
        ↑
      </button>
      <button className="find-btn" onClick={() => step(true)} title="Next match (Enter)">
        ↓
      </button>
      <button className="find-btn" onClick={close} title="Close (Esc)">
        ✕
      </button>
    </div>
  )
}
