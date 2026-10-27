/**
 * Speed dial (Master Plan Phase 6) — pure model + rules.
 *
 * A dial is a user-pinned tile on the New Tab page: { id, url, title, ts }.
 * Rules enforced here (unit-tested in test-v280.mjs):
 *   • urls must be http(s) — no javascript:, no aether:, no data:
 *   • titles are trimmed, control chars stripped, capped at 60 chars
 *   • dials dedupe by URL (first one wins), cap at MAX_DIALS
 *   • ids are 'dl_' + 12 hex chars; anything else read back from disk is
 *     dropped (fail-closed sanitize)
 */
import { randomUUID } from 'node:crypto'

export interface Dial {
  id: string
  url: string
  title: string
  ts: number
}

export const MAX_DIALS = 16
export const MAX_DIAL_TITLE = 60
export const MAX_DIAL_URL = 2048

/** Pure: '' when the URL is not a plain http(s) address. */
export function cleanDialUrl(raw: unknown): string {
  const s = String(raw ?? '').trim()
  if (!/^https?:\/\//i.test(s)) return ''
  if (s.length > MAX_DIAL_URL) return ''
  try {
    const u = new URL(s)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return ''
    return u.toString()
  } catch {
    return ''
  }
}

/** Pure: '' when the title is empty after cleaning. */
export function cleanDialTitle(raw: unknown): string {
  return String(raw ?? '')
    .replace(/[\u0000-\u001f]/g, '')
    .trim()
    .slice(0, MAX_DIAL_TITLE)
}

/** Pure: build a validated dial (null when the URL is unusable). */
export function makeDial(rawUrl: unknown, rawTitle: unknown, now = Date.now()): Dial | null {
  const url = cleanDialUrl(rawUrl)
  if (!url) return null
  let host = url
  try {
    host = new URL(url).hostname.replace(/^www\./, '')
  } catch {
    /* keep url as fallback title */
  }
  const title = cleanDialTitle(rawTitle) || host
  return { id: 'dl_' + randomUUID().replace(/-/g, '').slice(0, 12), url, title, ts: now }
}

/** Pure: add a dial — dedupe by URL (first wins, no duplicates), newest at front, cap MAX_DIALS. */
export function pushDial(list: Dial[], dial: Dial): Dial[] {
  if (list.some((d) => d.url === dial.url)) return list
  return [dial, ...list].slice(0, MAX_DIALS)
}

/** Pure: sanitize a dials array read back from disk (fail-closed). */
export function sanitizeDials(raw: unknown): Dial[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const out: Dial[] = []
  for (const r of raw) {
    if (!r || typeof r !== 'object') continue
    const d = r as { id?: unknown; url?: unknown; title?: unknown; ts?: unknown }
    if (typeof d.id !== 'string' || !/^dl_[a-f0-9]{6,16}$/.test(d.id)) continue
    const url = cleanDialUrl(d.url)
    if (!url || seen.has(url)) continue
    seen.add(url)
    out.push({
      id: d.id,
      url,
      title: cleanDialTitle(d.title) || hostOf(url),
      ts: typeof d.ts === 'number' && Number.isFinite(d.ts) ? d.ts : 0
    })
    if (out.length >= MAX_DIALS) break
  }
  return out
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}
