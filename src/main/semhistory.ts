/**
 * Local semantic history (Master Plan Phase 4, item #73) — "find that
 * article about…" over your history and bookmarks using Ollama embeddings.
 *
 * Pure core (cosine similarity, top-K, chunk text) is unit-tested; the
 * runtime embeds lazily on first semantic query and caches vectors in
 * embeddings.json (keyed by model so a model switch rebuilds).
 */
import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { recentHistory } from './store'
import { chatOnce } from './ollama'

export interface SemItem {
  url: string
  title: string
  host: string
  ts: number
}

export const SEM_MAX_ITEMS = 300
export const SEM_MODEL_CANDIDATES = ['nomic-embed-text', 'mxbai-embed-large', 'all-minilm']

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
export function topK<T extends { vec: number[] }>(items: T[], query: number[], k: number): Array<{ item: T; score: number }> {
  const scored = items.map((item, i) => ({ item, score: cosineSim(query, item.vec), i }))
  scored.sort((a, b) => b.score - a.score || a.i - b.i)
  return scored.slice(0, Math.max(0, Math.floor(k))).map(({ item, score }) => ({ item, score }))
}

/** Pure: what text gets embedded for an item (title + host beats long URLs). */
export function itemText(it: SemItem): string {
  return `${it.title} ${it.host}`.slice(0, 512)
}

// ---------- runtime ----------

interface EmbedCache {
  model: string
  items: Array<SemItem & { vec: number[] }>
}

function cacheFile(): string {
  return path.join(app.getPath('userData'), 'embeddings.json')
}

function loadCache(model: string): EmbedCache | null {
  try {
    const raw = JSON.parse(fs.readFileSync(cacheFile(), 'utf-8')) as EmbedCache
    return raw && raw.model === model && Array.isArray(raw.items) ? raw : null
  } catch {
    return null
  }
}

function saveCache(cache: EmbedCache): void {
  try {
    fs.writeFileSync(cacheFile(), JSON.stringify(cache))
  } catch {
    /* cache is an optimization — losing it is fine */
  }
}

/** Ask Ollama for an embedding; null when no embedding model is available. */
async function embed(model: string, text: string): Promise<number[] | null> {
  try {
    const res = await fetch('http://127.0.0.1:11434/api/embeddings', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model, prompt: text.slice(0, 2000) })
    })
    if (!res.ok) return null
    const data = (await res.json()) as { embedding?: number[] }
    return Array.isArray(data.embedding) ? data.embedding : null
  } catch {
    return null
  }
}

async function pickEmbedModel(): Promise<string | null> {
  try {
    const res = await fetch('http://127.0.0.1:11434/api/tags', { method: 'GET' })
    if (!res.ok) return null
    const data = (await res.json()) as { models?: Array<{ name?: string }> }
    const names = (data.models || []).map((m) => String(m?.name || ''))
    for (const cand of SEM_MODEL_CANDIDATES) {
      const hit = names.find((n) => n.startsWith(cand))
      if (hit) return hit.split(':')[0]
    }
    return null
  } catch {
    return null
  }
}

export interface SemResult {
  item: SemItem
  score: number
}

export interface SemSearchOutcome {
  ok: boolean
  error?: string
  model?: string
  results?: SemResult[]
}

/**
 * Semantic search over history (+bookmarks merged later if wanted).
 * Fails soft: no Ollama / no embedding model → ok:false with a human error.
 */
export async function semSearch(query: string, k = 8): Promise<SemSearchOutcome> {
  const q = String(query || '').trim()
  if (!q) return { ok: false, error: 'Type what you remember — a phrase is enough.' }
  const model = await pickEmbedModel()
  if (!model) {
    return {
      ok: false,
      error: 'Semantic search needs an embedding model. Run: ollama pull nomic-embed-text'
    }
  }
  const qvec = await embed(model, q)
  if (!qvec) return { ok: false, error: 'Could not reach Ollama for embeddings.' }

  const items: SemItem[] = recentHistory(SEM_MAX_ITEMS).map((h) => ({
    url: h.url,
    title: h.title || h.url,
    host: h.host,
    ts: h.ts
  }))
  if (!items.length) return { ok: true, model, results: [] }

  const cached = loadCache(model)
  const byUrl = new Map<string, SemItem & { vec: number[] }>((cached?.items || []).map((it) => [it.url, it]))
  let rebuilt = false
  for (const it of items) {
    if (byUrl.has(it.url)) continue
    const vec = await embed(model, itemText(it))
    if (vec) {
      byUrl.set(it.url, { ...it, vec })
      rebuilt = true
    }
  }
  if (rebuilt) saveCache({ model, items: [...byUrl.values()].slice(0, SEM_MAX_ITEMS) })

  const withVec = items
    .map((it) => byUrl.get(it.url))
    .filter((x): x is SemItem & { vec: number[] } => Boolean(x))
  const hits = topK(withVec, qvec, k).filter((h) => h.score > 0.15)
  return { ok: true, model, results: hits.map((h) => ({ item: { url: h.item.url, title: h.item.title, host: h.item.host, ts: h.item.ts }, score: Math.round(h.score * 1000) / 1000 })) }
}

/** Exposed for tests/tools: how many items the cache currently holds. */
export function semCacheSize(): number {
  try {
    const raw = JSON.parse(fs.readFileSync(cacheFile(), 'utf-8')) as EmbedCache
    return Array.isArray(raw.items) ? raw.items.length : 0
  } catch {
    return 0
  }
}
