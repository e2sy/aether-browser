/**
 * Session restore (v1.5.0) — "continue where you left off".
 *
 * Every open window/tab (url + pinned + which tab was active) is snapshotted
 * to <userData>/session.json whenever tab state changes (debounced) and again
 * synchronously on quit with a clean-exit marker. At boot the snapshot is
 * sanitized (garbage out, newtab/error/devtools pages dropped, caps applied)
 * and rebuilt into real windows.
 *
 * The sanitize/snapshot core is pure and unit-tested; nothing here imports
 * the window manager — entries are injected to keep the dependency graph
 * one-way (windows.ts → this module, never back).
 */
import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'

export interface SessionTab {
  url: string
  pinned: boolean
}

export interface SessionWindow {
  tabs: SessionTab[]
  /** index into `tabs` of the tab that should be focused after restore */
  active: number
}

export interface SessionSnapshot {
  windows: SessionWindow[]
  savedAt: number
  /** true when the previous run quit through the normal path */
  cleanExit?: boolean
}

const MAX_WINDOWS = 10
const MAX_TABS_PER_WINDOW = 50

/** Schemes/pages that must never come back from the dead. */
const NON_RESTORABLE =
  /^(aether:\/\/(newtab|search|error)([/?#].*)?$|devtools:|chrome:|about:|data:|blob:|javascript:|view-source:)/i

/** URLs we are willing to restore. */
export function isRestorableUrl(url: string): boolean {
  if (!url || typeof url !== 'string') return false
  if (NON_RESTORABLE.test(url)) return false
  return /^(https?|aether|file):\/\//i.test(url)
}

interface RawTab {
  url?: unknown
  pinned?: unknown
}
interface RawWindow {
  tabs?: unknown
  active?: unknown
}

/** Sanitize one window record; null when nothing restorable remains. */
export function sanitizeWindow(w: RawWindow | null | undefined): SessionWindow | null {
  if (!w || !Array.isArray(w.tabs)) return null
  const kept: SessionTab[] = []
  /** original index of every kept tab, for active-index remapping */
  const keptIdx: number[] = []
  const raw = w.tabs.slice(0, MAX_TABS_PER_WINDOW)
  raw.forEach((t: RawTab, i: number) => {
    if (!t || typeof t.url !== 'string') return
    if (!isRestorableUrl(t.url)) return
    kept.push({ url: t.url, pinned: Boolean(t.pinned) })
    keptIdx.push(i)
  })
  if (!kept.length) return null
  // focus the kept tab closest to the originally active one
  let want = Number.isFinite(w.active as number) ? Math.floor(w.active as number) : 0
  want = Math.max(0, Math.min(want, (w.tabs as unknown[]).length - 1))
  let best = 0
  let bestDist = Infinity
  keptIdx.forEach((origIdx, k) => {
    const d = Math.abs(origIdx - want)
    if (d < bestDist) {
      bestDist = d
      best = k
    }
  })
  return { tabs: kept, active: best }
}

/** Sanitize a whole snapshot; null when no window survives. */
export function sanitizeSession(s: SessionSnapshot | RawSession | null | undefined): SessionSnapshot | null {
  if (!s || !Array.isArray(s.windows)) return null
  const windows: SessionWindow[] = []
  for (const w of s.windows.slice(0, MAX_WINDOWS)) {
    const clean = sanitizeWindow(w as RawWindow)
    if (clean) windows.push(clean)
  }
  if (!windows.length) return null
  return {
    windows,
    savedAt: typeof s.savedAt === 'number' && s.savedAt > 0 ? s.savedAt : Date.now(),
    cleanExit: Boolean(s.cleanExit)
  }
}

/** Shape of a raw (possibly hostile) session.json blob. */
export interface RawSession {
  windows?: unknown
  savedAt?: unknown
  cleanExit?: unknown
}

/* ------------------------- electron glue ------------------------- */

/** Minimal structural type of a window entry (avoids importing windows.ts). */
export interface SessionEntryLike {
  win: { isDestroyed(): boolean }
  tabs: {
    getState(): { tabs: Array<{ id: number; url: string; pinned: boolean }>; activeId: number | null }
  }
  /** private windows (v1.5.0 build 5) must never hit the disk */
  private?: boolean
}

/** Build an unsanitized snapshot from live window entries. Private windows are excluded. */
export function snapshotFromEntries(entries: SessionEntryLike[]): SessionSnapshot {
  const windows: SessionWindow[] = []
  for (const e of entries) {
    if (e.private) continue
    if (e.win.isDestroyed()) continue
    const st = e.tabs.getState()
    if (!st.tabs.length) continue
    const tabs = st.tabs.map((t) => ({ url: t.url, pinned: t.pinned }))
    const ai = st.activeId !== null ? st.tabs.findIndex((t) => t.id === st.activeId) : 0
    windows.push({ tabs, active: Math.max(0, ai) })
  }
  return { windows, savedAt: Date.now(), cleanExit: false }
}

function sessionFile(): string {
  return path.join(app.getPath('userData'), 'session.json')
}

/** Read + sanitize the persisted snapshot. Returns null when absent/garbage/empty. */
export function loadSession(): SessionSnapshot | null {
  try {
    const raw = fs.readFileSync(sessionFile(), 'utf-8')
    return sanitizeSession(JSON.parse(raw) as RawSession)
  } catch {
    return null
  }
}

/** True when the previous run did not quit cleanly (crash / kill / power loss). */
export function wasUncleanShutdown(): boolean {
  try {
    const raw = JSON.parse(fs.readFileSync(sessionFile(), 'utf-8')) as RawSession
    return Boolean(raw && raw.savedAt) && raw.cleanExit !== true
  } catch {
    return false
  }
}

/** Write a snapshot immediately (synchronous) — used on quit. */
export function writeSessionNow(snapshot: SessionSnapshot): void {
  try {
    fs.mkdirSync(app.getPath('userData'), { recursive: true })
    fs.writeFileSync(sessionFile(), JSON.stringify(snapshot))
  } catch (err) {
    console.error('[session] write failed', err)
  }
}

/** Sanitize then write immediately. */
export function flushSessionNow(entries: SessionEntryLike[], cleanExit: boolean): void {
  const snap = snapshotFromEntries(entries)
  if (snap.windows.length) writeSessionNow({ ...snap, cleanExit })
}

let saveTimer: NodeJS.Timeout | null = null
let getEntries: (() => SessionEntryLike[]) | null = null

/** Wire the live window registry. Call once at boot. */
export function initSessionRestore(get: () => SessionEntryLike[]): void {
  getEntries = get
}

/** Debounced save — safe to call on every tab-state change. */
export function scheduleSessionSave(): void {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    saveTimer = null
    if (!getEntries) return
    const snap = snapshotFromEntries(getEntries())
    if (snap.windows.length) writeSessionNow(snap)
  }, 800)
  // keep the process alive only for this short write window
  if (typeof saveTimer.unref === 'function') saveTimer.unref()
}

/** Cancel a pending debounced save (quit path writes synchronously instead). */
export function cancelScheduledSessionSave(): void {
  if (saveTimer) {
    clearTimeout(saveTimer)
    saveTimer = null
  }
}

/** Drop the persisted session (used by "clear browsing data" flows later). */
export function forgetSession(): void {
  try {
    fs.rmSync(sessionFile(), { force: true })
  } catch {
    /* ignore */
  }
}
