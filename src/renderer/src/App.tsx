import { useEffect, useRef } from 'react'
import { useApp, upsertDownload } from './state/store'
import type { DownloadState } from '../../shared/types'
import TabStrip from './components/TabStrip'
import VerticalTabs from './components/VerticalTabs'
import Toolbar from './components/Toolbar'
import BookmarksBar from './components/BookmarksBar'
import Sidebar from './components/Sidebar'
import FindBar from './components/FindBar'
import PermPrompt from './components/PermPrompt'
import ZoomBubble from './components/ZoomBubble'
import DownloadBar from './components/DownloadBar'
import CommandPalette from './components/CommandPalette'
import TabSearch from './components/TabSearch'
import SaveCredBar from './components/SaveCredBar'
import TldrToast from './components/TldrToast'

export default function App(): JSX.Element {
  const sidebarOpen = useApp((s) => s.sidebarOpen)
  const activeLoading = useApp((s) => s.tabs.find((t) => t.id === s.activeId)?.loading)
  const isPrivate = useApp((s) => s.isPrivate)
  const tabOrientation = useApp((s) => s.tabOrientation)
  const profile = useApp((s) => s.profile)
  const set = useApp((s) => s.set)
  const chromeRef = useRef<HTMLDivElement>(null)
  // v2.1.0: the — □ × cluster moved into Toolbar.tsx (vertical mode), so the
  // platform check lives there now — App no longer needs isMac.

  // v1.8.0 (#33) — vertical tabs need the tab strip gone from the top chrome
  const vertical = tabOrientation === 'left'

  // v1.5.0 — bookmarks bar visibility: from settings, live from the menu toggle
  useEffect(() => {
    window.aether.settings
      .get()
      .then((s) => {
        const st = s as { showBookmarksBar?: boolean; tabOrientation?: 'top' | 'left' }
        set({
          showBookmarksBar: st.showBookmarksBar !== false,
          tabOrientation: st.tabOrientation === 'left' ? 'left' : 'top'
        })
      })
      .catch(() => undefined)
    const unsubBar = window.aether.state.onBookmarksBar((v) => set({ showBookmarksBar: Boolean(v) }))
    const unsubPriv = window.aether.state.onPrivate(() => set({ isPrivate: true }))
    // v2.9.0 — profile identity drives the Chrome-style top tint
    const unsubProf = window.aether.state.onProfile((raw) => {
      const p = raw as { id?: string; name?: string; color?: string } | null
      if (p && p.id) set({ profile: { id: String(p.id), name: String(p.name || 'Profile'), color: String(p.color || '#7c8cff') } })
    })
    return () => {
      unsubBar()
      unsubPriv()
      unsubProf()
    }
  }, [])

  // v1.5.0 — report the measured chrome height so the web view sits exactly
  // below it (the bookmarks bar changes the chrome's height dynamically)
  useEffect(() => {
    const el = chromeRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const send = (): void => {
      const h = Math.round(el.getBoundingClientRect().height)
      if (h > 0) void window.aether.ui.setChromeHeight(h)
    }
    const ro = new ResizeObserver(send)
    ro.observe(el)
    send()
    return () => ro.disconnect()
  }, [])

  // v1.4.0 Customization Studio — accent + UI zoom live on the chrome
  useEffect(() => {
    const axShade = (hex: string, amt: number): string => {
      if (!/^#[0-9a-f]{6}$/i.test(hex || '')) return hex
      const n = (i: number): number => parseInt(hex.slice(i, i + 2), 16)
      const mix = (v: number): string => {
        const o = Math.max(0, Math.min(255, Math.round(v * (1 - amt))))
        return ('0' + o.toString(16)).slice(-2)
      }
      return '#' + mix(n(1)) + mix(n(3)) + mix(n(5))
    }
    const apply = (raw: unknown): void => {
      const a = raw as { accent?: string; fontScale?: number } | undefined
      if (!a) return
      const r = document.documentElement.style
      if (typeof a.accent === 'string' && /^#[0-9a-f]{6}$/i.test(a.accent)) {
        r.setProperty('--accent', a.accent)
        r.setProperty('--accent2', axShade(a.accent, 0.16))
      }
      if (typeof a.fontScale === 'number' && a.fontScale > 0) {
        document.body.style.zoom = String(a.fontScale)
      }
    }
    window.aether.settings
      .get()
      .then((s) => apply((s as { appearance?: { accent?: string; fontScale?: number } }).appearance))
      .catch(() => {})
    let unsub: (() => void) | undefined
    try {
      unsub = window.aether.settings.onAppearanceChanged(apply)
    } catch {
      /* older preload — appearance just stays default until reboot */
    }
    return () => {
      try {
        unsub?.()
      } catch {
        /* noop */
      }
    }
  }, [])

  useEffect(() => {
    const unsub = window.aether.state.subscribe((data) => {
      const s = data as { tabs: never[]; activeId: number | null; groups?: never[] }
      set({ tabs: s.tabs, activeId: s.activeId, groups: (s.groups || []) as never })
    })
    const unsubMax = window.aether.state.onMaximized((m) => set({ maximized: Boolean(m) }))
    const unsubShow = window.aether.state.onSidebarShow((raw) => {
      const mode = (raw as { mode?: string })?.mode
      const sidebarMode = mode === 'models' ? 'models' : mode === 'agent' ? 'agent' : 'chat'
      set({ sidebarOpen: true, sidebarMode })
    })
    const unsubToggle = window.aether.state.onSidebarToggle(() => {
      const open = useApp.getState().sidebarOpen
      set({ sidebarOpen: !open })
    })
    const unsubZoom = window.aether.state.onZoom((raw) => {
      const z = raw as { percent?: number } | null
      if (z && typeof z.percent === 'number') set({ zoom: { percent: z.percent, ts: Date.now() } })
    })
    const unsubDl = window.aether.state.onDownload((raw) => {
      const d = raw as DownloadState | null
      if (d && d.id) upsertDownload(d)
    })
    // command palette (#37) — bookmarks are ranked as commands
    window.aether.bookmarks
      .list()
      .then((l) => set({ bookmarks: (Array.isArray(l) ? l : []) as never }))
      .catch(() => undefined)
    const unsubBm = window.aether.bookmarks.onChanged(() => {
      window.aether.bookmarks
        .list()
        .then((l) => set({ bookmarks: (Array.isArray(l) ? l : []) as never }))
        .catch(() => undefined)
    })
    return () => {
      unsub()
      unsubMax()
      unsubShow()
      unsubToggle()
      unsubZoom()
      unsubDl()
      unsubBm()
    }
  }, [])

  return (
    <div className={`app ${vertical ? 'vtabs-on' : ''}`}>
      {vertical && <VerticalTabs />}
      <div className="app-main">
        <div className="chrome" ref={chromeRef}>
          {/* v2.9.0 — Chrome-style profile identity tint (non-default profiles) */}
          {profile && profile.id !== 'default' && (
            <div className="profile-tint" style={{ background: profile.color }} title={`Profile: ${profile.name}`} />
          )}
          {!vertical && <TabStrip />}
          <Toolbar />
          <BookmarksBar />
          {activeLoading && <div className="load-progress" />}
          {isPrivate && (
            <div className="private-strip" title="Private window — Aether won't save history, cookies or site data from here">
              <span className="private-dot" /> Private window — history &amp; site data are not saved
            </div>
          )}
          {/* v2.1.0: the — □ × cluster in vertical mode now renders inline at
              the toolbar's right edge (inside Toolbar.tsx) — the old detached
              absolute-positioned overlay is gone. */}
        </div>
        <div className="body">
          <div className="webarea" />
          {sidebarOpen && <Sidebar />}
        </div>
      </div>
      <FindBar />
      <PermPrompt />
      <ZoomBubble />
      <DownloadBar />
      <CommandPalette />
      <TabSearch />
      <SaveCredBar />
      <TldrToast />
    </div>
  )
}
