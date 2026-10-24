import { JSDOM } from 'jsdom'
import { chatStream, OllamaMessage } from './ollama'
import { SEARCH_SYSTEM } from './agent/prompts'
import type { SearchResult } from '../shared/types'

const UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Aether/0.1'

/** Free web results via DuckDuckGo (no API key needed): HTML endpoint, lite endpoint as fallback. */
export async function webSearch(query: string, n = 8): Promise<SearchResult[]> {
  try {
    const res = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, {
      headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9' },
      signal: AbortSignal.timeout(9000)
    })
    if (res.ok) {
      const results = parseHtmlResults(await res.text(), n)
      if (results.length) return results
    }
  } catch {
    /* fall through to the lite endpoint */
  }
  // fallback: lite.duckduckgo.com (simpler layout, usually still available)
  const res = await fetch(`https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(query)}`, {
    headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9' },
    signal: AbortSignal.timeout(9000)
  })
  if (!res.ok) throw new Error(`Search engine responded ${res.status}`)
  return parseLiteResults(await res.text(), n)
}

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

/** Stream a cited answer for a query given its search results. */
export async function* answerStream(
  query: string,
  results: SearchResult[],
  model: string,
  signal?: AbortSignal
): AsyncGenerator<string> {
  const resultsText = results
    .map((r, i) => `[${i + 1}] ${r.title}\n${r.url}\n${r.snippet}`)
    .join('\n\n')

  const messages: OllamaMessage[] = [
    { role: 'system', content: SEARCH_SYSTEM },
    {
      role: 'user',
      content: `Question: ${query}\n\nWeb results:\n${resultsText || '(no results found)'}`
    }
  ]
  yield* chatStream(model, messages, signal)
}
