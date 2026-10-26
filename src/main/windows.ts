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
import { scheduleSessionSave, flushSessionNow, type SessionTab } from './session-restore'
import { CHROME_SHELL_LOCK } from './navlock'
import { canOpenAsTab } from './extproto'
import { shouldHideToTray, isQuitting, isBootHidden, wakeFromBootHidden, markQuitting } from './osshell'
import { mergedSettings } from './store'
import { listProfiles, switchProfileArgs, activeProfileName, activeProfileId } from './profiles'
import { validateProfileId } from '../shared/profiles'

export const CHROME_HEIGHT = 84
export const SIDEBAR_WIDTH = 400

export interface WindowEntry {
  win: BrowserWindow
  tabs: TabManager
  ui: { sidebarOpen: boolean; /** vertical-tabs panel width (#33) — 0 when disabled */ vtabWidth: number }
  /** v1.5.0 build 5: private windows skip history writes + session persistence */
  private?: boolean
  /** measured chrome height (tab strip + toolbar + optional bookmarks bar) */
  chromeH: number
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

/** Re-fit the chrome height / vertical-tabs / sidebar split for one window. */
export function applyLayout(entry: WindowEntry): void {
  if (entry.win.isDestroyed()) return
  const [w, h] = entry.win.getContentSize()
  const chromeH = Math.max(CHROME_HEIGHT, entry.chromeH || CHROME_HEIGHT)
  const sidebar = entry.ui.sidebarOpen ? SIDEBAR_WIDTH : 0
  const vtabs = Math.max(0, Math.min(400, entry.ui.vtabWidth || 0))
  entry.tabs.setBounds({
    x: vtabs,
    y: chromeH,
    width: Math.max(60, w - sidebar - vtabs),
    height: Math.max(60, h - chromeH)
  })
}

export interface CreateWindowOptions {
  /** restore this tab set instead of a single blank tab (session restore) */
  restore?: { tabs: SessionTab[]; active: number; groups?: unknown; tabGroups?: unknown }
  /** private window — in-memory session, no history/session writes (build 5) */
  private?: boolean
}

export function createBrowserWindow(url?: string, opts: CreateWindowOptions = {}): WindowEntry {
  // app icon for the taskbar / title bar in dev & unpackaged runs (packaged
  // builds get their icon from electron-builder, so a missing file is fine)
  const iconPath = path.join(__dirname, '../../build/icon.png')
  // v2.4.0 — non-default profiles show their name in the window/taskbar title
  const profTitle = activeProfileTitleSuffix()
  const win = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 720,
    minHeight: 520,
    ...(profTitle ? { title: `Aether — ${profTitle}` } : {}),
    frame: process.platform === 'darwin',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : undefined,
    backgroundColor: '#16171b',
    // ── chrome-UI sandbox re-audit (Master Plan #17) ──────────────────────
    // sandbox:true was evaluated and is NOT possible today: the generated
    // ui.js preload appends `require('electron-chrome-extensions/dist/
    // browser-action').injectBrowserAction()`, and sandboxed preloads can
    // require nothing beyond `electron` — extension browser actions (toolbar
    // icons + popups) would break on every browser window.
    // Compensating controls, all verified by tests (test-v178):
    //   • contextIsolation ON / nodeIntegration OFF — window.aether is the
    //     only bridge into Node
    //   • the preload itself contains zero Node builtins (single-file bundle)
    //   • navlock CHROME_SHELL_LOCK: this webContents can never navigate
    //   • will-attach-webview refused; CSP + nonce (build 2) kill inline JS
    //   • IPC is identity-guarded (trust.ts), not URL-guarded
    //   • webSecurity stays ON, insecure content off, no experimental flags
    webPreferences: {
      preload: uiPreloadPath || undefined,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      experimentalFeatures: false,
      spellcheck: false,
      ...(opts.private ? { partition: 'aether-private' } : {})
    },
    ...(process.platform !== 'darwin' && fs.existsSync(iconPath) ? { icon: iconPath } : {}),
    show: false
  })

  const entry: WindowEntry = {
    win,
    tabs: null as unknown as TabManager,
    ui: { sidebarOpen: false, vtabWidth: 0 },
    chromeH: CHROME_HEIGHT,
    ...(opts.private ? { private: true } : {})
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
      popout: (w, tabId) => popoutTab(w.id, tabId),
      ...(opts.private ? { private: true } : {})
    }
  )

  win.once('ready-to-show', () => {
    // startup boost: boots stay hidden until the user asks for a window
    // (tray click / second-instance link / dock click all call wake+focus)
    if (isBootHidden()) return
    win.show()
  })
  // close-to-tray (#28): swallow the close when enabled — Quit still works
  // via tray menu / Ctrl+Q (those set quitting first)
  win.on('close', (e) => {
    if (shouldHideToTray(Boolean(mergedSettings().closeToTray), isQuitting())) {
      e.preventDefault()
      wakeFromBootHidden()
      win.hide()
    }
  })
  win.webContents.on('did-finish-load', () => {
    if (entry.private && !win.isDestroyed()) win.webContents.send('win:private', true)
  })
  // navlock: the chrome shell is pure first-party UI — it must never navigate
  // anywhere (an injected script or a stray link must not replace the browser
  // chrome). Reloads/devtools are issued by the main process, not in-page.
  win.webContents.on('will-navigate', (e, targetUrl) => {
    if (!CHROME_SHELL_LOCK) return
    e.preventDefault()
    console.warn('[navlock] chrome-shell blocked ->', String(targetUrl).slice(0, 120))
  })
  win.webContents.on('will-attach-webview', (e) => e.preventDefault())
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
    // session restore: rebuild every tab, re-pin, re-group, focus the recorded one
    let focusId = 0
    entry.tabs.restoreGroups(opts.restore.groups, opts.restore.tabGroups)
    opts.restore.tabs.forEach((t, i) => {
      const id = entry.tabs.create(t.url, false)
      if (t.pinned) entry.tabs.setPinned(id, true)
      const gid = (t as SessionTab & { groupId?: string | null }).groupId
      if (gid) entry.tabs.setTabGroup(id, gid)
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

/** Guard used by single-instance lock / tray: wake + focus an existing window. */
export function focusAnyWindow(): void {
  wakeFromBootHidden()
  const entry = firstEntry()
  if (entry) {
    if (entry.win.isMinimized()) entry.win.restore()
    if (!entry.win.isVisible()) entry.win.show()
    entry.win.focus()
  } else {
    createBrowserWindow()
  }
}

/**
 * Open a URL as a tab in the running browser (second-instance link
 * forwarding — the default-browser flow: the OS hands us the URL, the
 * already-running instance opens it as a foreground tab and comes to
 * front). Never throws.
 */
export function openUrlInRunningBrowser(url: string): void {
  const clean = String(url || '').trim()
  // http/https always; aether:// only for our own internal routes (#32) —
  // the OS hands us both after default-browser + aether:// registration
  if (!canOpenAsTab(clean)) return
  const entry = firstEntry()
  if (entry && !entry.win.isDestroyed()) {
    try {
      entry.tabs.create(clean, true)
      wakeFromBootHidden()
      if (entry.win.isMinimized()) entry.win.restore()
      if (!entry.win.isVisible()) entry.win.show()
      entry.win.focus()
      return
    } catch (err) {
      console.warn('[windows] second-instance tab open failed, creating window:', err instanceof Error ? err.message : err)
    }
  }
  createBrowserWindow(clean)
}

export function appVersion(): string {
  return app.getVersion()
}

/** 'Work' when running a non-default profile, '' for the default one. */
function activeProfileTitleSuffix(): string {
  try {
    return activeProfileName()
  } catch {
    return ''
  }
}

/**
 * v2.4.0 build 18 — switch profiles Chrome-style: flush this profile's
 * session with a clean-exit marker, then relaunch into the target profile's
 * own userData (its own single-instance lock, its own everything).
 * Never throws — validation failures return a typed error instead.
 */
export function switchToProfile(id: unknown): { ok: boolean; error?: string } {
  const pid = String(id ?? '')
  if (!validateProfileId(pid) || !listProfiles().some((p) => p.id === pid)) {
    return { ok: false, error: 'Unknown profile' }
  }
  if (pid === activeProfileId()) return { ok: true }
  markQuitting() // clean-exit marker so the next boot restores without the crash warning
  flushSessionNow(allEntries(), true)
  app.relaunch({ args: switchProfileArgs(pid) })
  app.exit(0)
  return { ok: true }
}
