/**
 * Aether Containers (v2.7.0 build 21) — Firefox-style isolated tab containers.
 *
 * A container is a named, colored, ISOLATED session: its tabs get their own
 * cookie jar, localStorage, cache and service workers (Electron persist:
 * partition), so the same site can be logged in as different identities at
 * the same time. Complements multi-profiles (whole-window isolation, build
 * 18) with per-tab isolation inside one window.
 *
 * PURE module: shapes, validation and naming only — no electron imports.
 * The registry + session wiring lives in main/containers.ts.
 */

export interface ContainerDef {
  /** stable id, /^[a-z0-9]{4,24}$/ — used in the session partition name */
  id: string
  /** 1-32 chars after trim */
  name: string
  /** key into CONTAINER_COLORS */
  color: string
  /** '' = inherit the global proxy setting; else a validated proxy URL */
  proxyUrl: string
  /** '' = no timezone spoofing; else an IANA zone name (via farble preload) */
  timezone: string
  /** built-ins are pre-seeded on first run (and may still be edited/deleted) */
  builtin: boolean
  ts: number
}

export interface ContainerRegistry {
  containers: ContainerDef[]
}

export const CONTAINER_COLORS: Record<string, string> = {
  blue: '#3b82f6',
  teal: '#14b8a6',
  green: '#22c55e',
  yellow: '#eab308',
  orange: '#f97316',
  red: '#ef4444',
  pink: '#ec4899',
  purple: '#a855f7',
  gray: '#6b7280'
}

export const DEFAULT_COLOR = 'gray'

/** Pre-seeded on first boot — the identities people actually keep. */
export function seedContainers(): ContainerDef[] {
  const now = Date.now()
  const mk = (name: string, color: string): ContainerDef => ({
    id: newContainerId(),
    name,
    color,
    proxyUrl: '',
    timezone: '',
    builtin: true,
    ts: now
  })
  return [mk('Work', 'blue'), mk('Banking', 'green'), mk('Shopping', 'orange'), mk('Social', 'purple'), mk('Anonymous', 'gray')]
}

const ID_RE = /^[a-z0-9]{4,24}$/

export function isValidContainerId(id: unknown): boolean {
  return typeof id === 'string' && ID_RE.test(id)
}

let idCounter = 0
/** Collision-resistant container id (no crypto dependency in pure code). */
export function newContainerId(): string {
  idCounter = (idCounter + 1) % 1296
  const rand = Math.random().toString(36).slice(2, 8)
  return ('c' + Date.now().toString(36) + rand + idCounter.toString(36)).slice(0, 24).replace(/[^a-z0-9]/g, '0')
}

export function sanitizeContainerName(raw: unknown): string {
  const s = String(raw ?? '').trim().replace(/\s+/g, ' ')
  if (!s) return ''
  return s.slice(0, 32)
}

export function normalizeColor(raw: unknown): string {
  return typeof raw === 'string' && CONTAINER_COLORS[raw] ? raw : DEFAULT_COLOR
}

const TZ_RE = /^[A-Za-z_]+\/[A-Za-z_0-9+\-]+$/
/** Accepts IANA-ish zones (Area/City) and a few fixed ones; '' clears. */
export function normalizeTimezone(raw: unknown): string {
  const s = String(raw ?? '').trim()
  if (!s) return ''
  if (/^(UTC|UCT|GMT)$/i.test(s)) return 'UTC'
  if (!TZ_RE.test(s)) return ''
  return s
}

/** Electron partition for a container — the actual isolation boundary. */
export function partitionFor(id: string): string {
  if (!isValidContainerId(id)) throw new Error(`bad container id: ${String(id).slice(0, 40)}`)
  return `persist:cnt-${id}`
}

/** Normalize one raw registry entry; null when unusable. */
export function normalizeContainer(raw: unknown): ContainerDef | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const id = typeof r.id === 'string' ? r.id : ''
  if (!isValidContainerId(id)) return null
  const name = sanitizeContainerName(r.name)
  if (!name) return null
  return {
    id,
    name,
    color: normalizeColor(r.color),
    proxyUrl: typeof r.proxyUrl === 'string' ? r.proxyUrl.slice(0, 300) : '',
    timezone: normalizeTimezone(r.timezone),
    builtin: r.builtin === true,
    ts: typeof r.ts === 'number' && Number.isFinite(r.ts) ? r.ts : Date.now()
  }
}

/** Normalize a whole registry: valid entries only, ids deduped (first wins). */
export function sanitizeRegistry(raw: unknown): ContainerRegistry {
  let list: unknown[] = []
  if (raw && typeof raw === 'object') {
    const conts = (raw as { containers?: unknown }).containers
    if (Array.isArray(conts)) list = conts
  }
  const out: ContainerDef[] = []
  const seen = new Set<string>()
  for (const item of list) {
    const c = normalizeContainer(item)
    if (!c || seen.has(c.id)) continue
    seen.add(c.id)
    out.push(c)
  }
  return { containers: out }
}

export function containerById(list: readonly ContainerDef[], id: string | null | undefined): ContainerDef | null {
  if (!id) return null
  return list.find((c) => c.id === id) || null
}

/** Names must be unique — "Work 2" suffixing on collision (groups do this too). */
export function uniqueName(name: string, list: readonly ContainerDef[]): string {
  const taken = new Set(list.map((c) => c.name.toLowerCase()))
  if (!taken.has(name.toLowerCase())) return name
  for (let n = 2; n < 100; n++) {
    const cand = `${name} ${n}`
    if (!taken.has(cand.toLowerCase())) return cand
  }
  return `${name} ${Date.now().toString(36)}`
}
