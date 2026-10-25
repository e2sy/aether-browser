/**
 * osshell — OS-integration chrome (Master Plan items #27, #28, #29, #30, #31).
 *
 *   • System tray with quick actions + close-to-tray (#28)
 *   • Windows jump list + macOS dock menu (#27)
 *   • Taskbar download progress + native notifications (#27/#30)
 *   • macOS dock badge / Windows overlay icon for active downloads (#31)
 *   • Startup boost: opt-in login item launched --hidden (#29)
 *
 * Pure decision helpers are unit-tested (test-v180.mjs); everything else is
 * the Electron shell. All calls are defensive — a missing dock/tray API on
 * one OS must never break boot on another.
 */
import { app, Menu, Notification, Tray, nativeImage } from 'electron'
import path from 'node:path'
import fs from 'node:fs'

/**
 * Shield-toggle hook, injected at boot by index.ts (which owns the adblock
 * dependency). Keeps this module dependency-free — light bundles (tests)
 * can import the pure helpers without dragging in the whole engine.
 */
let shieldToggleHook: (() => void) | null = null
export function setShieldToggleHook(fn: () => void): void {
  shieldToggleHook = fn
}

/**
 * Window operations, injected at boot by index.ts. Same dependency-inversion
 * as the shield hook: oshell must never statically import windows.ts (the
 * whole chrome graph) or every test bundle that touches a download would
 * pull in the browser.
 */
export interface WindowOps {
  focusAnyWindow(): void
  createBrowserWindow(url?: string, opts?: { private?: boolean }): unknown
  focusedEntry(): { win: { isDestroyed(): boolean }; tabs: { create(url?: string, active?: boolean): number } } | undefined
  allEntries(): { win: { isDestroyed(): boolean; setOverlayIcon(icon: unknown, description: string): void } }[]
}

let ops: WindowOps | null = null
export function setWindowOps(o: WindowOps): void {
  ops = o
}

function requireOps(): WindowOps {
  if (!ops) throw new Error('[osshell] window ops not injected yet')
  return ops
}

// ---------- pure helpers (tested) ----------

/** macOS dock badge text: '' hides, >999 pins at '999+'. */
export function badgeCountText(n: number): string {
  const v = Math.max(0, Math.floor(Number(n) || 0))
  if (v === 0) return ''
  if (v > 999) return '999+'
  return String(v)
}

export type ProgressValue = number
export const PROGRESS_INDETERMINATE = -1
export const PROGRESS_CLEAR = 2

/** Map (received, total) to Electron setProgressBar values. */
export function progressValue(received: number, total: number, done = false): ProgressValue {
  if (done) return PROGRESS_CLEAR
  if (!Number.isFinite(total) || total <= 0) return PROGRESS_INDETERMINATE
  const r = Math.max(0, Number(received) || 0)
  return Math.max(0, Math.min(1, r / total))
}

/** Pure: should this window-close be swallowed into hide-to-tray? */
export function shouldHideToTray(closeToTray: boolean, quitting: boolean): boolean {
  return Boolean(closeToTray) && !quitting
}

/** Pure: login-item shape per platform for startup boost (#29). */
export function loginItemFor(
  platform: NodeJS.Platform,
  enabled: boolean
): { openAtLogin: boolean; args: string[] } {
  if (!enabled) return { openAtLogin: false, args: [] }
  return { openAtLogin: true, args: platform === 'darwin' ? ['--hidden'] : ['--hidden'] }
}

/** Pure: is this boot a "startup boost" hidden boot? */
export function launchedHidden(argv: string[]): boolean {
  return (argv ?? []).some((a) => a === '--hidden')
}

// ---------- runtime state ----------

let tray: Tray | null = null
let quitting = false
/** windows that were hidden at boot and wake on first user interaction */
let bootHidden = launchedHidden(process.argv)

export function isBootHidden(): boolean {
  return bootHidden
}

export function wakeFromBootHidden(): void {
  bootHidden = false
}

export function markQuitting(): void {
  quitting = true
}

export function isQuitting(): boolean {
  return quitting
}

function appIcon(): Electron.NativeImage | undefined {
  const p = path.join(app.getAppPath(), 'build/icon.png')
  try {
    if (fs.existsSync(p)) return nativeImage.createFromPath(p)
  } catch {
    /* fall through */
  }
  return undefined
}

// ---------- tray (#28) ----------

export function trayActions(): { newTab: () => void; newPrivate: () => void; pauseShields: () => void } {
  return {
    newTab: () => {
      try {
        const o = requireOps()
        const e = o.focusedEntry()
        if (e && !e.win.isDestroyed()) {
          e.tabs.create(undefined, true)
          o.focusAnyWindow()
        } else o.createBrowserWindow()
      } catch {
        /* ops not ready — ignore */
      }
    },
    newPrivate: () => {
      try {
        requireOps().createBrowserWindow(undefined, { private: true })
      } catch {
        /* ops not ready — ignore */
      }
    },
    pauseShields: () => {
      if (shieldToggleHook) shieldToggleHook()
    }
  }
}

export function createTray(): void {
  if (tray || process.platform === 'darwin') return // macOS has the dock menu instead
  try {
    const icon = appIcon()
    if (!icon) return
    tray = new Tray(icon)
    tray.setToolTip('Aether Browser')
    rebuildTrayMenu()
    tray.on('click', () => {
      try {
        requireOps().focusAnyWindow()
      } catch {
        /* ops not ready — ignore */
      }
    })
  } catch (err) {
    console.warn('[osshell] tray unavailable:', err instanceof Error ? err.message : err)
  }
}

