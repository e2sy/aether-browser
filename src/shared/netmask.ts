/**
 * IP masquerade (v2.7.0 build 21) — pure policy for the honest "IP spoofer".
 *
 * A browser cannot literally rewrite its source IP; what real browsers do is
 * ROUTE traffic through a proxy (or Tor) and plug the leaks that would
 * otherwise reveal the real address. This module is the decision layer:
 *
 *   - validateProxyUrl   — strict http/https/socks5 URL validation
 *   - electronProxyString — Chromium session.setProxy proxyRules syntax
 *   - effectiveProxyFor  — per-container override > Tor preset > manual > off
 *   - webrtcPolicy       — 'disable_non_proxied_udp' whenever masking is on
 *                          (WebRTC is the #1 real-IP leak behind proxies)
 *   - parseCloudflareTrace — the "Check my IP" verifier (plain-text trace)
 *   - maskIpForLog       — never write full IPs to logs
 *
 * Pure: no electron imports — fully unit-tested in scripts/test-v270.mjs.
 */

export type ProxyMode = 'off' | 'manual' | 'tor'

export const TOR_PROXY = 'socks5://127.0.0.1:9050'

export const PROXY_MODES: readonly ProxyMode[] = Object.freeze(['off', 'manual', 'tor'])

export function normalizeProxyMode(raw: unknown): ProxyMode {
  return PROXY_MODES.includes(raw as ProxyMode) ? (raw as ProxyMode) : 'off'
}

const PORT_RE = /^\d{1,5}$/
function validPort(p: string): boolean {
  if (!PORT_RE.test(p)) return false
  const n = Number(p)
  return n >= 1 && n <= 65535
}

/** Hostname (no scheme, no port) — IPv4, IPv6 literal, or DNS name. */
function validHost(h: string): boolean {
  if (!h) return false
  if (/^\[[0-9a-fA-F:]+\]$/.test(h)) return true // [::1] form
  if (/^[0-9a-fA-F:]+:[0-9a-fA-F:]*$/.test(h) && h.includes(':')) return true // bare ::1
  return /^[A-Za-z0-9](?:[A-Za-z0-9\-.]*[A-Za-z0-9])?$/.test(h) && h.length <= 253
}

/**
 * Validate + normalize a user-supplied proxy URL.
 *   http://host:port   https://host:port   socks5://host:port
 * Default ports are filled in (80/443/1080) so users can omit them.
 * Returns the NORMALIZED url, or null when invalid (fail-closed).
 */
export function validateProxyUrl(raw: unknown): string | null {
  const u = String(raw ?? '').trim()
  if (!u) return null
  const m = /^(https?|socks5):\/\/([^/?#]+)$/i.exec(u)
  if (!m) return null
  const scheme = m[1].toLowerCase()
  const hostport = m[2]
  // strip userinfo if someone pasted it (we do not forward credentials here)
  const at = hostport.lastIndexOf('@')
  const hp = at >= 0 ? hostport.slice(at + 1) : hostport
  const isV6Literal = hp.startsWith('[')
  let host = ''
  let port = ''
  if (isV6Literal) {
    const close = hp.indexOf(']')
    if (close < 0) return null
    host = hp.slice(0, close + 1)
    port = hp.slice(close + 1).replace(/^:/, '')
  } else {
    const colon = hp.lastIndexOf(':')
    if (colon < 0) {
      host = hp
    } else {
      host = hp.slice(0, colon)
      port = hp.slice(colon + 1)
    }
  }
  if (!validHost(host)) return null
  const defaults: Record<string, string> = { http: '80', https: '443', socks5: '1080' }
  if (!port) port = defaults[scheme]
  if (!validPort(port)) return null
  return `${scheme}://${host}:${port}`
}

/** Chromium proxyRules for session.setProxy (see netmask.ts applySessionProxy). */
export function electronProxyString(normalizedUrl: string): string | null {
  const v = validateProxyUrl(normalizedUrl)
  if (!v) return null
  const m = /^(https?|socks5):\/\/(.+)$/.exec(v)
  if (!m) return null
  if (m[1] === 'socks5') return `socks5://${m[2]}` // Chromium's SOCKS form
  if (m[1] === 'http') return m[2] // bare host:port = HTTP proxy for everything
  return `https=${m[2]}` // explicit https proxy needs the scheme key
}

/**
 * Which proxy should a session use?
 * Precedence: container override > Tor preset > manual global > none.
 */
export function effectiveProxyFor(
  containerProxyUrl: string | null | undefined,
  mode: ProxyMode,
  manualUrl: string | null | undefined
): string | null {
  const own = validateProxyUrl(containerProxyUrl || '')
  if (own) return own
  if (mode === 'tor') return TOR_PROXY
  if (mode === 'manual') return validateProxyUrl(manualUrl || '')
  return null
}

/**
 * WebRTC handling policy. When any masking is active, non-proxied UDP is
 * disabled so STUN/mDNS cannot disclose the real interface address.
 */
export function webrtcPolicy(proxyActive: boolean, leakShieldOn: boolean): 'default' | 'disable_non_proxied_udp' {
  return proxyActive || leakShieldOn ? 'disable_non_proxied_udp' : 'default'
}

/**
 * Parse Cloudflare's /cdn-cgi/trace plain-text response (the "Check my IP"
 * verifier). Only http(s) fetches ever reach it, and only on user action.
 */
export function parseCloudflareTrace(text: string): { ip: string; country: string } | null {
  if (typeof text !== 'string' || text.length > 8192) return null
  const map = new Map<string, string>()
  for (const line of text.split('\n')) {
    const eq = line.indexOf('=')
    if (eq <= 0) continue
    map.set(line.slice(0, eq).trim(), line.slice(eq + 1).trim())
  }
  const ip = map.get('ip') || ''
  const country = map.get('loc') || ''
  if (!ip || ip.length > 45) return null
  // loose sanity: digits/hex/colons/dots only — never echo arbitrary text
  if (!/^[0-9a-fA-F.:]+$/.test(ip)) return null
  if (!/^[A-Za-z]{2}$/.test(country)) return null
  return { ip, country: country.toUpperCase() }
}

/** IPv4 keeps the first two octets; IPv6 keeps the first three groups. */
export function maskIpForLog(ip: string): string {
  const s = String(ip || '')
  if (s.includes(':')) {
    const groups = s.split(':')
    return groups.slice(0, 3).join(':').replace(/:$/, '') + '::…'
  }
  const parts = s.split('.')
  if (parts.length === 4) return `${parts[0]}.${parts[1]}.x.x`
  return '<ip>'
}

/** Redact credentials someone may have pasted into a proxy URL. */
export function redactProxyUrl(normalizedUrl: string): string {
  const v = validateProxyUrl(normalizedUrl)
  if (!v) return '(invalid)'
  return v.replace(/^(https?|socks5):\/\/[^@/]+@/i, '$1://•••@')
}
