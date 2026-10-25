/**
 * v1.5.0 — page security classification, shared by the toolbar's site-info
 * popover and internal pages. Pure and deterministic (unit-tested).
 */

export type SecurityKind = 'secure' | 'insecure' | 'internal' | 'file' | 'unknown'

export interface SecurityInfo {
  kind: SecurityKind
  host: string
  scheme: string
}

const INTERNAL_SCHEMES = /^(aether|about|chrome|devtools|data|blob|view-source|javascript)$/i

export function securityOf(url: string): SecurityInfo {
  let scheme = ''
  let host = ''
  if (url && typeof url === 'string') {
    try {
      const u = new URL(url)
      scheme = u.protocol.replace(/:$/, '')
      host = u.hostname
    } catch {
      scheme = ''
      host = ''
    }
  }
  if (/^https$/i.test(scheme)) return { kind: 'secure', host, scheme }
  if (/^http$/i.test(scheme)) return { kind: 'insecure', host, scheme }
  if (INTERNAL_SCHEMES.test(scheme)) return { kind: 'internal', host, scheme }
  if (/^file$/i.test(scheme)) return { kind: 'file', host, scheme }
  return { kind: 'unknown', host, scheme }
}

export const SECURITY_LABEL: Record<SecurityKind, string> = {
  secure: 'Connection is secure — traffic is encrypted (HTTPS)',
  insecure: 'Connection is NOT secure — this site uses plain HTTP',
  internal: 'Aether internal page — nothing leaves your device',
  file: 'Local file — opened from this device',
  unknown: 'Connection details unavailable'
}
