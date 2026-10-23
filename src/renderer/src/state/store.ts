import { create } from 'zustand'
import type { TabMeta, Settings, Bookmark } from '../../../shared/types'

interface AppState {
  tabs: TabMeta[]
  activeId: number | null
  sidebarOpen: boolean
  maximized: boolean
  settings: Settings | null
  bookmarks: Bookmark[]
  set: (patch: Partial<AppState>) => void
}

export const useApp = create<AppState>((set) => ({
  tabs: [],
  activeId: null,
  sidebarOpen: false,
  maximized: false,
  settings: null,
  bookmarks: [],
  set: (patch) => set(patch)
}))

export function useActiveTab(): TabMeta | undefined {
  return useApp((s) => s.tabs.find((t) => t.id === s.activeId))
}
