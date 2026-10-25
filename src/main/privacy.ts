/**
 * Privacy fortress (Master Plan Phase 3 — items #58, #60, #61, #63, #68).
 *
 * Pure policy lives here (unit-tested in test-v184.mjs); the runtime wiring
 * (webRequest interceptors, session clearing) is installed at boot.
 *
 *   • #58 query-param scrubber — strips utm_…, gclid, fbclid from top-frame
 *     navigations (redirect, so the address bar shows the clean URL)
 *   • #60 HTTPS-only — http top-frame navigations are upgraded to https;
 *     hosts the user exempts keep working; the upgrade never loops
 *   • #63 clear-data — option builder for history/cache/cookies/site data
 *     across time ranges
 *   • #68 referrer tightening — cross-origin requests send origin-only
 *     referrers (strict-origin-when-cross-origin equivalent)
 */
import { session, shell } from 'electron'

// ---------- #58 query-param scrubber ----------

/** Tracking params we strip. Keep this list exact-match or prefix — no regex on values. */
export const TRACKING_PARAMS: readonly string[] = Object.freeze([
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'utm_id', 'utm_name',
  'utm_cid', 'utm_reader', 'utm_social', 'utm_brand',
  'gclid', 'gclsrc', 'dclid', 'gbraid', 'wbraid',
  'fbclid', 'fb_action_ids', 'fb_action_types', 'fb_ref',
  'msclkid', 'mc_eid', 'mc_cid',
  'igshid', 'igsh', 'si', // instagram / shared-link trackers
  'twclid', 'ttclid', 'li_fat_id', '_hsenc', '_hsmi', 'vero_id', 'wickedid', 'hsa_cam',
  'yclid', 's_kwcid', 'elqTrackId', 'otc', 'oly_anon_id', 'oly_enc_id', 'rb_clickid',
  'mib_extid', 'irclickid', 'ireid', 'sr_id', 'vbref'
])

