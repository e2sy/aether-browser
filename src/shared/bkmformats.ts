/**
 * Bookmark format codecs (v2.2.0) — the real-browser migration path, pure and
 * dependency-free so it runs (and tests) without Electron.
 *
 *  - parseNetscapeBookmarks()   — the universal "Bookmarks HTML File" that
 *    Chrome, Firefox, Edge, Safari and friends all export and import.
 *  - parseChromeBookmarksJson() — the `Bookmarks` JSON file inside
 *    Chrome / Edge / Brave / Chromium profile directories.
 *  - dedupeBookmarks()          — never import a URL that is already saved.
 *  - buildNetscapeExport()      — round-trips through every other browser.
 *  - candidateBaseDirs()        — where those profiles live per platform.
 *  - resolveDownloadDir()       — configured download folder with fallback.
 *
 * Safety: URLs are filtered to http(s), counts are capped, titles are decoded
 * and re-escaped on export, and nothing here ever executes input.
 */
import type { Bookmark } from './types'

/** Highest number of bookmarks a single import may add. */
export const IMPORT_CAP = 10000
/** Highest number of bookmarks the library may hold in total. */
export const LIBRARY_CAP = 20000

const ALLOWED_SCHEME = /^https?:\/\//i

/** Decode the HTML entities bookmark files use (&amp; &lt; &#39; …). */
export function decodeEntities(s: string): string {
  return String(s || '')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => safeCode(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => safeCode(Number(d)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
}

function safeCode(n: number): string {
  return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : ''
}

/** Escape text for use in exported HTML. */
export function escapeHtml(s: string): string {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** Normalized dedupe key — trims and drops trailing slashes so `x.com/` == `x.com`. */
export function bookmarkKey(url: string): string {
  return String(url || '')
    .trim()
    .replace(/\/+$/, '')
}

/** ADD_DATE / date_added values arrive in seconds or (Chrome) microseconds. */
export function normalizeTs(raw: unknown, fallback = Date.now()): number {
  const n = Number(raw)
  if (!Number.isFinite(n) || n <= 0) return fallback
  if (n > 1e15) return Math.round(n / 1e6 - 11644473600 * 1000) // Chrome µs since 1601
  if (n > 1e12) return Math.round(n) // already ms
  return Math.round(n * 1000) // seconds
}

/** Hostname fallback for untitled bookmarks. */
export function hostOfUrl(url: string): string {
  try {
    return new URL(url).hostname || url
  } catch {
    return url
  }
}

function bookmarkOf(url: string, title: string, ts: unknown, folder: string): Bookmark | null {
  const clean = String(url || '').trim()
  if (!ALLOWED_SCHEME.test(clean)) return null
  return {
    url: clean,
    title: decodeEntities(String(title || '').trim()) || hostOfUrl(clean),
    ts: normalizeTs(ts),
    ...(folder ? { folder } : {})
  }
}

/**
 * Parse a Netscape bookmarks HTML export (line-oriented format — every real
 * browser writes it this way). Folder paths are joined with " / ".
 */
export function parseNetscapeBookmarks(html: string): Bookmark[] {
  const out: Bookmark[] = []
  const stack: string[] = []
  const lines = String(html || '').split(/\r?\n/)
  for (const line of lines) {
    const h3 = line.match(/<dt>\s*<h3[^>]*>([^<]*)<\/h3>/i)
    if (h3 && stack.length < 10) {
      stack.push(decodeEntities(h3[1]).trim())
      continue
    }
    if (/<\/dl>/i.test(line)) {
      stack.pop()
      continue
    }
    const a = line.match(/<dt>\s*<a\s+([^>]*)>([^<]*)<\/a>/i)
    if (!a) continue
    const attrs = a[1]
    const href = attrs.match(/href\s*=\s*"([^"]*)"/i)?.[1] ?? attrs.match(/href\s*=\s*'([^']*)'/i)?.[1] ?? ''
    const addDate = attrs.match(/add_date\s*=\s*"([^"]*)"/i)?.[1]
    const bm = bookmarkOf(decodeEntities(href), a[2], addDate, stack.join(' / '))
    if (bm) out.push(bm)
    if (out.length >= IMPORT_CAP) break
  }
  return out
}

/** Walk one Chrome-JSON node tree, accumulating folder paths. */
function walkChromeNode(node: unknown, folder: string, out: Bookmark[]): void {
  if (!node || typeof node !== 'object' || out.length >= IMPORT_CAP) return
  const n = node as { type?: string; url?: string; name?: string; date_added?: string; children?: unknown[] }
  if (n.type === 'url' && typeof n.url === 'string') {
    const bm = bookmarkOf(n.url, n.name ?? '', n.date_added, folder)
    if (bm) out.push(bm)
    return
  }
  if (Array.isArray(n.children)) {
    const nextFolder = n.type === 'folder' && n.name ? (folder ? `${folder} / ${n.name}` : n.name) : folder
    for (const child of n.children) walkChromeNode(child, nextFolder, out)
  }
}

/**
 * Parse a Chrome/Edge/Brave/Chromium `Bookmarks` profile file:
 * `{ roots: { bookmark_bar, other, synced } }`.
 */
export function parseChromeBookmarksJson(json: string): Bookmark[] {
  let data: {
    roots?: Record<string, unknown>
  }
  try {
    data = JSON.parse(String(json || '')) as typeof data
  } catch {
    return []
  }
  const out: Bookmark[] = []
  const labels: Record<string, string> = {
    bookmark_bar: 'Bookmarks bar',
    other: 'Other bookmarks',
    synced: 'Mobile bookmarks'
  }
  for (const [root, label] of Object.entries(labels)) {
    if (!data.roots || !data.roots[root]) continue
    // canonical label wins over the file's own folder name at root level
    const node = { ...(data.roots[root] as object), name: label }
    walkChromeNode(node, '', out)
  }
  return out.slice(0, IMPORT_CAP)
}

/** Parse any import file — JSON if it looks like Chrome, Netscape HTML otherwise. */
export function parseBookmarkFile(content: string): Bookmark[] {
  const trimmed = String(content || '').trimStart()
  return trimmed.startsWith('{') ? parseChromeBookmarksJson(trimmed) : parseNetscapeBookmarks(trimmed)
}

/** Incoming bookmarks that are neither saved yet nor duplicated within the batch. */
export function dedupeBookmarks(existing: Bookmark[], incoming: Bookmark[]): Bookmark[] {
  const seen = new Set<string>(existing.map((b) => bookmarkKey(b.url)))
  const out: Bookmark[] = []
  for (const bm of incoming) {
    const key = bookmarkKey(bm.url)
    if (!key || seen.has(key)) continue
    seen.add(key)
    out.push(bm)
  }
  return out.slice(0, Math.max(0, LIBRARY_CAP - existing.length))
}

/** Universal Netscape HTML export — group by folder path, keep order stable. */
export function buildNetscapeExport(bookmarks: Bookmark[]): string {
  const groups = new Map<string, Bookmark[]>()
  for (const bm of bookmarks) {
    const key = bm.folder || ''
    const list = groups.get(key)
    if (list) list.push(bm)
    else groups.set(key, [bm])
  }
  const parts: string[] = [
    '<!DOCTYPE NETSCAPE-Bookmark-file-1>',
    '<!-- Exported by Aether Browser — importable by Chrome, Firefox, Edge and friends -->',
    '<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">',
    '<TITLE>Bookmarks</TITLE>',
    '<H1>Bookmarks</H1>',
    '<DL><p>'
  ]
  const item = (bm: Bookmark): string =>
    `<DT><A HREF="${escapeHtml(bm.url)}" ADD_DATE="${Math.floor((bm.ts || Date.now()) / 1000)}">${escapeHtml(bm.title)}</A>`
  for (const [folder, list] of groups) {
    if (!folder) {
      for (const bm of list) parts.push(item(bm))
      continue
    }
    parts.push(`<DT><H3 ADD_DATE="${Math.floor(Date.now() / 1000)}">${escapeHtml(folder)}</H3>`, '<DL><p>')
    for (const bm of list) parts.push(item(bm))
    parts.push('</DL><p>')
  }
  parts.push('</DL><p>')
  return parts.join('\n') + '\n'
}

/**
 * Where Chrome-family profiles live per platform. Pure — `env` is injected so
 * tests can assert path building on every OS without leaving Linux.
 */
export function candidateBaseDirs(
  browser: string,
  env: { home: string; localAppData: string; platform: string }
): string[] {
  const { home, localAppData, platform } = env
  const p = (...seg: string[]): string => seg.join('/')
  if (platform === 'win32') {
    const base: Record<string, string> = {
      Chrome: p(localAppData, 'Google', 'Chrome', 'User Data'),
      Edge: p(localAppData, 'Microsoft', 'Edge', 'User Data'),
      Brave: p(localAppData, 'BraveSoftware', 'Brave-Browser', 'User Data'),
      Chromium: p(localAppData, 'Chromium', 'User Data')
    }
    return base[browser] ? [base[browser]] : []
  }
  if (platform === 'darwin') {
    const lib = p(home, 'Library', 'Application Support')
    const base: Record<string, string> = {
      Chrome: p(lib, 'Google', 'Chrome'),
      Edge: p(lib, 'Microsoft Edge'),
      Brave: p(lib, 'BraveSoftware', 'Brave-Browser'),
      Chromium: p(lib, 'Chromium')
    }
    return base[browser] ? [base[browser]] : []
  }
  const dot = p(home, '.config')
  const base: Record<string, string[]> = {
    Chrome: [p(dot, 'google-chrome'), p(dot, 'google-chrome-beta')],
    Edge: [p(dot, 'microsoft-edge'), p(dot, 'microsoft-edge-beta')],
    Brave: [p(dot, 'BraveSoftware', 'Brave-Browser')],
    Chromium: [p(dot, 'chromium')]
  }
  return base[browser] ?? []
}

/** Configured download folder if it exists, else the OS fallback. */
export function resolveDownloadDir(
  configured: string | undefined,
  fallback: string,
  exists: (p: string) => boolean = (): boolean => true
): string {
  const dir = String(configured || '').trim()
  return dir && exists(dir) ? dir : fallback
}
