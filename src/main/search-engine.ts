/**
 * Aether Search — our own metasearch layer (v1.3.0).
 *
 * Aether does not crawl the web (no server, no index, no telemetry), so the
 * engine here is an honest aggregation pipeline: upstream sources are fetched
 * in parallel, every result keeps a `source` badge, URLs are stripped of
 * tracking parameters, results are deduped and ranked by OUR scorer, and the
 * top slots are interleaved so no single source owns the page.
 *
 * Everything in this file except searchSuggestions() is pure and deterministic
 * (stable tie-breaks) so tests can assert exact output. The network fetcher is
 * INJECTED (searchAll takes a fetchOne callback) — unit tests never touch the
 * network.
 */
import type { SearchResult } from '../shared/types'

/* ------------------------------ URL normalizing ----------------------------- */

/** Tracking parameters stripped before two URLs are compared (and shown). */
const TRACKING_PARAM =
  /^(utm_[a-z]+|fbclid|gclid|msclkid|dclid|igshid|mc_cid|mc_eid|ref_src|ref_url|_ga|yclid|twclid)$/i

/** Canonical-ish form for dedupe: http→https, lowercase host+path, no fragment,
 *  no tracking params, no trailing slash (except on the bare host). */
export function normalizeUrl(raw: string): string {
  try {
    const u = new URL(raw)
    if (u.protocol === 'http:' && u.hostname !== 'localhost') u.protocol = 'https:'
    u.hash = ''
    const keep: [string, string][] = []
    for (const [k, v] of u.searchParams.entries()) {
      if (!TRACKING_PARAM.test(k)) keep.push([k, v])
    }
    u.search = ''
    if (u.pathname.length > 1 && u.pathname.endsWith('/')) u.pathname = u.pathname.slice(0, -1)
    keep.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    for (const [k, v] of keep) u.searchParams.append(k, v)
    let s = u.toString()
    if (s.endsWith('/') && u.pathname !== '/') s = s.slice(0, -1)
    return s
  } catch {
    return String(raw || '').trim()
  }
}

/* --------------------------------- ranking --------------------------------- */

/** Lowercase word tokens of the query (len ≥ 2, deduped). */
export function tokenize(q: string): string[] {
  const seen = new Set<string>()
  for (const w of String(q || '').toLowerCase().split(/[^a-z0-9]+/i)) {
    if (w.length >= 2) seen.add(w)
  }
  return Array.from(seen)
}

