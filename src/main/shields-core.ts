/**
 * Shields core — PURE decision logic for the Brave-style blocking pipeline.
 * No electron imports: fully unit-testable (scripts/test-v120.mjs).
 *
 * v1.2.0 upgrades the old "cancel EasyList matches" adblocker into a real
 * shields pipeline: network filtering + cosmetic filtering + scriptlets +
 * CSP directives, all gated PER SITE with a persisted off-list, plus
 * blocked-request counters (per site + total) surfaced in the toolbar.
 */

export interface ShieldsPolicy {
  /** master switch (Settings → Block ads & trackers) */
  globalEnabled: boolean
  /** hosts where the user turned shields OFF for this site (already normalized) */
  offHosts: readonly string[]
}

export interface CosmeticsResult {
  active: boolean
  styles: string
  scripts: string[]
  /** extended (pro) selectors — engine-specific AST objects, passed through opaquely */
  extended: unknown[]
}

export const EMPTY_COSMETICS: CosmeticsResult = { active: false, styles: '', scripts: [], extended: [] }

/** Hosts are compared lowercase, without a leading "www." — Brave-style site key. */
export function normalizeHost(host: string | null | undefined): string {
  if (!host) return ''
  let h = String(host).trim().toLowerCase()
  if (h.endsWith('.')) h = h.slice(0, -1)
  if (h.startsWith('www.')) h = h.slice(4)
  return h
}

/** hostname of a URL; '' when the URL has none (data:, aether:, about:…). */
export function hostFromUrl(url: string | null | undefined): string {
  if (!url) return ''
  try {
    return normalizeHost(new URL(url).hostname)
  } catch {
    return ''
  }
}

/** Where blocked requests are counted when the page has no hostname (data: …). */
export function siteKeyFor(host: string): string {
  return host || '(local)'
}

/** True when shields should filter requests coming from `pageUrl`. */
export function shouldShieldFor(pageUrl: string, policy: ShieldsPolicy): boolean {
  if (!policy.globalEnabled) return false
  const host = hostFromUrl(pageUrl)
  if (!host) return true
  // defensive normalization: stored entries may still carry www./case
  const off = policy.offHosts.map((h) => normalizeHost(h))
  return !off.includes(host)
}

/**
 * Per-site toggle applies to real sites only — you can't turn shields off for
 * a data: URL or an internal page (there's nothing meaningful to unblock).
 */
export function canToggleSiteFor(url: string): boolean {
  return /^https?:\/\//i.test(url) && hostFromUrl(url) !== ''
}

/* ---------------- stats ---------------- */

export interface AdblockStats {
  total: number
  perHost: Record<string, number>
}

export const EMPTY_STATS: AdblockStats = { total: 0, perHost: {} }

/** Keep the per-host map bounded: the N most-blocked hosts. */
export const MAX_TRACKED_HOSTS = 500

export function recordBlocked(stats: AdblockStats, host: string): AdblockStats {
  const key = siteKeyFor(normalizeHost(host))
  const perHost = { ...stats.perHost, [key]: (stats.perHost[key] || 0) + 1 }
  return { total: stats.total + 1, perHost: pruneHosts(perHost) }
}

export function pruneHosts(perHost: Record<string, number>): Record<string, number> {
  const keys = Object.keys(perHost)
  if (keys.length <= MAX_TRACKED_HOSTS) return perHost
  return keys
    .sort((a, b) => perHost[b] - perHost[a])
    .slice(0, MAX_TRACKED_HOSTS)
    .reduce<Record<string, number>>((acc, k) => {
      acc[k] = perHost[k]
      return acc
    }, {})
}

/* ---------------- filter lists ---------------- */

export interface FilterPreset {
  id: string
  name: string
  url: string
}

/** Curated extra lists (on top of the built-in EasyList + EasyPrivacy engine). */
export const FILTER_PRESETS: readonly FilterPreset[] = [
  {
    id: 'ublock-ads',
    name: 'uBlock filters – Ads',
    url: 'https://raw.githubusercontent.com/uBlockOrigin/uAssets/master/filters/filters.txt'
  },
  {
    id: 'ublock-privacy',
    name: 'uBlock filters – Privacy',
    url: 'https://raw.githubusercontent.com/uBlockOrigin/uAssets/master/filters/privacy.txt'
  },
  {
    id: 'ublock-badware',
    name: 'uBlock filters – Badware risks',
    url: 'https://raw.githubusercontent.com/uBlockOrigin/uAssets/master/filters/badware.txt'
  },
  {
    // v2.7.0 — cookie-consent popups, newsletter nag screens, social overlays
    id: 'ublock-annoyances',
    name: 'uBlock filters – Annoyances (cookie banners, popups)',
    url: 'https://raw.githubusercontent.com/uBlockOrigin/uAssets/master/filters/annoyances.txt'
  },
  {
    // v2.7.0 — dedicated cookie-notice lists (Brave/Dolphin-style "no cookie walls")
    id: 'easylist-cookie',
    name: 'EasyList Cookie – consent popups',
    url: 'https://www.easylist.to/easylistcookie.txt'
  }
]

/**
 * Resolve the effective list URLs from preset ids + user-supplied URLs.
 * Dedupes, keeps order (presets first), drops anything that isn't an
 * http(s) URL or an unknown preset id.
 */
export function resolveListUrls(
  presetIds: readonly string[],
  customUrls: readonly string[],
  presets: readonly FilterPreset[] = FILTER_PRESETS
): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  const push = (url: string): void => {
    const u = url.trim()
    if (!u || seen.has(u)) return
    if (!/^https:\/\//i.test(u)) return
    seen.add(u)
    out.push(u)
  }
  for (const id of presetIds) {
    const preset = presets.find((p) => p.id === id)
    if (preset) push(preset.url)
  }
  for (const url of customUrls) push(url)
  return out
}

/** Merge engines' cosmetic outputs (main engine + custom list engines). */
export function mergeCosmetics(parts: readonly CosmeticsResult[]): CosmeticsResult {
  const live = parts.filter((p) => p.active)
  if (!live.length) return EMPTY_COSMETICS
  return {
    active: true,
    styles: live.map((p) => p.styles).filter(Boolean).join('\n'),
    scripts: live.flatMap((p) => p.scripts),
    extended: live.flatMap((p) => p.extended)
  }
}
