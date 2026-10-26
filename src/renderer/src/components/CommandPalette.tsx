import { useEffect, useMemo, useRef, useState } from 'react'
import type { TabMeta, Bookmark } from '../../../shared/types'
import { rankBy } from '../../../shared/fuzzy'
import { useApp } from '../state/store'

/**
 * Command palette (Master Plan Phase 2, item #37) — Ctrl/Cmd+K.
 * Every action, tab, bookmark and settings page, one fuzzy box away.
 * Ranking is the shared pure module (src/shared/fuzzy.ts, unit-tested).
 */

interface Cmd {
  id: string
  text: string
  sub?: string
  kind: 'action' | 'tab' | 'bookmark' | 'page'
  run: () => void
}

const KIND_LABEL: Record<Cmd['kind'], string> = {
  action: 'Action',
  tab: 'Tab',
  bookmark: 'Bookmark',
  page: 'Page'
}

export default function CommandPalette(): JSX.Element | null {
  const { tabs, bookmarks } = useApp()
  const open = useApp((s) => s.paletteOpen)
  const set = useApp((s) => s.set)
  const [q, setQ] = useState('')
  const [sel, setSel] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && String(e.key).toLowerCase() === 'k') {
        e.preventDefault()
        const now = !useApp.getState().paletteOpen
        set({ paletteOpen: now, ...(now ? {} : { paletteCmds: null }) })
      } else if (e.key === 'Escape' && useApp.getState().paletteOpen) {
        set({ paletteOpen: false })
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [set])

  useEffect(() => {
    if (open) {
      setQ('')
      setSel(0)
      setTimeout(() => inputRef.current?.focus(), 20)
    }
  }, [open])

  const cmds = useMemo<Cmd[]>(() => {
    const out: Cmd[] = []
    const t = (text: string, sub: string, kind: Cmd['kind'], run: () => void): void => {
      out.push({ id: kind + ':' + text + ':' + sub, text, sub, kind, run })
    }
    // actions
    t('New tab', 'Ctrl+T', 'action', () => void window.aether.tabs.create())
    t('Reload page', 'Ctrl+R', 'action', () => {
      if (useApp.getState().activeId != null) void window.aether.tabs.reload(useApp.getState().activeId as number)
    })
    t('Close tab', 'Ctrl+W', 'action', () => {
      if (useApp.getState().activeId != null) void window.aether.tabs.close(useApp.getState().activeId as number)
    })
    t('New private window', 'Ctrl+Shift+N', 'action', () => void window.aether.win.newPrivate())
    t('Search tabs', 'Ctrl+Shift+A', 'action', () => {
      set({ paletteOpen: false, tabSearchOpen: true })
    })
    t('Password manager', 'Ctrl+Shift+Y', 'page', () => void window.aether.tabs.create('aether://passwords'))
    t('Translate page', 'Alt+Shift+T', 'action', () => void window.aether.tabs.translate())
    t('Group tabs by topic', 'local AI', 'action', () => void window.aether.tabs.cluster())
    t('Toggle AI sidebar', 'Ctrl+E', 'action', () => {
      const openNow = useApp.getState().sidebarOpen
      set({ sidebarOpen: !openNow })
      void window.aether.ui.setSidebar(!openNow)
    })
    t('Zoom in', 'Ctrl+=', 'action', () => void window.aether.tabs.zoom('in'))
    t('Zoom out', 'Ctrl+-', 'action', () => void window.aether.tabs.zoom('out'))
    t('Reset zoom', 'Ctrl+0', 'action', () => void window.aether.tabs.zoom('reset'))
    t('Toggle bookmarks bar', 'Ctrl+Shift+B', 'action', () => {
      const show = !useApp.getState().showBookmarksBar
      set({ showBookmarksBar: show })
      void window.aether.ui.setBookmarksBar(show)
    })
    // pages
    t('Settings', 'aether://settings', 'page', () => void window.aether.tabs.create('aether://settings'))
    t('History', 'aether://history', 'page', () => void window.aether.tabs.create('aether://history'))
    t('Bookmarks', 'aether://bookmarks', 'page', () => void window.aether.tabs.create('aether://bookmarks'))
    t('Downloads', 'aether://downloads', 'page', () => void window.aether.tabs.create('aether://downloads'))
    t('Model library', 'aether://settings — Models section', 'page', () => void window.aether.tabs.create('aether://settings#models'))
    // tabs
    for (const tab of tabs as TabMeta[]) {
      t(tab.title || 'New Tab', tab.url, 'tab', () => void window.aether.tabs.activate(tab.id))
    }
    // bookmarks
    for (const b of (bookmarks || []) as Bookmark[]) {
      t(b.title || b.url, b.url, 'bookmark', () => void window.aether.tabs.create(b.url))
    }
    return out
  }, [tabs, bookmarks, set])

  const results = useMemo(() => rankBy(cmds, q, 24), [cmds, q])

  useEffect(() => {
    setSel(0)
  }, [q])

  useEffect(() => {
    const el = listRef.current?.querySelector('.cp-item.sel')
    el?.scrollIntoView({ block: 'nearest' })
  }, [sel, results.length, open])

  if (!open) return null

  const exec = (c: Cmd | undefined): void => {
    if (!c) return
    set({ paletteOpen: false })
    try {
      c.run()
    } catch {
      /* a dead action must never wedge the palette */
    }
  }

  return (
    <div className="cp-overlay" onClick={() => set({ paletteOpen: false })}>
      <div className="cp-box" onClick={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          className="cp-input"
          placeholder="Type a command, tab, bookmark or page…"
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
              exec(results[sel]?.item)
            }
          }}
        />
        <div className="cp-list" ref={listRef}>
          {results.map((r, i) => (
            <div
              key={r.item.id}
              className={`cp-item ${i === sel ? 'sel' : ''}`}
              onMouseEnter={() => setSel(i)}
              onClick={() => exec(r.item)}
            >
              <span className={`cp-kind cp-kind-${r.item.kind}`}>{KIND_LABEL[r.item.kind]}</span>
              <span className="cp-text">{r.item.text}</span>
              {r.item.sub && <span className="cp-sub">{r.item.sub}</span>}
            </div>
          ))}
          {!results.length && <div className="cp-empty">No matches</div>}
        </div>
        <div className="cp-foot">↑↓ navigate · Enter run · Esc close</div>
      </div>
    </div>
  )
}
