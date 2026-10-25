import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import type { Bookmark, HistoryEntry, Settings } from '../shared/types'
import { DEFAULT_APPEARANCE, normalizeAppearance } from './appearance'
/** Minimal debounced JSON file store — zero native dependencies. */
export class JsonStore<T> {
  private file: string
  data: T
  private timer: NodeJS.Timeout | null = null

  constructor(name: string, defaults: T) {
    this.file = path.join(app.getPath('userData'), name)
    try {
      const raw = fs.readFileSync(this.file, 'utf-8')
      this.data = JSON.parse(raw) as T
    } catch {
      this.data = defaults
    }
  }

  save(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      try {
        fs.mkdirSync(path.dirname(this.file), { recursive: true })
        fs.writeFileSync(this.file, JSON.stringify(this.data, null, 2))
      } catch (err) {
        console.error('[store] save failed', err)
      }
    }, 250)
  }
}

export const DEFAULT_SETTINGS: Settings = {
  model: null,
  usePageContext: true,
  confirmAgentActions: true,
  searchMode: 'ai',
  adblock: true,
  shieldsOffHosts: [],
  shieldsAggressive: false,
  filterPresetIds: [],
  filterLists: [],
  stripElectronUA: true,
  pageMemory: true,
  cloudFallback: { enabled: false, baseUrl: '', apiKey: '', model: '' },
  memorySaver: 30,
  extensions: [],
  appearance: DEFAULT_APPEARANCE,
  restoreSession: true,
  showBookmarksBar: true,
  grantTtlDays: 180,
  showTray: true,
  closeToTray: false,
  startupBoost: false,
  notifyDownloads: true,
  tabOrientation: 'top',
  forceDarkMode: 'off',
  forceDarkHosts: [],
  paramScrubber: true,
  httpsOnly: false,
  httpsExemptHosts: [],
  dohMode: 'off',
  dohTemplate: '',
  referrerTight: true,
  searchDepth: 'quick',
  tldrHosts: []
}

/** Settings with defaults merged in (older settings.json files may miss keys). */
export function mergedSettings(): Settings {
  const merged = { ...DEFAULT_SETTINGS, ...settings.data }
  merged.cloudFallback = { ...DEFAULT_SETTINGS.cloudFallback, ...settings.data.cloudFallback }
  if (!Array.isArray(merged.extensions)) merged.extensions = []
  // v1.4.0 — normalize the appearance blob so corrupted/old files can never break theming
  merged.appearance = normalizeAppearance(settings.data?.appearance, DEFAULT_APPEARANCE)
  return merged
}

export const settings = new JsonStore<Settings>('settings.json', DEFAULT_SETTINGS)

/** Per-host zoom levels (zoom factor exponent, 0 = 100%). Persisted across boots. */
export const zoomLevels = new JsonStore<Record<string, number>>('zoom.json', {})

export function getZoomLevel(host: string): number {
  return zoomLevels.data[host] ?? 0
}

export function setZoomLevel(host: string, level: number): void {
  if (!host) return
  if (Math.abs(level) < 0.001) delete zoomLevels.data[host]
  else zoomLevels.data[host] = Math.round(level * 1000) / 1000
  zoomLevels.save()
}

export const history = new JsonStore<HistoryEntry[]>('history.json', [])

export const bookmarks = new JsonStore<Bookmark[]>('bookmarks.json', [])

const INTERNAL_SCHEME = /^(aether|data|blob|about|devtools|chrome):/i

export function addHistory(url: string, title: string): void {
  if (!url || INTERNAL_SCHEME.test(url)) return
  let host = ''
  try {
    host = new URL(url).hostname
  } catch {
    return
  }
  const list = history.data.filter((h) => h.url !== url)
  list.unshift({ url, title: title || url, host, ts: Date.now() })
  history.data = list.slice(0, 500)
  history.save()
}

export function recentHistory(n = 12): HistoryEntry[] {
  return history.data.slice(0, n)
}

export function searchHistory(q: string, n = 300): HistoryEntry[] {
  const t = q.trim().toLowerCase()
  if (!t) return history.data.slice(0, n)
  return history.data
    .filter((h) => h.url.toLowerCase().includes(t) || h.title.toLowerCase().includes(t))
    .slice(0, n)
}

export function deleteHistory(url: string): void {
  history.data = history.data.filter((h) => h.url !== url)
  history.save()
}

export function clearHistory(): void {
  history.data = []
  history.save()
}

/** Clear history entries newer than `cutoffTs` (0 = everything). */
export function clearHistorySince(cutoffTs: number): void {
  const cut = Number(cutoffTs) || 0
  if (cut <= 0) {
    clearHistory()
    return
  }
  history.data = history.data.filter((h) => typeof h.ts === 'number' && h.ts < cut)
  history.save()
}

export function removeBookmark(url: string): void {
  bookmarks.data = bookmarks.data.filter((b) => b.url !== url)
  bookmarks.save()
}

export function searchBookmarks(q: string, n = 200): Bookmark[] {
  const t = q.trim().toLowerCase()
  if (!t) return bookmarks.data.slice(0, n)
  return bookmarks.data
    .filter((b) => b.url.toLowerCase().includes(t) || b.title.toLowerCase().includes(t))
    .slice(0, n)
}

/** Ranked omnibox suggestions: matching history + bookmarks. */
export function searchOmnibox(q: string, n = 6): { history: HistoryEntry[]; bookmarks: Bookmark[] } {
  const t = q.trim().toLowerCase()
  if (!t) return { history: recentHistory(4), bookmarks: [] }
  const scored = history.data
    .filter((h) => h.url.toLowerCase().includes(t) || h.title.toLowerCase().includes(t))
    .map((h, idx) => ({ h, score: (h.title.toLowerCase().includes(t) ? 2 : 0) + Math.max(0, 100 - idx) / 100 }))
    .sort((a, b) => b.score - a.score)
    .slice(0, n)
    .map((s) => s.h)
  const bms = bookmarks.data
    .filter((b) => b.url.toLowerCase().includes(t) || b.title.toLowerCase().includes(t))
    .slice(0, n)
  return { history: scored, bookmarks: bms }
}

/** Most visited hosts (by number of distinct page visits recorded). */
export function topSites(n = 8): HistoryEntry[] {
  const byHost = new Map<string, HistoryEntry>()
  for (const h of history.data) {
    const cur = byHost.get(h.host)
    if (!cur) byHost.set(h.host, h)
  }
  const freq = new Map<string, number>()
  for (const h of history.data) freq.set(h.host, (freq.get(h.host) || 0) + 1)
  return [...byHost.values()]
    .sort((a, b) => (freq.get(b.host) || 0) - (freq.get(a.host) || 0))
    .slice(0, n)
}

export function isBookmarked(url: string): boolean {
  return bookmarks.data.some((b) => b.url === url)
}

export function toggleBookmark(entry: { url: string; title: string }): boolean {
  const idx = bookmarks.data.findIndex((b) => b.url === entry.url)
  if (idx >= 0) {
    bookmarks.data.splice(idx, 1)
    bookmarks.save()
    return false
  }
  bookmarks.data.unshift({ url: entry.url, title: entry.title || entry.url, ts: Date.now() })
  bookmarks.save()
  return true
}
