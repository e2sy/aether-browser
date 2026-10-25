/**
 * Per-site permissions with a Chrome-style in-browser prompt and remembered
 * decisions (stored locally in permissions.json, manageable in Settings).
 *
 * Auto-allowed (harmless): fullscreen, clipboard-sanitized-write, pointerLock, mediaKeySystem.
 * Prompted + remembered: media (camera/mic), geolocation, notifications, midi,
 *                        speaker-selection, display-capture.
 * Everything else: denied (safe default).
 */
import { session } from 'electron'
import { randomUUID } from 'node:crypto'
import { JsonStore, mergedSettings } from './store'
import type { PermissionEntry } from '../shared/types'

/** Default re-prompt cadence for remembered grants (Master Plan #13).
 *  0 disables expiry. Overridable in Settings → Privacy. */
export const DEFAULT_GRANT_TTL_DAYS = 180

const DAY_MS = 86_400_000

/** Pure: has a remembered grant gone stale enough to re-ask? */
export function isGrantExpired(entry: PermissionEntry, now: number, ttlDays: number): boolean {
  if (!Number.isFinite(ttlDays) || ttlDays <= 0) return false
  if (typeof entry?.ts !== 'number') return true
  return now - entry.ts > ttlDays * DAY_MS
}

/** Pure: drop stale grants from a permissions map, returns [cleaned, count]. */
export function sweepGrantData(
  data: Record<string, PermissionEntry>,
  now: number,
  ttlDays: number
): [Record<string, PermissionEntry>, number] {
  const out: Record<string, PermissionEntry> = {}
  let n = 0
  for (const [k, v] of Object.entries(data)) {
    if (isGrantExpired(v, now, ttlDays)) {
      n++
      continue
    }
    out[k] = v
  }
  return [out, n]
}

function grantTtlDays(): number {
  const s = mergedSettings() as { grantTtlDays?: number }
  const v = Number(s.grantTtlDays)
  return Number.isFinite(v) ? v : DEFAULT_GRANT_TTL_DAYS
}

/** Drop all stale grants; returns how many were removed. */
export function sweepExpiredGrants(now = Date.now()): number {
  const [cleaned, n] = sweepGrantData(store.data, now, grantTtlDays())
  if (n > 0) {
    store.data = cleaned
    store.save()
  }
  return n
}

const store = new JsonStore<Record<string, PermissionEntry>>('permissions.json', {})

const AUTO_ALLOW = new Set(['fullscreen', 'clipboard-sanitized-write', 'pointerLock', 'mediaKeySystem'])
const PROMPTED = new Set(['media', 'geolocation', 'notifications', 'midi', 'speaker-selection', 'display-capture'])

const PENDING_TTL_MS = 90_000

interface PendingRequest {
  origin: string
  permission: string
  resolve: (allow: boolean) => void
  timer: NodeJS.Timeout
}

const pending = new Map<string, PendingRequest>()

function keyOf(origin: string, permission: string): string {
  return `${origin}|${permission}`
}

function originOf(url: string): string {
  try {
    return new URL(url).origin
  } catch {
    return ''
  }
}

/** Install the permission handlers on the default session. Call once at boot. */
export function installPermissionHandlers(askChrome: (payload: { requestId: string; origin: string; permission: string }) => void): void {
  const ses = session.defaultSession

  ses.setPermissionRequestHandler((_wc, permission, cb, details) => {
    if (AUTO_ALLOW.has(permission)) {
      cb(true)
      return
    }
    if (!PROMPTED.has(permission)) {
      cb(false)
      return
    }
    const origin = originOf(details.requestingUrl || _wc?.getURL() || '')
    if (!origin || !/^https?:/.test(origin)) {
      cb(false)
      return
    }
    const saved = store.data[keyOf(origin, permission)]
    if (saved) {
      if (isGrantExpired(saved, Date.now(), grantTtlDays())) {
        // idle-grant expiry: forget the stale decision and re-prompt
        delete store.data[keyOf(origin, permission)]
        store.save()
      } else {
        cb(saved.decision === 'allow')
        return
      }
    }

    // interactive prompt via the chrome UI — first requester wins
    const existing = [...pending.values()].find((p) => p.origin === origin && p.permission === permission)
    if (existing) {
      cb(false)
      return
    }
    const requestId = randomUUID().replace(/-/g, '').slice(0, 10)
    const timer = setTimeout(() => {
      const p = pending.get(requestId)
      if (p) {
        pending.delete(requestId)
        p.resolve(false)
      }
    }, PENDING_TTL_MS)
    pending.set(requestId, {
      origin,
      permission,
      timer,
      resolve: (allow: boolean) => cb(allow)
    })
    askChrome({ requestId, origin, permission })
  })

  // synchronous feature-detection checks — only persisted allows read as available
  ses.setPermissionCheckHandler((_wc, permission, requestingOrigin) => {
    if (AUTO_ALLOW.has(permission)) return true
    const saved = store.data[keyOf(requestingOrigin, permission)]
    return saved ? saved.decision === 'allow' : false
  })
}

/** User answered the prompt. `remember` persists the decision for the site. */
export function respondPermission(requestId: string, allow: boolean, remember: boolean): void {
  const p = pending.get(requestId)
  if (!p) return
  clearTimeout(p.timer)
  pending.delete(requestId)
  if (remember) {
    store.data[keyOf(p.origin, p.permission)] = {
      origin: p.origin,
      permission: p.permission,
      decision: allow ? 'allow' : 'block',
      ts: Date.now()
    }
    store.save()
  }
  p.resolve(allow)
}

export function listPermissions(): PermissionEntry[] {
  return Object.values(store.data).sort((a, b) => b.ts - a.ts)
}

export function revokePermission(origin: string, permission: string): void {
  delete store.data[keyOf(origin, permission)]
  store.save()
}

export function clearPermissions(): void {
  store.data = {}
  store.save()
}

export function countPermissions(): number {
  return Object.keys(store.data).length
}

export function permissionLabel(permission: string): string {
  const labels: Record<string, string> = {
    media: 'camera & microphone',
    geolocation: 'your location',
    notifications: 'notifications',
    midi: 'MIDI devices',
    'speaker-selection': 'audio output device',
    'display-capture': 'screen capture'
  }
  return labels[permission] || permission
}
