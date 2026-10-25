/**
 * DuckDuckGo-style bangs for Aether Search (v1.6.0 Beast Mode).
 *
 * Type `!yt lofi beats` in the search box (or the omnibox) and Aether opens
 * YouTube's own search for "lofi beats" instead of the metasearch page.
 * Bangs are the fastest navigation primitive a browser can offer and they
 * cost zero network in our implementation: the whole table below is local,
 * resolution is pure and deterministic, and unknown bangs fall through to a
 * normal search so a typo never eats the query.
 *
 * Aether is a local-first browser: this table ships in the binary, is not
 * fetched from anywhere, and can be extended by editing it. Everything here
 * is pure so tests can assert exact URLs.
 */

export interface Bang {
  /** the token users type after the ! (canonical, no duplicates) */
  key: string
  /** human name shown in the hint UI */
  name: string
  /** search URL template with %s placeholder */
  url: string
  /** fallback home page when the query is empty */
  home: string
}

/** The shipped bang table — popular DDG bangs plus India-relevant sites. */
export const BANGS: Bang[] = [
  { key: 'g', name: 'Google', url: 'https://www.google.com/search?q=%s', home: 'https://www.google.com' },
  { key: 'yt', name: 'YouTube', url: 'https://www.youtube.com/results?search_query=%s', home: 'https://www.youtube.com' },
  { key: 'w', name: 'Wikipedia', url: 'https://en.wikipedia.org/w/index.php?search=%s', home: 'https://en.wikipedia.org' },
  { key: 'wiki', name: 'Wikipedia', url: 'https://en.wikipedia.org/w/index.php?search=%s', home: 'https://en.wikipedia.org' },
  { key: 'b', name: 'Bing', url: 'https://www.bing.com/search?q=%s', home: 'https://www.bing.com' },
  { key: 'ddg', name: 'DuckDuckGo', url: 'https://duckduckgo.com/?q=%s', home: 'https://duckduckgo.com' },
  { key: 'gi', name: 'Google Images', url: 'https://www.google.com/search?tbm=isch&q=%s', home: 'https://images.google.com' },
  { key: 'isch', name: 'Google Images', url: 'https://www.google.com/search?tbm=isch&q=%s', home: 'https://images.google.com' },
  { key: 'n', name: 'Google News', url: 'https://news.google.com/search?q=%s', home: 'https://news.google.com' },
  { key: 'news', name: 'Google News', url: 'https://news.google.com/search?q=%s', home: 'https://news.google.com' },
  { key: 'maps', name: 'Google Maps', url: 'https://www.google.com/maps/search/%s', home: 'https://www.google.com/maps' },
  { key: 'gm', name: 'Google Maps', url: 'https://www.google.com/maps/search/%s', home: 'https://www.google.com/maps' },
  { key: 'tr', name: 'Google Translate', url: 'https://translate.google.com/?sl=auto&tl=en&text=%s&op=translate', home: 'https://translate.google.com' },
  { key: 'translate', name: 'Google Translate', url: 'https://translate.google.com/?sl=auto&tl=en&text=%s&op=translate', home: 'https://translate.google.com' },
  { key: 'gh', name: 'GitHub', url: 'https://github.com/search?q=%s', home: 'https://github.com' },
  { key: 'github', name: 'GitHub', url: 'https://github.com/search?q=%s', home: 'https://github.com' },
  { key: 'so', name: 'Stack Overflow', url: 'https://stackoverflow.com/search?q=%s', home: 'https://stackoverflow.com' },
  { key: 'stackoverflow', name: 'Stack Overflow', url: 'https://stackoverflow.com/search?q=%s', home: 'https://stackoverflow.com' },
  { key: 'mdn', name: 'MDN Web Docs', url: 'https://developer.mozilla.org/en-US/search?q=%s', home: 'https://developer.mozilla.org' },
  { key: 'r', name: 'Reddit', url: 'https://www.reddit.com/search/?q=%s', home: 'https://www.reddit.com' },
  { key: 'reddit', name: 'Reddit', url: 'https://www.reddit.com/search/?q=%s', home: 'https://www.reddit.com' },
  { key: 'x', name: 'X (Twitter)', url: 'https://x.com/search?q=%s', home: 'https://x.com' },
  { key: 'tw', name: 'X (Twitter)', url: 'https://x.com/search?q=%s', home: 'https://x.com' },
  { key: 'twitter', name: 'X (Twitter)', url: 'https://x.com/search?q=%s', home: 'https://x.com' },
  { key: 'ig', name: 'Instagram', url: 'https://www.instagram.com/explore/tags/%s/', home: 'https://www.instagram.com' },
  { key: 'a', name: 'Amazon', url: 'https://www.amazon.com/s?k=%s', home: 'https://www.amazon.com' },
  { key: 'amazon', name: 'Amazon', url: 'https://www.amazon.com/s?k=%s', home: 'https://www.amazon.com' },
  { key: 'az', name: 'Amazon.in', url: 'https://www.amazon.in/s?k=%s', home: 'https://www.amazon.in' },
  { key: 'fk', name: 'Flipkart', url: 'https://www.flipkart.com/search?q=%s', home: 'https://www.flipkart.com' },
  { key: 'flipkart', name: 'Flipkart', url: 'https://www.flipkart.com/search?q=%s', home: 'https://www.flipkart.com' },
  { key: 'sp', name: 'Spotify', url: 'https://open.spotify.com/search/%s', home: 'https://open.spotify.com' },
  { key: 'spotify', name: 'Spotify', url: 'https://open.spotify.com/search/%s', home: 'https://open.spotify.com' },
  { key: 'sc', name: 'SoundCloud', url: 'https://soundcloud.com/search?q=%s', home: 'https://soundcloud.com' },
  { key: 'dr', name: 'Google Drive', url: 'https://drive.google.com/drive/search?q=%s', home: 'https://drive.google.com' },
  { key: 'bi', name: 'Bing Images', url: 'https://www.bing.com/images/search?q=%s', home: 'https://www.bing.com/images' },
  { key: 'v', name: 'Google Videos', url: 'https://www.google.com/search?tbm=vid&q=%s', home: 'https://www.google.com' },
  { key: 'wa', name: 'Wolfram Alpha', url: 'https://www.wolframalpha.com/input?i=%s', home: 'https://www.wolframalpha.com' },
  { key: 'qu', name: 'Quora', url: 'https://www.quora.com/search?q=%s', home: 'https://www.quora.com' },
  { key: 'pin', name: 'Pinterest', url: 'https://in.pinterest.com/search/pins/?q=%s', home: 'https://in.pinterest.com' },
  { key: 'se', name: 'Steam', url: 'https://store.steampowered.com/search/?term=%s', home: 'https://store.steampowered.com' },
  { key: 'imdb', name: 'IMDb', url: 'https://www.imdb.com/find/?q=%s', home: 'https://www.imdb.com' },
  { key: 'mw', name: 'Merriam-Webster', url: 'https://www.merriam-webster.com/dictionary/%s', home: 'https://www.merriam-webster.com' },
  { key: 'dict', name: 'Dictionary.com', url: 'https://www.dictionary.com/browse/%s', home: 'https://www.dictionary.com' },
  { key: 'git', name: 'Google Git/Code', url: 'https://www.google.com/search?q=site:github.com+%s', home: 'https://github.com' }
]

