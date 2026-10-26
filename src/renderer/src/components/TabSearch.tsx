import { useEffect, useMemo, useRef, useState } from 'react'
import type { MouseEvent as ReactMouseEvent } from 'react'
import type { TabMeta } from '../../../shared/types'
import { rankTabs, hostOfTab } from '../../../shared/tabsearch'
import { useApp } from '../state/store'

/**
 * Tab search (v2.3.0) — Chrome parity: Ctrl+Shift+A opens a focused switcher
 * over the open tabs of THIS window. Ranking is the shared pure module
 * (src/shared/tabsearch.ts). Each row can also be closed without switching
 * (Chrome shows an × on hover too).
 */
export default function TabSearch(): JSX.Element | null {
  const { tabs, activeId } = useApp()
  const open = useApp((s) => s.tabSearchOpen)
  const set = useApp((s) => s.set)
  const [q, setQ] = useState('')
  const [sel, setSel] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && !e.altKey && String(e.key).toLowerCase() === 'a') {
        e.preventDefault()
        const now = !useApp.getState().tabSearchOpen
        set({ tabSearchOpen: now })
      } else if (e.key === 'Escape' && useApp.getState().tabSearchOpen) {
        set({ tabSearchOpen: false })
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [set])

  // menu → Search Tabs… works even when a web page has keyboard focus
  useEffect(() => {
    const unsub = window.aether.state.onTabSearchShow(() => set({ tabSearchOpen: true }))
    return unsub
  }, [set])

  useEffect(() => {
    if (open) {
      setQ('')
      setSel(0)
      setTimeout(() => inputRef.current?.focus(), 20)
    }
  }, [open])

  const results = useMemo(() => rankTabs(q, tabs as TabMeta[], activeId, 24), [tabs, activeId, q])

  useEffect(() => {
    setSel(0)
  }, [q])

  useEffect(() => {
    const el = listRef.current?.querySelector('.ts-item.sel')
    el?.scrollIntoView({ block: 'nearest' })
  }, [sel, results.length, open])

  if (!open) return null

  const activate = (id: number | undefined): void => {
    if (typeof id !== 'number') return
    set({ tabSearchOpen: false })
    void window.aether.tabs.activate(id)
  }

  const closeTab = (e: ReactMouseEvent, id: number): void => {
    e.stopPropagation()
    void window.aether.tabs.close(id)
  }

  return (
    <div className="cp-overlay ts-overlay" onClick={() => set({ tabSearchOpen: false })}>
      <div className="cp-box" onClick={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          className="cp-input"
          placeholder="Search your tabs — title or site…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault()
              setSel((s) => Math.min(s + 1, results.length - 1))
            } else if (e.key === 'ArrowUp') {
              e.preventDefault()
              setSel((s) => Math.max(s - 1, 0))
            } else if (e.key === 'Enter') {
              e.preventDefault()
              activate(results[sel]?.tab.id)
            }
          }}
        />
        <div className="cp-list" ref={listRef}>
          {results.map((r, i) => (
            <div
              key={r.tab.id}
              className={`cp-item ts-item ${i === sel ? 'sel' : ''}`}
              onMouseEnter={() => setSel(i)}
              onClick={() => activate(r.tab.id)}
            >
              <span className={`cp-kind ${r.tab.id === activeId ? 'ts-active' : ''}`}>
                {r.tab.pinned ? '📌' : r.tab.audible ? '🔊' : hostOfTab(r.tab.url).charAt(0).toUpperCase() || 'T'}
              </span>
              <span className="cp-text">{r.tab.title || 'New Tab'}</span>
              <span className="cp-sub">{hostOfTab(r.tab.url) || r.tab.url}</span>
              <button className="ts-close" title="Close tab" onClick={(e) => closeTab(e, r.tab.id)}>
                ×
              </button>
            </div>
          ))}
          {!results.length && <div className="cp-empty">No matching tabs — try the omnibox or Ctrl+K</div>}
        </div>
        <div className="cp-foot">↑↓ navigate · Enter switch · × close · Esc dismiss</div>
      </div>
    </div>
  )
}
