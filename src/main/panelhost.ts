/**
 * Side-panel host (v2.10.0 build 24) — owns the WebContentsView for the open
 * panel of every browser window and the layout math shared with applyLayout.
 *
 * Design:
 *   • panels are global (panels.json) but OPEN STATE is per window
 *     (WindowEntry.ui.panelOpenId), like the AI sidebar.
 *   • one view per (window, panel), created lazily and KEPT ALIVE when the
 *     panel is closed (removed from the contentView only) — reopening is
 *     instant and site state (scroll, logins within the session) survives.
 *   • the rail itself is DOM in the chrome renderer (PanelRail.tsx) — main
 *     only reserves the exact same 44px column when any panel exists.
 *   • panel views carry NO aether bridge preload: they are plain web pages.
 *     Session-level preloads (gestures/farble) still apply because they are
 *     installed on the session, not the view. Private windows use the
 *     aether-private partition.
 */
import { WebContentsView } from 'electron'
import type { Rectangle } from 'electron'
import type { WindowEntry } from './windows'
import { listPanels } from './panels'

export const PANEL_RAIL_WIDTH = 44
export const PANEL_VIEW_WIDTH = 360
/** the page content never gets narrower than this when a panel is open */
export const MIN_CONTENT_WIDTH = 220

/** per-window views keyed by panel id — alive across open/close toggles */
const views = new Map<number, Map<string, WebContentsView>>()

/** The rail shows whenever the user has at least one panel pinned. */
export function railVisible(_entry?: WindowEntry | null): boolean {
  return listPanels().length > 0
}

/**
 * Pure layout split for one window (unit-tested). Given the window content
 * size, chrome height, vertical-tabs width and whether the rail/panel show,
 * returns where the tab content starts and where the panel view goes.
 */
export function panelSplit(inp: {
  w: number
  h: number
  chromeH: number
  vtabs: number
  rail: boolean
  panelOpen: boolean
}): { contentX: number; contentW: number; panel: Rectangle | null } {
  const w = Math.max(1, Math.floor(inp.w) || 0)
  const h = Math.max(1, Math.floor(inp.h) || 0)
  const chromeH = Math.max(0, Math.floor(inp.chromeH) || 0)
  const vtabs = Math.max(0, Math.min(400, Math.floor(inp.vtabs) || 0))
  const rail = inp.rail ? PANEL_RAIL_WIDTH : 0
  // panel view sits between rail and content; when the window is too narrow
  // to fit PANEL_VIEW_WIDTH + MIN_CONTENT_WIDTH the panel shrinks first
  const avail = w - vtabs - rail
  const panelW = inp.panelOpen ? Math.max(120, Math.min(PANEL_VIEW_WIDTH, avail - MIN_CONTENT_WIDTH)) : 0
  const contentX = vtabs + rail
  const contentW = Math.max(60, avail - panelW)
  const panel: Rectangle | null = inp.panelOpen
    ? { x: contentX, y: chromeH, width: panelW, height: Math.max(60, h - chromeH) }
    : null
  return { contentX, contentW, panel }
}

export function getPanelState(entry: WindowEntry): { openId: string | null } {
  return { openId: entry.ui.panelOpenId ?? null }
}

function viewFor(entry: WindowEntry, panelId: string): WebContentsView {
  const map = views.get(entry.win.id) ?? new Map<string, WebContentsView>()
  views.set(entry.win.id, map)
  const existing = map.get(panelId)
  if (existing && !existing.webContents.isDestroyed()) return existing
  const view = new WebContentsView({
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      ...(entry.private ? { partition: 'aether-private' } : {})
    }
  })
  map.set(panelId, view)
  return view
}

/** Open (or focus) a pinned panel in this window. Returns false for unknown ids. */
export function openPanel(entry: WindowEntry, rawId: unknown): boolean {
  if (entry.win.isDestroyed()) return false
  const id = String(rawId ?? '')
  const panel = listPanels().find((p) => p.id === id)
  if (!panel) return false
  // hide whatever panel is currently docked (its view stays alive)
  const current = entry.ui.panelOpenId
  if (current === id) {
    applyPanelBounds(entry)
    return true
  }
  if (current) hidePanelView(entry, current)
  const view = viewFor(entry, id)
  try {
    if (view.webContents.getURL() !== panel.url && !view.webContents.isDestroyed()) {
      void view.webContents.loadURL(panel.url)
    }
  } catch {
    /* destroyed mid-flight */
  }
  wireView(entry, view)
  entry.win.contentView.addChildView(view)
  entry.ui.panelOpenId = id
  applyPanelBounds(entry)
  pushPanelState(entry)
  return true
}

/** Close the docked panel of this window (its view stays alive for reuse). */
export function closePanel(entry: WindowEntry): boolean {
  if (!entry.ui.panelOpenId || entry.win.isDestroyed()) return false
  hidePanelView(entry, entry.ui.panelOpenId)
  entry.ui.panelOpenId = null
  pushPanelState(entry)
  return true
}

export function togglePanel(entry: WindowEntry, rawId: unknown): boolean {
  const id = String(rawId ?? '')
  if (entry.ui.panelOpenId === id) return closePanel(entry)
  return openPanel(entry, id)
}

/** Menu accelerator: close the open panel, or open the newest pinned one. */
export function toggleLastPanel(entry: WindowEntry): boolean {
  if (entry.ui.panelOpenId) return closePanel(entry)
  const first = listPanels()[0]
  return first ? openPanel(entry, first.id) : false
}

/** Position the open panel view — called from applyLayout on every refit. */
export function applyPanelBounds(entry: WindowEntry): void {
  if (entry.win.isDestroyed() || !entry.ui.panelOpenId) return
  const id = entry.ui.panelOpenId
  const map = views.get(entry.win.id)
  const view = map?.get(id)
  if (!view || view.webContents.isDestroyed()) return
  const [w, h] = entry.win.getContentSize()
  const chromeH = Math.max(84, entry.chromeH || 84)
  const vtabs = entry.ui.vtabWidth || 0
  const split = panelSplit({
    w,
    h,
    chromeH,
    vtabs,
    rail: railVisible(entry),
    panelOpen: true
  })
  if (split.panel) view.setBounds(split.panel)
}

/** Views of this window must die with it (called from the 'closed' handler). */
export function destroyPanelViews(entry: WindowEntry): void {
  const map = views.get(entry.win.id)
  if (!map) return
  for (const view of map.values()) {
    try {
      if (!view.webContents.isDestroyed()) view.webContents.close()
    } catch {
      /* already gone */
    }
  }
  views.delete(entry.win.id)
}

function hidePanelView(entry: WindowEntry, panelId: string): void {
  const view = views.get(entry.win.id)?.get(panelId)
  if (!view) return
  try {
    entry.win.contentView.removeChildView(view)
  } catch {
    /* window gone */
  }
}

/** Links that ask for a new window become foreground tabs of this window. */
function wireView(entry: WindowEntry, view: WebContentsView): void {
  const wc = view.webContents
  if ((wc as unknown as { __aetherPanelWired?: boolean }).__aetherPanelWired) return
  ;(wc as unknown as { __aetherPanelWired?: boolean }).__aetherPanelWired = true
  wc.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) {
      entry.tabs.create(url, true)
      return { action: 'deny' }
    }
    return { action: 'deny' }
  })
}

function pushPanelState(entry: WindowEntry): void {
  if (entry.win.isDestroyed()) return
  try {
    entry.win.webContents.send('panels:state', getPanelState(entry))
  } catch {
    /* window gone */
  }
}