/** Pure: strip known tracking params from a URL. Returns null when unchanged. */
export function stripTrackingParams(rawUrl: string): string | null {
  const u = String(rawUrl || '').trim()
  if (!/^https?:\/\//i.test(u)) return null
  let parsed: URL
  try {
    parsed = new URL(u)
  } catch {
    return null
  }
  if (!parsed.search) return null
  const keep: string[] = []
  let removed = 0
  for (const [k, v] of parsed.searchParams.entries()) {
    const kl = k.toLowerCase()
    const isTracker = TRACKING_PARAMS.includes(kl) || kl.startsWith('utm_')
    if (isTracker) removed++
    else keep.push(`${k}=${v}`)
  }
  if (removed === 0) return null
  const qs = keep.length ? `?${keep.join('&')}` : ''
  return `${parsed.origin}${parsed.pathname}${qs}${parsed.hash}`
}

// ---------- #60 HTTPS-only ----------

/** Pure: loopback / link-local hosts never upgrade (local dev servers break). */
export function isLocalHost(host: string): boolean {
  const h = String(host || '').toLowerCase().replace(/^www\./, '')
  return (
    h === 'localhost' || h === '127.0.0.1' || h === '[::1]' || h === '::1' ||
    h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.home.arpa') ||
    /^192\.168\./.test(h) || /^10\./.test(h) || /^172\.(1[6-9]|2\d|3[01])\./.test(h)
  )
}

/** Pure: should this http URL be upgraded? (never loop: already-https → null) */
export function httpsUpgradeTarget(rawUrl: string, exemptHosts: string[], upgradedThisUrl: Set<string>): string | null {
  const u = String(rawUrl || '').trim()
  if (!/^http:\/\//i.test(u)) return null
  let host = ''
  try {
    host = new URL(u).hostname.replace(/^www\./, '')
  } catch {
    return null
  }
  if (isLocalHost(host)) return null
  if (exemptHosts.includes(host)) return null
  const key = u.toLowerCase()
  if (upgradedThisUrl.has(key)) return null // we already tried; a downgrade came back
  upgradedThisUrl.add(key)
  return 'https://' + u.slice(7)
}

// ---------- #63 clear-data ----------

export type ClearRange = '1h' | '24h' | '7d' | '4w' | 'all'
export type ClearKind = 'history' | 'cookies' | 'cache' | 'siteData'

const RANGE_MS: Record<ClearRange, number> = {
  '1h': 3600_000,
  '24h': 86_400_000,
  '7d': 7 * 86_400_000,
  '4w': 28 * 86_400_000,
  all: 0
}

/**
 * Pure: how far back should HISTORY be cut? (storage APIs in current Electron
 * clear per-type without a time filter — ranges apply to history only.)
 */
export function historyCutoff(range: ClearRange, now = Date.now()): number {
  const ms = RANGE_MS[range] ?? 0
  return ms === 0 ? 0 : now - ms
}

/**
 * Pure: which Chromium storage types to clear for a selection.
 * (Electron 45 removed the `since` filter — storage clears are per-type.)
 */
export function storagesFor(kinds: ClearKind[]): Electron.ClearStorageDataOptions['storages'] | undefined {
  const out = new Set<'cookies' | 'filesystem' | 'indexdb' | 'localstorage' | 'shadercache' | 'serviceworkers' | 'cachestorage'>()
  if (kinds.includes('cookies')) out.add('cookies')
  if (kinds.includes('siteData')) {
    for (const s of ['filesystem', 'indexdb', 'localstorage', 'serviceworkers', 'cachestorage'] as const) out.add(s)
  }
  return out.size ? [...out] : undefined
}

// ---------- #68 referrer tightening ----------

/**
 * Pure: tighten a request's Referer header — cross-origin requests send
 * origin-only referrers; same-origin passes through untouched.
 */
export function tightenReferrer(referer: string, targetUrl: string): string | null {
  if (!referer) return null
  try {
    const from = new URL(referer)
    const to = new URL(targetUrl)
    if (from.origin === to.origin) return null
    return from.origin + '/'
  } catch {
    return null
  }
}

// ---------- runtime wiring ----------

let httpsMemo = new Set<string>()

export interface PrivacySettings {
  paramScrubber: boolean
  httpsOnly: boolean
  httpsExemptHosts: string[]
  referrerTight: boolean
}

export function installPrivacy(policyOf: () => PrivacySettings): void {
  const ses = session.defaultSession
  const scrubTargets = new Set<string>()

  ses.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (details, callback) => {
    try {
      const p = policyOf()
      const isTopFrame = details.resourceType === 'mainFrame'

      // #58 — scrub tracking params on top-frame navigations
      if (p.paramScrubber && isTopFrame && /^https?:/i.test(details.url)) {
        const clean = stripTrackingParams(details.url)
        if (clean) {
          scrubTargets.add(clean.toLowerCase())
          void shell // no-op keep import shape
          callback({ redirectURL: clean })
          return
        }
      }

      // #60 — HTTPS-only upgrades (one attempt per URL: downgrades pass through)
      if (p.httpsOnly && isTopFrame) {
        const upgraded = httpsUpgradeTarget(details.url, p.httpsExemptHosts || [], httpsMemo)
        if (upgraded) {
          callback({ redirectURL: upgraded })
          return
        }
      }

      callback({})
    } catch {
      callback({})
    }
  })

  // #68 — origin-only cross-origin referrers
  ses.webRequest.onBeforeSendHeaders({ urls: ['http://*/*', 'https://*/*'] }, (details, callback) => {
    try {
      const p = policyOf()
      if (!p.referrerTight) {
        callback({ requestHeaders: details.requestHeaders })
        return
      }
      const referer = details.requestHeaders['Referer'] || details.requestHeaders['referer']
      if (referer) {
        const tightened = tightenReferrer(String(referer), details.url)
        if (tightened) {
          details.requestHeaders['Referer'] = tightened
        }
      }
      callback({ requestHeaders: details.requestHeaders })
    } catch {
      callback({ requestHeaders: details.requestHeaders })
    }
  })
}

/** Boot hook: reset the one-upgrade-per-URL memo (fresh session, fresh tries). */
export function resetHttpsMemo(): void {
  httpsMemo = new Set<string>()
}
