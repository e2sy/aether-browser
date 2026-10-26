/**
 * Web apps / PWA support (v2.3.0) — "Install this site as an app".
 *
 * A web app is a dedicated BrowserWindow (no browser chrome, no Aether
 * bridge — real apps never see window.aether) that shares the default
 * session so logins persist. Installers read the site's webmanifest when it
 * has one (name, start_url, icons) and fall back to the tab's title +
 * favicon otherwise — the same graceful degradation Chrome calls
 * "Create shortcut…".
 *
 * Launch surfaces: context menu, command palette action, Settings card,
 * Windows jump list and the macOS dock menu (all wired in this module).
 */
import { app, BrowserWindow, Menu, net, session, shell } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import { JsonStore, mergedSettings } from './store'
import { openUrlInRunningBrowser } from './windows'
import { notify } from './osshell'
import { parseManifestLink, parseManifestJson, pickIcon, resolveUrl, slugAppId, parseAppArg } from '../shared/pwa'
import { normalizeHost } from '../shared/creds'
import type { TabManager } from './tabs'

export interface AppRecord {
  id: string
  name: string
  shortName: string
  /** start URL (absolute) */
  url: string
  host: string
  iconPath?: string
  /** true when installed from a real webmanifest */
  manifest: boolean
  createdAt: number
}

const apps = new JsonStore<{ records: AppRecord[] }>('apps.json', { records: [] })
const MAX_APPS = 50
const MAX_FETCH = 2 * 1024 * 1024
const MAX_ICON = 3 * 1024 * 1024

const running = new Map<number, string>() // windowId → appId

function appsDir(): string {
  const dir = path.join(app.getPath('userData'), 'webapps')
  try {
    fs.mkdirSync(dir, { recursive: true })
  } catch {
    /* cosmetic */
  }
  return dir
}

export function listApps(): AppRecord[] {
  return apps.data.records
}

export function appById(id: string): AppRecord | undefined {
  return apps.data.records.find((a) => a.id === String(id || ''))
}

function saveIcon(bytes: ArrayBuffer, mime: string, id: string): string | undefined {
  const ok = /^image\/(png|jpeg|webp)/i.test(mime)
  if (!ok) return undefined
  if (bytes.byteLength > MAX_ICON || bytes.byteLength < 64) return undefined
  const ext = /png/i.test(mime) ? 'png' : /webp/i.test(mime) ? 'webp' : 'jpg'
  try {
    const dir = path.join(appsDir(), id)
    fs.mkdirSync(dir, { recursive: true })
    const file = path.join(dir, `icon.${ext}`)
    fs.writeFileSync(file, Buffer.from(bytes))
    return file
  } catch {
    return undefined
  }
}

/** Decode a data: URL favicon into an icon file; returns '' when unsupported. */
function saveDataIcon(dataUrl: string, id: string): string | undefined {
  const m = /^data:image\/(png|jpe?g|webp);base64,([A-Za-z0-9+/=]+)\s*$/i.exec(String(dataUrl || '').trim())
  if (!m) return undefined
  const ext = /png/i.test(m[1]) ? 'png' : /webp/i.test(m[1]) ? 'webp' : 'jpg'
  try {
    const buf = Buffer.from(m[2], 'base64')
    if (buf.length < 64 || buf.length > MAX_ICON) return undefined
    const dir = path.join(appsDir(), id)
    fs.mkdirSync(dir, { recursive: true })
    const file = path.join(dir, `icon.${ext}`)
    fs.writeFileSync(file, buf)
    return file
  } catch {
    return undefined
  }
}

async function fetchCapped(url: string, mime?: string): Promise<{ bytes: ArrayBuffer; contentType: string } | null> {
  try {
    // useSessionCookies is a runtime-only net.fetch option (not in the typings)
    const res = await net.fetch(url, {
      headers: { accept: mime || 'application/manifest+json, image/*, text/html, */*' }
    } as RequestInit & { useSessionCookies?: boolean })
    if (!res.ok) return null
    const buf = await res.arrayBuffer()
    if (buf.byteLength > MAX_FETCH) return null
    return { bytes: buf, contentType: String(res.headers.get('content-type') || '') }
  } catch {
    return null
  }
}

export interface InstallResult {
  ok: boolean
  id?: string
  name?: string
  error?: string
}

/**
 * Install the given tab as a web app. Reads the manifest when present,
 * falls back to title+favicon. Never throws — every failure becomes a
 * message for the user.
 */
