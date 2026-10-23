import { useEffect } from 'react'
import { useApp } from './state/store'
import TabStrip from './components/TabStrip'
import Toolbar from './components/Toolbar'
import Sidebar from './components/Sidebar'
import FindBar from './components/FindBar'
import PermPrompt from './components/PermPrompt'

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
    return () => {
      unsub()
      unsubMax()
      unsubShow()
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
    </div>
  )
}
