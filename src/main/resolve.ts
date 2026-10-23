import type { Settings } from '../shared/types'
import { settings } from './store'

const ENGINES: Record<string, (q: string) => string> = {
  ai: (q) => 'aether://search?q=' + encodeURIComponent(q),
  google: (q) => 'https://www.google.com/search?q=' + encodeURIComponent(q),
  duckduckgo: (q) => 'https://duckduckgo.com/?q=' + encodeURIComponent(q)
}

/**
 * Resolve omnibox / search-box input into a URL.
 * - explicit scheme        -> as-is
 * - looks like a domain    -> https:// prefixed
 * - otherwise              -> chosen search mode (AI search page, Google or DuckDuckGo)
 */
export function resolveInput(text: string, s: Settings = settings.data): string | null {
  const t = text.trim()
  if (!t) return null
  if (/^(https?|aether|file):\/\//i.test(t)) return t
  // domain-ish: one dot, no spaces, valid chars
  if (!/\s/.test(t) && /^[\w-]+(\.[\w-]+)+(:\d+)?(\/\S*)?$/.test(t) && /\.[a-z]{2,}$/i.test(t.split('/')[0])) {
    return 'https://' + t
  }
  if (t.startsWith('localhost')) return 'http://' + t
  const engine = ENGINES[s.searchMode] || ENGINES.ai
  return engine(t)
}