export async function installFromTab(tm: TabManager, tabId: number): Promise<InstallResult> {
  const tab = tm.get(tabId)
  const url = String(tab?.url || '')
  if (!/^https?:/i.test(url)) return { ok: false, error: 'Only http(s) pages can be installed as apps' }
  const host = normalizeHost(url)
  if (!host) return { ok: false, error: 'Could not resolve the site address' }

  let name = String(tab?.title || '').slice(0, 80) || host
  let shortName = name
  let startUrl = url
  let manifestUsed = false
  let iconPath: string | undefined

  // 1) try the real manifest path
  const page = await fetchCapped(url, 'text/html')
  const link = page ? parseManifestLink(Buffer.from(page.bytes).toString('utf8')) : null
  const manifestUrl = link ? resolveUrl(url, link) : null
  if (manifestUrl) {
    const raw = await fetchCapped(manifestUrl)
    const parsed = raw ? parseManifestJson(Buffer.from(raw.bytes).toString('utf8'), manifestUrl) : null
    if (parsed) {
      manifestUsed = true
      if (parsed.name) name = parsed.name.slice(0, 80)
      shortName = (parsed.shortName || name).slice(0, 40)
      startUrl = parsed.startUrl
      const icon = pickIcon(parsed.icons)
      if (icon) {
        const iconUrl = resolveUrl(manifestUrl, icon.src)
        if (iconUrl && !/\.svg($|\?)/i.test(iconUrl)) {
          const got = await fetchCapped(iconUrl)
          if (got) iconPath = saveIcon(got.bytes, got.contentType, slugAppId(startUrl))
        }
      }
    }
  }

  // 2) favicon fallback (shortcut-style install)
  if (!iconPath && tab?.favicon) {
    if (/^data:image\//i.test(tab.favicon)) iconPath = saveDataIcon(tab.favicon, slugAppId(startUrl))
    else if (/^https?:/i.test(tab.favicon) && !/\.svg($|\?)/i.test(tab.favicon)) {
      const got = await fetchCapped(tab.favicon)
      if (got) iconPath = saveIcon(got.bytes, got.contentType, slugAppId(startUrl))
    }
  }

  const id = slugAppId(startUrl)
  if (apps.data.records.length >= MAX_APPS && !appById(id)) {
    return { ok: false, error: 'App limit reached (50) — remove one from Settings first' }
  }
  const existing = appById(id)
  if (existing) {
    existing.name = name
    existing.shortName = shortName
    existing.url = startUrl
    if (iconPath) existing.iconPath = iconPath
    existing.manifest = manifestUsed
  } else {
    apps.data.records.push({
      id,
      name,
      shortName,
      url: startUrl,
      host: normalizeHost(startUrl) || host,
      ...(iconPath ? { iconPath } : {}),
      manifest: manifestUsed,
      createdAt: Date.now()
    })
  }
  apps.save()
  refreshOSSurfaces()
  return { ok: true, id, name }
}

// ---------- launching ----------

function openInBrowserIfWeb(url: string): void {
  if (/^https?:/i.test(url)) openUrlInRunningBrowser(url)
}

export function launchApp(id: string): number | null {
  const rec = appById(id)
  if (!rec) return null
  const iconPath = rec.iconPath && fs.existsSync(rec.iconPath) ? rec.iconPath : undefined
  const win = new BrowserWindow({
    width: 1200,
    height: 820,
    minWidth: 480,
    minHeight: 360,
    title: rec.name,
    backgroundColor: '#16171b',
    autoHideMenuBar: process.platform !== 'darwin',
    ...(iconPath ? { icon: iconPath } : {}),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // deliberately NO preload — a web app must never see window.aether
      spellcheck: mergedSettings().spellcheck !== false
    },
    show: false
  })
  if (process.platform !== 'darwin') win.setMenu(null)
  running.set(win.id, rec.id)
  win.once('ready-to-show', () => win.show())
  win.on('closed', () => running.delete(win.id))
  win.webContents.setWindowOpenHandler(({ url: popupUrl }) => {
    const target = String(popupUrl || '')
    if (normalizeHost(target) && normalizeHost(target) === rec.host) {
      void win.webContents.loadURL(target).catch(() => undefined)
      return { action: 'deny' }
    }
    if (/^https?:/i.test(target)) openInBrowserIfWeb(target)
    else void shell.openExternal(target).catch(() => undefined)
    return { action: 'deny' }
  })
  win.webContents.on('did-fail-load', (_e, code, desc, validated, isMainFrame) => {
    if (!isMainFrame || code === -3) return
    notify(`${rec.name} failed to load`, String(desc || code))
  })
  win.webContents.on('page-title-updated', (_e, title) => {
    if (title) win.setTitle(`${title} — ${rec.shortName || rec.name}`)
  })
  void win.webContents.loadURL(rec.url).catch(() => {
    notify(`${rec.name} could not start`, rec.url)
  })
  return win.id
}

export function removeApp(id: string): boolean {
  const rec = appById(id)
  if (!rec) return false
  apps.data.records = apps.data.records.filter((a) => a.id !== rec.id)
  apps.save()
  if (rec.iconPath) {
    try {
      fs.rmSync(path.dirname(rec.iconPath), { recursive: true, force: true })
    } catch {
      /* cosmetic */
    }
  }
  refreshOSSurfaces()
  return true
}

// ---------- OS surfaces ----------

/** Windows jump list + macOS dock menu: "launch this app" entries. */
export function refreshOSSurfaces(): void {
  try {
    if (process.platform === 'win32') {
      const items = apps.data.records.slice(0, 20).map((a) => ({
        type: 'task' as const,
        program: process.execPath,
        args: `--aether-app=${a.id}`,
        title: a.name,
        description: a.url,
        ...(a.iconPath && fs.existsSync(a.iconPath) ? { iconPath: a.iconPath, iconIndex: 0 } : {})
      }))
      app.setJumpList([
        ...(items.length ? [{ type: 'custom' as const, name: 'Web apps', items }] : []),
        {
          type: 'tasks' as const,
          items: [
            {
              type: 'task' as const,
              program: process.execPath,
              args: '--aether-window',
              title: 'New window',
              description: 'Open a new Aether window'
            }
          ]
        }
      ])
    }
    if (process.platform === 'darwin' && app.dock) {
      const items = apps.data.records.slice(0, 15).map((a) => ({
        label: a.name,
        click: (): void => {
          launchApp(a.id)
        }
      }))
      app.dock.setMenu(Menu.buildFromTemplate(items))
    }
  } catch {
    /* OS surfaces are cosmetic — never fatal */
  }
}

/** Parse `--aether-app=<id>` out of a command line (boot / second-instance). */
export function consumeAppArg(argv: string[]): string | null {
  return parseAppArg(argv)
}

/** True when the host already has an installed app (context-menu state). */
export function appForHost(url: string): AppRecord | undefined {
  const host = normalizeHost(url)
  if (!host) return undefined
  return apps.data.records.find((a) => a.host === host)
}
