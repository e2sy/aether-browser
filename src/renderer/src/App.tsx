import { useEffect } from 'react'
import { useApp, upsertDownload } from './state/store'
import type { DownloadState } from '../../shared/types'
import TabStrip from './components/TabStrip'
import Toolbar from './components/Toolbar'
import Sidebar from './components/Sidebar'
import FindBar from './components/FindBar'
import PermPrompt from './components/PermPrompt'
import ZoomBubble from './components/ZoomBubble'
import DownloadBar from './components/DownloadBar'

export default function App(): JSX.Element {
  const sidebarOpen = useApp((s) => s.sidebarOpen)
  const set = useApp((s) => s.set)

  useEffect(() => {
    const unsub = window.aether.state.subscribe((data) => {
      const s = data as { tabs: never[]; activeId: number | null }
      set({ tabs: s.tabs, activeId: s.activeId })
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
    return () => {
      unsub()
      unsubMax()
      unsubShow()
      unsubToggle()
      unsubZoom()
      unsubDl()
    }
  }, [])

  return (
    <div className="app">
      <div className="chrome">
        <TabStrip />
        <Toolbar />
      </div>
      <div className="body">
        <div className="webarea" />
        {sidebarOpen && <Sidebar />}
      </div>
      <FindBar />
      <PermPrompt />
      <ZoomBubble />
      <DownloadBar />
    </div>
  )
}
