/**
 * defaultbrowser — make Aether the OS default browser (Master Plan items
 * 19, 20, 25). The beast feature that lets users actually LIVE in Aether:
 * links clicked anywhere on the system open here.
 *
 * Architecture: pure decision logic (`looksLikeUs`, `parseLaunchArgs`) is
 * unit-tested; the Electron shell (`defaultBrowserState`,
 * `setAsDefaultBrowser`) wraps Electron's protocol APIs.
 *
 * How "am I the default?" works per OS:
 *   - Windows: HKCU registrations via setAsDefaultProtocolClient +
 *     the installer's ProgID; `getApplicationNameForProtocol('https://…')`
 *     returns the registered handler's path — compare with our execPath.
 *   - macOS: LaunchServices; the API returns the handler's bundle name.
 *   - Linux: xdg-settings / x-scheme-handler registrations; the API may
 *     return the executable path or an empty string (then: unknown).
 * A fuzzy-but-safe comparison (`looksLikeUs`) handles path separators,
 * casing, .exe suffixes and bundle names across all three.
 */
import { app, shell } from 'electron'
import path from 'node:path'
import { execFile } from 'node:child_process'

/** Linux: the desktop file electron-builder ships for us (see builder yml). */
export const LINUX_DESKTOP_FILE = 'aether.desktop'

/**
 * Pure: does the OS-reported handler for http/https look like THIS Aether
 * install? Normalizes separators/case/.exe/quotes and requires the match
 * to be the basename or the full path — never a substring in the middle
 * ("notaether-browser.exe" must NOT match "Aether").
 */
export function looksLikeUs(handler: string, ourExe: string): boolean {
  const norm = (p: string): string =>
    String(p || '')
      .trim()
      .replace(/^"|"$/g, '')
      .replace(/\\/g, '/')
      .replace(/\.exe$/i, '')
      .toLowerCase()
  const h = norm(handler)
  const o = norm(ourExe)
  if (!h || !o) return false
  if (h === o) return true
  // basename equality ("Aether" vs "C:/.../Aether")
  const hBase = h.split('/').pop() || ''
  const oBase = o.split('/').pop() || ''
  return hBase.length > 0 && hBase === oBase
}

export interface LaunchTargets {
  /** http/https URLs passed on the command line (default-browser launches) */
  urls: string[]
  /** .crx/.zip extension files (open-with flows) */
  packages: string[]
}

/**
 * Pure: extract launch targets from process.argv / second-instance argv.
 * Windows passes URLs as bare arguments ("Aether.exe" "https://…");
 * flags (--foo, /bar), file paths and junk are ignored. Length is capped —
 * a pathological argv must not wedge boot. Handles http(s) AND aether://
 * links (the internal scheme is registered with the OS — item #32).
 */
export function parseLaunchArgs(argv: string[]): LaunchTargets {
  const urls: string[] = []
  const packages: string[] = []
  const seen = new Set<string>()
  for (const raw of argv ?? []) {
    const a = String(raw ?? '').trim()
    if (!a || a.startsWith('-') || a.startsWith('/')) continue
    if (/^(https?|aether):\/\//i.test(a)) {
      if (a.length <= 2048 && !seen.has(a)) {
        seen.add(a)
        urls.push(a)
      }
      continue
    }
    if (/\.(crx|zip)$/i.test(a) && a.length <= 512) packages.push(a)
  }
  return { urls: urls.slice(0, 16), packages: packages.slice(0, 8) }
}

export interface DefaultBrowserState {
  isDefault: boolean
  /** what the OS currently opens links with (display string) */
  handler: string
  platform: NodeJS.Platform
}

/** Ask the OS who owns http/https right now. */
export function defaultBrowserState(): DefaultBrowserState {
  let handler = ''
  try {
    handler = app.getApplicationNameForProtocol('https://aether.default.check/')
  } catch {
    handler = ''
  }
  const isDefault = looksLikeUs(handler, app.getPath('exe') || process.execPath)
  return { isDefault, handler, platform: process.platform }
}

/**
 * Register Aether as the http/https handler (Windows registry per-user,
 * macOS LaunchServices, Linux xdg). Returns the fresh state after the call.
 * Note: on modern Windows the user may still need to confirm in
 * Settings → Default apps; we open that pane for them when the state
 * doesn't stick.
 */
export function setAsDefaultBrowser(): DefaultBrowserState {
  try {
    app.setAsDefaultProtocolClient('http')
    app.setAsDefaultProtocolClient('https')
    registerAetherScheme()
    if (process.platform === 'linux') void xdgSetDefault()
  } catch (err) {
    console.warn('[defaultbrowser] registration failed:', err instanceof Error ? err.message : err)
  }
  return defaultBrowserState()
}

/**
 * Also claim aether:// so internal links (aether://settings, shared search
 * URLs…) open in Aether from other apps (Master Plan #32).
 */
export function registerAetherScheme(): void {
  try {
    if (app.isPackaged) {
      app.setAsDefaultProtocolClient('aether')
    } else {
      // unpackaged runs must point at the electron CLI + our entry script
      const entry = path.resolve(process.argv[1] || '.')
      app.setAsDefaultProtocolClient('aether', process.execPath, [entry])
    }
  } catch (err) {
    console.warn('[defaultbrowser] aether:// registration failed:', err instanceof Error ? err.message : err)
  }
}

/** Linux fallback: xdg-settings speaks the desktop-entry dialect (#24). */
export function xdgSetDefault(): Promise<boolean> {
  return new Promise((resolve) => {
    execFile('xdg-settings', ['set', 'default-web-browser', LINUX_DESKTOP_FILE], (err) => {
      if (err) {
        console.warn('[defaultbrowser] xdg-settings set failed:', String((err as Error).message || err).slice(0, 120))
        resolve(false)
      } else {
        resolve(true)
      }
    })
  })
}

/** Linux: ask xdg-settings who owns the web right now. */
export function xdgCheckDefault(): Promise<string> {
  return new Promise((resolve) => {
    execFile('xdg-settings', ['get', 'default-web-browser'], (err, stdout) => {
      resolve(err ? '' : String(stdout || '').trim())
    })
  })
}

/**
 * Open the OS pane where the default browser is chosen (some Windows/macOS
 * builds require a manual confirm). Best-effort — returns whether a pane
 * was opened. Linux handles registration silently via xdg, so no pane.
 */
export async function openDefaultAppsSettings(): Promise<boolean> {
  try {
    if (process.platform === 'win32') {
      await shell.openExternal('ms-settings:defaultapps')
      return true
    }
    if (process.platform === 'darwin') {
      await shell.openExternal('x-apple.systempreferences:com.apple.Desktop-Settings.extension')
      return true
    }
    if (process.platform === 'linux') {
      // xdg handles registration silently; surface the generic settings app
      await shell.openExternal('gnome-control-center default-apps').catch(async () => {
        await shell.openExternal('kcmshell5 kcm_componentchooser').catch(() => undefined)
      })
      return true
    }
    return false
  } catch {
    return false
  }
}
