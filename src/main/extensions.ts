/**
 * Chrome extension support via electron-chrome-extensions (GPL-3.0 — see LICENSE).
 *
 * Wires the library to Aether's tab system, loads unpacked extensions from
 * user-chosen folders (persisted in settings), and manages browser-action
 * popups. Extensions are loaded on every boot (Electron requirement).
 */
import { app, dialog, session } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import { ElectronChromeExtensions } from 'electron-chrome-extensions'
import type { BrowserWindow, Extension, MenuItemConstructorOptions, WebContents } from 'electron'
import type { ContextMenuParams } from 'electron'
import type { TabManager } from './tabs'
import type { ExtensionInfo, ExtensionRecord } from '../shared/types'
import { mergedSettings, settings } from './store'
import { validateManifestOnDisk, ensureExtensionConsent, type ManifestVerdict } from './extsec'

let exts: ElectronChromeExtensions | null = null

/**
 * Multi-window: every browser window registers its TabManager here, so the
 * extensions host can resolve tabs regardless of which window they live in.
 */
const tabManagers = new Set<TabManager>()

export function registerTabManager(tm: TabManager): void {
  tabManagers.add(tm)
}

export function unregisterTabManager(tm: TabManager): void {
  tabManagers.delete(tm)
}

export function tabManagerCount(): number {
  return tabManagers.size
}

function findByWebContentsAny(wc: WebContents): { tab: ReturnType<TabManager['get']>; tm: TabManager } | null {
  for (const tm of tabManagers) {
    const tab = tm.findByWebContents(wc)
    if (tab) return { tab, tm }
  }
  return null
}

/** Where should an extension-created tab open? The focused window. */
let targetResolver: (() => { tabs: TabManager; win: BrowserWindow } | undefined) | null = null

/** Minimal shape of the PopupView emitted with 'browser-action-popup-created'. */
interface PopupLike {
  parent?: BrowserWindow | null
  destroy(): void
}

export function initExtensions(
  target: () => { tabs: TabManager; win: BrowserWindow } | undefined
): ElectronChromeExtensions {
  targetResolver = target
  const ses = session.defaultSession

  exts = new ElectronChromeExtensions({
    session: ses,
    // bundled main can't rely on __dirname — point at the real module folder
    modulePath: path.join(app.getAppPath(), 'node_modules/electron-chrome-extensions'),
    createTab: async (details) => {
      const target0 = targetResolver?.()
      if (!target0) throw new Error('No browser window available')
      const url =
        typeof details.url === 'string' && /^(https?|aether|chrome-extension):/i.test(details.url)
          ? details.url
          : undefined
      const id = target0.tabs.create(url, details.active !== false)
      const tab = target0.tabs.get(id)
      if (!tab?.view) throw new Error('Failed to create tab for extension')
      return [tab.view.webContents, target0.win]
    },
    selectTab: (wc: WebContents) => {
      const found = findByWebContentsAny(wc)
      if (found?.tab) found.tm.activate(found.tab.id)
    },
    removeTab: (wc: WebContents) => {
      const found = findByWebContentsAny(wc)
      if (found?.tab) found.tm.close(found.tab.id)
    },
    assignTabDetails: (details, wc) => {
      const found = findByWebContentsAny(wc)
      const tab = found?.tab
      if (!tab) return
      details.title = tab.title
      details.url = tab.url
      if (tab.favicon) details.favIconUrl = tab.favicon
      details.pinned = tab.pinned
      details.audible = tab.audible
    }
  })

  // extension browser-action popups are managed by the library; just tie the
  // popup's lifetime to our window
  exts.on('browser-action-popup-created', (popup: PopupLike) => {
    popup.parent?.once('closed', () => {
      try {
        popup.destroy()
      } catch {
        /* already destroyed */
      }
    })
  })

  void loadStartupExtensions()
  return exts
}

export function getExtensions(): ElectronChromeExtensions | null {
  return exts
}

// ---------- tab lifecycle notifications (called from tabs.ts) ----------

export function notifyTabAdded(wc: WebContents, win: BrowserWindow): void {
  try {
    exts?.addTab(wc, win)
  } catch (err) {
    console.error('[extensions] addTab failed', err)
  }
}

export function notifyTabRemoved(_wc: WebContents): void {
  // electron-chrome-extensions v3 unregisters tabs automatically when their
  // webContents emit 'destroyed' — nothing to do here.
}

export function notifyTabSelected(wc: WebContents): void {
  try {
    exts?.selectTab(wc)
  } catch {
    /* ignore */
  }
}

/** Merge chrome.contextMenus items (from extensions) into a page context menu. */
export function contextMenuItems(wc: WebContents, params: ContextMenuParams): MenuItemConstructorOptions[] {
  try {
    return ((exts?.getContextMenuItems(wc, params) ?? []) as unknown) as MenuItemConstructorOptions[]
  } catch {
    return []
  }
}

// ---------- unpacked extension management ----------

function records(): ExtensionRecord[] {
  const list = mergedSettings().extensions
  return Array.isArray(list) ? list : []
}

function saveRecords(list: ExtensionRecord[]): void {
  settings.data = { ...mergedSettings(), extensions: list }
  settings.save()
}

