import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import type { Bookmark, HistoryEntry, Settings } from '../shared/types'

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
  searchMode: 'ai'
}

export const settings = new JsonStore<Settings>('settings.json', DEFAULT_SETTINGS)

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
