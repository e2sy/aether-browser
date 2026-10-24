/**
 * Download manager — intercepts session downloads, dedupes filenames into
 * ~/Downloads, streams progress to the chrome UI, supports cancel / reveal.
 */
import { app, shell, session, DownloadItem, BrowserWindow } from 'electron'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import fs from 'node:fs'
import type { DownloadState } from '../shared/types'

const active = new Map<string, { item: DownloadItem; path: string }>()

/** Downloads can start in any window — stream progress to all of them. */
function broadcast(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(channel, payload)
  }
}

/** Pick a non-colliding path inside the downloads folder. */
export function uniquePath(dir: string, filename: string): string {
  const clean = filename.replace(/[\\/]/g, '_').trim() || 'download'
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
    received,
    total,
    percent: total > 0 ? Math.min(100, Math.round((received / total) * 100)) : null,
    done: false,
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

    item.on('updated', (_e, state) => {
      broadcast('download:progress', stateOf(id, item, state === 'interrupted' ? { error: 'interrupted' } : {}))
    })
    item.on('done', (_e, state) => {
      const final = stateOf(id, item, {
        done: true,
        received: state === 'completed' ? item.getTotalBytes() : item.getReceivedBytes(),
        ...(state === 'cancelled' ? { cancelled: true } : {}),
        ...(state === 'interrupted' ? { error: 'interrupted' } : {})
      })
      active.delete(id)
      broadcast('download:progress', final)
    })
    broadcast('download:progress', stateOf(id, item))
  })
}

export function cancelDownload(id: string): void {
  active.get(String(id))?.item.cancel()
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
