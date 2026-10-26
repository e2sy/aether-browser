/**
 * Tab search (v2.3.0, Master Plan — Chrome parity Ctrl+Shift+A).
 *
 * Chrome's tab search ranks by fuzzy subsequence over the tab title and URL
 * with a hard boost when the query equals the site host. Pure module so both
 * the renderer overlay and the tests share one policy.
 */

import { fuzzyMatch } from './fuzzy'
import type { TabMeta } from './types'

export interface TabHit {
  tab: TabMeta
  score: number
}

/** Host without the www. prefix, '' when the URL is not parseable. */
export function hostOfTab(url: string): string {
  try {
    return new URL(String(url || '')).hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}

/**
 * Rank open tabs for a query. Empty query → every tab in strip order with the
 * active tab first (Chrome shows all tabs when the box opens). Non-matches
 * are dropped; title hits beat URL hits (same rule as the command palette).
 */
export function rankTabs(query: string, tabs: TabMeta[], activeId: number | null = null, limit = 20): TabHit[] {
  const list = Array.isArray(tabs) ? tabs : []
  const q = String(query || '').trim()
  if (!q) {
    const ordered = [...list].sort((a, b) => {
      if (a.id === activeId) return -1
      if (b.id === activeId) return 1
      return 0
    })
    return ordered.slice(0, limit).map((tab) => ({ tab, score: 0 }))
  }

  const out: TabHit[] = []
  for (const tab of list) {
    const title = String(tab.title || '')
    const url = String(tab.url || '')
    const host = hostOfTab(url)
    const mTitle = fuzzyMatch(q, title)
    const mUrl = fuzzyMatch(q, url)
    const mHost = host ? fuzzyMatch(q, host) : null
    let score = -1
    if (mTitle) score = Math.max(score, mTitle.score + 6)
    if (mUrl) score = Math.max(score, mUrl.score)
    if (mHost) score = Math.max(score, mHost.score + 10) // typing "youtube" finds the host instantly
    if (score < 0) continue
    if (tab.id === activeId) score += 2 // already-focused tab still wins ties
    if (tab.pinned) score += 1
    out.push({ tab, score })
  }
  out.sort((a, b) => b.score - a.score)
  return out.slice(0, limit)
}
