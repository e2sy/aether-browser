/**
 * Smart tab clustering (v2.6.0 build 20) — "Group tabs by topic".
 *
 * Pure core: greedy online clustering of embedding vectors with a centroid
 * per cluster, plus label generation from tab titles. The runtime half
 * (embedding tabs via Ollama, creating real tab groups) lives in
 * main/tabcluster.ts.
 *
 * Algorithm: walk items in order; each item joins the first cluster whose
 * CENTROID is within `threshold` cosine similarity, else opens a new cluster.
 * Centroids are running sums compared with plain cosine (normalization is
 * monotonic for the comparison, so we skip the sqrt work).
 */

import { cosineSim } from './semvec'

/** Words that never make a good group label. */
export const LABEL_STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'that', 'this', 'from', 'your', 'you', 'are', 'was', 'were',
  'have', 'has', 'had', 'not', 'but', 'all', 'can', 'will', 'one', 'two', 'how', 'what',
  'when', 'where', 'who', 'why', 'its', "it's", 'into', 'about', 'out', 'just', 'get',
  'got', 'new', 'now', 'top', 'best', 'home', 'page', 'official', 'site', 'website',
  'www', 'com', 'net', 'org', 'https', 'http', 'index', 'main', 'online', 'free',
  'login', 'signin', 'signup', 'account', 'search', 'settings', 'dashboard'
])

/** Pure: tokenize a tab title into label-worthy words. */
export function tokenizeTitle(title: string): string[] {
  return String(title || '')
    .toLowerCase()
    .split(/[^a-z0-9\u00c0-\u024f\u0900-\u097f]+/i)
    .map((t) => t.trim())
    .filter((t) => t.length >= 3 && t.length <= 24 && !LABEL_STOPWORDS.has(t))
    // digit-only tokens ("123") never make a good label — require a letter
    .filter((t) => /[a-z\u00c0-\u024f\u0900-\u097f]/i.test(t))
    .slice(0, 12)
}

/** Pure: short human label from the titles in a cluster ("Recipe Ideas"). */
export function labelForTitles(titles: string[], fallback: string): string {
  const freq = new Map<string, number>()
  let any = false
  for (const title of titles || []) {
    for (const tok of tokenizeTitle(title)) {
      any = true
      freq.set(tok, (freq.get(tok) || 0) + 1)
    }
  }
  if (!any) return fallback
  const ranked = [...freq.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 2)
  const label = ranked.map(([w]) => w[0].toUpperCase() + w.slice(1)).join(' & ')
  return label.slice(0, 40) || fallback
}

/**
 * Pure: greedy online clustering. Returns clusters of input indices, in
 * first-seen order. Malformed vectors are ignored (never crash grouping).
 */
export function clusterIndices(vectors: number[][], threshold: number): number[][] {
  const clusters: Array<{ sum: number[]; members: number[] }> = []
  const t = Math.min(1, Math.max(0, Number(threshold) || 0))
  vectors.forEach((vec, idx) => {
    if (!Array.isArray(vec) || !vec.length || vec.some((x) => typeof x !== 'number' || !Number.isFinite(x))) {
      return
    }
    let hit: (typeof clusters)[number] | null = null
    for (const c of clusters) {
      const centroid = c.sum.map((s) => s / c.members.length)
      if (cosineSim(centroid, vec) >= t) {
        hit = c
        break
      }
    }
    if (hit) {
      hit.members.push(idx)
      for (let i = 0; i < hit.sum.length; i++) hit.sum[i] += Number(vec[i]) || 0
    } else {
      clusters.push({ sum: vec.map((x) => Number(x) || 0), members: [idx] })
    }
  })
  return clusters.map((c) => c.members)
}

export interface ClusterInput {
  index: number
  title: string
  vec: number[]
}

export interface TopicGroup {
  label: string
  colorIndex: number
  members: Array<{ index: number; title: string }>
}

/** Group colors cycled in this order (matches tabgroups palette length). */
export const CLUSTER_COLORS = 8

/**
 * Pure: turn clusters into topic groups worth creating.
 * Only clusters with >= minSize members become groups (singletons stay
 * ungrouped); labels come from the member titles; `usedNames` keeps names
 * unique against groups that already exist.
 */
export function buildTopicGroups(
  items: ClusterInput[],
  threshold: number,
  minSize: number,
  usedNames: string[] = []
): TopicGroup[] {
  const vecs = items.map((it) => it.vec)
  const clusters = clusterIndices(vecs, threshold)
  const taken = new Set((usedNames || []).map((n) => String(n).toLowerCase()))
  const out: TopicGroup[] = []
  for (const members of clusters) {
    if (members.length < Math.max(2, Math.floor(minSize))) continue
    const titles = members.map((i) => items[i].title)
    let label = labelForTitles(titles, `Group ${out.length + 1}`)
    // keep names unique against existing groups + siblings
    let candidate = label
    let n = 2
    while (taken.has(candidate.toLowerCase())) candidate = `${label} ${n++}`
    taken.add(candidate.toLowerCase())
    out.push({
      label: candidate,
      colorIndex: out.length % CLUSTER_COLORS,
      members: members.map((i) => ({ index: items[i].index, title: items[i].title }))
    })
  }
  return out
}
