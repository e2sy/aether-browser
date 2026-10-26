/**
 * Screenshot tool (v2.5.0 build 19) — visible-area capture of the active tab.
 *
 * Ctrl+Shift+S / context menu → capturePage() → saved to
 * <userData>/screenshots/<shotFilename> AND copied to the clipboard, then an
 * OS notification announces the file (click focuses Aether).
 */
import { app, clipboard, ClipboardItem, WebContents } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import { shotFilename } from '../shared/fmt'
import { notify } from './osshell'
import { focusedEntry } from './windows'

export function screenshotsDir(): string {
  return path.join(app.getPath('userData'), 'screenshots')
}

export interface ShotResult {
  ok: boolean
  file?: string
  error?: string
}

/** Capture + save + clipboard. Never throws — the result is user-visible. */
export async function captureScreenshot(wc?: WebContents): Promise<ShotResult> {
  const target = wc ?? focusedEntry()?.tabs.activeView()?.webContents
  if (!target || target.isDestroyed()) return { ok: false, error: 'No active tab to capture' }
  try {
    const img = await target.capturePage()
    if (img.isEmpty()) return { ok: false, error: 'The page had nothing to capture yet' }
    const dir = screenshotsDir()
    fs.mkdirSync(dir, { recursive: true })
    const file = path.join(dir, shotFilename())
    const png = img.toPNG()
    fs.writeFileSync(file, png)
    try {
      // Electron 45 clipboard: W3C-style write([ClipboardItem]) with a Blob
      const bytes = new Uint8Array(png.buffer.slice(png.byteOffset, png.byteOffset + png.byteLength) as ArrayBuffer)
      const item = new ClipboardItem({ 'image/png': new Blob([bytes], { type: 'image/png' }) })
      await clipboard.write([item])
    } catch {
      /* clipboard is a bonus — the file is the primary artifact */
    }
    notify('Screenshot saved & copied', file)
    return { ok: true, file }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { ok: false, error: msg }
  }
}
