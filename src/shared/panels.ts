/**
 * Side panels (v2.10.0 build 24) — pure model + rules.
 *
 * A panel is a user-pinned site that docks in a narrow view beside the page
 * content (message-web style): { id, url, title, ts }. Rules enforced here
 * (unit-tested in test-v2100.mjs):
 *   • urls must be http(s) — no javascript:, no aether:, no data:
 *   • titles are trimmed, control chars stripped, capped at 40 chars
 *   • panels dedupe by URL (first one wins), cap at MAX_PANELS
 *   • ids are 'pn_' + 12 hex chars; anything else read back from disk is
 *     dropped (fail-closed sanitize)
 */
import { randomUUID } from 'node:crypto'

export interface Panel {
  id: string
  url: string
  title: string
  ts: number
}

export const MAX_PANELS = 12
export const MAX_PANEL_TITLE = 40
export const MAX_PANEL_URL = 2048

/** Pure: '' when the URL is not a plain http(s) address. */
export function cleanPanelUrl(raw: unknown): string {
  const s = String(raw ?? '').trim()
  if (!/^https?:\/\//i.test(s)) return ''
  if (s.length > MAX_PANEL_URL) return ''
  try {
    const u = new URL(s)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return ''
    return u.toString()
  } catch {
    return ''
  }
}

/** Pure: '' when the title is empty after cleaning. */
export function cleanPanelTitle(raw: unknown): string {
  return String(raw ?? '')
    .replace(/[\u0000-\u001f]/g, '')
    .trim()
    .slice(0, MAX_PANEL_TITLE)
}

/** Pure: build a validated panel (null when the URL is unusable). */
export function makePanel(rawUrl: unknown, rawTitle: unknown, now = Date.now()): Panel | null {
  const url = cleanPanelUrl(rawUrl)
  if (!url) return null
  let host = url
  try {
    host = new URL(url).hostname.replace(/^www\./, '')
  } catch {
    /* keep url as fallback title */
  }
  const title = cleanPanelTitle(rawTitle) || host
  return { id: 'pn_' + randomUUID().replace(/-/g, '').slice(0, 12), url, title, ts: now }
}

/** Pure: add a panel — dedupe by URL (first wins, no duplicates), newest at front, cap MAX_PANELS. */
export function pushPanel(list: Panel[], panel: Panel): Panel[] {
  if (list.some((p) => p.url === panel.url)) return list
  return [panel, ...list].slice(0, MAX_PANELS)
}

/** Pure: sanitize a panels array read back from disk (fail-closed). */
export function sanitizePanels(raw: unknown): Panel[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const out: Panel[] = []
  for (const r of raw) {
    if (!r || typeof r !== 'object') continue
    const p = r as { id?: unknown; url?: unknown; title?: unknown; ts?: unknown }
    if (typeof p.id !== 'string' || !/^pn_[a-f0-9]{6,16}$/.test(p.id)) continue
    const url = cleanPanelUrl(p.url)
    if (!url || seen.has(url)) continue
    seen.add(url)
    out.push({
      id: p.id,
      url,
      title: cleanPanelTitle(p.title) || hostOf(url),
      ts: typeof p.ts === 'number' && Number.isFinite(p.ts) ? p.ts : 0
    })
    if (out.length >= MAX_PANELS) break
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

/** Pure: one-letter avatar glyph for a panel (host initial). */
export function panelGlyph(url: string): string {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '')
    return (host[0] || '?').toUpperCase()
  } catch {
    return '?'
  }
}
