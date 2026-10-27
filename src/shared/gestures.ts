/**
 * Mouse gestures (Master Plan Phase 6, Dolphin-style) — pure model + rules.
 *
 * A gesture is a right-button drag whose trail collapses into a sequence of
 * cardinal directions ('L' | 'R' | 'U' | 'D'). Two-gesture combos power the
 * reload actions. Everything here is pure so the main process (which owns the
 * actions) and the unit tests share ONE implementation:
 *
 *   • segments need GESTURE_THRESHOLD px of travel on one axis before a
 *     direction is recorded; the dominant axis wins (diagonals don't jitter)
 *   • sequences cap at MAX_GESTURE_LEN so scribbles can't become commands
 *   • the action map is total: unknown sequences return null (no-op)
 *
 * Mapping (matches popular gesture extensions / Dolphin):
 *   L = back · R = forward · U = new tab · D = close tab
 *   DU = reload · UD = reopen closed tab
 */
export type GestureDir = 'L' | 'R' | 'U' | 'D'
export type GestureAction = 'back' | 'forward' | 'newTab' | 'closeTab' | 'reload' | 'reopenClosed'

/** px of travel on one axis before a direction is recorded */
export const GESTURE_THRESHOLD = 30
/** longest sequence we recognize (scribble guard) */
export const MAX_GESTURE_LEN = 3

export const ACTION_FOR_SEQ: Readonly<Record<string, GestureAction>> = Object.freeze({
  L: 'back',
  R: 'forward',
  U: 'newTab',
  D: 'closeTab',
  DU: 'reload',
  UD: 'reopenClosed'
})

export function actionForSeq(seq: string): GestureAction | null {
  return Object.prototype.hasOwnProperty.call(ACTION_FOR_SEQ, seq) ? ACTION_FOR_SEQ[seq] : null
}

export interface GesturePoint {
  x: number
  y: number
}

/**
 * Pure: collapse a trail of points into a direction sequence.
 * Accepts anything; non-finite coordinates are ignored so a hostile or
 * half-broken payload can never poison the sequence.
 */
export function seqFromTrail(rawTrail: unknown): string {
  if (!Array.isArray(rawTrail)) return ''
  const trail: GesturePoint[] = []
  for (const p of rawTrail) {
    if (!p || typeof p !== 'object') continue
    const x = (p as { x?: unknown }).x
    const y = (p as { y?: unknown }).y
    if (typeof x !== 'number' || !Number.isFinite(x)) continue
    if (typeof y !== 'number' || !Number.isFinite(y)) continue
    trail.push({ x, y })
    if (trail.length >= 400) break // hard cap — enough for any real drag
  }
  if (trail.length < 2) return ''

  const dirs: GestureDir[] = []
  let ax = trail[0].x
  let ay = trail[0].y
  for (let i = 1; i < trail.length; i++) {
    const dx = trail[i].x - ax
    const dy = trail[i].y - ay
    if (Math.abs(dx) >= GESTURE_THRESHOLD || Math.abs(dy) >= GESTURE_THRESHOLD) {
      // dominant axis wins — the larger absolute delta decides the direction
      dirs.push(Math.abs(dx) >= Math.abs(dy) ? (dx > 0 ? 'R' : 'L') : dy > 0 ? 'D' : 'U')
      if (dirs.length >= MAX_GESTURE_LEN) return dirs.join('')
      ax = trail[i].x
      ay = trail[i].y
    }
  }
  return dirs.join('')
}

/** The exact payload the gesture preload sends over 'aether:gesture'. */
export interface GesturePayload {
  seq: string
  trail: GesturePoint[]
}

/** Pure: validate an incoming IPC payload (fail-closed). */
export function sanitizeGesturePayload(raw: unknown): GesturePayload | null {
  if (!raw || typeof raw !== 'object') return null
  const seq = seqFromTrail((raw as { trail?: unknown }).trail)
  if (!seq) return null
  const trail: GesturePoint[] = []
  const rawTrail = (raw as { trail?: unknown }).trail
  if (Array.isArray(rawTrail)) {
    for (const p of rawTrail) {
      if (!p || typeof p !== 'object') continue
      const x = (p as { x?: unknown }).x
      const y = (p as { y?: unknown }).y
      if (typeof x === 'number' && Number.isFinite(x) && typeof y === 'number' && Number.isFinite(y)) {
        trail.push({ x, y })
      }
      if (trail.length >= 400) break
    }
  }
  return { seq, trail }
}
