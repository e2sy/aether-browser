import { JSDOM } from 'jsdom'
import type { SearchResult } from '../shared/types'

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'

const HEADERS = { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9' }
const TIMEOUT_MS = 7000

interface Engine {
  name: string
  url: (q: string) => string
  parse: (html: string, n: number) => SearchResult[]
}

/**
 * Free HTML search engines tried in order. DDG is privacy-first but flags some
 * networks with an HTTP-202 anomaly page (which parses to zero results), so the
 * chain falls through to the lite endpoint and then to Bing, which rarely blocks.
 */
const ENGINES: Engine[] = [
  {
    name: 'DuckDuckGo',
    url: (q) => `https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}`,
    parse: parseHtmlResults
  },
  {
    name: 'DuckDuckGo Lite',
    url: (q) => `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(q)}`,
    parse: parseLiteResults
  },
  {
    name: 'Bing',
    url: (q) => `https://www.bing.com/search?q=${encodeURIComponent(q)}&count=20&setlang=en`,
    parse: parseBingResults
  }
]

/**
 * Web results from the first engine that actually returns some. Every failure
 * is collected so the final error says exactly which engine failed and why.
 * (Kept for contract compatibility — the v1.3 pipeline uses tryEngine +
 * search-engine.searchAll to run every source in parallel and aggregate.)
 */
export async function webSearch(query: string, n = 8): Promise<SearchResult[]> {
  const q = String(query || '').trim()
  if (!q) return []

  const failures: string[] = []
  for (const engine of ENGINES) {
    try {
      const res = await fetch(engine.url(q), {
        headers: HEADERS,
        signal: AbortSignal.timeout(TIMEOUT_MS)
      })
      if (!res.ok) {
        failures.push(`${engine.name}: HTTP ${res.status}`)
        continue
      }
      const results = engine.parse(await res.text(), n)
      if (results.length) return results
      // e.g. DDG's 202-style anomaly page renders fine but has zero results
      failures.push(`${engine.name}: page had no results`)
    } catch (err) {
      failures.push(`${engine.name}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
  throw new Error(`all search engines failed (${failures.join(' | ')})`)
}

/** Source names the Aether Search pipeline runs in parallel (v1.3.0). */
export const ENGINE_NAMES: string[] = ENGINES.map((e) => e.name)

/**
 * Fetch ONE source by name — the unit the Aether Search pipeline aggregates.
 * Throws on HTTP errors and empty result pages (same failure semantics the
 * chain used), so searchAll can time and tag each source independently.
 */
export async function tryEngine(source: string, query: string, n = 8): Promise<SearchResult[]> {
  const engine = ENGINES.find((e) => e.name === source)
  if (!engine) throw new Error(`unknown engine: ${source}`)
  const q = String(query || '').trim()
  if (!q) return []
  const res = await fetch(engine.url(q), {
    headers: HEADERS,
    signal: AbortSignal.timeout(TIMEOUT_MS)
  })
  if (!res.ok) throw new Error(`${engine.name}: HTTP ${res.status}`)
  const results = engine.parse(await res.text(), n)
  if (!results.length) throw new Error(`${engine.name}: page had no results`)
  return results
}

/* ---------------------------- DuckDuckGo ---------------------------- */

function parseHtmlResults(html: string, n: number): SearchResult[] {
  const dom = new JSDOM(html)
  const doc = dom.window.document
  const out: SearchResult[] = []

  for (const li of Array.from(doc.querySelectorAll('div.result, div.web-result'))) {
    if (out.length >= n) break
    const a = li.querySelector('a.result__a') as HTMLAnchorElement | null
    if (!a) continue
    const url = unwrapDdgLink(a.href || '')
    if (!url) continue
    const title = (a.textContent || '').replace(/\s+/g, ' ').trim()
    const snippet = (li.querySelector('.result__snippet')?.textContent || '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 300)
    if (!title) continue
    out.push({ title, url, snippet })
  }
  return out
}

/** lite.duckduckgo.com renders a plain table: a.result-link + td.result-snippet. */
function parseLiteResults(html: string, n: number): SearchResult[] {
  const dom = new JSDOM(html)
  const doc = dom.window.document
  const out: SearchResult[] = []

  for (const a of Array.from(doc.querySelectorAll('a.result-link')) as HTMLAnchorElement[]) {
    if (out.length >= n) break
    const url = unwrapDdgLink(a.href || '')
    if (!url) continue
    const title = (a.textContent || '').replace(/\s+/g, ' ').trim()
    if (!title) continue
    // snippet lives in the next result row's td.result-snippet
    const row = a.closest('tr')?.nextElementSibling
    const snippet = (row?.querySelector('td.result-snippet')?.textContent || '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 300)
    out.push({ title, url, snippet })
  }
  return out
}

/** Resolve DDG outbound wrappers (/l/?uddg=<encoded>) to the real URL. */
function unwrapDdgLink(href: string): string {
  try {
    const abs = href.startsWith('//') ? 'https:' + href : href
    const u = new URL(abs)
    const uddg = u.searchParams.get('uddg')
    const url = uddg || abs
    return /^https?:/i.test(url) ? url : ''
  } catch {
    return ''
  }
}

/* -------------------------------- Bing ------------------------------- */

/**
 * Bing wraps results in bing.com/ck/a redirects whose `u` parameter carries the
 * real target as base64url, usually prefixed with "a1" (e.g. u=a1aHR0cHM6...).
 * Occasionally Bing serves direct links — those pass through unchanged.
 */
function unwrapBingLink(href: string): string {
  try {
    const u = new URL(href)
    if (u.hostname !== 'www.bing.com' || u.pathname !== '/ck/a') {
      return /^https?:\/\//i.test(href) ? href : ''
    }
    const raw = u.searchParams.get('u') || ''
    if (/^https?:\/\//i.test(raw)) return raw
    const b64 = raw.replace(/^a1/, '')
    if (!b64) return ''
    const decoded = Buffer.from(b64, 'base64url').toString('utf8')
    return /^https?:\/\//i.test(decoded) ? decoded : ''
  } catch {
    return ''
  }
}

/** bing.com/search results: li.b_algo > h2 a (title/link) + .b_caption p (snippet). */
function parseBingResults(html: string, n: number): SearchResult[] {
  const dom = new JSDOM(html)
  const doc = dom.window.document
  const out: SearchResult[] = []

  for (const li of Array.from(doc.querySelectorAll('li.b_algo'))) {
    if (out.length >= n) break
    const a = li.querySelector('h2 a') as HTMLAnchorElement | null
    if (!a) continue
    const url = unwrapBingLink(a.href || '')
    if (!url) continue
    const title = (a.textContent || '').replace(/\s+/g, ' ').trim()
    if (!title) continue
    const paragraphs = li.querySelectorAll('.b_caption p, p')
    let snippet = ''
    for (const p of Array.from(paragraphs)) {
      const text = (p.textContent || '').replace(/\s+/g, ' ').trim()
      if (text.length > 20) {
        snippet = text
        break
      }
    }
    out.push({ title, url, snippet: snippet.slice(0, 300) })
  }
  return out
}

/** Direct Google URL used as the final human fallback in the UI. */
export function googleSearchUrl(query: string): string {
  return 'https://www.google.com/search?q=' + encodeURIComponent(String(query || '').trim())
}
