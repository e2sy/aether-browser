/**
 * PWA / web-app manifest policy (v2.3.0) — pure parsing shared by the
 * installer in main/apps.ts and the tests. Fetching happens in main; these
 * helpers only turn bytes into decisions.
 */

export interface ManifestIcon {
  src: string
  sizes?: string
  type?: string
  purpose?: string
}

export interface ParsedManifest {
  name: string
  shortName: string
  /** absolute start URL (resolved against the manifest URL) */
  startUrl: string
  display: string
  icons: ManifestIcon[]
}

const MAX_MANIFEST_BYTES = 2 * 1024 * 1024

/** Extract the <link rel="manifest"> href from page HTML; null when absent. */
export function parseManifestLink(html: string): string | null {
  const s = String(html || '').slice(0, MAX_MANIFEST_BYTES)
  const re = /<link\b[^>]*>/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(s))) {
    const tag = m[0]
    if (!/rel\s*=\s*["']?manifest/i.test(tag)) continue
    const href = /href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(tag)
    const val = href ? href[1] || href[2] || href[3] || '' : ''
    if (val) return val
  }
  return null
}

/** Resolve a possibly-relative URL against a base; null when it throws. */
export function resolveUrl(base: string, rel: string): string | null {
  try {
    return new URL(String(rel || ''), String(base || '')).toString()
  } catch {
    return null
  }
}

/**
 * Parse a webmanifest body. Tolerates junk: non-JSON → null, missing name →
 * host-based fallback done by the caller. start_url is resolved against the
 * manifest URL (spec behavior) and must stay http(s).
 */
export function parseManifestJson(raw: string, manifestUrl: string): ParsedManifest | null {
  let doc: unknown
  try {
    doc = JSON.parse(String(raw || '').slice(0, MAX_MANIFEST_BYTES))
  } catch {
    return null
  }
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return null
  const m = doc as Record<string, unknown>
  const name = typeof m['name'] === 'string' && m['name'].trim() ? m['name'].trim() : ''
  const shortName = typeof m['short_name'] === 'string' && m['short_name'].trim() ? m['short_name'].trim() : name
  const startRel = typeof m['start_url'] === 'string' ? m['start_url'] : '.'
  const startUrl = resolveUrl(manifestUrl, startRel)
  if (!startUrl || !/^https?:/i.test(startUrl)) return null
  const display = typeof m['display'] === 'string' ? m['display'] : 'standalone'
  let icons: ManifestIcon[] = []
  if (Array.isArray(m['icons'])) {
    icons = m['icons']
      .filter((i) => i && typeof i === 'object' && typeof (i as ManifestIcon).src === 'string')
      .map((i) => {
        const ic = i as ManifestIcon
        return { src: ic.src, sizes: typeof ic.sizes === 'string' ? ic.sizes : '', type: typeof ic.type === 'string' ? ic.type : '', purpose: typeof ic.purpose === 'string' ? ic.purpose : '' }
      })
      .slice(0, 24)
  }
  return { name, shortName, startUrl, display, icons }
}

/** Parse one `sizes` attribute ("192x192 512x512" / "any") into px numbers. */
export function parseIconSizes(sizes: string): number[] {
  const out: number[] = []
  for (const part of String(sizes || '').split(/\s+/)) {
    const m = /^(\d+)x(\d+)$/i.exec(part)
    if (m) out.push(Math.min(Number(m[1]), Number(m[2])))
  }
  return out
}

/**
 * Pick the best icon: raster (png/jpeg/webp) beats svg, biggest declared
 * size ≤ 512 wins, anything with no parsable size ranks lowest (but is kept
 * as a last resort). Returns the icon or null when the list is empty.
 */
export function pickIcon(icons: ManifestIcon[]): ManifestIcon | null {
  const list = Array.isArray(icons) ? icons.filter((i) => i && i.src) : []
  if (!list.length) return null
  const isRaster = (i: ManifestIcon): boolean => /png|jpe?g|webp/i.test(`${i.type || ''} ${i.src}`)
  const scored = list.map((i) => {
    const sizes = parseIconSizes(i.sizes || '')
    const big = sizes.length ? Math.max(...sizes) : 0
    let score = big
    if (score > 512) score = 512 - (score - 512) * 0.1 // oversized still usable but not preferred
    if (isRaster(i)) score += 1000
    if (/maskable/i.test(i.purpose || '')) score -= 200 // cropped circles lose artwork
    return { i, score }
  })
  scored.sort((a, b) => b.score - a.score)
  return scored[0].i
}

/** Deterministic app id from the start URL: host + first path slug. */
export function slugAppId(url: string): string {
  let host = 'app'
  let pathPart = ''
  try {
    const u = new URL(String(url || ''))
    host = u.hostname.replace(/^www\./, '').toLowerCase() || 'app'
    pathPart = u.pathname
  } catch {
    /* keep defaults */
  }
  const pathSlug =
    pathPart
      .split('/')
      .filter(Boolean)
      .map((p) => p.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, ''))
      .filter(Boolean)
      .slice(0, 2)
      .join('-') || ''
  const id = pathSlug ? `${host}-${pathSlug}` : host
  return id.slice(0, 96).replace(/[^a-z0-9._-]/gi, '') || 'app'
}

/** Parse `--aether-app=<id>` out of a command line (boot / second-instance). */
export function parseAppArg(argv: string[]): string | null {
  const list = Array.isArray(argv) ? argv : []
  const m = list.find((a) => /^--aether-app=[A-Za-z0-9._-]+$/.test(String(a || '')))
  return m ? String(m).split('=')[1] : null
}
