/**
 * Fuzzy matcher for the command palette (Master Plan Phase 2, item #37).
 *
 * Pure + shared (renderer and main both import it). Single-character gaps
 * allowed in order (classic subsequence match), scored by:
 *   • consecutive-run bonuses (whole words win)
 *   • word-boundary bonuses (camelCase, after space/dot/dash/slash)
 *   • start-of-string bonus
 *   • penalty spread over the matched span (compact matches win)
 * Returns null when the query is not a subsequence — callers filter those.
 */
export interface FuzzyResult {
  score: number
  /** indexes in the target that matched, in query order (for highlighting) */
  positions: number[]
}

const BOUNDARY_CHARS = new Set([' ', '-', '_', '.', '/', ':', '(', ')', '[', ']'])

export function fuzzyMatch(query: string, target: string): FuzzyResult | null {
  const q = String(query || '').toLowerCase()
  const t = String(target || '').toLowerCase()
  if (!q) return { score: 0, positions: [] }
  if (!t) return null

  const positions: number[] = []
  let score = 0
  let ti = 0
  let run = 0
  let firstIdx = -1

  for (let qi = 0; qi < q.length; qi++) {
    const c = q[qi]
    if (c === ' ') {
      // space = soft separator: allow skipping ahead, no char to consume
      run = 0
      continue
    }
    let found = -1
    for (let j = ti; j < t.length; j++) {
      if (t[j] === c) {
        found = j
        break
      }
    }
    if (found < 0) return null
    // bonuses
    let gain = 1
    if (found > 0 && BOUNDARY_CHARS.has(t[found - 1])) gain += 6 // word boundary
    else if (found > 0 && t[found - 1] !== t[found - 1].toUpperCase() && t[found] === t[found].toUpperCase()) gain += 5 // camelCase
    if (found === 0) gain += 8 // start of string
    run = found === (positions.length ? positions[positions.length - 1] + 1 : found) && run > 0 ? run + 1 : 1
    if (run > 1) gain += 2 + Math.min(run, 6) // consecutive run
    // compactness penalty grows with unmatched gap size
    const gap = positions.length ? found - positions[positions.length - 1] - 1 : found
    gain -= Math.min(gap, 10) * 0.4
    score += gain
    positions.push(found)
    ti = found + 1
    if (firstIdx < 0) firstIdx = found
  }

  return { score, positions }
}

export interface Ranked<T> {
  item: T
  score: number
  positions: number[]
}

/** Rank a list of {text, sub} items; drops non-matches; empty query = original order. */
export function rankBy<T extends { text: string; sub?: string }>(items: T[], query: string, limit = 20): Ranked<T>[] {
  const q = String(query || '').trim()
  if (!q) {
    return items.slice(0, limit).map((item) => ({ item, score: 0, positions: [] as number[] }))
  }
  const out: Ranked<T>[] = []
  for (const item of items) {
    const m1 = fuzzyMatch(q, item.text)
    const m2 = item.sub ? fuzzyMatch(q, item.sub) : null
    if (!m1 && !m2) continue
    // matching the title beats matching the subtitle
    let best: FuzzyResult
    let titleHit = false
    if (m1 && m2) {
      titleHit = m1.score >= m2.score
      best = titleHit ? m1 : m2
    } else if (m1) {
      titleHit = true
      best = m1
    } else {
      best = m2 as FuzzyResult
    }
    out.push({ item, score: best.score + (titleHit ? 4 : 0), positions: best.positions })
  }
  out.sort((a, b) => b.score - a.score)
  return out.slice(0, limit)
}
