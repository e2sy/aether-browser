/**
 * Print & Save-as-PDF (v2.2.0) — the daily-driver staples every real browser
 * ships: Ctrl+P opens the native print dialog for the active tab, Ctrl+S
 * saves the page as a PDF through a save dialog.
 */
import { app, BrowserWindow, dialog } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { focusedEntry } from './windows'
import { sanitizeFilename } from './downloads'
import { notify } from './osshell'

/** Active tab of the focused browser window (or null). */
function activeWebContents(): Electron.WebContents | null {
  const entry = focusedEntry()
  if (!entry || entry.win.isDestroyed()) return null
  return entry.tabs.activeView()?.webContents ?? null
}

/** Ctrl+P — native print dialog with background graphics on. */
export function printActive(): void {
  const wc = activeWebContents()
  if (!wc) return
  try {
    wc.print({ silent: false, printBackground: true })
  } catch {
    /* print dialog unavailable — ignore */
  }
}

/** Ctrl+S — save the active web page as a PDF via a save dialog. */
export async function savePageAsPdf(): Promise<void> {
  const wc = activeWebContents()
  if (!wc) return
  const url = wc.getURL()
  if (!/^https?:/i.test(url)) {
    notify('Save as PDF', 'Only web pages can be saved as PDF')
    return
  }
  const title = sanitizeFilename(wc.getTitle() || hostish(url))
  const parent = BrowserWindow.fromWebContents(wc) ?? undefined
  const res = await dialog.showSaveDialog(parent!, {
    title: 'Save page as PDF',
    defaultPath: path.join(app.getPath('downloads'), `${title}.pdf`),
    filters: [{ name: 'PDF document', extensions: ['pdf'] }]
  })
  if (res.canceled || !res.filePath) return
  try {
    const buf = await wc.printToPDF({ printBackground: true })
    fs.writeFileSync(res.filePath, buf)
    notify('Page saved as PDF', path.basename(res.filePath))
  } catch {
    notify('Save as PDF', 'This page could not be rendered to PDF')
  }
}

function hostish(url: string): string {
  try {
    return new URL(url).hostname || 'page'
  } catch {
    return 'page'
  }
}
