/**
 * Download manager (v1.5.0) — intercepts session downloads, dedupes filenames
 * into ~/Downloads, streams progress to the chrome UI, and keeps a persisted
 * download history for the aether://downloads page: pause / resume / cancel /
 * re-download / reveal / clear.
 */
import { app, shell, session, DownloadItem, BrowserWindow } from 'electron'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import fs from 'node:fs'
import type { DownloadState } from '../shared/types'
import { progressValue, setBadgeCount, notify } from './osshell'
import { mergedSettings } from './store'

const active = new Map<string, { item: DownloadItem; path: string }>()

/** One finished (or failed) download, kept on disk for the downloads page. */
export interface DownloadRecord {
  id: string
  url: string
  filename: string
  path: string
  total: number
  received: number
  state: 'progressing' | 'completed' | 'cancelled' | 'interrupted'
  ts: number
}

const LOG_MAX = 300
let log: DownloadRecord[] | null = null

function logFile(): string {
  return path.join(app.getPath('userData'), 'downloads.json')
}

function loadLog(): DownloadRecord[] {
  if (log) return log
  try {
    const raw = JSON.parse(fs.readFileSync(logFile(), 'utf-8')) as DownloadRecord[]
    log = Array.isArray(raw) ? raw.filter((r) => r && typeof r.url === 'string') : []
  } catch {
    log = []
  }
  return log
}

function saveLog(): void {
  try {
    fs.mkdirSync(app.getPath('userData'), { recursive: true })
    fs.writeFileSync(logFile(), JSON.stringify((log || []).slice(0, LOG_MAX)))
  } catch (err) {
    console.error('[downloads] log save failed', err)
  }
}

/* ----------------------- pure record helpers (tested) ----------------------- */

export function doneStateOf(itemState: string): DownloadRecord['state'] {
  return itemState === 'completed' ? 'completed' : itemState === 'cancelled' ? 'cancelled' : 'interrupted'
}

/** Newest first. */
export function sortRecords(list: DownloadRecord[]): DownloadRecord[] {
  return [...list].sort((a, b) => (b.ts || 0) - (a.ts || 0))
}

/** Cap the log, keeping the newest entries. */
export function capLog(list: DownloadRecord[], max = LOG_MAX): DownloadRecord[] {
  return sortRecords(list).slice(0, Math.max(0, max))
}

/** Remove every record with this id (defensive dedupe). */
export function withoutRecord(list: DownloadRecord[], id: string): DownloadRecord[] {
  return list.filter((r) => r.id !== id)
}

/* ------------------------------ electron glue ------------------------------ */

/** Downloads can start in any window — stream progress to all of them. */
function broadcast(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(channel, payload)
  }
}

/** Windows reserved device names — cannot be filenames on NTFS. */
const WIN_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i

/**
 * Make a download filename safe for the host filesystem.
 * Strips path separators, Windows-illegal characters (< > : " | ? * and
 * control chars), trailing dots/spaces, and prefixes reserved device names
 * (CON, NUL, COM1…) so saves never fail on Windows 11.
 */
