import { useEffect, useRef, useState } from 'react'
import { useApp } from '../state/store'

/**
 * Side panels (v2.10.0 build 24) — a 44px rail on the window's left edge with
 * the user's pinned sites (panels.json). Clicking a glyph docks that site in
 * a 360px WebContentsView between the rail and the page (the main process
 * reserves the exact same geometry via panelhost.panelSplit — same contract
 * as VerticalTabs' measured width, except the rail width is a constant both
 * sides agree on).
 */

const RAIL_W = 44

interface PanelItem {
  id: string
  url: string
  title: string
  ts: number
}

/** stable hue per URL for the letter-avatar glyph */
function hueFor(url: string): number {
  let h = 0
  for (let i = 0; i < url.length; i++) h = (h * 31 + url.charCodeAt(i)) >>> 0
  return h % 360
}

function glyphFor(url: string): string {
  try {
    return (new URL(url).hostname.replace(/^www\./, '')[0] || '?').toUpperCase()
  } catch {
    return '?'
  }
}

export default function PanelRail(): JSX.Element | null {
  const { tabs, activeId } = useApp()
  const [panels, setPanels] = useState<PanelItem[]>([])
  const [openId, setOpenId] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [url, setUrl] = useState('')
  const [name, setName] = useState('')
  const urlRef = useRef<HTMLInputElement>(null)

  const refresh = (): void => {
    void window.aether.panels
      .list()
      .then((r) => setPanels(r.panels || []))
      .catch(() => {})
  }

  useEffect(() => {
    refresh()
    void window.aether.panels
      .getState()
      .then((s) => setOpenId(s.openId))
      .catch(() => {})
    const offChanged = window.aether.state.onPanelsChanged(refresh)
    const offState = window.aether.state.onPanelState((s) => {
      const d = s as { openId?: string | null } | null
      setOpenId(d?.openId ?? null)
    })
    return () => {
      offChanged()
      offState()
    }
  }, [])

  useEffect(() => {
    if (adding) setTimeout(() => urlRef.current?.focus(), 30)
  }, [adding])

  if (!panels.length) return null

  const active = tabs.find((t) => t.id === activeId)
  const currentUrl = active && /^https?:\/\//i.test(active.url) ? active.url : ''

  const submit = (): void => {
    const u = url.trim()
    if (!u) return
    void window.aether.panels
      .add(u, name.trim() || undefined)
      .then((p) => {
        if (p) {
          setUrl('')
          setName('')
          setAdding(false)
          void window.aether.panels.open(p.id)
        }
      })
      .catch(() => {})
  }

  return (
    <div className="panels-rail" style={{ width: RAIL_W }} aria-label="Side panels">
      {panels.map((p) => (
        <div key={p.id} className={`panels-item ${openId === p.id ? 'open' : ''}`} title={`${p.title} — ${p.url}`}>
          <button
            className="panels-glyph"
            style={{ background: `hsl(${hueFor(p.url)} 42% 38%)` }}
            onClick={() => void window.aether.panels.open(p.id)}
            title={openId === p.id ? 'Close panel' : `Open ${p.title}`}
          >
            {glyphFor(p.url)}
          </button>
          <button
            className="panels-x"
            title="Remove panel"
            onClick={() => void window.aether.panels.remove(p.id)}
          >
            ×
          </button>
        </div>
      ))}
      <button className="panels-add" title="Add side panel" onClick={() => setAdding(!adding)}>
        +
      </button>
      {adding && (
        <div className="panels-form" role="dialog" aria-label="Add side panel">
          <div className="panels-form-title">Add side panel</div>
          {currentUrl && (
            <button
              className="panels-form-current"
              title="Pin the page you are reading"
              onClick={() => {
                setUrl(currentUrl)
                setName(active?.title || '')
              }}
            >
              Use current page: {active?.title?.slice(0, 28) || currentUrl.slice(0, 32)}…
            </button>
          )}
          <input
            ref={urlRef}
            value={url}
            placeholder="https://site.com"
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submit()
              if (e.key === 'Escape') setAdding(false)
            }}
          />
          <input
            value={name}
            placeholder="Name (optional)"
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submit()
              if (e.key === 'Escape') setAdding(false)
            }}
          />
          <div className="panels-form-row">
            <button className="panels-form-ok" onClick={submit}>
              Add panel
            </button>
            <button className="panels-form-cancel" onClick={() => setAdding(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
