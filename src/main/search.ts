import { JSDOM } from 'jsdom'
import { chatStream, OllamaMessage } from './ollama'
import { SEARCH_SYSTEM } from './agent/prompts'
import type { SearchResult } from '../shared/types'

const UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Aether/0.1'

/** Free web results via DuckDuckGo HTML endpoint (no API key needed). */
export async function webSearch(query: string, n = 8): Promise<SearchResult[]> {
  const res = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, {
    headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9' },
    signal: AbortSignal.timeout(9000)
  })
  if (!res.ok) throw new Error(`Search engine responded ${res.status}`)
  const html = await res.text()
  const dom = new JSDOM(html)
  const doc = dom.window.document
  const out: SearchResult[] = []

  for (const li of Array.from(doc.querySelectorAll('div.result, div.web-result'))) {
    if (out.length >= n) break
    const a = li.querySelector('a.result__a') as HTMLAnchorElement | null
    if (!a) continue
    let url = a.href || ''
    // DDG wraps outbound links in /l/?uddg=<encoded>
    try {
      const abs = url.startsWith('//') ? 'https:' + url : url
      const u = new URL(abs)
      const uddg = u.searchParams.get('uddg')
      if (uddg) url = uddg
      else url = abs
    } catch {
      continue
    }
    if (!/^https?:/i.test(url)) continue
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