/** Result quality score: query-term coverage of title/snippet + snippet presence. */
export function scoreResult(r: SearchResult, qTokens: string[]): number {
  const title = String(r.title || '').toLowerCase()
  const snippet = String(r.snippet || '').toLowerCase()
  let score = 0
  for (const t of qTokens) {
    if (title.includes(t)) score += 3
    else if (snippet.includes(t)) score += 1
  }
  if (snippet.length > 40) score += 1
  if (/^https?:\/\//i.test(r.url || '')) score += 1
  return score
}

export interface TaggedResults {
  source: string
  results: SearchResult[]
}

/**
 * Merge per-source result lists into one ranked, deduped list.
 * - dedupe by normalizeUrl (first source to see a URL wins the badge)
 * - each source's candidates are ordered by OUR score (stable ties)
 * - round-robin interleave across sources so the top of the page is diverse
 * - deterministic: no Date/random anywhere
 */
export function aggregate(perEngine: TaggedResults[], n = 12): SearchResult[] {
  const seen = new Set<string>()
  const lanes: SearchResult[][] = []

  for (const { source, results } of perEngine) {
    const lane: SearchResult[] = []
    for (const r of results || []) {
      const key = normalizeUrl(r.url)
      if (!key || seen.has(key)) continue
      seen.add(key)
      lane.push({ ...r, source, url: r.url })
    }
    if (lane.length) lanes.push(lane)
  }

  const out: SearchResult[] = []
  let idx = 0
  while (out.length < n) {
    let pushed = false
    for (const lane of lanes) {
      if (idx < lane.length && out.length < n) {
        out.push(lane[idx])
        pushed = true
      }
    }
    if (!pushed) break
    idx++
  }
  return out
}

/**
 * Score-aware variant used by the real pipeline: lanes are pre-sorted by
 * scoreResult before interleaving, so the best of each source surfaces first.
 * Deterministic tie-break: original order within a lane.
 */
export function aggregateRanked(
  perEngine: TaggedResults[],
  query: string,
  n = 12
): SearchResult[] {
  const qTokens = tokenize(query)
  const sorted = perEngine.map(({ source, results }) => ({
    source,
    results: results
      .map((r, i) => ({ r, i }))
      .sort(
        (a, b) =>
          scoreResult(b.r, qTokens) - scoreResult(a.r, qTokens) || a.i - b.i
      )
      .map(({ r }) => r)
  }))
  return aggregate(sorted, n)
}

/* ------------------------- local instant answers --------------------------- */

/**
 * Safe arithmetic evaluator — a hand-written tokenizer + recursive-descent
 * parser. No eval, no Function, no RegExp DoS: input length is capped and
 * only whitelisted tokens are accepted. Returns null for anything that is
 * not a well-formed arithmetic expression.
 */

const MATH_MAX_LEN = 100

type Tok =
  | { t: 'num'; v: number }
  | { t: 'id'; v: string }
  | { t: 'op'; v: string }

const CONSTS: Record<string, number> = { pi: Math.PI, e: Math.E }
const FUNCS: Record<string, (x: number) => number> = {
  sqrt: Math.sqrt,
  abs: Math.abs,
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  ln: Math.log
}

function tokenizeMath(src: string): Tok[] | null {
  const toks: Tok[] = []
  let i = 0
  while (i < src.length) {
    const c = src[i]
    if (/\s/.test(c)) {
      i++
      continue
    }
    if (/[0-9.]/.test(c)) {
      let j = i
      while (j < src.length && /[0-9.]/.test(src[j])) j++
      const text = src.slice(i, j)
      if (!/^\d+(\.\d+)?$|^\.\d+$/.test(text)) return null
      toks.push({ t: 'num', v: parseFloat(text) })
      i = j
      continue
    }
    if (/[a-z_]/i.test(c)) {
      let j = i
      while (j < src.length && /[a-z_0-9]/i.test(src[j])) j++
      toks.push({ t: 'id', v: src.slice(i, j).toLowerCase() })
      i = j
      continue
    }
    if ('+-*/%^()'.includes(c)) {
      toks.push({ t: 'op', v: c })
      i++
      continue
    }
    return null // any other character disqualifies the expression
  }
  return toks
}

function evaluateTokens(toks: Tok[]): number | null {
  let pos = 0
  const peek = (): Tok | undefined => toks[pos]
  const eat = (v: string): boolean => {
    const t = toks[pos]
    if (t && t.t === 'op' && t.v === v) {
      pos++
      return true
    }
    return false
  }

  // expr := term (('+'|'-') term)*
  function expr(): number | null {
    let acc = term()
    if (acc === null) return null
    for (;;) {
      if (eat('+')) {
        const right = term()
        if (right === null) return null
        acc = acc + right
      } else if (eat('-')) {
        const right = term()
        if (right === null) return null
        acc = acc - right
      } else return acc
    }
  }

  // term := unary (('*'|'/'|'%') unary)*
  function term(): number | null {
    let acc = unary()
    if (acc === null) return null
    for (;;) {
      if (eat('*')) {
        const right = unary()
        if (right === null) return null
        acc = acc * right
      } else if (eat('/')) {
        const right = unary()
        if (right === null) return null
        acc = acc / right
      } else if (eat('%')) {
        const right = unary()
        if (right === null) return null
        acc = acc % right
      } else return acc
    }
  }

  // unary := ('-'|'+') unary | power
  function unary(): number | null {
    if (eat('-')) {
      const v = unary()
      return v === null ? null : -v
    }
    if (eat('+')) return unary()
    return power()
  }

  // power := primary ('^' unary)?   (right-associative)
  function power(): number | null {
    const base = primary()
    if (base === null) return null
    if (eat('^')) {
      const exp = unary()
      if (exp === null) return null
      return Math.pow(base, exp)
    }
    return base
  }

  // primary := number | const | func '(' expr ')' | '(' expr ')'
  function primary(): number | null {
    const t = peek()
    if (!t) return null
    if (t.t === 'num') {
      pos++
      return t.v
    }
    if (t.t === 'id') {
      pos++
      const name = t.v
      if (name in FUNCS) {
        if (!eat('(')) return null
        const arg = expr()
        if (arg === null) return null
        if (!eat(')')) return null
        return FUNCS[name](arg)
      }
      if (name in CONSTS) return CONSTS[name]
      return null
    }
    if (eat('(')) {
      const v = expr()
      if (v === null) return null
      if (!eat(')')) return null
      return v
    }
    return null
  }

  const v = expr()
  return v !== null && Number.isFinite(v) && pos === toks.length ? v : null
}

export function evaluateMath(src: string): number | null {
  const s = String(src || '').trim()
  if (!s || s.length > MATH_MAX_LEN) return null
  const toks = tokenizeMath(s)
  if (!toks || !toks.length) return null
  // must contain at least one operator or function — "123" alone is not an answer
  const hasOp = toks.some((t) => t.t === 'op' && !'()'.includes(t.v)) ||
    toks.some((t) => t.t === 'id')
  if (!hasOp) return null
  try {
    return evaluateTokens(toks)
  } catch {
    return null
  }
}

export interface InstantAnswer {
  type: 'calc'
  input: string
  output: string
}

function fmtNumber(v: number): string {
  if (!Number.isFinite(v)) return ''
  const rounded = Math.round(v * 1e10) / 1e10
  return String(rounded)
}

/** Local instant answer for a query — currently the calculator. Pure. */
export function instantAnswer(q: string): InstantAnswer | null {
  let s = String(q || '').trim()
  if (!s) return null
  s = s.replace(/[?！?]+\s*$/, '').replace(/\s*=\s*$/, '').trim()
  s = s.replace(/^(what\s+is|what's|calculate|calc|compute|solve)\s+/i, '').trim()
  if (!s || !/\d/.test(s)) return null
  if (!/^[0-9\s+\-*/%^().a-z_,]+$/i.test(s)) return null
  const value = evaluateMath(s)
  if (value === null) return null
  return { type: 'calc', input: s, output: fmtNumber(value) }
}

/* --------------------------- omnibox suggestions --------------------------- */

/** Parse the DDG ac response — supports both list-shape and phrase-shape. */
export function parseAcResponse(body: string): string[] {
  try {
    const data = JSON.parse(String(body || ''))
    if (Array.isArray(data) && Array.isArray(data[1])) {
      return data[1].filter((s: unknown) => typeof s === 'string').slice(0, 8)
    }
    if (Array.isArray(data)) {
      return data
        .map((o: { phrase?: unknown }) => (o && typeof o.phrase === 'string' ? o.phrase : ''))
        .filter(Boolean)
        .slice(0, 8)
    }
    return []
  } catch {
    return []
  }
}

/** Remote suggestion feed (DDG autocomplete). Fails silent+empty. */
export async function searchSuggestions(q: string, timeoutMs = 1500): Promise<string[]> {
  const query = String(q || '').trim()
  if (query.length < 3) return []
  try {
    const res = await fetch('https://duckduckgo.com/ac/?q=' + encodeURIComponent(query) + '&type=list', {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Aether' },
      signal: AbortSignal.timeout(timeoutMs)
    })
    if (!res.ok) return []
    return parseAcResponse(await res.text())
  } catch {
    return []
  }
}

/** Merge local (history/bookmark titles) with remote suggestions. Local wins,
 *  case-insensitive dedupe, cap n. Pure. */
export function mergeSuggestions(local: string[], remote: string[], n = 8): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const s of [...(local || []), ...(remote || [])]) {
    const t = String(s || '').trim()
    if (!t) continue
    const key = t.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(t)
    if (out.length >= n) break
  }
  return out
}

/* ------------------------------ the pipeline ------------------------------- */

export interface SourceStat {
  source: string
  count: number
  ms: number
  error?: string
}

export interface SearchOutcome {
  aggregated: SearchResult[]
  stats: SourceStat[]
}

/**
 * Run every source in parallel through the injected fetcher, aggregate with
 * own ranking. Throws only when EVERY source failed (message lists each
 * failure, same contract as the old chain).
 */
export async function searchAll(
  q: string,
  fetchOne: (source: string) => Promise<SearchResult[]>,
  sources: string[],
  n = 12
): Promise<SearchOutcome> {
  const query = String(q || '').trim()
  if (!query) return { aggregated: [], stats: [] }

  const jobs = sources.map(async (source) => {
    const t0 = Date.now()
    try {
      const results = await fetchOne(source)
      return { source, results, ms: Date.now() - t0, error: undefined as string | undefined }
    } catch (err) {
      return {
        source,
        results: [] as SearchResult[],
        ms: Date.now() - t0,
        error: err instanceof Error ? err.message : String(err)
      }
    }
  })

  const settled = await Promise.all(jobs)
  const stats: SourceStat[] = settled.map(({ source, results, ms, error }) => ({
    source,
    count: results.length,
    ms,
    error
  }))

  const ok = settled.filter((s) => !s.error && s.results.length > 0)
  if (!ok.length) {
    const failures = stats.map((s) => `${s.source}: ${s.error || 'no results'}`)
    throw new Error(`all search engines failed (${failures.join(' | ')})`)
  }
  return {
    aggregated: aggregateRanked(
      ok.map(({ source, results }) => ({ source, results })),
      query,
      n
    ),
    stats
  }
}
