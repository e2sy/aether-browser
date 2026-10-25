import { useCallback, useEffect, useRef, useState } from 'react'
import { useApp, useActiveTab } from '../state/store'

interface Bm {
  url: string
  title: string
  ts: number
}

/** First letter chip — bookmarks carry no favicon in the store. */
function letterOf(b: Bm): string {
  const host = (() => {
    try {
      return new URL(b.url).hostname.replace(/^www\./, '')
    } catch {
      return b.title || '?'
    }
  })()
  return (host.charAt(0) || '?').toUpperCase()
}

/**
 * v1.5.0 — Chrome-style bookmarks bar under the toolbar.
 * Left-click opens in the current tab; middle-click / Ctrl-click opens a
 * background tab; right-click gives Open-in-new-tab / Remove.
 */
export default function BookmarksBar(): JSX.Element | null {
  const show = useApp((s) => s.showBookmarksBar)
  const tab = useActiveTab()
  const [items, setItems] = useState<Bm[]>([])
  const [menuFor, setMenuFor] = useState<{ bm: Bm; x: number; y: number } | null>(null)
  const barRef = useRef<HTMLDivElement>(null)

  const load = useCallback((): void => {
    window.aether.bookmarks
      .list()
      .then((l) => setItems(Array.isArray(l) ? (l as Bm[]) : []))
      .catch(() => undefined)
  }, [])

  useEffect(() => {
    load()
  }, [load])

  // toggle/remove can come from the toolbar star, this bar, or the bookmarks page
  useEffect(() => {
    return window.aether.bookmarks.onChanged(() => load())
  }, [load])

  // close the context menu on any outside click
  useEffect(() => {
    if (!menuFor) return
    const close = (): void => setMenuFor(null)
    window.addEventListener('mousedown', close)
    return () => window.removeEventListener('mousedown', close)
  }, [menuFor])

  if (!show) return null

  const open = (bm: Bm, background: boolean): void => {
    if (background) {
      void window.aether.tabs.createBackground(bm.url)
      return
    }
    if (tab) void window.aether.tabs.omnibox(tab.id, bm.url)
  }

  return (
    <div className="bookmarks-bar" ref={barRef}>
      {items.length === 0 && <span className="bm-empty">Bookmark pages with the ★ — they appear here</span>}
      {items.map((bm) => (
        <button
          key={bm.url}
          className="bm-item"
          title={`${bm.title || bm.url}\n${bm.url}`}
          onClick={(e) => open(bm, e.ctrlKey || e.metaKey)}
          onAuxClick={(e) => {
            if (e.button === 1) {
              e.preventDefault()
              open(bm, true)
            }
          }}
          onContextMenu={(e) => {
            e.preventDefault()
            setMenuFor({ bm, x: e.clientX, y: e.clientY })
          }}
        >
          <span className="bm-ic">{letterOf(bm)}</span>
          <span className="bm-label">{bm.title || bm.url}</span>
        </button>
      ))}
      {menuFor && (
        <div className="bm-menu" style={{ left: Math.min(menuFor.x, window.innerWidth - 190), top: menuFor.y }}>
          <button
            onClick={() => {
              void window.aether.tabs.createBackground(menuFor.bm.url)
              setMenuFor(null)
            }}
          >
            Open in new tab
          </button>
          <button
            className="danger"
            onClick={() => {
              void window.aether.bookmarks.remove(menuFor.bm.url)
              setMenuFor(null)
            }}
          >
            Remove bookmark
          </button>
        </div>
      )}
    </div>
  )
}
