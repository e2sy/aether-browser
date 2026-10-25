/**
 * Reading list (Master Plan Phase 2, item #46) — separate from bookmarks,
 * with read/unread state and reading-time estimates.
 *
 * Estimate model: ~230 words per minute of focused reading. Word counts are
 * captured when the page is open (context-menu add) and stay null otherwise
 * (the list shows "—" instead of guessing).
 */
import { JsonStore } from './store'

export interface ReadingItem {
  url: string
  title: string
  addedTs: number
  read: boolean
  /** estimated minutes (null = unknown) */
  minutes: number | null
}

export const MAX_READING_ITEMS = 500

export function readingMinutes(words: number): number {
  const w = Math.max(0, Math.floor(Number(words) || 0))
  if (w === 0) return 0
  return Math.max(1, Math.ceil(w / 230))
}

/** Pure: strip + validate a list read back from disk (fail-closed). */
export function sanitizeReadingList(raw: unknown): ReadingItem[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const out: ReadingItem[] = []
  for (const r of raw) {
    if (!r || typeof r !== 'object') continue
    const it = r as { url?: unknown; title?: unknown; addedTs?: unknown; read?: unknown; minutes?: unknown }
    if (typeof it.url !== 'string' || !/^https?:\/\//i.test(it.url) || it.url.length > 2048) continue
    if (seen.has(it.url)) continue
    seen.add(it.url)
    out.push({
      url: it.url,
      title: typeof it.title === 'string' ? it.title.slice(0, 300) : it.url,
      addedTs: typeof it.addedTs === 'number' && it.addedTs > 0 ? it.addedTs : Date.now(),
      read: it.read === true,
      minutes: typeof it.minutes === 'number' && it.minutes >= 0 && it.minutes < 100000 ? it.minutes : null
    })
  }
  return out.slice(0, MAX_READING_ITEMS)
}

/** Pure: add (dedupe by URL — re-adding moves to top and marks unread). */
export function addReadingItem(
  list: ReadingItem[],
  entry: { url: string; title?: string; words?: number }
): ReadingItem[] {
  const url = String(entry?.url || '')
  if (!/^https?:\/\//i.test(url)) return list
  const rest = list.filter((x) => x.url !== url)
  const item: ReadingItem = {
    url,
    title: String(entry?.title || url).slice(0, 300),
    addedTs: Date.now(),
    read: false,
    minutes: entry?.words ? readingMinutes(entry.words) : null
  }
  return [item, ...rest].slice(0, MAX_READING_ITEMS)
}

export function removeReadingItem(list: ReadingItem[], url: string): ReadingItem[] {
  return list.filter((x) => x.url !== String(url || ''))
}

export function toggleReadingRead(list: ReadingItem[], url: string): ReadingItem[] {
  return list.map((x) => (x.url === String(url || '') ? { ...x, read: !x.read } : x))
}

// ---------- runtime ----------

const store = new JsonStore<ReadingItem[]>('readinglist.json', [])

function load(): ReadingItem[] {
  const clean = sanitizeReadingList(store.data)
  if (Array.isArray(store.data) && clean.length === store.data.length) return clean
  store.data = clean
  store.save()
  return clean
}

export function listReading(): ReadingItem[] {
  return load()
}

export function addReading(entry: { url: string; title?: string; words?: number }): ReadingItem[] {
  store.data = addReadingItem(load(), entry)
  store.save()
  return store.data
}

export function removeReading(url: string): ReadingItem[] {
  store.data = removeReadingItem(load(), url)
  store.save()
  return store.data
}

export function toggleReading(url: string): ReadingItem[] {
  store.data = toggleReadingRead(load(), url)
  store.save()
  return store.data
}

export function countUnread(): number {
  return load().filter((x) => !x.read).length
}