export function rebuildTrayMenu(): void {
  if (!tray) return
  const acts = trayActions()
  const focus = (): void => {
    try {
      requireOps().focusAnyWindow()
    } catch {
      /* ops not ready — ignore */
    }
  }
  const menu = Menu.buildFromTemplate([
    { label: 'Open Aether', click: focus },
    { type: 'separator' },
    { label: 'New Tab', click: acts.newTab },
    { label: 'New Private Window', click: acts.newPrivate },
    { type: 'separator' },
    { label: 'Pause shields', click: acts.pauseShields },
    { type: 'separator' },
    { label: 'Quit Aether', click: () => {
        markQuitting()
        app.quit()
      } }
  ])
  tray.setContextMenu(menu)
}

export function destroyTray(): void {
  try {
    tray?.destroy()
  } catch {
    /* already gone */
  }
  tray = null
}

// ---------- windows jump list + mac dock menu (#27) ----------

export function jumplistEntries(): { label: string; program: string; args: string; iconPath: string; iconIndex: number }[] {
  return [
    { label: 'New window', program: process.execPath, args: '--new-window', iconPath: process.execPath, iconIndex: 0 },
    { label: 'New private window', program: process.execPath, args: '--private', iconPath: process.execPath, iconIndex: 0 },
    { label: 'Downloads', program: process.execPath, args: 'aether://downloads', iconPath: process.execPath, iconIndex: 0 }
  ]
}

export function installJumplist(): void {
  if (process.platform !== 'win32') return
  try {
    app.setJumpList([
      {
        type: 'custom',
        name: 'Actions',
        items: jumplistEntries().map((e) => ({
          type: 'task' as const,
          title: e.label,
          description: e.label,
          program: e.program,
          args: e.args,
          iconPath: e.iconPath,
          iconIndex: e.iconIndex
        }))
      }
    ])
  } catch (err) {
    console.warn('[osshell] jump list failed:', err instanceof Error ? err.message : err)
  }
}

export function dockMenuEntries(): string[] {
  return ['New Window', 'New Private Window', 'Downloads']
}

export function installDockMenu(): void {
  if (process.platform !== 'darwin' || !app.dock) return
  try {
    const o = (): WindowOps => {
      try {
        return requireOps()
      } catch {
        return { focusAnyWindow() {}, createBrowserWindow() {}, focusedEntry() { return undefined }, allEntries() { return [] } }
      }
    }
    const menu = Menu.buildFromTemplate([
      { label: 'New Window', click: () => o().createBrowserWindow() },
      { label: 'New Private Window', click: () => o().createBrowserWindow(undefined, { private: true }) },
      { label: 'Downloads', click: () => o().createBrowserWindow('aether://downloads') }
    ])
    app.dock.setMenu(menu)
  } catch (err) {
    console.warn('[osshell] dock menu failed:', err instanceof Error ? err.message : err)
  }
}

// ---------- badges (#31) ----------

/** 16×16 blue dot used as the Windows taskbar overlay icon. */
const OVERLAY_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAZ0lEQVR4nGNgGGjAiEvi////z1AUMjJKEWUAukYMDWgGoRiArNm9+bskstzOWs7n2AxhwmYLumZcYigGwGzHpRBZDtmlWF1AChhEBsBCFjm00QFMjmAsYDMEl8HUTUj4DMKVlAceAACkrTAUv0YxIQAAAABJRU5ErkJggg=='

let overlayCache: Electron.NativeImage | null = null
function overlayIcon(): Electron.NativeImage {
  if (!overlayCache) overlayCache = nativeImage.createFromBuffer(Buffer.from(OVERLAY_PNG_BASE64, 'base64'))
  return overlayCache
}

/**
 * Reflect active-download count on the OS surface: macOS dock badge text,
 * Windows overlay icon. count<=0 clears both.
 */
export function setBadgeCount(count: number): void {
  const n = Math.max(0, Math.floor(Number(count) || 0))
  try {
    if (process.platform === 'darwin' && app.dock) {
      app.dock.setBadge(badgeCountText(n))
    } else if (process.platform === 'win32') {
      for (const e of requireOps().allEntries()) {
        if (e.win.isDestroyed()) continue
        try {
          if (n > 0) e.win.setOverlayIcon(overlayIcon(), 'Downloads in progress')
          else e.win.setOverlayIcon(null, '')
        } catch {
          /* window racing shutdown */
        }
      }
    }
  } catch (err) {
    console.warn('[osshell] badge failed:', err instanceof Error ? err.message : err)
  }
}

// ---------- native notifications (#30) ----------

export function notify(title: string, body: string): void {
  try {
    if (!Notification.isSupported()) return
    const n = new Notification({ title: String(title || 'Aether').slice(0, 80), body: String(body || '').slice(0, 240), silent: false })
    n.on('click', () => {
      try {
        requireOps().focusAnyWindow()
      } catch {
        /* ops not ready — ignore */
      }
    })
    n.show()
  } catch (err) {
    console.warn('[osshell] notification failed:', err instanceof Error ? err.message : err)
  }
}

// ---------- startup boost (#29) ----------

/** Apply the opt-in login item (idempotent; call on boot + setting change). */
export function applyStartupBoost(enabled: boolean): boolean {
  try {
    const cfg = loginItemFor(process.platform, enabled)
    app.setLoginItemSettings({ ...cfg, path: process.execPath })
    return true
  } catch (err) {
    console.warn('[osshell] login item failed:', err instanceof Error ? err.message : err)
    return false
  }
}

/** Boot-time install of everything OS-chrome-y. Called once from index.ts. */
export function installOsShell(): void {
  installJumplist()
  installDockMenu()
}
