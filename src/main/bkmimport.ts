/**
 * Bookmark import & export glue (v2.2.0) — turns the pure codecs in
 * shared/bkmformats.ts into real-browser workflows:
 *
 *  - detectImportSources()   scan this machine for Chrome/Edge/Brave/Chromium
 *                            profiles holding a `Bookmarks` file
 *  - importFromProfile(id)   one-click import from a detected profile (the id
 *                            must match a detection result — no arbitrary paths)
 *  - importFromFileFlow()    file picker for exported HTML / Chrome JSON
 *  - exportBookmarksFlow()   save dialog → universal Netscape HTML
 */
import { app, BrowserWindow, dialog } from 'electron'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { Bookmark, ImportSource } from '../shared/types'
import {
  candidateBaseDirs,
  dedupeBookmarks,
  parseBookmarkFile,
  buildNetscapeExport
} from '../shared/bkmformats'
import { bookmarks, mergedSettings } from './store'
import { notify } from './osshell'

const BROWSERS = ['Chrome', 'Edge', 'Brave', 'Chromium'] as const
const MAX_FILE_BYTES = 8 * 1024 * 1024

interface SourceId {
  id: string
  browser: string
  profile: string
  path: string
}

/** Cache of the last detection so import-by-id can never receive a foreign path. */
let lastSources: SourceId[] = []

function countBookmarks(file: string): number {
  try {
    const raw = fs.readFileSync(file, 'utf-8')
    return parseBookmarkFile(raw).length
  } catch {
    return 0
  }
}

function sourceId(profilePath: string): string {
  return createHash('sha1').update(profilePath).digest('hex').slice(0, 12)
}

/**
 * Scan the machine for Chrome-family profiles. Pure-filesystem: missing
 * browsers are simply skipped, and no profile without a `Bookmarks` file
 * is offered.
 */
export function detectImportSources(): ImportSource[] {
  lastSources = []
  const env = {
    home: os.homedir(),
    localAppData: process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'),
    platform: process.platform
  }
  for (const browser of BROWSERS) {
    for (const base of candidateBaseDirs(browser, env)) {
      let entries: string[]
      try {
        if (!fs.existsSync(base)) continue
        entries = fs.readdirSync(base)
      } catch {
        continue
      }
      const profiles = ['Default', ...entries.filter((e) => /^Profile \d+$/i.test(e)).sort()]
      for (const profile of profiles) {
        const profilePath = path.join(base, profile)
        const file = path.join(profilePath, 'Bookmarks')
        if (!fs.existsSync(file)) continue
        const src: SourceId = {
          id: sourceId(profilePath),
          browser,
          profile,
          path: profilePath
        }
        lastSources.push(src)
      }
    }
  }
  return lastSources.map((s) => ({
    ...s,
    count: countBookmarks(path.join(s.path, 'Bookmarks'))
  }))
}

function broadcastChanged(): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send('bookmarks:changed', {})
  }
}

/** Merge parsed bookmarks into the library; returns what happened. */
export function applyIncoming(incoming: Bookmark[]): { added: number; skipped: number } {
  const adds = dedupeBookmarks(bookmarks.data, incoming)
  if (!adds.length) return { added: 0, skipped: incoming.length }
  bookmarks.data = [...bookmarks.data, ...adds]
  bookmarks.save()
  broadcastChanged()
  return { added: adds.length, skipped: incoming.length - adds.length }
}

/** One-click import from a detected profile (id-validated — never a raw path). */
export function importFromProfile(id: string): { added: number; skipped: number; label: string } {
  const src = lastSources.find((s) => s.id === String(id || ''))
  if (!src) return { added: 0, skipped: 0, label: 'That browser profile is no longer available — rescan in Settings.' }
  try {
    const parsed = parseBookmarkFile(fs.readFileSync(path.join(src.path, 'Bookmarks'), 'utf-8'))
    const res = applyIncoming(parsed)
    return { ...res, label: `${src.browser} ${src.profile}` }
  } catch {
    return { added: 0, skipped: 0, label: `${src.browser} ${src.profile} could not be read` }
  }
}

/** File picker for universal HTML exports and Chrome JSON files. */
export async function importFromFileFlow(): Promise<{
  added: number
  skipped: number
  files: number
}> {
  const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows().find((w) => !w.isDestroyed())
  const res = win
    ? await dialog.showOpenDialog(win, {
        title: 'Import bookmarks',
        filters: [{ name: 'Bookmarks (HTML / JSON)', extensions: ['html', 'htm', 'json'] }],
        properties: ['openFile', 'multiSelections']
      })
    : { canceled: true, filePaths: [] as string[] }
  if (res.canceled || !res.filePaths.length) return { added: 0, skipped: 0, files: 0 }
  let added = 0
  let skipped = 0
  let files = 0
  for (const file of res.filePaths.slice(0, 10)) {
    try {
      const stat = fs.statSync(file)
      if (!stat.isFile() || stat.size > MAX_FILE_BYTES) continue
      const parsed = parseBookmarkFile(fs.readFileSync(file, 'utf-8'))
      const r = applyIncoming(parsed)
      added += r.added
      skipped += r.skipped
      files++
    } catch {
      /* unreadable file — skip it */
    }
  }
  return { added, skipped, files }
}

/** Save every bookmark as a universal Netscape HTML file. */
export async function exportBookmarksFlow(): Promise<string | null> {
  const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows().find((w) => !w.isDestroyed())
  const stamp = new Date().toISOString().slice(0, 10)
  const res = win
    ? await dialog.showSaveDialog(win, {
        title: 'Export bookmarks',
        defaultPath: path.join(app.getPath('downloads'), `aether-bookmarks-${stamp}.html`),
        filters: [{ name: 'Bookmarks HTML', extensions: ['html'] }]
      })
    : { canceled: true, filePath: undefined }
  if (res.canceled || !res.filePath) return null
  fs.writeFileSync(res.filePath, buildNetscapeExport(bookmarks.data))
  notify('Bookmarks exported', `${bookmarks.data.length} bookmarks → ${path.basename(res.filePath)}`)
  return res.filePath
}

/** Current default download folder (for the Settings card label). */
export function currentDownloadDirLabel(): string {
  const s = mergedSettings()
  return s.downloadDir || app.getPath('downloads')
}
