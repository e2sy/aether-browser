/**
 * Multi-profiles (v2.4.0 build 18) — pure policy shared between the main
 * process and the tests.
 *
 * Design (Chrome-style, honest Electron mapping):
 *   • A profile is a FULL data directory: its own history, bookmarks,
 *     passwords vault, cookies, cache and settings — because userData is
 *     switched before the single-instance lock is acquired (preboot), every
 *     store under app.getPath('userData') isolates for free.
 *   • `--aether-profile=<id>` selects the profile at boot. The DEFAULT
 *     profile keeps the original userData dir (zero migration for existing
 *     users); extra profiles live under <original userData>/profiles/<id>.
 *   • The profiles REGISTRY always lives at <original userData>/profiles.json
 *     — a fixed path computed before any setPath, so every profile can see
 *     and switch to every other profile.
 *   • Two different profiles CAN run side by side: Electron's single-instance
 *     lock is scoped to the userData dir, and each profile gets its own.
 */

export const DEFAULT_PROFILE_ID = 'default'

/** Chrome-like avatar palette (kept as plain hex — no CSS var dependency). */
export const PROFILE_COLORS = ['#7c8cff', '#4cc38a', '#f5a623', '#ef6c6c', '#5ac8fa', '#c792ea', '#f06292', '#9ccc65'] as const

export interface Profile {
  id: string
  name: string
  color: string
  createdAt: number
  lastUsedAt: number
}

export interface ProfileRegistry {
  profiles: Profile[]
}

/** Profile ids are filesystem-safe slugs: lowercase, digits, dashes. */
const PROFILE_ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/

export function validateProfileId(id: unknown): id is string {
  return typeof id === 'string' && PROFILE_ID_RE.test(id)
}

/** Pure: `--aether-profile=<id>` / `--aether-profile <id>` — the LAST valid
 *  occurrence wins (deterministic when argv carries junk). Returns null for
 *  absent, malformed, or explicitly-default args so the boot path stays
 *  identical to the pre-profiles one. */
export function parseProfileArg(argv: string[] | undefined): string | null {
  if (!Array.isArray(argv)) return null
  let found: string | null = null
  for (let i = 0; i < argv.length; i++) {
    const a = String(argv[i] ?? '')
    if (a.startsWith('--aether-profile=')) {
      const v = a.slice('--aether-profile='.length)
      if (validateProfileId(v) && v !== DEFAULT_PROFILE_ID) found = v
    } else if (a === '--aether-profile' && i + 1 < argv.length) {
      const v = String(argv[i + 1] ?? '')
      if (validateProfileId(v) && v !== DEFAULT_PROFILE_ID) found = v
    }
  }
  return found
}

/** Pure: trim, collapse control chars, cap at 40 visible chars; empty falls
 *  back to `fallback` (default 'Profile'). */
export function sanitizeProfileName(raw: unknown, fallback = 'Profile'): string {
  const cleaned = String(raw ?? '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 40)
  return cleaned || fallback
}

/** Pure: keep only palette colors (unknown → first palette color). */
export function normalizeProfileColor(raw: unknown): string {
  const c = String(raw ?? '')
  return (PROFILE_COLORS as readonly string[]).includes(c) ? c : PROFILE_COLORS[0]
}

/** Pure: sortable unique id — 'p' + base36 timestamp + short random tail. */
export function newProfileId(now = Date.now(), rng = Math.random): string {
  const tail = Math.floor(rng() * 46656)
    .toString(36)
    .padStart(3, '0')
  return `p${now.toString(36)}${tail}`
}

/** Pure: first avatar letter, uppercased (CRLF/controls already stripped by
 *  sanitizeProfileName upstream). */
export function profileInitial(name: string): string {
  const n = String(name ?? '').trim()
  return (n ? n[0] : '?').toUpperCase()
}

/**
 * Pure: normalize an on-disk registry of unknown shape into a safe one.
 *  - drops entries that fail shape/id validation
 *  - coerces name/color/ts fields (never trusts disk)
 *  - guarantees exactly one DEFAULT entry (seeded when missing, deduped)
 *  - orders: default first, then most-recently-used
 *  - caps at MAX_PROFILES (16) after the default
 */
export const MAX_PROFILES = 16

export function normalizeRegistry(raw: unknown, now = Date.now()): ProfileRegistry {
  const list: Profile[] = []
  const seen = new Set<string>()
  const arr = Array.isArray((raw as ProfileRegistry | null)?.profiles) ? (raw as ProfileRegistry).profiles : []
  for (const item of arr) {
    if (!item || typeof item !== 'object') continue
    const rec = item as Partial<Profile>
    if (!validateProfileId(rec.id) || seen.has(rec.id)) continue
    if (rec.id === DEFAULT_PROFILE_ID) continue // default is appended once, below
    seen.add(rec.id)
    list.push({
      id: rec.id,
      name: sanitizeProfileName(rec.name, `Profile ${list.length + 2}`),
      color: normalizeProfileColor(rec.color),
      createdAt: typeof rec.createdAt === 'number' && rec.createdAt > 0 ? rec.createdAt : now,
      lastUsedAt: typeof rec.lastUsedAt === 'number' && rec.lastUsedAt > 0 ? rec.lastUsedAt : 0
    })
  }
  list.sort((a, b) => b.lastUsedAt - a.lastUsedAt)
  const capped = list.slice(0, MAX_PROFILES - 1)
  const def: Profile = {
    id: DEFAULT_PROFILE_ID,
    name: 'Personal',
    color: PROFILE_COLORS[0],
    createdAt: now,
    lastUsedAt: now
  }
  return { profiles: [def, ...capped] }
}

/** Pure: is deleting this profile allowed? (policy mirrored by IPC layer) */
export function canDeleteProfile(
  profiles: Profile[],
  id: string,
  activeId: string
): { ok: boolean; error?: string } {
  if (id === DEFAULT_PROFILE_ID) return { ok: false, error: 'The default profile cannot be deleted' }
  if (!profiles.some((p) => p.id === id)) return { ok: false, error: 'Unknown profile' }
  if (id === activeId) return { ok: false, error: 'Switch to another profile before deleting this one' }
  return { ok: true }
}

/** Pure: registry update — touch lastUsedAt for a profile switch. */
export function touchProfile(reg: ProfileRegistry, id: string, now = Date.now()): ProfileRegistry {
  return { profiles: reg.profiles.map((p) => (p.id === id ? { ...p, lastUsedAt: now } : p)) }
}
