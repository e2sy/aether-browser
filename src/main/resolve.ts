import type { Settings } from '../shared/types'
import { settings } from './store'

/**
 * Resolve omnibox / search-box input into a URL.
 * - explicit scheme        -> as-is
 * - looks like a domain    -> https:// prefixed
 * - otherwise              -> AI search page (default) or plain DuckDuckGo
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
  if (s.searchMode === 'ai') return 'aether://search?q=' + encodeURIComponent(t)
  return 'https://duckduckgo.com/?q=' + encodeURIComponent(t)
}
