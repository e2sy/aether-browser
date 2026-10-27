/**
 * Mouse gestures — main-process side (v2.8.0, Dolphin-style).
 *
 * The DETECTION lives in preload/gesture.js (sandbox-safe plain JS, injected
 * on every session next to the shields cosmetic + farble preloads). When the
 * user finishes a right-button drag that forms a recognized shape, the
 * preload sends 'aether:gesture' with the raw trail; this module:
 *   - answers the preload's one config round-trip ('aether:gesture-config')
 *     with { enabled } so right-click stays a right-click when gestures are
 *     off (the toggle is read live on every page load);
 *   - validates the trail with the pure shared model (single source of
 *     truth), then maps the sequence onto the sender's own TabManager.
 *
 * Actions: L=back · R=forward · U=new tab · D=close tab · DU=reload ·
 * UD=reopen closed tab.
 */
import { ipcMain, session } from 'electron'
import path from 'node:path'
import { actionForSeq, sanitizeGesturePayload, type GestureAction } from '../shared/gestures'
import { mergedSettings } from './store'
import type { TabManager } from './tabs'

/** Path of the copied preload (out/preload/gesture.js — see vite config). */
export function gesturePreloadPath(): string {
  return path.join(__dirname, '../preload/gesture.js')
}

export function gestureEnabled(): boolean {
  return mergedSettings().gestures !== false
}

/** Register the gesture preload on a session (idempotent, best-effort). */
export function registerGestureOnSession(ses: Electron.Session): void {
  try {
    const p = gesturePreloadPath()
    const existing: string[] = (ses as unknown as { getPreloads?: () => string[] }).getPreloads?.() || []
    if (!existing.includes(p)) {
      ;(ses as unknown as { setPreloads: (p: string[]) => void }).setPreloads([...existing, p])
    }
  } catch (err) {
    console.warn('[gestures] preload registration failed:', err instanceof Error ? err.message : err)
  }
}

/** Boot hook: default + private sessions. Container sessions register on creation. */
export function registerGestureEverywhere(): void {
  registerGestureOnSession(session.defaultSession)
  try {
    registerGestureOnSession(session.fromPartition('aether-private'))
  } catch {
    /* private session registration is best-effort */
  }
}

/** Resolve the sender webContents → its TabManager + tab id (injected). */
export type GestureRouter = (wc: Electron.WebContents) => { tm: TabManager; tabId: number } | null

let route: GestureRouter = () => null

export function initGestures(router: GestureRouter): void {
  route = router

  ipcMain.on('aether:gesture-config', (event) => {
    event.returnValue = { enabled: gestureEnabled() }
  })

  ipcMain.on('aether:gesture', (event, payload: unknown) => {
    try {
      if (!gestureEnabled()) return
      const clean = sanitizeGesturePayload(payload)
      if (!clean) return
      const action = actionForSeq(clean.seq)
      if (!action) return
      const target = route(event.sender)
      if (!target) return
      runAction(target.tm, target.tabId, action)
    } catch {
      /* a broken payload must never take the main process down */
    }
  })
}

/** Pure-ish dispatch — exported so tests can assert the mapping end-to-end. */
export function runAction(tm: TabManager, tabId: number, action: GestureAction): void {
  switch (action) {
    case 'back':
      tm.back(tabId)
      break
    case 'forward':
      tm.forward(tabId)
      break
    case 'reload':
      tm.reload(tabId)
      break
    case 'newTab':
      tm.create()
      break
    case 'closeTab':
      tm.close(tabId)
      break
    case 'reopenClosed':
      tm.reopenClosedTab()
      break
  }
}