export function sanitizeFilename(name: string): string {
  let clean = String(name || '')
    .replace(/[\\/]/g, '_')
    .replace(/[<>:"|?*\u0000-\u001f]/g, '')
    .replace(/[\s.]+$/g, '')
    .trim()
  if (WIN_RESERVED.test(clean)) clean = '_' + clean
  return clean || 'download'
}

/** Pick a non-colliding path inside the downloads folder. */
export function uniquePath(dir: string, filename: string): string {
  const clean = sanitizeFilename(filename)
  const ext = path.extname(clean)
  const base = path.basename(clean, ext)
  let candidate = path.join(dir, clean)
  for (let i = 1; fs.existsSync(candidate); i++) {
    candidate = path.join(dir, `${base} (${i})${ext}`)
  }
  return candidate
}

function stateOf(id: string, item: DownloadItem, extra: Partial<DownloadState> = {}): DownloadState {
  const total = item.getTotalBytes()
  const received = item.getReceivedBytes()
  return {
    id,
    filename: path.basename(item.getSavePath()),
    path: item.getSavePath(),
    url: item.getURL(),
    received,
    total,
    percent: total > 0 ? Math.min(100, Math.round((received / total) * 100)) : null,
    done: false,
    paused: item.isPaused(),
    ...extra
  }
}

export function installDownloadHandler(): void {
  session.defaultSession.on('will-download', (_event, item) => {
    const id = randomUUID().replace(/-/g, '').slice(0, 10)
    const dir = app.getPath('downloads')
    const savePath = uniquePath(dir, item.getFilename() || 'download')
    item.setSavePath(savePath)
    active.set(id, { item, path: savePath })

    const record: DownloadRecord = {
      id,
      url: item.getURL(),
      filename: path.basename(savePath),
      path: savePath,
      total: 0,
      received: 0,
      state: 'progressing',
      ts: Date.now()
    }
    const store = loadLog()
    log = capLog(withoutRecord(store, id))

    item.on('updated', (_e, state) => {
      const st = stateOf(id, item, state === 'interrupted' ? { error: 'interrupted' } : {})
      record.received = st.received
      record.total = st.total
      broadcast('download:progress', st)
      // OS taskbar progress + active-download badge (#27/#31)
      try {
        for (const w of BrowserWindow.getAllWindows()) {
          if (!w.isDestroyed()) w.setProgressBar(progressValue(st.received, st.total))
        }
      } catch {
        /* progress is cosmetic */
      }
      setBadgeCount(active.size)
    })
    item.on('done', (_e, state) => {
      const final = stateOf(id, item, {
        done: true,
        received: state === 'completed' ? item.getTotalBytes() : item.getReceivedBytes(),
        ...(state === 'cancelled' ? { cancelled: true } : {}),
        ...(state === 'interrupted' ? { error: 'interrupted' } : {})
      })
      active.delete(id)
      record.state = doneStateOf(state)
      record.received = final.received
      record.total = final.total || record.total
      log = capLog([...(log || []), record])
      saveLog()
      broadcast('download:progress', final)
      broadcast('downloads:changed', {})
      try {
        for (const w of BrowserWindow.getAllWindows()) {
          if (!w.isDestroyed()) w.setProgressBar(progressValue(0, 0, true))
        }
      } catch {
        /* cosmetic */
      }
      setBadgeCount(active.size)
      if (state === 'completed' && mergedSettings().notifyDownloads !== false) {
        notify('Download complete', record.filename || 'File saved')
      }
    })
    log = capLog([...(log || []), record])
    broadcast('download:progress', stateOf(id, item))
    setBadgeCount(active.size)
  })
}

export function cancelDownload(id: string): void {
  active.get(String(id))?.item.cancel()
}

export function pauseDownload(id: string): void {
  const item = active.get(String(id))?.item
  try {
    if (item && !item.isPaused()) item.pause()
  } catch {
    /* already done */
  }
}

export function resumeDownload(id: string): void {
  const item = active.get(String(id))?.item
  try {
    if (item && item.isPaused()) item.resume()
  } catch {
    /* already done */
  }
}

/** Everything the downloads page needs: live items + persisted history. */
export function listDownloads(): {
  active: DownloadState[]
  history: DownloadRecord[]
} {
  const activeStates: DownloadState[] = []
  for (const [id, a] of active) {
    try {
      activeStates.push(stateOf(id, a.item))
    } catch {
      /* item vanished */
    }
  }
  return { active: activeStates, history: sortRecords(loadLog()) }
}

export function clearDownloadHistory(): void {
  log = []
  saveLog()
}

/** Remove one record from the persisted history (file itself untouched). */
export function removeDownloadRecord(id: string): void {
  log = withoutRecord(loadLog(), String(id || ''))
  saveLog()
}

/** Start a fresh download of a recorded URL (fresh file, dedupe keeps both). */
export function redownload(id: string): boolean {
  const rec = loadLog().find((r) => r.id === String(id || ''))
  if (!rec || !/^https?:\/\//i.test(rec.url)) return false
  session.defaultSession.downloadURL(rec.url)
  return true
}

export function revealDownload(p: string): void {
  const target = String(p || '')
  if (!target) return
  try {
    if (fs.existsSync(target)) shell.showItemInFolder(target)
  } catch {
    /* ignore */
  }
}
