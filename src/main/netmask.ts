/**
 * IP masquerade — runtime (v2.7.0 build 21).
 *
 * Applies the effective proxy (global mode or the container's own override)
 * to real Electron sessions, forces the WebRTC leak shield, and powers the
 * "Check my IP" verifier. Pure decisions live in shared/netmask.ts.
 *
 * A note on honesty: no browser can rewrite its source IP. What this does is
 * route traffic through a proxy/Tor and plug the WebRTC leak that would
 * otherwise reveal the real interface address — the same thing Brave/Firefox
 * do, which is what "IP spoofing" means in a real browser.
 */
import { session, webContents } from 'electron'
import {
  electronProxyString,
  maskIpForLog,
  normalizeProxyMode,
  parseCloudflareTrace,
  validateProxyUrl,
  webrtcPolicy,
  type ProxyMode
} from '../shared/netmask'
import { isValidContainerId, partitionFor } from '../shared/containers'
import { mergedSettings, settings } from './store'

/**
 * WebRTC leak shield — Electron 45 exposes the handling policy per
 * webContents (not per session). Applied on every tab view at spawn and
 * re-swept whenever the proxy posture changes.
 */
export function applyWebRTCShield(wc: Electron.WebContents): void {
  try {
    if (wc.isDestroyed()) return
    const s = mergedSettings()
    const proxied = normalizeProxyMode(s.proxyMode) !== 'off'
    wc.setWebRTCIPHandlingPolicy(webrtcPolicy(proxied, s.webrtcLeakShield !== false))
  } catch {
    /* policy is best-effort */
  }
}

/** Re-apply the shield to every live webContents (devtools etc. included). */
export function sweepWebRTCShield(): void {
  for (const wc of webContents.getAllWebContents()) applyWebRTCShield(wc)
}

/**
 * One session's network posture: proxy rules (the WebRTC policy is per-view —
 * see applyWebRTCShield). proxyUrl === null → direct. Never throws.
 */
export async function applySessionProxy(ses: Electron.Session, proxyUrl: string | null): Promise<boolean> {
  try {
    if (proxyUrl) {
      const rules = electronProxyString(proxyUrl)
      if (!rules) {
        console.warn('[netmask] invalid proxy ignored:', maskIpForLog(proxyUrl))
        await ses.setProxy({ mode: 'direct' })
        return false
      }
      await ses.setProxy({ mode: 'fixed_servers', proxyRules: rules })
      console.log('[netmask] proxy active:', rules.replace(/\/\/[^@/]+@/, '//•••@'))
    } else {
      await ses.setProxy({ mode: 'direct' })
    }
  } catch (err) {
    console.error('[netmask] setProxy failed:', err instanceof Error ? err.message : err)
    return false
  }
  return Boolean(proxyUrl)
}

/**
 * The proxy a container session should use right now:
 * container override > global mode (tor → fixed, manual → validated url).
 */
export function effectiveProxyForContainer(c: { proxyUrl: string }): string | null {
  const s = mergedSettings()
  const mode: ProxyMode = normalizeProxyMode(s.proxyMode)
  const own = validateProxyUrl(c.proxyUrl || '')
  if (own) return own
  if (mode === 'tor') return 'socks5://127.0.0.1:9050'
  if (mode === 'manual') return validateProxyUrl(s.proxyUrl || '')
  return null
}

/** Re-apply the global posture to default + private sessions (and containers). */
export async function applyProxyEverywhere(): Promise<void> {
  const s = mergedSettings()
  const mode = normalizeProxyMode(s.proxyMode)
  const globalProxy =
    mode === 'tor' ? 'socks5://127.0.0.1:9050' : mode === 'manual' ? validateProxyUrl(s.proxyUrl || '') : null
  const targets: Electron.Session[] = [session.defaultSession]
  try {
    targets.push(session.fromPartition('aether-private'))
  } catch {
    /* private session is best-effort */
  }
  for (const ses of targets) void applySessionProxy(ses, globalProxy)
  // the WebRTC policy is per-view — refresh every live one
  sweepWebRTCShield()
}

/**
 * "Check my IP" — plain-text Cloudflare trace fetched THROUGH the session in
 * question, so it reports what the exit really sees. Only runs on explicit
 * user action. Logs stay masked (maskIpForLog).
 */
export async function checkIp(
  target: 'default' | string
): Promise<{ ok: boolean; ip: string; country: string; via: string; error?: string }> {
  let ses: Electron.Session | null = null
  let via = 'direct connection'
  try {
    if (target === 'default') {
      ses = session.defaultSession
    } else if (isValidContainerId(target)) {
      ses = session.fromPartition(partitionFor(target), { cache: true })
    }
  } catch (err) {
    return { ok: false, ip: '', country: '', via, error: err instanceof Error ? err.message : 'session unavailable' }
  }
  if (!ses) return { ok: false, ip: '', country: '', via, error: 'unknown session' }

  try {
    const s = mergedSettings()
    const mode = normalizeProxyMode(s.proxyMode)
    via = mode === 'tor' ? 'Tor (socks5://127.0.0.1:9050)' : mode === 'manual' ? 'manual proxy' : 'direct connection'
  } catch {
    /* label only */
  }

  try {
    const res = await ses.fetch('https://www.cloudflare.com/cdn-cgi/trace', {
      signal: AbortSignal.timeout(8000)
    })
    const text = await res.text()
    const parsed = parseCloudflareTrace(text)
    if (!parsed) return { ok: false, ip: '', country: '', via, error: 'unexpected trace response' }
    console.log('[netmask] check-ip via', via, '→', maskIpForLog(parsed.ip), parsed.country)
    return { ok: true, ip: parsed.ip, country: parsed.country, via }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.warn('[netmask] check-ip failed:', msg)
    return {
      ok: false,
      ip: '',
      country: '',
      via,
      error: /timeout|aborted/i.test(msg) ? 'Timed out — is the proxy/Tor reachable?' : msg
    }
  }
}

/** Settings-page view model (URLs redacted). */
export function netmaskStatus(): { mode: ProxyMode; proxyUrl: string; webrtcShield: boolean } {
  const s = mergedSettings()
  return {
    mode: normalizeProxyMode(s.proxyMode),
    proxyUrl: typeof s.proxyUrl === 'string' ? s.proxyUrl : '',
    webrtcShield: s.webrtcLeakShield !== false
  }
}

/** Persist a proxy patch from IPC; returns an error string when rejected. */
export function setProxySettings(patch: { mode?: unknown; proxyUrl?: unknown }): { ok: boolean; error?: string } {
  const s = mergedSettings()
  const next: Partial<typeof s> = {}
  if (patch.mode !== undefined) {
    const mode = normalizeProxyMode(patch.mode)
    if (mode !== patch.mode && patch.mode !== 'off') return { ok: false, error: 'mode must be off | manual | tor' }
    next.proxyMode = mode
  }
  if (patch.proxyUrl !== undefined) {
    const raw = String(patch.proxyUrl ?? '').trim()
    if (raw === '') {
      next.proxyUrl = ''
    } else {
      const v = validateProxyUrl(raw)
      if (!v) return { ok: false, error: 'Proxy URL must be http://host:port, https://host:port or socks5://host:port' }
      next.proxyUrl = v
    }
  }
  settings.data = { ...s, ...next } as typeof s
  settings.save()
  return { ok: true }
}
