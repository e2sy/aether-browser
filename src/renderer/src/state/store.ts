import { create } from 'zustand'
import type { TabMeta, Settings, Bookmark, SidebarMode, DownloadState, TabGroupInfo } from '../../../shared/types'

/** v2.9.0 — this window's profile identity (from main's win:profile event) */
export interface WindowProfile {
  id: string
  name: string
  color: string
}

interface AppState {
  tabs: TabMeta[]
  activeId: number | null
  /** tab groups (#34) — synced from tabs:state */
  groups: TabGroupInfo[]
  /** v1.8.0 (#33) — tab strip orientation */
  tabOrientation: 'top' | 'left'
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
  /** v1.5.0 — bookmarks bar visibility (settings + live menu toggle) */
  showBookmarksBar: boolean
  /** v1.5.0 — this window is private (in-memory session, nothing saved) */
  isPrivate: boolean
  /** v2.9.0 — this window's profile (drives the chrome top tint) */
  profile: WindowProfile | null
  /** v1.8.0 (#37) — command palette visibility */
  paletteOpen: boolean
  /** v2.3.0 — tab search overlay (Ctrl+Shift+A, Chrome parity) */
  tabSearchOpen: boolean
  /** v2.3.0 — password save bar prompt (main → chrome) */
  credPrompt: { requestId: string; host: string; url?: string; username: string } | null
  set: (patch: Partial<AppState>) => void
}

export const useApp = create<AppState>((set) => ({
  tabs: [],
  activeId: null,
  groups: [],
  tabOrientation: 'top',
  sidebarOpen: false,
  sidebarMode: null,
  maximized: false,
  settings: null,
  bookmarks: [],
  downloads: [],
  zoom: null,
  showBookmarksBar: true,
  isPrivate: false,
  profile: null,
  paletteOpen: false,
  tabSearchOpen: false,
  credPrompt: null,
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
