/**
 * Shared pure vector math (extracted from main/semhistory.ts in v2.6.0 so
 * both the semantic-history module and the tab-clusterer can use it without
 * dragging Electron into shared code).
 */

/** Pure: cosine similarity of two equal-length vectors (0 when malformed). */
export function cosineSim(a: number[], b: number[]): number {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length || a.length === 0) return 0
  let dot = 0
  let na = 0
  let nb = 0
  for (let i = 0; i < a.length; i++) {
    const x = Number(a[i]) || 0
    const y = Number(b[i]) || 0
    dot += x * y
    na += x * x
    nb += y * y
  }
  if (na === 0 || nb === 0) return 0
  return dot / (Math.sqrt(na) * Math.sqrt(nb))
}

/** Pure: top-K items by similarity (ties keep original order). */
export function topK<T extends { vec: number[] }>(
  items: T[],
  query: number[],
  k: number
): Array<{ item: T; score: number }> {
  const scored = items.map((item, i) => ({ item, score: cosineSim(query, item.vec), i }))
  scored.sort((a, b) => b.score - a.score || a.i - b.i)
  return scored.slice(0, Math.max(0, Math.floor(k))).map(({ item, score }) => ({ item, score }))
}
