/**
 * Omnibox suggestion rows (v2.1.0 build 15) — pure policy shared between the
 * renderer Toolbar and the tests.
 *
 * The v1.3.0 dropdown had three problems, all visible in the wild:
 *  1. NO stale-guard — typing "youtu" then "youtube" let the slow "youtu"
 *     remote request resolve last and clobber the dropdown with rows for a
 *     query the user had already left (the exact "Search for 'youtu'" while
 *     the input said "youtube" bug report).
 *  2. Row budgets starved the feed — remote suggestions stopped at a total
 *     of 6 rows, so after the static row + URL row only ~4 engine
 *     suggestions ever appeared.
 *  3. History/bookmark rows could duplicate each other (dedupe only ran for
 *     bookmarks).
 *
 * buildOmniboxRows() fixes the row policy (pure, unit-tested); the Toolbar
 * owns the stale-guard (a request-sequence ref, verified by a static gate).
 */

export interface SugRow {
  kind: 'search' | 'url' | 'history' | 'bookmark'
  label: string
  sub?: string
  value: string
}

export interface OmniboxHistoryHit {
  url: string
  title?: string
  host?: string
}

export interface OmniboxBookmarkHit {
  url: string
  title?: string
}

/** A domain-ish blob: host.tld, with optional port and path, no spaces. */
export const DOMAINISH = /^[\w-]+(\.[\w-]+)+(:\d+)?(\/\S*)?$/

/** Row budgets (Chrome shows ~10-12): url 1 + search 7 + history 3 + bookmarks 2. */
export const OMNIBOX_ROW_CAP = 12

/** Pure: does this input look like a direct URL the user wants to open? */
export function isDomainLike(text: string): boolean {
  const t = String(text || '').trim()
  return !/\s/.test(t) && DOMAINISH.test(t)
}

/**
 * Pure: build the dropdown rows in priority order.
 *  [Go to <url>] (input is domain-like) → Search for "<text>" → engine
 *  suggestions (≤7, exact-match skipped) → history (≤3) → bookmarks (≤2),
 *  all case-insensitively deduped by value, capped at OMNIBOX_ROW_CAP.
 */
export function buildOmniboxRows(
  text: string,
  feed: {
    history?: OmniboxHistoryHit[]
    bookmarks?: OmniboxBookmarkHit[]
    suggestions?: string[]
  }
): SugRow[] {
  const t = String(text || '').trim()
  if (!t) return []
  const out: SugRow[] = []
  const seen = new Set<string>()
  /** appends unless the value is already present; returns whether it did —
   *  callers MUST gate their per-kind counters on this, or duplicates burn
   *  the budget and starve the rest of the feed (found by test-v190) */
  const push = (row: SugRow): boolean => {
    const key = row.value.toLowerCase()
    if (seen.has(key)) return false
    seen.add(key)
    out.push(row)
    return true
  }

  if (isDomainLike(t)) push({ kind: 'url', label: `Go to ${t}`, sub: 'open URL', value: t })
  push({ kind: 'search', label: `Search for “${t}”`, sub: 'address bar search', value: t })

  let searchCount = 0
  for (const s of feed.suggestions || []) {
    if (searchCount >= 7 || out.length >= 8) break
    const v = String(s || '').trim()
    if (!v || v.toLowerCase() === t.toLowerCase()) continue
    if (push({ kind: 'search', label: v, sub: 'search suggestion', value: v })) searchCount++
  }
  let historyCount = 0
  for (const h of feed.history || []) {
    if (historyCount >= 3 || out.length >= 11) break
    const url = String(h?.url || '')
    if (!url) continue
    if (push({ kind: 'history', label: h.title || url, sub: h.host || hostOf(url), value: url })) historyCount++
  }
  let bookmarkCount = 0
  for (const b of feed.bookmarks || []) {
    if (bookmarkCount >= 2 || out.length >= OMNIBOX_ROW_CAP) break
    const url = String(b?.url || '')
    if (!url) continue
    if (push({ kind: 'bookmark', label: b.title || url, sub: 'bookmark', value: url })) bookmarkCount++
  }
  return out.slice(0, OMNIBOX_ROW_CAP)
}

/** Tiny host extractor for history rows that arrive without a host field. */
export function hostOf(url: string): string {
  try {
    return new URL(String(url || '')).hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}

// ── v2.4.0 build 18: inline autocomplete + paste-and-go ────────────────────

/**
 * Pure: Chrome-style type-ahead. Given the text currently in the box and the
 * top dropdown row, returns the completion SUFFIX to show as ghost text —
 * e.g. input "yout" with top row value "youtube.com" → "ube.com" — or null
 * when there is nothing to complete.
 *
 * Rules (all unit-tested):
 *  - top row must exist and start with the input (case-insensitive)
 *  - the completion must actually ADD characters
 *  - a trailing space means the user finished a word — never complete
 */
export function inlineComplete(input: string, top: { value: string } | null | undefined): string | null {
  const t = String(input ?? '')
  const trimmedEnd = t.replace(/\s+$/, '')
  if (!trimmedEnd || /\s$/.test(t)) return null
  const value = String(top?.value ?? '')
  if (!value) return null
  const lower = value.toLowerCase()
  const start = trimmedEnd.toLowerCase()
  if (!lower.startsWith(start)) return null
  const suffix = value.slice(trimmedEnd.length)
  return suffix.length > 0 ? suffix : null
}

/**
 * Pure: paste-and-go target sanitizer. Accepts an http(s) URL or a
 * domain-like blob (example.com, example.com/path, host:port) after
 * trimming; everything else (search phrases, javascript:, data:, empty)
 * returns null so the caller keeps the plain-paste behavior.
 */
export function pasteGoTarget(text: unknown): string | null {
  const t = String(text ?? '').trim()
  if (!t || /\s/.test(t)) return null
  if (/^https?:\/\//i.test(t)) return t
  if (isDomainLike(t)) return t
  return null
}