function toInfo(rec: ExtensionRecord, loaded?: Extension): ExtensionInfo {
  return {
    id: loaded?.id ?? '',
    name: loaded?.name ?? path.basename(rec.path),
    version: loaded?.version ?? '—',
    path: rec.path,
    enabled: Boolean(rec.enabled)
  }
}

/** Load all enabled unpacked extensions (skips missing folders). */
async function loadStartupExtensions(): Promise<void> {
  const ses = session.defaultSession
  const kept: ExtensionRecord[] = []
  for (const rec of records()) {
    if (!fs.existsSync(path.join(rec.path, 'manifest.json'))) {
      console.warn('[extensions] skipping missing extension folder:', rec.path)
      continue
    }
    kept.push(rec)
    if (!rec.enabled) continue
    try {
      await ses.loadExtension(rec.path, { allowFileAccess: true })
      console.log('[extensions] loaded', path.basename(rec.path))
    } catch (err) {
      console.error('[extensions] failed to load', rec.path, err)
    }
  }
  if (kept.length !== records().length) saveRecords(kept)
}

/** Info rows for the settings page (records merged with loaded state). */
export async function listExtensionInfos(): Promise<ExtensionInfo[]> {
  const ses = session.defaultSession
  const loaded = ses.getAllExtensions()
  return records().map((rec) => toInfo(rec, loaded.find((e) => e.path === rec.path)))
}

/** Ask for a folder and load it as an unpacked extension. */
export async function addExtensionFromDialog(): Promise<ExtensionInfo | null> {
  const res = await dialog.showOpenDialog({
    title: 'Load unpacked extension',
    buttonLabel: 'Load extension',
    properties: ['openDirectory'],
    defaultPath: app.getPath('downloads')
  })
  if (res.canceled || !res.filePaths.length) return null
  return installFromFolder(res.filePaths[0])
}

/**
 * Shared installer used by “Load unpacked…”, the .crx/.zip one-click flow and
 * extension imports: validates the folder, shows the Chrome-style consent
 * screen, avoids duplicates, loads + records.
 *
 * opts.ownStaging — the caller created this folder (CRX/ZIP flow) and wants
 * it wiped on any failure. Never pass it for a user-chosen source folder.
 */
export async function installFromFolder(
  dir: string,
  opts: { ownStaging?: boolean; skipConsentDialog?: boolean } = {}
): Promise<ExtensionInfo> {
  const target = path.resolve(String(dir || ''))
  const fail = (msg: string): Error => {
    if (opts.ownStaging) fs.rmSync(target, { recursive: true, force: true })
    return new Error(msg)
  }
  if (!fs.existsSync(path.join(target, 'manifest.json'))) {
    throw fail('Not an extension folder — manifest.json not found')
  }

  // Quarantine gate: validate the manifest before touching the loader.
  const verdict: ManifestVerdict = validateManifestOnDisk(target)
  if (!verdict.ok) {
    throw fail('Invalid extension manifest: ' + (verdict.error || 'rejected'))
  }

  const ses = session.defaultSession
  const existing = records()
  if (existing.some((r) => path.resolve(r.path) === target)) {
    throw fail('This extension folder is already installed')
  }

  // Chrome-style permission consent (Master Plan #5) — the dialog lists what
  // the extension can do; the user must accept before it ever runs. A changed
  // version re-prompts. Decline = abort with nothing left behind.
  const consented = await ensureExtensionConsent(target, verdict, { skipDialog: opts.skipConsentDialog })
  if (!consented) {
    throw fail(`“${verdict.name}” was not added — you declined its permissions`)
  }

  try {
    const ext = await ses.loadExtension(target, { allowFileAccess: true })
    saveRecords([...existing, { path: target, enabled: true }])
    return toInfo({ path: target, enabled: true }, ext)
  } catch (err) {
    throw fail('Could not load the extension: ' + (err instanceof Error ? err.message : String(err)))
  }
}

/** Enable/disable by folder path (disabled = unloaded but remembered). */
export async function toggleExtension(dir: string): Promise<void> {
  const ses = session.defaultSession
  const list = records()
  const rec = list.find((r) => r.path === String(dir || ''))
  if (!rec) throw new Error('Extension not found')
  const loaded = ses.getAllExtensions().find((e) => e.path === rec.path)
  try {
    if (loaded) {
      await ses.removeExtension(loaded.id)
      rec.enabled = false
    } else {
      await ses.loadExtension(rec.path, { allowFileAccess: true })
      rec.enabled = true
    }
  } catch (err) {
    throw new Error('Toggle failed: ' + (err instanceof Error ? err.message : String(err)))
  }
  saveRecords(list)
}

/** Fully uninstall: unload + forget the record (files stay on disk). */
export async function removeExtension(dir: string): Promise<void> {
  const ses = session.defaultSession
  const p = String(dir || '')
  const loaded = ses.getAllExtensions().find((e) => e.path === p)
  if (loaded) {
    try {
      await ses.removeExtension(loaded.id)
    } catch {
      /* ignore */
    }
  }
  saveRecords(records().filter((r) => r.path !== p))
}
