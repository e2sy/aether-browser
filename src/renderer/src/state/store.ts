import { create } from 'zustand'
import type { TabMeta, Settings, Bookmark, SidebarMode, DownloadState } from '../../../shared/types'

interface AppState {
  tabs: TabMeta[]
  activeId: number | null
  sidebarOpen: boolean
  /** one-shot request (from app menu) to open the sidebar on a given tab */
  sidebarMode: SidebarMode | null
  maximized: boolean
  settings: Settings | null
  bookmarks: Bookmark[]
  /** recent downloads (active first, capped) */
  downloads: DownloadState[]
  /** last zoom feedback for the bubble */
  zoom: { percent: number; ts: number } | null
  set: (patch: Partial<AppState>) => void
}

export const useApp = create<AppState>((set) => ({
  tabs: [],
  activeId: null,
  sidebarOpen: false,
  sidebarMode: null,
  maximized: false,
  settings: null,
  bookmarks: [],
  downloads: [],
  zoom: null,
  set: (patch) => set(patch)
}))

/** Upsert a download entry (newest first, keep the list small). */
export function upsertDownload(d: DownloadState): void {
  const list = useApp.getState().downloads.filter((x) => x.id !== d.id)
  useApp.getState().set({ downloads: [d, ...list].slice(0, 6) })
}

export function useActiveTab(): TabMeta | undefined {
  return useApp((s) => s.tabs.find((t) => t.id === s.activeId))
}
