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
import { JsonStore } from './store'
import type { PermissionEntry } from '../shared/types'

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
      cb(saved.decision === 'allow')
      return
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