/** Fast lookup: bang key → entry (keys are unique). */
const BANG_MAP = new Map<string, Bang>(BANGS.map((b) => [b.key, b]))

export interface ResolvedBang {
  /** the bang key that matched (lowercase) */
  bang: string
  /** display name from the table */
  name: string
  /** the query with the bang token removed (trimmed; '' when bare bang) */
  query: string
  /** the URL to open — search template filled, or home when query is empty */
  url: string
}

/**
 * Resolve a raw query that may start with one or more bang tokens.
 *
 * Accepted forms: `!yt query`, `!yt! query`, `!!yt query` (people mash keys),
 * leading whitespace, case-insensitive. If the FIRST token is an unknown
 * bang, returns null — the query searches normally (a typo like `!yk cats`
 * should never silently swallow the search). Multiple bangs chain: the last
 * known one wins (`!g !yt cats` searches YouTube).
 *
 * Pure — tests assert exact URLs.
 */
export function resolveBang(raw: string): ResolvedBang | null {
  let q = String(raw || '').trim()
  if (!q || !q.startsWith('!')) return null

  let matched: Bang | null = null
  for (;;) {
    const m = /^!+([a-z0-9_-]*)(\s+|!|$)/i.exec(q)
    if (!m) break
    const key = (m[1] || '').toLowerCase()
    const rest = q.slice(m[0].length)
    if (!key) {
      // bare "!" or "!!" with no key — not a bang unless something follows
      if (!rest) return null
      q = rest
      continue
    }
    const hit = BANG_MAP.get(key)
    if (!hit) return null // unknown first token → normal search
    matched = hit
    q = rest.trim()
    if (!q.startsWith('!')) break
  }

  if (!matched) return null
  const url = q
    ? matched.url.replace('%s', encodeURIComponent(q))
    : matched.home
  return { bang: matched.key, name: matched.name, query: q, url }
}

/** True when the query STARTS with a bang token — used by the live hint UI. */
export function startsWithBang(raw: string): boolean {
  return /^!+[a-z0-9_-]/i.test(String(raw || '').trim())
}

/** Popular bangs for the hint popover, in table order (deduped by name). */
export function popularBangs(n = 12): Array<{ key: string; name: string }> {
  const seen = new Set<string>()
  const out: Array<{ key: string; name: string }> = []
  for (const b of BANGS) {
    if (seen.has(b.name)) continue
    seen.add(b.name)
    out.push({ key: b.key, name: b.name })
    if (out.length >= n) break
  }
  return out
}
