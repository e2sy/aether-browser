/**
 * Multi-window support — Aether can open any number of browser windows, each
 * with its own tab strip, sidebar state and TabManager.
 *
 * The registry here is the single source of truth for routing:
 *   - IPC senders are mapped back to their window via BrowserWindow.fromWebContents
 *   - app-menu commands act on the focused window
 *   - the extensions host resolves tabs across every registered TabManager
 */
import { BrowserWindow, app } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import { TabManager } from './tabs'
import { registerTabManager, unregisterTabManager } from './extensions'
import { scheduleSessionSave, type SessionTab } from './session-restore'

export const CHROME_HEIGHT = 84
export const SIDEBAR_WIDTH = 400

export interface WindowEntry {
  win: BrowserWindow
  tabs: TabManager
  ui: { sidebarOpen: boolean }
  /** v1.5.0 build 5: private windows skip history writes + session persistence */
  private?: boolean
}

const entries = new Map<number, WindowEntry>()
let preloadPath = ''
let uiPreloadPath = ''

export function setPreloadPath(p: string): void {
  preloadPath = p
}

/** Sandbox-free chrome-UI preload (bridge + extension browser-action glue). */
export function setUiPreloadPath(p: string): void {
  uiPreloadPath = p
}

export function allEntries(): WindowEntry[] {
  return [...entries.values()]
}

export function entryForWin(win: BrowserWindow | null | undefined): WindowEntry | undefined {
  if (!win) return undefined
  return entries.get(win.id)
}

/** Which window did this renderer webContents come from? */
export function entryForSender(sender: Electron.WebContents): WindowEntry | undefined {
  return entryForWin(BrowserWindow.fromWebContents(sender))
}

/** The window the user is currently working in (menu accelerators land here). */
export function focusedEntry(): WindowEntry | undefined {
  return entryForWin(BrowserWindow.getFocusedWindow()) ?? allEntries().find((e) => !e.win.isDestroyed())
}

/** Re-fit the chrome height / sidebar split for one window. */
export function applyLayout(entry: WindowEntry): void {
  if (entry.win.isDestroyed()) return
  const [w, h] = entry.win.getContentSize()
  const sidebar = entry.ui.sidebarOpen ? SIDEBAR_WIDTH : 0
  entry.tabs.setBounds({
    x: 0,
    y: CHROME_HEIGHT,
    width: Math.max(60, w - sidebar),
    height: Math.max(60, h - CHROME_HEIGHT)
  })
}

export interface CreateWindowOptions {
  /** restore this tab set instead of a single blank tab (session restore) */
  restore?: { tabs: SessionTab[]; active: number }
  /** private window — in-memory session, no history/session writes (build 5) */
  private?: boolean
}

export function createBrowserWindow(url?: string, opts: CreateWindowOptions = {}): WindowEntry {
  // app icon for the taskbar / title bar in dev & unpackaged runs (packaged
  // builds get their icon from electron-builder, so a missing file is fine)
  const iconPath = path.join(__dirname, '../../build/icon.png')
  const win = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 720,
    minHeight: 520,
    frame: process.platform === 'darwin',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : undefined,
    backgroundColor: '#16171b',
    // The chrome UI is first-party code: sandbox:false lets its preload load
    // the electron-chrome-extensions glue. contextIsolation stays ON and
    // nodeIntegration stays OFF — window.aether remains the only bridge.
    webPreferences: {
      preload: uiPreloadPath || undefined,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false
    },
    ...(process.platform !== 'darwin' && fs.existsSync(iconPath) ? { icon: iconPath } : {}),
    show: false
  })

  const entry: WindowEntry = {
    win,
    tabs: null as unknown as TabManager,
    ui: { sidebarOpen: false }
  }
  entries.set(win.id, entry)

  entry.tabs = new TabManager(
    win,
    preloadPath,
    () => {
      if (!win.isDestroyed()) win.webContents.send('tabs:state', entry.tabs.getState())
      if (!entry.private) scheduleSessionSave()
    },
    {
      onEmpty: (w) => {
        if (!w.isDestroyed()) w.close()
      },
      popout: (w, tabId) => popoutTab(w.id, tabId)
    }
  )

  win.once('ready-to-show', () => win.show())
  win.on('resize', () => applyLayout(entry))
  win.on('maximize', () => {
    if (!win.isDestroyed()) win.webContents.send('win:maximized', true)
  })
  win.on('unmaximize', () => {
    if (!win.isDestroyed()) win.webContents.send('win:maximized', false)
  })
  win.on('closed', () => {
    entry.tabs.stopMemorySaver()
    unregisterTabManager(entry.tabs)
    entries.delete(win.id)
    if (!entry.private) scheduleSessionSave()
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    void win.webContents.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void win.webContents.loadFile(path.join(__dirname, '../renderer/index.html'))
  }

  registerTabManager(entry.tabs)
  if (opts.restore && opts.restore.tabs.length) {
    // session restore: rebuild every tab, re-pin, focus the recorded one
    let focusId = 0
    opts.restore.tabs.forEach((t, i) => {
      const id = entry.tabs.create(t.url, false)
      if (t.pinned) entry.tabs.setPinned(id, true)
      if (i === opts.restore!.active) focusId = id
    })
    entry.tabs.activate(focusId || entry.tabs.listIds()[0])
  } else {
    entry.tabs.create(url)
  }
  entry.tabs.startMemorySaver()
  applyLayout(entry)
  return entry
}

/**
 * “Move tab to new window”: lift the tab's URL into a fresh window. When it
 * was the source window's only tab, that window closes (Chrome behavior).
 * Returns the new window's id, or null if the tab disappeared.
 */
export function popoutTab(fromWinId: number, tabId: number): number | null {
  const src = entries.get(fromWinId)
  if (!src || src.win.isDestroyed()) return null
  const tab = src.tabs.get(tabId)
  if (!tab) return null
  const url = /^https?:\/\//i.test(tab.url) || tab.url.startsWith('aether://') ? tab.url : undefined
  const title = tab.title
  src.tabs.close(tabId) // closes the source window if this was its last tab
  const entry = createBrowserWindow(url || undefined)
  if (title && title !== 'New Tab') {
    const t = entry.tabs.active()
    if (t) t.title = title
  }
  return entry.win.id
}

/** First window, or undefined before boot finishes. */
export function firstEntry(): WindowEntry | undefined {
  return allEntries().find((e) => !e.win.isDestroyed())
}

/** Guard used by single-instance lock: focus an existing window instead. */
export function focusAnyWindow(): void {
  const entry = firstEntry()
  if (entry) {
    if (entry.win.isMinimized()) entry.win.restore()
    entry.win.focus()
  } else {
    createBrowserWindow()
  }
}

export function appVersion(): string {
  return app.getVersion()
}
